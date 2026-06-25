// ---------------------------------------------------------------------------
// Lightweight PostHog client for the studio browser bundle.
// Mirrors `packages/cli/src/telemetry/client.ts` but uses fetch/sendBeacon.
// All calls are fire-and-forget; telemetry must never break the studio UI.
// ---------------------------------------------------------------------------

import { getAnonymousId, hasShownNotice, isOptedOut, markNoticeShown } from "./config";
import { getBrowserSystemMeta } from "./system";

// Write-only PostHog project key, safe to embed in client code.
const POSTHOG_API_KEY = "phc_zjjbX0PnWxERXrMHhkEJWj9A9BhGVLRReICgsfTMmpx";
const POSTHOG_HOST = "https://us.i.posthog.com";
const FLUSH_INTERVAL_MS = 1_000;

type EventProperties = Record<string, string | number | boolean | undefined>;

interface QueuedEvent {
  event: string;
  properties: EventProperties;
  timestamp: string;
}

let eventQueue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let telemetryEnabled: boolean | null = null;

function isDoNotTrackOn(): boolean {
  return typeof navigator !== "undefined" && navigator.doNotTrack === "1";
}

function isApiKeyConfigured(): boolean {
  return POSTHOG_API_KEY.startsWith("phc_");
}

// VITE_HYPERFRAMES_NO_TELEMETRY mirrors the CLI's HYPERFRAMES_NO_TELEMETRY=1
// opt-out so HeyGen's own dev/CI builds can suppress telemetry from the studio
// bundle the same way. Vite injects it at build time. Accepts "1" or "true".
// `import.meta.env` may be undefined in non-Vite bundlers (Next.js Turbopack).
function isBuildTimeOptOut(): boolean {
  try {
    const v = import.meta.env.VITE_HYPERFRAMES_NO_TELEMETRY as string | undefined;
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

// `import.meta.env.DEV` is true under `vite dev` / `vite preview`. Auto-suppress
// so developers running `hyperframes preview` don't pollute production telemetry.
function isViteDevMode(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

export function shouldTrack(): boolean {
  if (telemetryEnabled !== null) return telemetryEnabled;
  telemetryEnabled =
    isApiKeyConfigured() &&
    !isBuildTimeOptOut() &&
    !isViteDevMode() &&
    !isOptedOut() &&
    !isDoNotTrackOn();
  return telemetryEnabled;
}

export function trackEvent(event: string, properties: EventProperties = {}): void {
  if (!shouldTrack()) return;

  const sys = getBrowserSystemMeta();
  eventQueue.push({
    event,
    properties: { ...properties, ...sys },
    timestamp: new Date().toISOString(),
  });

  if (flushTimer === null) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, FLUSH_INTERVAL_MS);
  }
  showNoticeOnce();
}

// Fire-and-forget: the queue is cleared before `send()` resolves, so a network
// failure drops the batch rather than retrying. Matches the CLI client's
// design. Do NOT add retry logic here — a retry without cross-batch dedup
// would risk double-counting events on transient PostHog 5xx responses.
function flush(): void {
  if (eventQueue.length === 0) return;
  const distinctId = getAnonymousId();
  const batch = eventQueue.map((e) => ({
    event: e.event,
    // $ip: null tells PostHog to not record the request IP.
    properties: { ...e.properties, $ip: null },
    distinct_id: distinctId,
    timestamp: e.timestamp,
  }));
  eventQueue = [];
  send(`${POSTHOG_HOST}/batch/`, JSON.stringify({ api_key: POSTHOG_API_KEY, batch }));
}

function send(url: string, payload: string): void {
  // Prefer fetch with keepalive (survives page navigation). sendBeacon is a
  // fallback for older runtimes where fetch isn't available.
  try {
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {
      /* silent */
    });
    return;
  } catch {
    /* fall through */
  }
  try {
    navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
  } catch {
    /* silent */
  }
}

function showNoticeOnce(): void {
  if (hasShownNotice()) return;
  markNoticeShown();
  // Intentional one-time consent disclosure (not debug noise): tells users
  // anonymous analytics are on and how to opt out. Kept behind a pragma.
  // eslint-disable-next-line no-console
  console.info(
    "%c[HyperFrames]%c Anonymous studio usage analytics enabled. " +
      "Disable: localStorage.setItem('hyperframes-studio:telemetryDisabled','1') (then reload).",
    "color:#7c3aed;font-weight:bold",
    "color:inherit",
  );
}

// Flush queued events when the tab is being hidden or closed so tail events
// (e.g. a render_start fired moments before the user navigates away) aren't lost.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => flush(), { capture: true });
  window.addEventListener("visibilitychange", () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") flush();
  });
}
