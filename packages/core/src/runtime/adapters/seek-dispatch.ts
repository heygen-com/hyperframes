import { swallow } from "../diagnostics";

/**
 * Shared, deduplicated `"hf-seek"` CustomEvent dispatcher for GPU adapters.
 *
 * Both the Three.js and TypeGPU adapters dispatch the same `"hf-seek"` event
 * so that compositions need not know which GPU library they're paired with.
 * Without deduplication, a seek to time T would fire two events (one from each
 * adapter), doubling per-scrub work in any composition that has both present.
 *
 * This module deduplicates by tracking the last dispatched time. If the same
 * time value is dispatched twice in the same synchronous call stack (e.g. two
 * adapters both calling `dispatchSeekEvent(5.0)` without yielding), only the
 * first call fires the event.
 *
 * The deduplication is intentionally coarse (exact float equality). Adapter
 * seek paths clamp and normalise time before calling this function, so the
 * values that arrive here are already stable.
 */

let _lastDispatchedTime = -1;

export function dispatchSeekEvent(time: number): void {
  if (time === _lastDispatchedTime) return;
  _lastDispatchedTime = time;
  try {
    window.dispatchEvent(new CustomEvent("hf-seek", { detail: { time } }));
  } catch (err) {
    swallow("runtime.adapters.seek-dispatch.site1", err);
  }
}

/**
 * Force-dispatch a `"hf-seek"` event even if `time` equals the last dispatched
 * time, bypassing the dedup guard.
 *
 * Needed for the post-video-injection GPU re-render: the engine seeks to time
 * T (GPU adapters render once, before video frames are injected), then injects
 * the decoded `__render_frame__` images, then must re-render GPU compositions
 * at the *same* T so they re-upload textures from the now-present frames. The
 * normal dedup would swallow that second dispatch.
 */
export function forceDispatchSeekEvent(time: number): void {
  _lastDispatchedTime = time;
  try {
    window.dispatchEvent(new CustomEvent("hf-seek", { detail: { time } }));
  } catch (err) {
    swallow("runtime.adapters.seek-dispatch.force", err);
  }
}

/** Reset internal state — used in tests to prevent cross-test contamination. */
export function resetSeekDispatchState(): void {
  _lastDispatchedTime = -1;
}
