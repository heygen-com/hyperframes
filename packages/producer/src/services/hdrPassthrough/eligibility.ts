/**
 * HDR passthrough eligibility.
 *
 * Decides whether a render that is about to take the HDR layered composite
 * path can instead take the passthrough. Pure gates run first; the page is
 * only opened (via `session.get()`) once every metadata gate has passed.
 */

import type { CheckPassthroughEligibilityArgs, PassthroughEligibility } from "./types.js";

/**
 * Default ceiling on distinct overlay states before declaring `too_many_states`.
 * Exported for the eligibility tests; drop the fallow suppression once they use it.
 */
// fallow-ignore-next-line unused-export
export const DEFAULT_MAX_OVERLAY_STATES = 4096;

/**
 * Contract:
 *
 * Returns `{ eligible: true, video, timing }` only when ALL hold, else the
 * FIRST failing gate's `{ eligible: false, reason, detail? }`. Never throws
 * for an ineligible composition; throws only on unexpected IO / browser
 * failures (the caller falls back on throw too).
 *
 * Render-level gates (no page, from `args.input`):
 *   - `not_hdr`: `input.hasHdrContent && input.effectiveHdr` and
 *     `input.preset.hdr` set.
 *   - `output_format`: `job.config.format` is mp4 (or omitted); v1 only.
 *   - `alpha_output`, `output_scale` (device scale factor must be 1),
 *     `motion_blur` (`job.config.motionBlur` set), `graded_canvas` /
 *     `master_fx_chain` (`composition.gradedCanvas` / `.masterFxChain`).
 *   - `hdr_images`: `input.nativeHdrImageIds.size > 0`.
 *   - `shader_transitions`: the page reports `window.__hf.transitions`
 *     non-empty (checked once the page is open).
 *
 * Video gates (from `composition.videos`, reuse engine `qualifyVideoLayer`
 * for count/hidden/grading/loop/rate/start/end reasons):
 *   - exactly one `<video>`; it is in `input.nativeHdrVideoIds`
 *     (`video_not_native_hdr` otherwise) with transfer
 *     `input.videoTransfers.get(id) === input.effectiveHdr.transfer`;
 *   - local file that exists (`remote_source` / `source_missing`, resolved
 *     with engine `resolveProjectRelativeSrc`);
 *   - `extractMediaMetadata`: not VFR, no alpha, bt2020 primaries, source
 *     covers `mediaStart + composition.duration` (`source_unsupported`).
 *
 * Page gates (`await session.get()`):
 *   - layout at sampled times matches `inspectVideoLayout` in
 *     `render/videoLayerPassthroughPlan.ts` (same reasons; `fill` must be
 *     same-size or same-aspect, `cover` same aspect after crop);
 *   - `video_animated`: no GSAP tween, CSS animation or WAAPI animation
 *     targets the video or any ancestor;
 *   - overlay timing via `planner.analyzeOverlayTiming` with
 *     `maxStates = DEFAULT_MAX_OVERLAY_STATES`; its failure reason is
 *     returned as-is.
 *
 * Leaves the page seeked to time 0 and with no DOM mask applied.
 */
export async function checkPassthroughEligibility(
  args: CheckPassthroughEligibilityArgs,
): Promise<PassthroughEligibility> {
  void args;
  throw new Error("hdrPassthrough: checkPassthroughEligibility not implemented");
}
