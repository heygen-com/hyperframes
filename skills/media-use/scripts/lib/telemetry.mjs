// Opt-out usage tracking for media-use, sharing the hyperframes CLI/studio
// identity (packages/cli/src/telemetry): the same install id from
// ~/.hyperframes/config.json, plus a $identify to the HeyGen account on sign-in,
// so a person is one PostHog profile across surfaces — not a fresh id per tool.
// Not fully anonymous by design (it must dedupe): pseudonymous before sign-in,
// account-linked after. Event PROPERTIES stay coarse — media TYPE, resolution
// SOURCE, winning PROVIDER — never the intent text, file names, or paths.
//
// Same public PostHog project key as the CLI (a write-only ingestion key, safe
// to ship), same opt-outs (DO_NOT_TRACK / HYPERFRAMES_NO_TELEMETRY / CI / dev),
// and $ip:null so no IP is recorded. Fire-and-forget: telemetry never blocks a
// resolve and never throws into it.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const POSTHOG_API_KEY = "phc_zjjbX0PnWxERXrMHhkEJWj9A9BhGVLRReICgsfTMmpx";
const POSTHOG_HOST = "https://us.i.posthog.com";
const TIMEOUT_MS = 1500;
let identifiedAccount = false;

/** True when telemetry must NOT be sent (opt-out envs, CI, dev). */
export function optedOut() {
  return (
    process.env.HYPERFRAMES_NO_TELEMETRY === "1" ||
    process.env.DO_NOT_TRACK === "1" ||
    process.env.CI === "true" ||
    process.env.CI === "1" ||
    process.env.NODE_ENV === "development"
  );
}

// CLI + studio share one install identity in ~/.hyperframes/config.json
// (packages/cli/src/telemetry/config.ts — same path, same `anonymousId` /
// `telemetryNoticeShown` fields). Read and write that same file so media-use is
// the same PostHog person and shows the notice once per person, not per tool.
// Computed per call (not a module const) so it honors HOME at runtime — tests
// sandbox HOME, and os.homedir() re-reads it each call.
function sharedConfigPath() {
  return join(homedir(), ".hyperframes", "config.json");
}

function readSharedConfig() {
  try {
    const file = sharedConfigPath();
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    }
  } catch {
    // unreadable config → treat as empty; never throw
  }
  return {};
}

function writeSharedConfig(config) {
  const dir = join(homedir(), ".hyperframes");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(config, null, 2) + "\n");
}

// Adopt a pre-existing media-use-only id (~/.media/anon-id from before this
// change) so upgraders keep their PostHog persona instead of resetting to a new
// one — otherwise cross-surface continuity would start over on upgrade.
function legacyMediaAnonId() {
  try {
    const file = join(homedir(), ".media", "anon-id");
    if (existsSync(file)) {
      const id = readFileSync(file, "utf8").trim();
      if (id) return id;
    }
  } catch {
    // ignore
  }
  return null;
}

// Stable per-machine id from the shared config; seeds it (adopting a legacy
// media-use id when present) if absent.
function anonymousId() {
  try {
    const config = readSharedConfig();
    if (typeof config.anonymousId === "string" && config.anonymousId.trim()) {
      return config.anonymousId.trim();
    }
    const id = legacyMediaAnonId() || randomUUID();
    writeSharedConfig({ ...config, anonymousId: id });
    return id;
  } catch {
    return "anon"; // best-effort; a shared bucket is fine if the fs is read-only
  }
}

function heygenAccountDistinctId() {
  const file = join(process.env.HEYGEN_CONFIG_DIR || join(homedir(), ".heygen"), "credentials");
  try {
    if (!existsSync(file)) return null;
    const raw = readFileSync(file, "utf8").trim();
    if (!raw.startsWith("{")) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const user = parsed.user;
    if (!user || typeof user !== "object" || Array.isArray(user)) return null;
    const id = typeof user.email === "string" && user.email.trim() ? user.email : user.username;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

function showTelemetryNotice() {
  if (optedOut()) return;
  try {
    const config = readSharedConfig();
    // Shared with the CLI (config.telemetryNoticeShown): shown once per person
    // across surfaces, not once per tool.
    if (config.telemetryNoticeShown === true) return;
    console.error(
      [
        "media-use sends usage telemetry: media type, resolution source, and provider; never intent text, file names, or paths.",
        "If you sign in to HeyGen, usage links to your account email or username. Opt out with HYPERFRAMES_NO_TELEMETRY=1 or DO_NOT_TRACK=1.",
      ].join("\n"),
    );
    writeSharedConfig({ ...config, telemetryNoticeShown: true });
  } catch {
    // notice is best-effort; never surface into the command
  }
}

async function postBatch(batch) {
  try {
    await fetch(`${POSTHOG_HOST}/batch/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Connection: "close" },
      body: JSON.stringify({ api_key: POSTHOG_API_KEY, batch }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // telemetry is best-effort; never surface into the command
  }
}

async function postEvent(event, properties, distinctId) {
  await postBatch([
    {
      event,
      properties: { ...properties, surface: "media-use", $ip: null },
      distinct_id: distinctId,
      timestamp: new Date().toISOString(),
    },
  ]);
}

async function identifyAccount(anonId) {
  if (optedOut() || identifiedAccount) return;
  const distinctId = heygenAccountDistinctId();
  if (!distinctId) return;
  identifiedAccount = true;
  await postEvent("$identify", { $anon_distinct_id: anonId }, distinctId);
}

/**
 * Fire-and-forget a single event to PostHog. Best-effort: awaited with a short
 * timeout so a short-lived script flushes before exit, but any failure (offline,
 * opted out) is swallowed. `properties` must be non-PII (no intent/paths).
 */
export async function track(event, properties = {}) {
  if (optedOut()) return;
  showTelemetryNotice();
  const anonId = anonymousId();
  await identifyAccount(anonId);
  await postEvent(event, properties, anonId);
}

export function __anonymousIdForTest() {
  return anonymousId();
}

export function __resetTelemetryForTest() {
  identifiedAccount = false;
}
