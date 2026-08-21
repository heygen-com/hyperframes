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
type SeekCompletionResult = { status: "fulfilled" } | { status: "rejected"; reason: unknown };
let _pendingCompletions = new Set<Promise<SeekCompletionResult>>();
let _pendingFailure: { reason: unknown } | undefined;
let _activeCompletionBarriers = 0;

export interface HfSeekEventDetail {
  time: number;
  waitUntil: (promise: PromiseLike<unknown>) => void;
}

function dispatch(time: number): void {
  const pending: PromiseLike<unknown>[] = [];
  let accepting = true;
  const detail: HfSeekEventDetail = {
    time,
    waitUntil: (promise) => {
      if (!accepting) {
        throw new Error("hf-seek waitUntil() must be called synchronously from the event listener");
      }
      pending.push(promise);
    },
  };
  try {
    window.dispatchEvent(new CustomEvent<HfSeekEventDetail>("hf-seek", { detail }));
  } catch (err) {
    swallow("runtime.adapters.seek-dispatch.site1", err);
  } finally {
    accepting = false;
  }
  if (pending.length === 0) return;
  const completion = Promise.all(pending)
    .then<SeekCompletionResult>(() => ({ status: "fulfilled" }))
    .catch<SeekCompletionResult>((reason: unknown) => ({ status: "rejected", reason }));
  _pendingCompletions.add(completion);
  void completion.then((result) => {
    if (!_pendingCompletions.delete(completion)) return;
    if (result.status === "rejected" && _pendingFailure === undefined) {
      _pendingFailure = { reason: result.reason };
    }
  });
}

export function dispatchSeekEvent(time: number): void {
  if (time === _lastDispatchedTime) return;
  _lastDispatchedTime = time;
  dispatch(time);
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
  dispatch(time);
}

export function isSeekCompletionBarrierActive(): boolean {
  return _activeCompletionBarriers > 0;
}

export async function waitForSeekCompletion(): Promise<void> {
  _activeCompletionBarriers += 1;
  let failed = _pendingFailure;
  try {
    // Let concurrently started barriers snapshot the same retained failure
    // before either one consumes it.
    await Promise.resolve();
    while (_pendingCompletions.size > 0) {
      const results = await Promise.all([..._pendingCompletions]);
      const rejected = results.find((result) => result.status === "rejected");
      if (failed === undefined && rejected?.status === "rejected") {
        failed = { reason: rejected.reason };
      }
    }
    const retainedFailure = _pendingFailure;
    if (failed === undefined) {
      failed = retainedFailure;
    }
    if (_pendingFailure === retainedFailure) {
      _pendingFailure = undefined;
    }
    if (failed) throw failed.reason;
  } finally {
    _activeCompletionBarriers -= 1;
  }
}

/** Reset internal state — used in tests to prevent cross-test contamination. */
export function resetSeekDispatchState(): void {
  _lastDispatchedTime = -1;
  _pendingCompletions = new Set();
  _pendingFailure = undefined;
  _activeCompletionBarriers = 0;
}
