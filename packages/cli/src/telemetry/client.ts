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

let eventQueue: Array<{
  event: string;
  properties: EventProperties;
  timestamp: string;
  // Override for the batch distinct_id. Defaults to the install's anonymousId.
  // Used to attribute server-side studio renders to the browser user who
  // triggered them, so the render funnel is joinable across processes.
  distinctId?: string;
}> = [];

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
    },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Drain the in-memory queue into a PostHog `/batch/` payload string.
 * Returns null when there's nothing to send. Resets the queue as a side effect
 * so callers can fire-and-forget the resulting payload.
 *
 * $ip:null tells PostHog not to record the request IP for any of these events.
 * Server-side "Discard client IP data" is also enabled in project settings.
 */
function drainQueueToPayload(): string | null {
  if (eventQueue.length === 0) return null;
  const config = readConfig();
  const batch = eventQueue.map((e) => ({
    event: e.event,
    properties: { ...e.properties, $ip: null },
    distinct_id: e.distinctId ?? config.anonymousId,
    timestamp: e.timestamp,
  }));
  eventQueue = [];
  return JSON.stringify({ api_key: POSTHOG_API_KEY, batch });
}

/**
 * Flush all queued events to PostHog via async HTTP POST.
 * Called before normal process exit via `beforeExit`.
 */
export async function flush(): Promise<void> {
  const payload = drainQueueToPayload();
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
  } catch {
    // Silently ignore — telemetry must never break the CLI
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
  const payload = drainQueueToPayload();
  if (payload == null) return;

  try {
    const { spawn } = require("node:child_process") as typeof import("node:child_process");
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
  console.log(`  ${c.dim("No personal info, file paths, or content is collected.")}`);
  console.log();
  console.log(`  ${c.dim("Disable anytime:")} ${c.accent("hyperframes telemetry disable")}`);
  console.log();

  return true;
}
