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
 * This is a candidate, not a final decision: the engine downgrades it back to
 * `false` once the page is loaded and `pageContentExceedsCaptureHeight`
 * (screenshotService.ts) measures that the content doesn't actually overflow
 * the requested capture height — the "reliable clip predictor" this used to
 * lack. That measurement matters beyond the software re-raster tax: on
 * SwiftShader, requesting beyond-viewport for content that doesn't need it
 * can produce phantom duplicate content in the captured frame (HF#2550).
 */
export function resolveVideoCaptureBeyondViewport(videoCount: number): boolean | undefined {
  if (videoCount <= 0) return undefined;
  return true;
}
