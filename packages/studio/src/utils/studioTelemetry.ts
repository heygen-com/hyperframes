import { resolveStudioDistinctId } from "../telemetry/distinctId";

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

function isEnabled(): boolean {
  try {
    return localStorage.getItem("hf-studio-telemetry-opt-out") !== "1";
  } catch {
    return true;
  }
}

function getSessionProperties(): EventProperties {
  return {
    studio_version: typeof __STUDIO_VERSION__ !== "undefined" ? __STUDIO_VERSION__ : "dev",
    screen_width: window.screen?.width,
    screen_height: window.screen?.height,
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
    user_agent: navigator.userAgent,
    url_hash: location.hash.replace(/#project\//, ""),
  };
}

declare const __STUDIO_VERSION__: string;

export function trackStudioEvent(event: string, properties: EventProperties = {}): void {
  if (!isEnabled()) return;

  queue.push({
    event: `studio:${event}`,
    properties: { ...getSessionProperties(), ...properties },
    timestamp: new Date().toISOString(),
  });

  if (!flushTimer) {
    flushTimer = setInterval(flushEvents, FLUSH_INTERVAL_MS);
  }
}

async function flushEvents(): Promise<void> {
  if (queue.length === 0) return;

  const batch = queue.map((e) => ({
    event: e.event,
    properties: { ...e.properties, $ip: null },
    distinct_id: getDistinctId(),
    timestamp: e.timestamp,
  }));
  queue = [];

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
  const batch = queue.map((e) => ({
    event: e.event,
    properties: { ...e.properties, $ip: null },
    distinct_id: getDistinctId(),
    timestamp: e.timestamp,
  }));
  queue = [];
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
