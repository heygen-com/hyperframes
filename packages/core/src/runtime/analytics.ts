import { swallow } from "./diagnostics";
/**
 * Runtime analytics — vendor-agnostic event emission via postMessage.
 *
 * The host application decides what to do with events: forward to PostHog,
 * Mixpanel, Amplitude, a custom logger, or nothing at all.
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
  } catch (err) {
    // Never let analytics failures affect the runtime
    swallow("runtime.analytics.site1", err);
  }
}
