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

// Stable per-machine anonymous id, read from the shared CLI/studio contract.
function anonymousId() {
  const dir = join(homedir(), ".hyperframes");
  const file = join(dir, "config.json");
  try {
    let config = {};
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed;
      } catch {
        config = {};
      }
      if (typeof config.anonymousId === "string" && config.anonymousId.trim()) {
        return config.anonymousId.trim();
      }
    }
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const id = randomUUID();
    writeFileSync(file, JSON.stringify({ ...config, anonymousId: id }, null, 2) + "\n");
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
  const dir = join(homedir(), ".media");
  const file = join(dir, "telemetry-notice-shown");
  try {
    if (existsSync(file)) return;
  } catch {
    return;
  }
  console.error(
    [
      "media-use sends usage telemetry: media type, resolution source, and provider; never intent text, file names, or paths.",
      "If you sign in to HeyGen, usage links to your account email or username. Opt out with HYPERFRAMES_NO_TELEMETRY=1 or DO_NOT_TRACK=1.",
    ].join("\n"),
  );
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, new Date().toISOString() + "\n");
  } catch {
    // notice marker is best-effort; never surface into the command
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
