/**
 * HDR passthrough overlay capture: one transparent screenshot per overlay
 * state, mapped to the HDR signal space and written as a 16-bit RGBA PNG.
 */

import type { CaptureOverlayStatesArgs, CapturedOverlaySet } from "./types.js";

/**
 * Contract:
 *
 * For each `plan.states[i]` in order:
 *   1. Seek the page to `captureFrame / fps` the same way the layered loop
 *      does (`seekInjectAndQueryStacking` in
 *      `render/stages/captureHdrFrameShared.ts`, which runs the session's
 *      `onBeforeCapture` hook).
 *   2. Hide the passthrough video with engine `applyDomLayerMask(page,
 *      showIds, [video.id])` (all other ids shown), then
 *      `captureAlphaPng(page, width, height)` and `decodePng`.
 *   3. Hash the 8-bit RGBA pixels (sha256). A hash seen before reuses that
 *      state's `pngPath`; otherwise map every pixel with
 *      `getSrgbToSignalLut(video.transfer)` (RGB → 16-bit signal; alpha →
 *      `a8 * 257`, straight alpha, NOT premultiplied) and write a 16-bit
 *      RGBA PNG (`<outDir>/overlay-<index>.png`).
 *   4. Call `onStateCaptured(framesCovered, i + 1, states.length)` with the
 *      cumulative `endFrame - startFrame` of states done so far.
 *
 * Calls `input.assertNotAborted()` before each state. Removes the DOM mask
 * before returning. Pixel parity target: compositing a returned PNG over a
 * video frame with straight-alpha `over` must equal
 * `blitRgba8OverRgb48le(domRgba, frame, w, h, transfer)` within 1 LSB at 16 bit.
 */
export async function captureOverlayStates(
  args: CaptureOverlayStatesArgs,
): Promise<CapturedOverlaySet> {
  void args;
  throw new Error("hdrPassthrough: captureOverlayStates not implemented");
}
