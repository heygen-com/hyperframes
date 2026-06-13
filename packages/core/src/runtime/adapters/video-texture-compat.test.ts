import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { patchWebGLVideoTextureCompat } from "./video-texture-compat";

// Minimal fake WebGL2 context that records the source passed to texImage2D /
// texSubImage2D, so we can assert the patch substitutes the injected frame.
class FakeGL2 {
  lastImageArgs: unknown[] | null = null;
  lastSubArgs: unknown[] | null = null;
  texImage2D(...args: unknown[]) {
    this.lastImageArgs = args;
  }
  texSubImage2D(...args: unknown[]) {
    this.lastSubArgs = args;
  }
}

function makeInjectedImage(): HTMLImageElement {
  const img = document.createElement("img");
  img.classList.add("__render_frame__");
  Object.defineProperty(img, "complete", { value: true, configurable: true });
  Object.defineProperty(img, "naturalWidth", { value: 16, configurable: true });
  return img;
}

describe("patchWebGLVideoTextureCompat", () => {
  let originalGL2: unknown;

  beforeEach(() => {
    originalGL2 = (globalThis as Record<string, unknown>).WebGL2RenderingContext;
    (globalThis as Record<string, unknown>).WebGL2RenderingContext = FakeGL2;
    document.body.innerHTML = "";
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).WebGL2RenderingContext = originalGL2;
    document.body.innerHTML = "";
  });

  it("substitutes the decoded __render_frame__ image when uploading a <video>", () => {
    patchWebGLVideoTextureCompat();

    const video = document.createElement("video");
    const img = makeInjectedImage();
    document.body.append(video, img); // img is video.nextElementSibling

    const gl = new FakeGL2();
    gl.texImage2D(0x0de1, 0, 0x1908, 0x1908, 0x1401, video);

    // Last argument (the source) must be swapped to the injected image.
    expect(gl.lastImageArgs?.[gl.lastImageArgs.length - 1]).toBe(img);
  });

  it("leaves the <video> source untouched when no render frame is present (preview)", () => {
    patchWebGLVideoTextureCompat();

    const video = document.createElement("video");
    document.body.append(video);

    const gl = new FakeGL2();
    gl.texImage2D(0x0de1, 0, 0x1908, 0x1908, 0x1401, video);

    expect(gl.lastImageArgs?.[gl.lastImageArgs.length - 1]).toBe(video);
  });

  it("ignores a render-frame image that is not yet decoded", () => {
    patchWebGLVideoTextureCompat();

    const video = document.createElement("video");
    const img = document.createElement("img");
    img.classList.add("__render_frame__");
    Object.defineProperty(img, "complete", { value: false, configurable: true });
    Object.defineProperty(img, "naturalWidth", { value: 0, configurable: true });
    document.body.append(video, img);

    const gl = new FakeGL2();
    gl.texImage2D(0x0de1, 0, 0x1908, 0x1908, 0x1401, video);

    expect(gl.lastImageArgs?.[gl.lastImageArgs.length - 1]).toBe(video);
  });

  it("also patches texSubImage2D", () => {
    patchWebGLVideoTextureCompat();

    const video = document.createElement("video");
    const img = makeInjectedImage();
    document.body.append(video, img);

    const gl = new FakeGL2();
    gl.texSubImage2D(0x0de1, 0, 0, 0, 0x1908, 0x1401, video);

    expect(gl.lastSubArgs?.[gl.lastSubArgs.length - 1]).toBe(img);
  });

  it("does not touch numeric/pixel-data overloads (no video source)", () => {
    patchWebGLVideoTextureCompat();

    const pixels = new Uint8Array([1, 2, 3, 4]);
    const gl = new FakeGL2();
    gl.texImage2D(0x0de1, 0, 0x1908, 1, 1, 0, 0x1908, 0x1401, pixels);

    expect(gl.lastImageArgs?.[gl.lastImageArgs.length - 1]).toBe(pixels);
  });

  it("is idempotent — patching twice does not double-wrap", () => {
    patchWebGLVideoTextureCompat();
    const once = FakeGL2.prototype.texImage2D;
    patchWebGLVideoTextureCompat();
    expect(FakeGL2.prototype.texImage2D).toBe(once);
  });
});
