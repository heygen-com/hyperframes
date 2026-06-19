/**
 * Types and type-guards for the two playback adapter paths the player supports:
 *
 *  - `RuntimeDurationAdapter` — the HyperFrames runtime exposes `window.__player`
 *    with a `getDuration()` method. This is the standard path for compositions
 *    served through the runtime bridge.
 *
 *  - `DirectTimelineAdapter` — same-origin standalone compositions can expose
 *    their GSAP master timeline at `window.__timelines` without installing the
 *    full runtime. The player drives play/pause/seek directly against the
 *    timeline object, bypassing the postMessage bridge.
 *
 *  `PlaybackDurationAdapter` is the discriminated union the probe interval
 *  returns after deciding which path is available.
 */

export interface RuntimeDurationAdapter {
  getDuration: () => number;
}

export interface DirectTimelineAdapter {
  duration: () => number;
  time: () => number;
  // suppressEvents mirrors GSAP's timeline.seek(position, suppressEvents); pass
  // false to fire onUpdate (so imperative-visibility compositions repaint on seek).
  seek: (timeInSeconds: number, suppressEvents?: boolean) => unknown;
  play: () => unknown;
  pause: () => unknown;
  /** Optional: set playback rate (e.g. GSAP's timeScale). Called when the player's playbackRate changes. */
  timeScale?: (scale: number) => unknown;
}

export type PlaybackDurationAdapter =
  | { kind: "runtime"; getDuration: () => number }
  | { kind: "direct-timeline"; timeline: DirectTimelineAdapter; getDuration: () => number };

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isRuntimeDurationAdapter(value: unknown): value is RuntimeDurationAdapter {
  return isObjectRecord(value) && typeof value.getDuration === "function";
}

export function isDirectTimelineAdapter(value: unknown): value is DirectTimelineAdapter {
  return (
    isObjectRecord(value) &&
    typeof value.duration === "function" &&
    typeof value.time === "function" &&
    typeof value.seek === "function" &&
    typeof value.play === "function" &&
    typeof value.pause === "function"
  );
}
