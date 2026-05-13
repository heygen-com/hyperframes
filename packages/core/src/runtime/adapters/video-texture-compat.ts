/**
 * Patches `GPUQueue.copyExternalImageToTexture` so that video-backed WebGPU
 * effects work in both preview and render mode.
 *
 * During render, the engine's video-frame injector replaces each `<video>`
 * with a pre-decoded `<img class="__render_frame__">` sibling. Chrome's
 * headless compositor can't supply decoded frames from the native `<video>`
 * element to WebGPU, so `copyExternalImageToTexture({ source: video })`
 * fails with "Browser fails extracting valid resource from external image."
 *
 * This patch checks whether a render-frame `<img>` exists next to the
 * source `<video>`. If it does and has decoded pixels, the patch
 * transparently substitutes it as the copy source. In preview mode (no
 * render-frame sibling), the original video path is used unchanged.
 */
export function patchVideoTextureCompat(): void {
  const GPUQueueCtor = (globalThis as Record<string, unknown>).GPUQueue as
    | { prototype: Record<string, unknown> }
    | undefined;

  if (!GPUQueueCtor?.prototype?.copyExternalImageToTexture) return;

  const orig = GPUQueueCtor.prototype.copyExternalImageToTexture as (
    source: unknown,
    destination: unknown,
    copySize: unknown,
  ) => void;

  GPUQueueCtor.prototype.copyExternalImageToTexture = function (
    source: Record<string, unknown>,
    destination: unknown,
    copySize: unknown,
  ) {
    if (source?.source instanceof HTMLVideoElement) {
      const sibling = source.source.nextElementSibling;
      if (
        sibling instanceof HTMLImageElement &&
        sibling.classList.contains("__render_frame__") &&
        sibling.complete &&
        sibling.naturalWidth > 0
      ) {
        return orig.call(this, { ...source, source: sibling }, destination, copySize);
      }
    }
    return orig.call(this, source, destination, copySize);
  };
}
