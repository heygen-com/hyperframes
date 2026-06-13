/**
 * Patches GPU texture-upload paths so that video-backed effects work in both
 * preview and render mode — for WebGPU (`GPUQueue.copyExternalImageToTexture`)
 * and WebGL (`texImage2D` / `texSubImage2D`).
 *
 * During render, the engine's video-frame injector replaces each `<video>`
 * with a pre-decoded `<img class="__render_frame__">` sibling. Chrome's
 * headless compositor can't supply decoded frames from the native `<video>`
 * element to the GPU, so uploading a `<video>` directly fails (WebGPU throws
 * "Browser fails extracting valid resource from external image"; WebGL uploads
 * a black/stale frame). These patches transparently substitute the decoded
 * render-frame `<img>` as the upload source. In preview mode (no render-frame
 * sibling), the original `<video>` path is used unchanged.
 */

/**
 * Resolve the decoded render-frame `<img>` for a source `<video>`, if the
 * engine has injected one and it has decoded pixels. Returns null in preview
 * mode or before the frame is decoded, so callers fall back to the video.
 *
 * The injector inserts the `<img>` as the video's immediate next sibling and
 * also gives it the id `__render_frame_<videoId>__`; we check the sibling
 * first (cheap) and fall back to an id lookup in case a node was inserted
 * between them.
 */
function resolveRenderFrameImage(video: HTMLVideoElement): HTMLImageElement | null {
  const sibling = video.nextElementSibling;
  if (
    sibling instanceof HTMLImageElement &&
    sibling.classList.contains("__render_frame__") &&
    sibling.complete &&
    sibling.naturalWidth > 0
  ) {
    return sibling;
  }
  if (video.id) {
    const byId = document.getElementById(`__render_frame_${video.id}__`);
    if (byId instanceof HTMLImageElement && byId.complete && byId.naturalWidth > 0) {
      return byId;
    }
  }
  return null;
}

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
      const img = resolveRenderFrameImage(source.source);
      if (img) {
        return orig.call(this, { ...source, source: img }, destination, copySize);
      }
    }
    return orig.call(this, source, destination, copySize);
  };
}

/**
 * WebGL analog of {@link patchVideoTextureCompat}. Patches `texImage2D` and
 * `texSubImage2D` on both `WebGL2RenderingContext` and `WebGLRenderingContext`
 * so that when a `<video>` is passed as the texture source (the last argument
 * in the DOM-source overloads), the decoded render-frame `<img>` is uploaded
 * instead during render. Numeric/`ArrayBufferView` overloads are untouched —
 * only a trailing `HTMLVideoElement` argument is substituted.
 */
export function patchWebGLVideoTextureCompat(): void {
  const ctors = [
    (globalThis as Record<string, unknown>).WebGL2RenderingContext,
    (globalThis as Record<string, unknown>).WebGLRenderingContext,
  ] as Array<{ prototype: Record<string, unknown> } | undefined>;

  const methods = ["texImage2D", "texSubImage2D"] as const;

  for (const ctor of ctors) {
    const proto = ctor?.prototype;
    if (!proto) continue;
    for (const method of methods) {
      const orig = proto[method] as ((...args: unknown[]) => unknown) & {
        __hfVideoPatched?: boolean;
      };
      if (typeof orig !== "function" || orig.__hfVideoPatched) continue;

      const patched = function (this: unknown, ...args: unknown[]) {
        const lastIndex = args.length - 1;
        const last = args[lastIndex];
        if (last instanceof HTMLVideoElement) {
          const img = resolveRenderFrameImage(last);
          if (img) args[lastIndex] = img;
        }
        return orig.apply(this, args);
      } as ((...args: unknown[]) => unknown) & { __hfVideoPatched?: boolean };
      patched.__hfVideoPatched = true;
      proto[method] = patched;
    }
  }
}
