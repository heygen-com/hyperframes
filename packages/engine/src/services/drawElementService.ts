/**
 * DrawElement Capture Service
 *
 * `canvas.drawElementImage(element, x, y)` reads DOM paint records directly into
 * a canvas, bypassing the full compositor pipeline. Requires the Chrome flag
 * `--enable-features=CanvasDrawElement` (already added globally) and a
 * `<canvas layoutsubtree>` wrapper around the composition root.
 *
 * Performance: ~46% faster than Page.captureScreenshot on local GPU.
 * Alpha: pixel-perfect (PSNR=∞) on GPU. Falls back to screenshot in Docker
 * (SwiftShader) when transparent output is requested — SwiftShader drops promoted
 * compositor sub-layers on a transparent canvas destination (Chromium bug, filed
 * Blink>Canvas, 2026-06-08).
 */

import type { Page } from "puppeteer-core";

/**
 * Resolve which capture mode to use when `useDrawElement` is true.
 *
 * Two cases fall back to screenshot (see docs/fast-capture-limitations.md):
 *  - transparent + SwiftShader: software-GL drops promoted sub-layers on a
 *    transparent canvas destination (Chromium bug 521434899).
 *  - hasVideo: drawElementImage draws a snapshot taken at the paint event and
 *    does not capture the freshly-injected per-frame video <img> — the video
 *    region comes out black/stale. This was verified on BOTH macOS and a native
 *    amd64 Linux runner (where per-frame BeginFrame *does* paint) — fast-vs-
 *    baseline PSNR ~12 dB either way — so video is unconditionally routed to
 *    screenshot capture regardless of platform. Fast video is future R&D.
 */
export function resolveDrawElementCaptureMode(
  isSwiftShader: boolean,
  transparent: boolean,
  hasVideo = false,
): "drawelement" | "screenshot" {
  if (transparent && isSwiftShader) return "screenshot";
  if (hasVideo) return "screenshot";
  return "drawelement";
}

/**
 * Detect whether the page is running on SwiftShader (software rasterizer).
 *
 * Returns true inside Docker headless-shell with --use-angle=swiftshader.
 * Returns false on macOS / Linux with a real GPU.
 * Call once after window.__hf is ready; cache result on session.
 */
export async function detectSwiftShader(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return false;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return false;
    const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
    return renderer.toLowerCase().includes("swiftshader");
  });
}

/**
 * Inject a `<canvas layoutsubtree>` around the composition root.
 *
 * The canvas must wrap `[data-composition-id]` for drawElementImage to read
 * its paint records. Idempotent — skips injection if `__hf_de_canvas` exists.
 * Must be called after window.__hf is ready (so the composition root is in the DOM).
 */
export async function injectDrawElementCanvas(
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await page.evaluate(
    ({ w, h }: { w: number; h: number }) => {
      const root = document.querySelector("[data-composition-id]") as HTMLElement | null;
      if (!root || document.getElementById("__hf_de_canvas")) return;
      const parent = root.parentNode;
      if (!parent) throw new Error("drawElement: composition root has no parent node");
      const canvas = document.createElement("canvas") as HTMLCanvasElement & {
        layoutsubtree: boolean;
      };
      canvas.id = "__hf_de_canvas";
      canvas.setAttribute("layoutsubtree", "");
      canvas.width = w;
      canvas.height = h;
      canvas.style.cssText = "display:block;position:absolute;top:0;left:0;z-index:0";
      parent.insertBefore(canvas, root);
      canvas.appendChild(root);
      // Invalidation sentinel: a canvas child OUTSIDE the captured root.
      // Toggling its `left` each capture dirties the layoutsubtree so a paint
      // (and a fresh snapshot) is guaranteed even for static frames — without
      // ever appearing in drawElementImage(root) output.
      const tick = document.createElement("div");
      tick.id = "__hf_de_tick";
      tick.style.cssText =
        "position:absolute;left:0px;top:0;width:1px;height:1px;background:#000;opacity:0.01;pointer-events:none";
      canvas.appendChild(tick);
    },
    { w: width, h: height },
  );
}

/**
 * Capture one frame via canvas.drawElementImage, synchronized to the canvas
 * `paint` event.
 *
 * `drawElementImage` draws from a snapshot recorded at the paint event; called
 * outside one it returns the PREVIOUS frame's snapshot (WICG html-in-canvas).
 * Capturing unsynchronized therefore yields one-frame-stale content, or an
 * `InvalidStateError: No cached paint record` when no paint has landed since
 * the last DOM mutation (the intermittent macOS crash). The fix is the API's
 * intended usage: force an invalidation, await the canvas `paint` event, and
 * draw inside its handler — the snapshot is then the CURRENT frame. Measured
 * cost of the paint wait is ~1.3 ms/frame; the encode dominates.
 *
 * Encoding MUST match what the downstream encoder expects:
 *   - "png"  → `toDataURL("image/png")` — preserves alpha (transparent output).
 *   - "jpeg" → `toDataURL("image/jpeg", q)` — opaque output. The producer's
 *     streaming encoder pipes frames to ffmpeg as mjpeg; feeding it PNG bytes
 *     makes ffmpeg's jpeg decoder fail ("Can not process SOS before SOF").
 *
 * Alpha (png) is preserved correctly on GPU (PSNR=∞ vs captureScreenshot). Do
 * NOT call in Docker with transparent output — use the screenshot fallback
 * instead (see routing in frameCapture.ts initializeSession).
 */
export async function captureDrawElementFrame(
  page: Page,
  width: number,
  height: number,
  format: "jpeg" | "png" = "jpeg",
  quality = 80,
  // Await the canvas `paint` event before drawing. Required on hosts with a
  // free-running compositor (macOS / screenshot-launched browsers) where the
  // capture call is unsynchronized with painting. MUST be false under
  // BeginFrame control (Linux headless-shell): there, paints happen only on
  // the per-frame HeadlessExperimental.beginFrame already issued before this
  // call (snapshot is fresh), and no further paint would ever arrive — the
  // wait would burn the fallback timeout on every frame.
  syncToPaintEvent = true,
): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ({
      w,
      h,
      fmt,
      q,
      sync,
    }: {
      w: number;
      h: number;
      fmt: "jpeg" | "png";
      q: number;
      sync: boolean;
    }) => {
      const canvas = document.getElementById("__hf_de_canvas") as HTMLCanvasElement | null;
      const root = document.querySelector("[data-composition-id]") as HTMLElement | null;
      if (!canvas || !root) throw new Error("drawElement canvas not initialized");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("drawElement: 2d context unavailable");
      return new Promise<string>((resolveCapture, rejectCapture) => {
        let settled = false;
        const drawAndEncode = () => {
          if (settled) return;
          settled = true;
          try {
            ctx.clearRect(0, 0, w, h);
            (
              ctx as unknown as { drawElementImage(el: Element, x: number, y: number): void }
            ).drawElementImage(root, 0, 0);
          } catch (e) {
            rejectCapture(e instanceof Error ? e : new Error(String(e)));
            return;
          }
          // Encode OUTSIDE the paint handler — heavy canvas work inside the
          // paint event can stall the renderer.
          setTimeout(() => {
            try {
              resolveCapture(
                fmt === "png"
                  ? canvas.toDataURL("image/png")
                  : canvas.toDataURL("image/jpeg", q / 100),
              );
            } catch (e) {
              rejectCapture(e instanceof Error ? e : new Error(String(e)));
            }
          }, 0);
        };
        if (!sync) {
          // BeginFrame mode: the per-frame beginFrame already painted a fresh
          // snapshot before this call — draw immediately.
          drawAndEncode();
          return;
        }
        const onPaint = () => {
          canvas.removeEventListener("paint", onPaint);
          drawAndEncode();
        };
        canvas.addEventListener("paint", onPaint);
        // Force an invalidation so a paint is guaranteed even when this frame's
        // seek produced no paint-level change (static scene, or transform-only
        // GSAP updates that are compositor-side and never repaint). The sentinel
        // is a 1x1 canvas child OUTSIDE the captured root (see
        // injectDrawElementCanvas): toggling its background is a PAINT-level
        // change (layout/transform toggles do NOT fire the paint event), so a
        // paint + fresh snapshot follow promptly — without the sentinel ever
        // appearing in drawElementImage(root) output.
        const tick = document.getElementById("__hf_de_tick");
        if (tick) {
          tick.style.backgroundColor =
            tick.style.backgroundColor === "rgb(0, 0, 0)" ? "rgb(1, 1, 1)" : "rgb(0, 0, 0)";
        }
        // Safety net: if the paint event doesn't arrive (feature drift /
        // throttled page), fall back to an unsynchronized draw after 250 ms —
        // worst case one-frame-stale content rather than a hung render.
        setTimeout(() => {
          canvas.removeEventListener("paint", onPaint);
          drawAndEncode();
        }, 250);
      });
    },
    { w: width, h: height, fmt: format, q: quality, sync: syncToPaintEvent },
  );
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("drawElement: toDataURL returned no base64 payload");
  return Buffer.from(base64, "base64");
}
