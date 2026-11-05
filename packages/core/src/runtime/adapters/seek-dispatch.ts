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
/** What a seek waits on, named when the barrier stops waiting for it. */
export type SeekHold =
  | "video-frame"
  | "hf-seek"
  | "frame-source"
  | "scene-window"
  | "motion-blur"
  | "vfx"
  | "image-decode";
let _pendingCompletions = new Map<Promise<SeekCompletionResult>, SeekHold>();
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
  registerSeekCompletion(Promise.all(pending), "hf-seek");
}

/**
 * Join `promise` to the seek-completion barrier: `waitForSeekCompletion` will
 * not resolve until it settles, and its rejection (the first one) becomes the
 * barrier's.
 *
 * Exported because the `"hf-seek"` event's synchronous `waitUntil()` is not
 * the only asynchronous seek work a frame can owe. `runtime/vfx.ts` registers
 * its preview-side capture here, so the CLI seek paths that already await this
 * barrier wait for a `self` chain's paint instead of racing it.
 */
export function registerSeekCompletion(promise: Promise<unknown>, hold: SeekHold): void {
  const completion = promise
    .then<SeekCompletionResult>(() => ({ status: "fulfilled" }))
    .catch<SeekCompletionResult>((reason: unknown) => ({ status: "rejected", reason }));
  _pendingCompletions.set(completion, hold);
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

/** Settles with every pending completion, without consuming a failure the barrier reports. */
export async function seekCompletionsSettled(): Promise<void> {
  for (
    let pending = [..._pendingCompletions.keys()];
    pending.length > 0;
    pending = [..._pendingCompletions.keys()]
  ) {
    await Promise.all(pending);
  }
}

export function hasPendingSeekCompletion(): boolean {
  return _pendingCompletions.size > 0;
}

/** All of `pending` settled, or null once `deadline` (epoch ms) passes first. */
async function settledBy(
  pending: Promise<SeekCompletionResult>[],
  deadline: number | undefined,
): Promise<SeekCompletionResult[] | null> {
  if (deadline === undefined) return Promise.all(pending);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()));
  });
  try {
    return await Promise.race([Promise.all(pending), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** `videoFrames: false` skips only video-frame holds. Past a caller's `timeoutMs` it throws, naming what is pending. */
export async function waitForSeekCompletion(options?: {
  videoFrames?: boolean;
  timeoutMs?: number;
}): Promise<void> {
  const awaited = () =>
    [..._pendingCompletions].filter(
      ([, hold]) => options?.videoFrames !== false || hold !== "video-frame",
    );
  const timeoutMs = options?.timeoutMs;
  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
  _activeCompletionBarriers += 1;
  let failed = _pendingFailure;
  try {
    // Let concurrently started barriers snapshot the same retained failure
    // before either one consumes it.
    await Promise.resolve();
    for (let pending = awaited(); pending.length > 0; pending = awaited()) {
      // Holds that keep arriving past the deadline must not outrun it.
      const results =
        deadline === undefined || Date.now() < deadline
          ? await settledBy(
              pending.map(([completion]) => completion),
              deadline,
            )
          : null;
      if (!results) {
        const holds = [...new Set(awaited().map(([, hold]) => hold))].join(", ");
        throw Object.assign(
          new Error(`seek did not settle within ${timeoutMs} ms: still waiting on ${holds}`),
          { name: "SeekNotSettledError" },
        );
      }
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
  _pendingCompletions = new Map();
  _pendingFailure = undefined;
  _activeCompletionBarriers = 0;
}
