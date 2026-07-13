/**
 * Native video surfaces need Chrome's beyond-viewport screenshot path or the
 * viewport-bound capture clips the bottom edge of the frame — the same
 * #1094 tall-portrait guard the alpha capture paths already hardcode
 * (`captureScreenshotWithAlpha` / `captureAlphaPng`).
 *
 * This used to be gated to hardware-GPU captures to skip the full-surface
 * software re-rasterization tax on SwiftShader/CPU render hosts. But that left
 * software hosts clipping ~87 bottom rows to black on video comps — and every
 * distributed chunk render resolves as "software", so the entire distributed
 * fleet shipped video renders with a black bottom band. Correct output wins
 * over the software perf optimization: enable beyond-viewport for any render
 * that has a native video surface, regardless of GPU mode.
 *
 * ponytail: blanket-on for video. If the software re-raster tax proves
 * significant on the distributed fleet, narrow it back to comps whose content
 * actually reaches the bottom edge — but that needs a reliable clip predictor
 * first, and a black band is unshippable in the meantime.
 */
export function resolveVideoCaptureBeyondViewport(videoCount: number): boolean | undefined {
  if (videoCount <= 0) return undefined;
  return true;
}
