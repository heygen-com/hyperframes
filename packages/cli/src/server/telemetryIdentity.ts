// ---------------------------------------------------------------------------
// CLI → Studio telemetry identity (Layer 1).
//
// The CLI owns both the Studio launch and the local server, so it seeds the
// browser with its own anonymous `config.anonymousId`. Studio adopts it as its
// distinct_id (see packages/studio/src/telemetry/distinctId.ts), so the CLI's
// `cli_command*` events and the browser's `studio:*` / `studio_*` / render
// events are attributed to one PostHog person.
//
// This uses ONLY the existing anonymous machine id (a random UUID, no PII), so
// the "no personal info" telemetry disclosure stays valid. When CLI telemetry
// is disabled (opt-out / dev / CI / DO_NOT_TRACK) nothing is seeded and Studio
// behaves exactly as if opened standalone.
//
// Kept out of studioServer.ts so it can be unit-tested without pulling in the
// server's heavy render dependencies (@hyperframes/producer, engine, …).
// ---------------------------------------------------------------------------

import { identityAllowed, isLoopbackHost } from "@hyperframes/studio-server/request-identity";
import { readConfig, readConfigFresh } from "../telemetry/config.js";
import {
  resetTelemetryPostureCache,
  shouldTrack as telemetryShouldTrack,
} from "../telemetry/client.js";
import { canaryDecisionsForStudio, type CliCanaryDecision } from "../telemetry/canary.js";
import { detectAgentRuntime } from "../telemetry/agent_runtime.js";

// The host-identity half of this module moved to
// @hyperframes/studio-server/request-identity, where the studio API's
// write guard shares the same definition. Re-exported so this module's
// existing importers keep one source for it.
export { identityAllowed, isLoopbackHost };

/**
 * The CLI's anonymous distinct id to hand to Studio, or null when CLI telemetry
 * is disabled or no id is available. Fail-silent — telemetry must never break
 * the preview server.
 */
export function resolveCliTelemetryDistinctId(): string | null {
  try {
    if (!telemetryShouldTrack()) return null;
    const id = readConfig().anonymousId;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * The CLI's canary bucket seed to hand to Studio, or null. Injected alongside
 * the distinct id so a CLI-launched Studio buckets canaries on the SAME unit
 * as the CLI — without it the two surfaces would agree only while the seed
 * still equals whatever Studio falls back to, and a rollout spanning render
 * and editor would split one user across cohorts. Same telemetry gate as the
 * distinct id: seeding is part of the identity stitch, not a separate channel.
 */
function resolveCliBucketSeed(): string | null {
  try {
    if (!telemetryShouldTrack()) return null;
    const seed = readConfig().bucketSeed;
    return typeof seed === "string" && seed.length > 0 ? seed : null;
  } catch {
    return null;
  }
}

// JSON.stringify does not escape "<" or "/". Escaping both means no
// "</script>" (or "</…") sequence can form in the emitted value, so it can
// never terminate the inline <script> or open a new tag. (The values are
// randomUUID()s, so this is belt-and-suspenders.)
function encodeInlineScriptValue(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\//g, "\\/");
}

/**
 * Same escaping, for a structured value. Separate from the string form
 * because that one stringifies its argument — passing an object through it
 * would double-encode into a quoted JSON blob.
 *
 * The keys here are registry canary names, so they are developer-authored and
 * ASCII by convention rather than user input; the escaping is belt-and-braces
 * for the same reason it is on the ids.
 */
function encodeInlineScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\//g, "\\/");
}

/**
 * The CLI's resolved canary decisions for a launched Studio, or null when
 * there are none to publish. Fail-silent, like everything else here.
 */
function resolveCliCanaryDecisions(): Record<string, CliCanaryDecision> | null {
  try {
    const decisions = canaryDecisionsForStudio();
    return Object.keys(decisions).length > 0 ? decisions : null;
  } catch {
    return null;
  }
}

/**
 * `<script>` tag to inject into the served index.html `<head>`, publishing the
 * CLI distinct id as `window.__HF_CLI_DISTINCT_ID` (plus the bucket seed and
 * resolved canary decisions) before the studio bundle runs. Preferred over a
 * URL param so the id never leaks into `$current_url` / `url_hash` telemetry
 * or browser history. Empty string only when there is nothing at all to
 * publish.
 */
export function buildCliIdentityScript(options: { includeIdentity?: boolean } = {}): string {
  const { includeIdentity = true } = options;
  const parts: string[] = [];
  parts.push(`window.__HF_CLI_TELEMETRY_DISABLED=${!telemetryShouldTrack()};`);

  // Identity is the only part gated on a trusted Host. The decisions map below
  // is not identifying, and withholding it would push a LAN/remote Studio
  // (`HYPERFRAMES_PREVIEW_HOST=0.0.0.0`, an explicitly supported mode) back to
  // re-deriving locally — reopening exactly the CLI/Studio disagreement this
  // whole mechanism exists to close.
  const cliId = includeIdentity ? resolveCliTelemetryDistinctId() : null;
  if (cliId) {
    parts.push(`window.__HF_CLI_DISTINCT_ID=${encodeInlineScriptValue(cliId)};`);
    const seed = resolveCliBucketSeed();
    if (seed) parts.push(`window.__HF_CLI_BUCKET_SEED=${encodeInlineScriptValue(seed)};`);
  }

  // Emitted even when telemetry is OFF and the identity block above is empty —
  // that is the case it exists for. With telemetry off the CLI resolves every
  // canary to `telemetry_opt_out`, but Studio's opt-out is a separate
  // localStorage flag it cannot see, so left to itself Studio would evaluate
  // normally and could enrol on a render the CLI had already excluded. Same
  // for an `HF_CANARY_*` override, which never crosses into the browser.
  //
  // Safe to publish unconditionally: these are booleans about features, not
  // identity, and strictly less than the seed they replace as Studio's input.
  const decisions = resolveCliCanaryDecisions();
  if (decisions !== null) {
    parts.push(`window.__HF_CLI_CANARY_DECISIONS=${encodeInlineScriptJson(decisions)};`);
  }

  // Which agent, if any, is driving this CLI — and therefore the Studio it just
  // opened. Studio cannot work this out for itself: the signal is entirely in
  // the CLI process's environment, which the browser never sees.
  //
  // Published on the same terms as the decisions above, and for the same
  // reason: it is a category derived from the EXISTENCE of well-known vendor
  // env vars, never their values (`agent_runtime.ts` is explicit that it never
  // reads a value, because some are API keys). One of a dozen fixed strings, or
  // absent. Nothing identifying, so it does not belong behind the trusted-Host
  // gate that gates the distinct id.
  //
  // Gated on telemetry being ON, unlike the decisions above. Those exist so a
  // Studio whose CLI opted out does not enrol itself, so they have to survive
  // the opt-out. This is only ever read to label an event, so with telemetry off
  // there is nothing for it to label — publishing it anyway would leave a marker
  // in the page of a user who asked not to be measured.
  const agent = telemetryShouldTrack() ? detectAgentRuntime() : null;
  if (agent) {
    parts.push(`window.__HF_CLI_AGENT_RUNTIME=${encodeInlineScriptValue(agent)};`);
  }

  return parts.length === 0 ? "" : `<script>${parts.join("")}</script>`;
}

/**
 * Compose the scripts injected into the served Studio `index.html` `<head>`.
 * The CLI identity script MUST come first so `window.__HF_CLI_DISTINCT_ID` is
 * set before the (deferred) Studio bundle runs telemetry init and reads it;
 * `envScript` is the existing `window.__HF_STUDIO_ENV__` injection. Keeping the
 * ordering in one pure, tested function guards against a future `<head>` inject
 * silently landing ahead of the identity script and reintroducing a boot race.
 */
export function buildStudioHeadScripts(
  envScript: string,
  options: { includeIdentity?: boolean } = {},
): string {
  return `${buildCliIdentityScript(options)}${envScript}`;
}

/**
 * Re-read the persisted telemetry preference for this request.
 *
 * Both caches have to go, together. `readConfig()` memoizes the parsed config
 * and `shouldTrack()` memoizes its own boolean on top of it, so clearing
 * either alone still yields the stale answer: the canary layer asks
 * `readConfig()`, the identity layer asks `shouldTrack()`, and they would
 * disagree mid-refresh. A long-lived `hyperframes preview` otherwise keeps
 * serving pre-opt-out decisions and injecting the CLI id for hours after
 * `hyperframes telemetry disable` runs in another terminal.
 *
 * Fail-silent and once per request — a config re-read, not a hot path.
 */
export function refreshTelemetryPosture(): void {
  try {
    readConfigFresh();
    resetTelemetryPostureCache();
  } catch {
    /* telemetry must never break the preview server */
  }
}

/**
 * The `<head>` scripts for a request, given its `Host`.
 *
 * The Host split lives here rather than in the route so it is testable
 * without a Studio bundle on disk — the route's own test can only reach the
 * injection branch when `packages/studio/dist` happens to be built, which is
 * true locally and false in the CI test lane.
 */
export function buildStudioHeadScriptsForHost(envScript: string, host: string | undefined): string {
  refreshTelemetryPosture();
  return buildStudioHeadScripts(envScript, { includeIdentity: identityAllowed(host) });
}
