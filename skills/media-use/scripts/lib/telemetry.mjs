// Anonymous, opt-out usage tracking for media-use, mirroring the hyperframes CLI
// telemetry (packages/cli/src/telemetry). Answers "is this actually used, and
// which capabilities" without any PII: we send the media TYPE, the resolution
// SOURCE, and the winning PROVIDER: never the intent text, file names, or paths.
//
// Same public PostHog project key as the CLI (a write-only ingestion key, safe
// to ship), same opt-outs (DO_NOT_TRACK / HYPERFRAMES_NO_TELEMETRY / CI), and
// $ip:null so no IP is recorded. Fire-and-forget: telemetry never blocks a
// resolve and never throws into it.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const POSTHOG_API_KEY = "phc_zjjbX0PnWxERXrMHhkEJWj9A9BhGVLRReICgsfTMmpx";
const POSTHOG_HOST = "https://us.i.posthog.com";
const TIMEOUT_MS = 1500;

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

// Stable per-machine anonymous id, persisted in the dir media-use already owns.
function anonymousId() {
  const dir = join(homedir(), ".media");
  const file = join(dir, "anon-id");
  try {
    if (existsSync(file)) return readFileSync(file, "utf8").trim();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const id = randomUUID();
    writeFileSync(file, id);
    return id;
  } catch {
    return "anon"; // best-effort; a shared bucket is fine if the fs is read-only
  }
}

/**
 * Fire-and-forget a single event to PostHog. Best-effort: awaited with a short
 * timeout so a short-lived script flushes before exit, but any failure (offline,
 * opted out) is swallowed. `properties` must be non-PII (no intent/paths).
 */
export async function track(event, properties = {}) {
  if (optedOut()) return;
  const body = JSON.stringify({
    api_key: POSTHOG_API_KEY,
    batch: [
      {
        event,
        properties: { ...properties, surface: "media-use", $ip: null },
        distinct_id: anonymousId(),
        timestamp: new Date().toISOString(),
      },
    ],
  });
  try {
    await fetch(`${POSTHOG_HOST}/batch/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Connection: "close" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // telemetry is best-effort; never surface into the command
  }
}
