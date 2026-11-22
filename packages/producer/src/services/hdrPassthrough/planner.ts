/**
 * HDR passthrough overlay planner.
 *
 * `analyzeOverlayTiming` reads the page once to derive every frame where the
 * overlay DOM can change; `planOverlayStates` turns that into ordered static
 * intervals. Splitting them keeps the interval math pure and unit-testable.
 */

import type {
  AnalyzeOverlayTimingArgs,
  OverlayPlan,
  OverlayTimingAnalysis,
  PlanOverlayStatesArgs,
} from "./types.js";

/**
 * Contract:
 *
 * Derive `OverlayTiming.changeFrames` statically, with the passthrough video
 * excluded. Reuse the engine's static-frame analysis rather than re-walking
 * timelines: `computeStaticFrameSet(page, fps, [videoId])` (exported from
 * `@hyperframes/engine`) gives tween intervals, the timeline-callback
 * (`timeline_call`), canvas, iframe, frame-source and CSS/WAAPI
 * (`overlay_non_gsap_animation`) disqualifiers, and the analysis frame limit
 * (`analysis_limit`). Clip boundaries come from the runtime's authored timing
 * (`data-start` / `data-duration`, core `runtime/authoredTiming.ts`
 * `resolveAuthoredTimingWindow`) of every timed element other than the video.
 *
 * Rules:
 *   - A frame `f` is a change frame iff `f` is not in `staticFrameSet` and
 *     `0 < f < totalFrames` (the static set already requires both `f` and
 *     `f-1` outside any tween interval), or `f` is a clip boundary frame
 *     (`Math.round(t * fps)` of each start / end).
 *   - Zero-duration tweens (`tl.set`) are discrete changes: allowed.
 *   - A tween with non-zero duration is continuous motion: v1 returns
 *     `overlay_continuous_animation` unless its interval spans at most a few
 *     frames, in which case every frame inside it is a change frame (one
 *     state each). Keep the threshold a named constant.
 *   - More than `maxStates` resulting states → `too_many_states`.
 *
 * Restores the page to time 0 before returning. Never mutates the DOM.
 *
 * Exported for eligibility.ts; drop the fallow suppression once it is used.
 */
// fallow-ignore-next-line unused-export
export async function analyzeOverlayTiming(
  args: AnalyzeOverlayTimingArgs,
): Promise<OverlayTimingAnalysis> {
  void args;
  throw new Error("hdrPassthrough: analyzeOverlayTiming not implemented");
}

/**
 * Contract (pure, synchronous):
 *
 * Splits `[0, timing.totalFrames)` at every `timing.changeFrames` entry into
 * half-open `OverlayState`s, in order, `index` 0..n-1, covering every frame
 * exactly once (see `OverlayPlan` invariants in types.ts). `captureFrame` is
 * `Math.floor((startFrame + endFrame - 1) / 2)`. Ignores change frames
 * outside `[1, totalFrames)` and duplicates. `totalFrames <= 0` → no states.
 * Does not dedupe by content; that happens after capture.
 */
export function planOverlayStates(args: PlanOverlayStatesArgs): OverlayPlan {
  void args;
  throw new Error("hdrPassthrough: planOverlayStates not implemented");
}
