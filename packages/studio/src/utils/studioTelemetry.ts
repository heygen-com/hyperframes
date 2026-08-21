import { resolveStudioDistinctId } from "../telemetry/distinctId";
import { browserTelemetryAllowed } from "../telemetry/policy";
import { canaryEventProperties } from "../telemetry/canary";
import { agentRuntimeProperty } from "../telemetry/agentRuntime";

// PostHog public ingest key — write-only, safe to ship in the client bundle
const POSTHOG_API_KEY = "phc_zjjbX0PnWxERXrMHhkEJWj9A9BhGVLRReICgsfTMmpx";
const POSTHOG_HOST = "https://us.i.posthog.com";
const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_TIMEOUT_MS = 5_000;

interface EventProperties {
  [key: string]: string | number | boolean | null | undefined;
}

interface QueuedEvent {
  event: string;
  properties: EventProperties;
  timestamp: string;
}

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

// Delegates to the single source of truth (telemetry/distinctId.ts) so `studio:*`
// events share one id with `studio_*` / render events, and adopt the CLI's
// distinct_id when the CLI launched Studio.
function getDistinctId(): string {
  return resolveStudioDistinctId();
}

/**
 * This path predates telemetry/config.ts and enforced only its own
 * localStorage key, so `navigator.doNotTrack`, VITE_HYPERFRAMES_NO_TELEMETRY,
 * Vite dev mode and the documented `hyperframes-studio:telemetryDisabled` all
 * failed to silence `studio:*` events. Now one shared policy governs every
 * transport — including the legacy key, which it still honours.
 */
function isEnabled(): boolean {
  return browserTelemetryAllowed();
}

function getSessionProperties(): EventProperties {
  return {
    studio_version: typeof __STUDIO_VERSION__ !== "undefined" ? __STUDIO_VERSION__ : "dev",
    // On EVERY event, not just the audio ones. "Which of these sessions was a
    // person and which was an agent" is a question worth asking of any feature,
    // and a property that only some events carry cannot answer it — the
    // breakdown silently reads as though the agent never used the rest.
    agent_runtime: agentRuntimeProperty(),
    screen_width: window.screen?.width,
    screen_height: window.screen?.height,
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
    user_agent: navigator.userAgent,
    // Route slug only — drop the query string, which carries the current
    // selection (selId / selSelector are the user's own element ids/CSS
    // selectors) and other view state we must not send to analytics.
    url_hash: location.hash.replace(/#project\//, "").split("?")[0],
  };
}

declare const __STUDIO_VERSION__: string;

export function trackStudioEvent(event: string, properties: EventProperties = {}): void {
  if (!isEnabled()) return;

  queue.push({
    event: `studio:${event}`,
    // Canary assignments on every event, matching the CLI and the newer
    // studio client — "every telemetry event carries the assignment" has to
    // include this path or a cohort breakdown silently omits `studio:*`.
    properties: { ...getSessionProperties(), ...canaryEventProperties(), ...properties },
    timestamp: new Date().toISOString(),
  });

  if (!flushTimer) {
    flushTimer = setInterval(flushEvents, FLUSH_INTERVAL_MS);
  }
}

/** The queue, shaped for PostHog's batch endpoint — shared by both drain paths. */
function drainBatch() {
  const batch = queue.map((e) => ({
    event: e.event,
    properties: { ...e.properties, $ip: null },
    distinct_id: getDistinctId(),
    timestamp: e.timestamp,
  }));
  queue = [];
  return batch;
}

async function flushEvents(): Promise<void> {
  if (queue.length === 0) return;

  const batch = drainBatch();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);

  try {
    await fetch(`${POSTHOG_HOST}/batch/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: POSTHOG_API_KEY, batch }),
      signal: controller.signal,
    });
  } catch {
    // Telemetry must never break the studio
  } finally {
    clearTimeout(timeout);
  }
}

// Synchronously drains the queue via sendBeacon — safe to call from any
// tab-hide handler regardless of listener registration order. Exported so
// other modules (e.g. sdkResolverShadow.ts) can force delivery of an event
// they just queued without racing this module's own visibilitychange
// listener below.
export function flushViaBeacon(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return;
  const batch = drainBatch();
  const body = JSON.stringify({ api_key: POSTHOG_API_KEY, batch });
  try {
    navigator.sendBeacon(`${POSTHOG_HOST}/batch/`, body);
  } catch {
    // best-effort
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushViaBeacon();
  });
}
