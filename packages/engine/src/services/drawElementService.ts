// fallow-ignore-file code-duplication complexity
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
 * Cases that fall back to screenshot (see docs/fast-capture-limitations.md):
 *  - SwiftShader (software rasterizer, i.e. Docker/CI with no GPU): drawElement
 *    yields NO speedup here and is slightly slower. Its entire advantage is
 *    skipping the GPU→CPU screenshot readback IPC — on SwiftShader there is no
 *    GPU, so both paths block on identical software rasterization (measured
 *    parity: font-variant-numeric baseline 7822ms vs fast 7979ms, page-side
 *    draw/readback/encode all ~0ms). The drawElement path only adds a per-frame
 *    CDP round-trip on top of the same raster cost, and on a transparent
 *    destination additionally drops promoted sub-layers (Chromium bug
 *    521434899). The speedup is real only on a hardware GPU (macOS 1.6×), so
 *    SwiftShader always routes to the platform baseline.
 *  - hasVideo: a PROXY gate for the caption-pattern capture bug. The actual
 *    trigger (established by bisect + standalone repro, 2026-06-09) is the
 *    word-by-word caption opacity pattern: per-frame JS opacity writes on >=2
 *    stacked containers with fully-transparent children, inside a transformed
 *    container overflowing the capture canvas, read back via toDataURL —
 *    drawElementImage then captures fully-transparent frames (~12 dB
 *    fast-vs-baseline, both macOS and native amd64 Linux). Video itself
 *    captures fine (caption-free bg-video probe: 54 dB), but real video comps
 *    almost always carry captions, so <video> is the conservative signal.
 *    Chromium-side; see docs/fast-capture-limitations.md Lim 2. Fast video
 *    arrives when the upstream bug is fixed (or the gate learns to detect the
 *    caption pattern instead).
 */
export function resolveDrawElementCaptureMode(
  isSwiftShader: boolean,
  transparent: boolean,
  hasVideo = false,
): "drawelement" | "screenshot" {
  // `transparent` is retained for call-site clarity; SwiftShader blocks
  // unconditionally now (no GPU egress to skip — parity at best), which
  // subsumes the former transparent-only SwiftShader case.
  void transparent;
  if (isSwiftShader) return "screenshot";
  if (hasVideo) return "screenshot";
  return "drawelement";
}

/**
 * Instrument `HTMLCanvasElement.getContext` before any page script runs.
 *
 * Accelerated canvas contexts (webgl/webgl2/webgpu) present via compositor
 * texture swap — the canvas element never repaints, so its paint record never
 * invalidates and drawElementImage serves the FIRST frame's snapshot for the
 * whole render (confirmed: typegpu comp frozen at t=0, 21 dB; 2d canvas is
 * unaffected at 56 dB). The fix is to composite those canvases manually:
 * this wrapper records them in `window.__hf_accel_canvases` so
 * captureDrawElementFrame can hide them from paint records and drawImage
 * their live content underneath the drawElementImage output.
 *
 * WebGL contexts additionally get `preserveDrawingBuffer: true` forced —
 * without it the drawing buffer is cleared after each compositor present and
 * drawImage(glCanvas) reads blank.
 *
 * Must be registered via page.evaluateOnNewDocument BEFORE navigation.
 */
export function instrumentAcceleratedCanvases(): void {
  type AccelWindow = Window & {
    __hf_accel_canvases?: HTMLCanvasElement[];
    __hf_canvas_2d?: HTMLCanvasElement[];
  };
  const w = window as AccelWindow;
  w.__hf_accel_canvases = [];
  w.__hf_canvas_2d = [];
  const orig = HTMLCanvasElement.prototype.getContext;
  // oxlint-disable-next-line no-explicit-any
  (HTMLCanvasElement.prototype as any).getContext = function (
    this: HTMLCanvasElement,
    type: string,
    attrs?: Record<string, unknown>,
  ) {
    const isGl = type === "webgl" || type === "webgl2" || type === "experimental-webgl";
    const isAccel = isGl || type === "webgpu";
    const finalAttrs = isGl ? { ...attrs, preserveDrawingBuffer: true } : attrs;
    // oxlint-disable-next-line no-explicit-any
    const ctx = (orig as any).call(this, type, finalAttrs);
    if (ctx && isAccel) {
      const list = w.__hf_accel_canvases ?? [];
      if (!list.includes(this)) list.push(this);
      w.__hf_accel_canvases = list;
    }
    // 2d canvases are tracked separately: their paint records DO refresh on
    // macOS (the sentinel forces a paint each frame), but under BeginFrame
    // pacing (Linux headless-shell) canvas bitmap changes never dirty the
    // record and the capture freezes at the first frame — so the BeginFrame
    // path composites these too (see captureDrawElementFrame).
    if (ctx && type === "2d") {
      const list2d = w.__hf_canvas_2d ?? [];
      if (!list2d.includes(this)) list2d.push(this);
      w.__hf_canvas_2d = list2d;
    }
    return ctx;
  };
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
      // Accelerated canvases (webgl/webgl2/webgpu) never repaint — their paint
      // record stays frozen at the first frame (see instrumentAcceleratedCanvases).
      // Hide them NOW, before this frame's paint, so the stale record stops
      // painting; drawAndEncode composites their live content via drawImage
      // underneath the drawElementImage output instead. Hiding must happen
      // before the paint wait (sync mode) so the awaited paint reflects it.
      type AccelWindow = Window & {
        __hf_accel_canvases?: HTMLCanvasElement[];
        __hf_canvas_2d?: HTMLCanvasElement[];
        __hf3d?: { update: () => void };
      };
      const aw = window as AccelWindow;
      // Re-project CSS 3D contexts for THIS frame (threeDProjection.ts) so
      // their WebGL canvases are fresh before being drawImage-composited
      // below. Must run before the paint wait for the same reason as the
      // canvas hiding: the awaited paint should reflect the final state.
      aw.__hf3d?.update();
      const accel = (aw.__hf_accel_canvases ?? []).filter((c) => root.contains(c));
      // Under BeginFrame pacing (sync=false) 2d canvas bitmaps also freeze in
      // the paint records — composite them the same way. On paint-synced hosts
      // (sync=true) the per-frame sentinel paint refreshes them natively.
      if (!sync) {
        for (const c of (aw.__hf_canvas_2d ?? []).filter((c2) => root.contains(c2))) {
          if (!accel.includes(c)) accel.push(c);
        }
        // Stable z among composited canvases: document order.
        accel.sort((a, b) =>
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
        );
      }
      for (const c of accel) {
        if (c.style.visibility !== "hidden") c.style.visibility = "hidden";
      }
      return new Promise<string>((resolveCapture, rejectCapture) => {
        let settled = false;
        const drawAndEncode = () => {
          if (settled) return;
          settled = true;
          try {
            ctx.clearRect(0, 0, w, h);
            // drawElementImage only paints the captured subtree. A background
            // set on <body>/<html> (the common authoring pattern) lives OUTSIDE
            // [data-composition-id], so without this fill those pixels stay
            // transparent — and the jpeg encode below turns them black.
            // Resolve the nearest non-transparent ancestor background-color and
            // paint it first, matching what captureScreenshot composites.
            // (Resolved per frame: compositions may set body background from JS.)
            let bg = "";
            for (let el = root.parentElement; el; el = el.parentElement) {
              const c = getComputedStyle(el).backgroundColor;
              if (c && c !== "transparent" && c !== "rgba(0, 0, 0, 0)") {
                bg = c;
                break;
              }
            }
            // Opaque (jpeg) output with no author background anywhere:
            // Page.captureScreenshot composites over the browser's default
            // white viewport, but a cleared canvas encodes to BLACK in jpeg.
            // Fill white for parity (transparent comps rendered to an opaque
            // container — e.g. the webm-transparency test forced to mp4).
            // png keeps true transparency.
            if (!bg && fmt === "jpeg") bg = "#fff";
            if (bg) {
              ctx.fillStyle = bg;
              ctx.fillRect(0, 0, w, h);
            }
            // Composite live accelerated-canvas content UNDER the DOM paint.
            // The canvases are visibility:hidden (transparent holes in the
            // drawElementImage output), so DOM content above them (captions,
            // overlays) still paints on top. Constraint: an opaque background
            // on the composition root or an ancestor between root and the
            // canvas would paint over this — backgrounds belong on <body> or
            // inside the canvas for GPU comps.
            const rootRect = root.getBoundingClientRect();
            // fallow-ignore-next-line code-duplication
            for (const c of accel) {
              if (c.hasAttribute("data-hf-3d")) continue;
              const r = c.getBoundingClientRect();
              try {
                ctx.drawImage(c, r.left - rootRect.left, r.top - rootRect.top, r.width, r.height);
              } catch {
                // Zero-sized or not-yet-configured canvas — skip this frame.
              }
            }
            (
              ctx as unknown as { drawElementImage(el: Element, x: number, y: number): void }
            ).drawElementImage(root, 0, 0);
            // 3D-projection canvases (threeDProjection.ts) composite OVER the
            // DOM paint: their content replaces clip-path-hidden foreground
            // elements, and the under-pass above would bury them beneath the
            // composition root's own background.
            // fallow-ignore-next-line code-duplication
            for (const c of accel) {
              if (!c.hasAttribute("data-hf-3d")) continue;
              const r = c.getBoundingClientRect();
              try {
                ctx.drawImage(c, r.left - rootRect.left, r.top - rootRect.top, r.width, r.height);
              } catch {
                // Zero-sized canvas — skip this frame.
              }
            }
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
