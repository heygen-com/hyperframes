import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readConfig, writeConfig } from "./config.js";
import { VERSION } from "../version.js";
import { c } from "../ui/colors.js";
import { isDevMode } from "../utils/env.js";
import { getSystemMeta } from "./system.js";

// This is a public project API key — safe to embed in client-side code.
// It only allows writing events, not reading data.
const POSTHOG_API_KEY = "phc_zjjbX0PnWxERXrMHhkEJWj9A9BhGVLRReICgsfTMmpx";
const POSTHOG_HOST = "https://us.i.posthog.com";
const FLUSH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Lightweight PostHog client — uses the HTTP batch API directly to avoid
// pulling in the full posthog-node SDK and its dependencies.
// All calls are fire-and-forget with a hard timeout.
// ---------------------------------------------------------------------------

interface EventProperties {
  [key: string]: string | number | boolean | null | undefined;
}

interface QueuedEvent {
  // Client-generated event id. PostHog dedupes on it, so an event that gets
  // sent by an interrupted flush() AND re-sent by the exit-time flushSync()
  // fallback still counts once.
  uuid: string;
  event: string;
  properties: EventProperties;
  timestamp: string;
  // Override for the batch distinct_id. Defaults to the install's anonymousId.
  // Used to attribute server-side studio renders to the browser user who
  // triggered them, so the render funnel is joinable across processes.
  distinctId?: string;
}

let eventQueue: QueuedEvent[] = [];

let telemetryEnabled: boolean | null = null;

/**
 * Check if telemetry should be active.
 * Disabled when: dev mode, user opted out, CI environment, or HYPERFRAMES_NO_TELEMETRY set.
 */
export function shouldTrack(): boolean {
  if (telemetryEnabled !== null) return telemetryEnabled;

  if (process.env["HYPERFRAMES_NO_TELEMETRY"] === "1" || process.env["DO_NOT_TRACK"] === "1") {
    telemetryEnabled = false;
    return false;
  }

  if (isDevMode()) {
    telemetryEnabled = false;
    return false;
  }

  // Safety check: ensure the API key has been configured (phc_ prefix = valid PostHog key)
  if (!POSTHOG_API_KEY.startsWith("phc_")) {
    telemetryEnabled = false;
    return false;
  }

  const config = readConfig();
  telemetryEnabled = config.telemetryEnabled;
  return telemetryEnabled;
}

/**
 * Queue a telemetry event. Non-blocking, fail-silent.
 */
export function trackEvent(
  event: string,
  properties: EventProperties = {},
  distinctId?: string,
): void {
  if (!shouldTrack()) return;

  const sys = getSystemMeta();
  eventQueue.push({
    uuid: randomUUID(),
    event,
    distinctId,
    properties: {
      ...properties,
      cli_version: VERSION,
      os: process.platform,
      arch: process.arch,
      node_version: process.version,
      os_release: sys.os_release,
      cpu_count: sys.cpu_count,
      cpu_model: sys.cpu_model ?? undefined,
      cpu_speed: sys.cpu_speed ?? undefined,
      memory_total_mb: sys.memory_total_mb,
      is_docker: sys.is_docker,
      is_ci: sys.is_ci,
      ci_name: sys.ci_name ?? undefined,
      is_wsl: sys.is_wsl,
      is_tty: sys.is_tty,
      sandbox_runtime: sys.sandbox_runtime ?? undefined,
      agent_runtime: sys.agent_runtime ?? undefined,
      // New-agent discovery signals — populated only when agent_runtime is null.
      agent_hint: sys.agent_hint ?? undefined,
      term_program: sys.term_program ?? undefined,
      agent_env_hints: sys.agent_env_hints ?? undefined,
    },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Serialize events into a PostHog `/batch/` payload string. Pure — the queue
 * is untouched, so callers decide when events count as delivered.
 *
 * Each event carries its client-generated `uuid`, which PostHog treats as the
 * event id — re-sending the same event is idempotent, not a duplicate.
 *
 * $ip:null tells PostHog not to record the request IP for any of these events.
 * Server-side "Discard client IP data" is also enabled in project settings.
 */
function buildPayload(events: readonly QueuedEvent[]): string | null {
  if (events.length === 0) return null;
  const config = readConfig();
  const batch = events.map((e) => ({
    uuid: e.uuid,
    event: e.event,
    properties: { ...e.properties, $ip: null },
    distinct_id: e.distinctId ?? config.anonymousId,
    timestamp: e.timestamp,
  }));
  return JSON.stringify({ api_key: POSTHOG_API_KEY, batch });
}

/**
 * Flush all queued events to PostHog via async HTTP POST.
 * Call sites: the `beforeExit` hook in cli.ts (normal exit), eager sends right
 * after high-value events (trackRenderComplete / trackRenderError), and the
 * `events` beacon command, which awaits delivery before its process exits.
 *
 * Events are only removed from the queue once the request has completed.
 * The old drain-first version silently lost the whole batch whenever the
 * process died with the fetch in flight — which is the NORMAL exit path for
 * `render`: an agent pipe closing triggers the EPIPE `process.exit(0)`, and
 * error paths call `process.exit(1)` directly, both killing the in-flight
 * request that `beforeExit` had just started. Keeping the queue intact until
 * delivery lets the exit-time flushSync() child (which survives the parent)
 * re-send anything unconfirmed; event uuids make that re-send idempotent.
 */
export async function flush(): Promise<void> {
  // Copy, not alias — events queued while the request is in flight must not
  // be swept into the "delivered" set below.
  const snapshot = eventQueue.slice();
  const payload = buildPayload(snapshot);
  if (payload == null) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);

  try {
    await fetch(`${POSTHOG_HOST}/batch/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Connection: "close" },
      body: payload,
      signal: controller.signal,
    });
    // Delivered — forget exactly what was sent (events queued while the
    // request was in flight stay for the next flush).
    const sent = new Set(snapshot);
    eventQueue = eventQueue.filter((e) => !sent.has(e));
  } catch {
    // Silently ignore — telemetry must never break the CLI. The events stay
    // queued so the exit-time flushSync() fallback can still deliver them.
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fire-and-forget flush for use in the `exit` event handler.
 * Spawns a detached child process that sends the HTTP request independently,
 * so the parent process exits immediately without waiting.
 */
export function flushSync(): void {
  const payload = buildPayload(eventQueue);
  if (payload == null) return;
  eventQueue = [];

  try {
    const child = spawn(
      process.execPath,
      [
        "-e",
        `fetch(${JSON.stringify(`${POSTHOG_HOST}/batch/`)},{method:"POST",headers:{"Content-Type":"application/json"},body:${JSON.stringify(payload)},signal:AbortSignal.timeout(${FLUSH_TIMEOUT_MS})}).catch(()=>{})`,
      ],
      { detached: true, stdio: "ignore" },
    );
    // Let the parent exit without waiting for the child
    child.unref();
  } catch {
    // Silently ignore
  }
}

/**
 * Show the first-run telemetry notice if it hasn't been shown yet.
 * Must be called BEFORE any tracking calls so the user sees the disclosure
 * before any data is sent.
 */
export function showTelemetryNotice(): boolean {
  if (!shouldTrack()) return false;

  const config = readConfig();
  if (config.telemetryNoticeShown) return false;

  // Persist the notice flag first, before any tracking occurs,
  // so the user is never tracked without having seen the disclosure.
  config.telemetryNoticeShown = true;
  writeConfig(config);

  console.log();
  console.log(`  ${c.dim("Hyperframes collects anonymous usage data to improve the tool.")}`);
  console.log(`  ${c.dim("File paths and composition content are never collected.")}`);
  console.log(
    `  ${c.dim("If you sign in to HeyGen, your account (email, or username) is linked to your usage.")}`,
  );
  console.log();
  console.log(`  ${c.dim("Disable anytime:")} ${c.accent("hyperframes telemetry disable")}`);
  console.log();

  return true;
}
