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

import { hostname, networkInterfaces } from "node:os";
import { readConfig, readConfigFresh } from "../telemetry/config.js";
import {
  resetTelemetryPostureCache,
  shouldTrack as telemetryShouldTrack,
} from "../telemetry/client.js";
import { canaryDecisionsForStudio, type CliCanaryDecision } from "../telemetry/canary.js";

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

/**
 * Is this request's `Host` a loopback name the studio server could have been
 * reached on directly?
 *
 * A bare `[::1]`/`localhost`/dotted-quad check rather than a full parse: the
 * port is irrelevant (any port on loopback is us), and anything exotic enough
 * to miss here should be refused rather than guessed at.
 *
 * Scope, stated precisely: this is a **DNS-rebinding mitigation for browsers**,
 * not access control. A browser sets `Host` from the URL it was given, so a
 * page that rebinds its own hostname to 127.0.0.1 arrives carrying that
 * hostname and is refused. A non-browser client sets `Host` to whatever it
 * likes, so this stops nothing there — but on a loopback-bound server such a
 * client is already local, and on a LAN-bound one it can read the project
 * files through the unauthenticated studio API anyway. See `identityAllowed`.
 */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  // Strip the port. IPv6 literals are bracketed (`[::1]:1234`), so take the
  // bracketed part when present and only split on ":" otherwise.
  const bracketed = /^\[([^\]]+)\]/.exec(host);
  const hostname = (bracketed ? bracketed[1] : host.split(":")[0])?.toLowerCase() ?? "";
  if (hostname === "localhost" || hostname === "::1" || hostname === "0:0:0:0:0:0:0:1") return true;
  // 127.0.0.0/8 — the whole loopback block, not just 127.0.0.1.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
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
 * The `<head>` scripts for a request, given its `Host`.
 *
 * The Host split lives here rather than in the route so it is testable
 * without a Studio bundle on disk — the route's own test can only reach the
 * injection branch when `packages/studio/dist` happens to be built, which is
 * true locally and false in the CI test lane.
 */
/** Hostname of a `Host` header, port and IPv6 brackets removed. */
function hostnameOf(host: string | undefined): string {
  if (!host) return "";
  const bracketed = /^\[([^\]]+)\]/.exec(host);
  return (bracketed ? bracketed[1] : host.split(":")[0])?.toLowerCase() ?? "";
}

/**
 * Names this machine legitimately answers to on a wildcard bind: every
 * interface address, plus its own hostname and the `.local` mDNS form people
 * actually type. Fail closed — a throw yields an empty set, which denies.
 */
function localNames(): Set<string> {
  const names = new Set<string>();
  try {
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) names.add(entry.address.toLowerCase());
    }
    const self = hostname().toLowerCase();
    if (self !== "") {
      names.add(self);
      // `my-box` is reachable as `my-box.local`, and a `my-box.lan.example`
      // FQDN is reachable by its short form. Register both directions.
      names.add(`${self}.local`);
      const short = self.split(".")[0];
      if (short !== undefined && short !== "") {
        names.add(short);
        names.add(`${short}.local`);
      }
    }
  } catch {
    /* fail closed */
  }
  return names;
}

/**
 * Wildcard binds answer on every local name; a specific bind on itself only.
 *
 * This is the part that was missing: the previous rule accepted ANY Host once
 * the env var was set, so a rebinding page could name itself `evil.example.com`
 * and still be handed the CLI identity.
 */
function hostMatchesBind(host: string | undefined, bind: string): boolean {
  const requested = hostnameOf(host);
  if (requested === "") return false;
  const bound = bind.toLowerCase();
  if (requested === bound) return true;
  return bound === "0.0.0.0" || bound === "::" || bound === "*"
    ? localNames().has(requested)
    : false;
}

/**
 * May this request receive the CLI's identity (distinct id + bucket seed)?
 *
 * The server binds loopback by DEFAULT and exposes the LAN only when an
 * operator sets `HYPERFRAMES_PREVIEW_HOST` (portUtils.ts, F-001). A loopback
 * `Host` is always fine: whatever reached us came via loopback, and the only
 * interesting attacker is a rebinding browser page — which the Host check
 * catches, because a browser cannot forge `Host`.
 *
 * For anything else the bind decides:
 *
 *  - **Unset, or bound to loopback.** No LAN exposure was requested, so the
 *    Host check is a live rebinding mitigation and a non-loopback Host is
 *    refused. Previously ANY non-empty value disabled the check, so even
 *    `HYPERFRAMES_PREVIEW_HOST=127.0.0.1` — which exposes nothing — turned the
 *    loopback service from hostile-Host refusal into accept-everything.
 *  - **Bound to a LAN address.** The operator opted into exposure, so identity
 *    has to reach the LAN name the user browses or the CLI-to-Studio stitch
 *    breaks and Studio mints a second person for the same human. But it is
 *    still checked: the Host must name an address this machine actually
 *    answers on, not any attacker-chosen name a rebinding page supplies.
 */
export function identityAllowed(host: string | undefined): boolean {
  if (isLoopbackHost(host)) return true;
  const bind = (process.env["HYPERFRAMES_PREVIEW_HOST"] ?? "").trim();
  if (bind === "" || isLoopbackHost(bind)) return false;
  return hostMatchesBind(host, bind);
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

export function buildStudioHeadScriptsForHost(envScript: string, host: string | undefined): string {
  refreshTelemetryPosture();
  return buildStudioHeadScripts(envScript, { includeIdentity: identityAllowed(host) });
}
