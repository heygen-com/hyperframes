/**
 * Runtime analytics — vendor-agnostic event emission.
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
 *   if (e.data?.source !== "hf-preview" || e.data?.type !== "analytics") return;
 *   const { event, properties } = e.data;
 *
 *   // PostHog:
 *   posthog.capture(event, properties);
 *   // Mixpanel:
 *   mixpanel.track(event, properties);
 *   // Custom:
 *   myLogger.track(event, properties);
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

// Stored reference to the postRuntimeMessage function, set during init.
// Avoids a circular import between analytics ↔ bridge.
let _postMessage: ((payload: unknown) => void) | null = null;

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
