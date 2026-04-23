/**
 * Runtime analytics & performance telemetry — vendor-agnostic event emission.
 *
 * The runtime emits structured events via postMessage. The host application
 * decides what to do with them: forward to PostHog, Mixpanel, Amplitude,
 * a custom logger, or nothing at all.
 *
 * For session replay: initialize your analytics SDK (e.g. PostHog) only in
 * the parent app with `recordCrossOriginIframes: true`. No SDK needs to run
 * inside this iframe.
 *
 * ## Host app integration
 *
 * ```javascript
 * window.addEventListener("message", (e) => {
 *   if (e.data?.source !== "hf-preview") return;
 *
 *   if (e.data.type === "analytics") {
 *     // discrete lifecycle events: composition_loaded, played, seeked, etc.
 *     posthog.capture(e.data.event, e.data.properties);
 *   }
 *
 *   if (e.data.type === "perf") {
 *     // numeric performance metrics: scrub latency, fps, decoder count, etc.
 *     // Aggregate per-session (p50/p95) and forward on flush.
 *     myMetrics.observe(e.data.name, e.data.value, e.data.tags);
 *   }
 * });
 * ```
 */

export type RuntimeAnalyticsEvent =
  | "composition_loaded"
  | "composition_played"
  | "composition_paused"
  | "composition_seeked"
  | "composition_ended"
  | "element_picked";

export type RuntimeAnalyticsProperties = Record<string, string | number | boolean | null>;

/**
 * Tags attached to a performance metric — small, low-cardinality identifiers
 * (composition id hash, media count bucket, browser version, etc.). Same shape
 * as analytics properties so hosts can forward both through one pipeline.
 */
export type RuntimePerformanceTags = Record<string, string | number | boolean | null>;

// Stored reference to the postRuntimeMessage function, set during init.
// Avoids a circular import between analytics ↔ bridge. Shared by both
// emitAnalyticsEvent and emitPerformanceMetric — one bridge, two channels.
let _postMessage: ((payload: unknown) => void) | null = null;

/**
 * Wire the analytics + performance bridge to the runtime's postMessage transport.
 * Called once during runtime bootstrap from `init.ts`.
 */
export function initRuntimeAnalytics(postMessage: (payload: unknown) => void): void {
  _postMessage = postMessage;
}

/**
 * Emit an analytics event through the bridge.
 * The host app receives it via postMessage and forwards to its analytics provider.
 */
export function emitAnalyticsEvent(
  event: RuntimeAnalyticsEvent,
  properties?: RuntimeAnalyticsProperties,
): void {
  if (!_postMessage) return;
  try {
    _postMessage({
      source: "hf-preview",
      type: "analytics",
      event,
      properties: properties ?? {},
    });
  } catch {
    // Never let analytics failures affect the runtime
  }
}

/**
 * Emit a numeric performance metric through the bridge.
 *
 * Used for player-perf telemetry — scrub latency, sustained fps, dropped
 * frames, decoder count, composition load time, media sync drift. The host
 * aggregates per-session values (p50/p95) and forwards to its observability
 * pipeline on flush.
 *
 * Also writes a `performance.mark()` so the metric shows up under the
 * DevTools Performance panel's "User Timing" track for local debugging,
 * with `value` and `tags` available on the entry's `detail` field.
 *
 * @param name   Metric name, e.g. "player_scrub_latency", "player_playback_fps"
 * @param value  Numeric value (units are metric-specific: ms for latency, fps for rate, etc.)
 * @param tags   Optional low-cardinality tags (composition id, media count bucket, etc.)
 */
export function emitPerformanceMetric(
  name: string,
  value: number,
  tags?: RuntimePerformanceTags,
): void {
  // Local DevTools breadcrumb. Wrapped because performance.mark() can throw on
  // strict CSP, when the document is not yet ready, or when `detail` is non-cloneable.
  try {
    if (typeof performance !== "undefined" && typeof performance.mark === "function") {
      performance.mark(name, { detail: { value, tags: tags ?? {} } });
    }
  } catch {
    // performance API unavailable or rejected — keep going
  }

  if (!_postMessage) return;
  try {
    _postMessage({
      source: "hf-preview",
      type: "perf",
      name,
      value,
      tags: tags ?? {},
    });
  } catch {
    // Never let telemetry failures affect the runtime
  }
}
