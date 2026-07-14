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
 *
 * The former <video> gate (a proxy for the word-by-word caption opacity pattern)
 * was removed once Chrome 151 fixed crbug 521861819: video + nested-fade comps now
 * render correctly on the drawElement path (verified PSNR=inf vs baseline). 151 is
 * the pinned floor. See docs/fast-capture-limitations.md Lim 2.
 */
export function resolveDrawElementCaptureMode(
  isSwiftShader: boolean,
  transparent: boolean,
): "drawelement" | "screenshot" {
  // `transparent` is retained for call-site clarity; SwiftShader blocks
  // unconditionally now (no GPU egress to skip — parity at best), which
  // subsumes the former transparent-only SwiftShader case.
  void transparent;
  if (isSwiftShader) return "screenshot";
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
      // Record the root's base opacity (timeline at 0, before any entrance/
      // outro tween) for the LEGACY root-opacity ratio correction. The
      // correction only runs on paths whose paint does not bake the root's
      // current opacity into the snapshot — BeginFrame (sync=false) captures
      // and builds without canvas.requestPaint(); see __hfDeInvalidate below.
      try {
        (window as unknown as { __HF_ROOT_BASE_OPACITY__?: number }).__HF_ROOT_BASE_OPACITY__ =
          parseFloat(getComputedStyle(root).opacity) || 1;
      } catch {
        /* leave undefined → ratio defaults to 1 */
      }
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
      // Toggling its background each capture is a PAINT-level dirty
      // (layout/transform toggles do NOT fire the canvas `paint` event), so a
      // paint — and a fresh snapshot — is guaranteed even for static frames,
      // without the sentinel ever appearing in drawElementImage(root) output.
      const tick = document.createElement("div");
      tick.id = "__hf_de_tick";
      tick.style.cssText =
        "position:absolute;left:0px;top:0;width:1px;height:1px;background:#000;opacity:0.01;pointer-events:none";
      canvas.appendChild(tick);
      // Per-frame invalidation helper shared by every paint-wait site (serial
      // capture, worker produce, batch produce). Two mechanisms, both applied:
      //  - the sentinel toggle guarantees a paint even if requestPaint() were
      //    to elide one on a clean subtree, and remains the sole mechanism on
      //    builds without requestPaint;
      //  - canvas.requestPaint() is the html-in-canvas API's intended
      //    invalidation (crbug 529829538 triage): it refreshes the subtree's
      //    paint records — compositor-applied props included — where the
      //    sentinel's dirty alone would not on pre-151 builds. Guarded so a
      //    throwing implementation degrades to sentinel-only instead of
      //    rejecting the capture.
      // Returns true when requestPaint was called — the snapshot then bakes
      // the root's CURRENT compositor-applied opacity (measured on 151/152),
      // so callers must skip the legacy root-opacity ratio correction.
      interface RequestPaintCanvas extends HTMLCanvasElement {
        requestPaint?: () => void;
      }
      (window as Window & { __hfDeInvalidate?: () => boolean }).__hfDeInvalidate = () => {
        tick.style.backgroundColor =
          tick.style.backgroundColor === "rgb(0, 0, 0)" ? "rgb(1, 1, 1)" : "rgb(0, 0, 0)";
        const cvp: RequestPaintCanvas = canvas;
        if (typeof cvp.requestPaint === "function") {
          try {
            cvp.requestPaint();
            return true;
          } catch {
            // Feature drift — sentinel dirty above still forces the paint.
          }
        }
        return false;
      };
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
        __hfDeInvalidate?: () => boolean;
        __HF_ROOT_PROPS__?: boolean;
        __HF_ROOT_BASE_OPACITY__?: number;
      };
      const aw = window as AccelWindow;
      // True when this frame's paint was requested via canvas.requestPaint()
      // — the snapshot then bakes the root's current compositor-applied
      // opacity, so the legacy ratio correction below must be skipped.
      let usedRequestPaint = false;
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
            // Root compositor-prop corrections. Two distinct behaviours:
            //  • transform — the snapshot NEVER bakes the captured element's
            //    own transform (even a static one renders unscaled — the
            //    parent applies it at composite time; verified still true
            //    under the requestPaint contract, crbug 529829538 triage,
            //    probed on 151 + 152 canary 2026-07-07). Apply the current
            //    matrix unconditionally about the transform-origin.
            //  • opacity — DEPENDS on how this frame's paint was produced.
            //    A requestPaint()-driven paint bakes the root's CURRENT
            //    opacity into the snapshot (pixel alpha) — the legacy ratio
            //    correction DOUBLE-APPLIES there (~0.92 → 0.85 effective,
            //    30.1 dB self-verify failure on a root-fade A/B) and must be
            //    skipped. BeginFrame captures (sync=false) and builds without
            //    requestPaint keep the pre-existing ratio correction: on
            //    those paths the snapshot holds the load-time opacity.
            //    filter is never corrected (paint wait bakes it).
            let __appliedTransform = false;
            let __appliedAlpha = false;
            if (aw.__HF_ROOT_PROPS__) {
              try {
                const rcs = getComputedStyle(root);
                if (!usedRequestPaint) {
                  const baseOp = aw.__HF_ROOT_BASE_OPACITY__ ?? 1;
                  const curOp = parseFloat(rcs.opacity);
                  if (baseOp > 0.001 && Number.isFinite(curOp)) {
                    const ratio = curOp / baseOp;
                    if (Math.abs(ratio - 1) > 0.002) {
                      ctx.globalAlpha = Math.max(0, Math.min(1, ratio));
                      __appliedAlpha = true;
                    }
                  }
                }
                const curTransform = rcs.transform;
                if (curTransform && curTransform !== "none") {
                  const m = new DOMMatrix(curTransform);
                  const origin = rcs.transformOrigin.split(" ");
                  const ox = parseFloat(origin[0] ?? "0") || 0;
                  const oy = parseFloat(origin[1] ?? "0") || 0;
                  ctx.translate(ox, oy);
                  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
                  ctx.translate(-ox, -oy);
                  __appliedTransform = true;
                }
              } catch {
                /* leave context unchanged → uncorrected (no worse than before) */
              }
            }
            (
              ctx as unknown as { drawElementImage(el: Element, x: number, y: number): void }
            ).drawElementImage(root, 0, 0);
            if (__appliedAlpha) ctx.globalAlpha = 1;
            if (__appliedTransform) ctx.setTransform(1, 0, 0, 1, 0, 0);
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
        // GSAP updates that are compositor-side and never repaint). Sentinel
        // dirty + requestPaint(), installed by injectDrawElementCanvas — see
        // __hfDeInvalidate there for the full mechanism/rationale.
        usedRequestPaint = aw.__hfDeInvalidate?.() === true;
        // Safety net: if the paint event doesn't arrive (feature drift /
        // throttled page), fall back to an unsynchronized draw after 250 ms —
        // worst case one-frame-stale content (the root's alpha may lag its
        // transform by that frame) rather than a hung render.
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

// ── Worker-encode pipeline ────────────────────────────────────────────────────
//
// Architecture: an in-page OffscreenCanvas Worker encodes JPEG frames off the
// main thread. The main thread does seek+paint+drawElement+createImageBitmap
// (the "produce" phase) and immediately transfers the bitmap to the worker.
// The worker encodes it concurrently while the main thread processes the next
// frame — hiding ~7.4ms of encode cost behind ~8.4ms of produce work.
//
// The worker posts the encoded bytes back by calling window.__hfFrameReady
// (a Puppeteer exposeFunction binding that calls a node-side callback).
// Node resolves the per-frame Promise from that callback.

interface WorkerEncodeEntry {
  resolve: (buf: Buffer) => void;
  reject: (err: Error) => void;
}

interface WorkerEncodeState {
  nextId: number;
  pending: Map<number, WorkerEncodeEntry>;
}

const workerEncodeStates = new WeakMap<Page, WorkerEncodeState>();
// Pages that already have the `__hfFrameReady` binding installed. The binding
// survives navigation and cannot be cleanly removed, so its lifetime is
// tracked separately from WorkerEncodeState (which is recreated per session).
// Without this, a re-init after cleanup would call exposeFunction twice and
// throw "already exists".
const workerEncodeBoundPages = new WeakSet<Page>();

/**
 * Initialize the in-page JPEG encode Worker for a session. Must be called
 * after page navigation (post-`initializeSession`) and before any
 * `produceDrawElementFrame` calls.
 *
 * Safe to call multiple times for the same page (e.g. session reuse after
 * navigation): the exposeFunction binding survives navigation, but the
 * in-page Worker is re-created. Pending promises from a prior navigation are
 * rejected with a "session reused" error.
 */
export async function initDrawElementWorkerEncode(page: Page): Promise<void> {
  const existing = workerEncodeStates.get(page);

  if (existing) {
    // Session reused after navigation — reject stale pending promises and
    // reset the frame-id counter so ids track the new render's frame indices.
    for (const entry of existing.pending.values()) {
      entry.reject(new Error("drawElement worker encode: session reused, frame dropped"));
    }
    existing.pending.clear();
    existing.nextId = 0;
  } else {
    const state: WorkerEncodeState = { nextId: 0, pending: new Map() };
    workerEncodeStates.set(page, state);
  }

  // Register the node-side callback ONCE per page. The exposeFunction binding
  // survives navigation and cannot be re-added (throws "already exists"), so
  // guard with workerEncodeBoundPages rather than the per-session state. The
  // callback reads the CURRENT WorkerEncodeState live, so it works across
  // re-inits where the state object is replaced.
  if (!workerEncodeBoundPages.has(page)) {
    workerEncodeBoundPages.add(page);
    await page.exposeFunction("__hfFrameReady", (id: number, b64: string, error?: string) => {
      const s = workerEncodeStates.get(page);
      if (!s) return;
      // id < 0 is a fatal worker signal (e.g. worker onerror): the worker is
      // dead and no frame will ever come back — reject every in-flight frame
      // so awaiters fail fast instead of hanging forever.
      if (id < 0) {
        for (const entry of s.pending.values()) {
          entry.reject(new Error(`drawElement worker encode failed: ${error ?? "worker error"}`));
        }
        s.pending.clear();
        return;
      }
      const entry = s.pending.get(id);
      if (!entry) return;
      s.pending.delete(id);
      if (error) {
        entry.reject(new Error(`drawElement worker encode failed: ${error}`));
      } else if (!b64) {
        // A success message with no payload would otherwise resolve a 0-byte
        // Buffer and ffmpeg would write a corrupt/empty frame silently. Fail loud.
        entry.reject(new Error(`drawElement worker encode returned empty frame (frame ${id})`));
      } else {
        entry.resolve(Buffer.from(b64, "base64"));
      }
    });
  }

  // Inject (or re-create) the in-page Worker after each navigation.
  await page.evaluate(() => {
    type EncWin = Window & {
      __hfEncWorker?: Worker;
      __hfFrameReady?: (id: number, b64: string, error?: string) => void;
    };
    const ew = window as EncWin;
    if (ew.__hfEncWorker) {
      ew.__hfEncWorker.terminate();
      ew.__hfEncWorker = undefined;
    }
    // Base64 is done INSIDE the worker (off the main thread) so it never
    // competes with the produce phase; the worker posts a string the page
    // relays to node. On any encode failure the worker posts an error for that
    // frame's id so the node-side promise rejects instead of hanging.
    const workerSrc = `
      // Reuse one OffscreenCanvas across frames (dimensions are constant for a
      // render) — a fresh canvas per frame churns ~w*h*4 bytes of backing store
      // every frame and pressures GC on the encode hot path.
      let oc = null, c = null;
      self.onmessage = async (e) => {
        const { bmp, id, w, h, q } = e.data;
        try {
          if (!oc || oc.width !== w || oc.height !== h) {
            oc = new OffscreenCanvas(w, h);
            c = oc.getContext('2d');
          }
          if (!c) throw new Error('OffscreenCanvas 2d context unavailable');
          c.drawImage(bmp, 0, 0);
          bmp.close();
          const blob = await oc.convertToBlob({ type: 'image/jpeg', quality: q });
          const ab = await blob.arrayBuffer();
          const u = new Uint8Array(ab);
          let s = ''; const CH = 0x8000;
          for (let i = 0; i < u.length; i += CH)
            s += String.fromCharCode.apply(null, u.subarray(i, i + CH));
          self.postMessage({ id, b64: btoa(s) });
        } catch (err) {
          try { if (bmp) bmp.close(); } catch (_) {}
          self.postMessage({ id, error: (err && err.message) || String(err) });
        }
      };
    `;
    const url = URL.createObjectURL(new Blob([workerSrc], { type: "text/javascript" }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url); // only needed for Worker construction
    ew.__hfEncWorker = worker;
    worker.onmessage = (ev: MessageEvent) => {
      const d = ev.data as { id: number; b64?: string; error?: string };
      ew.__hfFrameReady?.(d.id, d.b64 ?? "", d.error);
    };
    worker.onerror = (err: ErrorEvent) => {
      // Fatal, not tied to a frame id — signal node (id = -1) to reject all
      // in-flight frames so the pipeline fails fast instead of hanging.
      ew.__hfFrameReady?.(-1, "", err.message || "worker fatal error");
    };
  });
}

/**
 * Clean up the worker encode state for a session being closed. Rejects any
 * pending frame promises and removes the WeakMap entry. Safe to call even if
 * `initDrawElementWorkerEncode` was never called for this page.
 */
export function cleanupDrawElementWorkerEncode(page: Page): void {
  const state = workerEncodeStates.get(page);
  if (!state) return;
  for (const entry of state.pending.values()) {
    entry.reject(new Error("drawElement worker encode: session closed"));
  }
  state.pending.clear();
  workerEncodeStates.delete(page);
}

/**
 * Pipelined drawElement frame capture: produce phase only.
 *
 * Performs seek-prep, paint-wait, drawElementImage, compositing, and
 * `createImageBitmap` on the main thread, then transfers the bitmap to the
 * in-page encode worker. Returns as soon as the bitmap is transferred — the
 * worker encodes asynchronously. The returned `encodeResult` resolves when
 * the worker posts the encoded frame back to node.
 *
 * Call `initDrawElementWorkerEncode` once per page before using this function.
 *
 * JPEG only (png falls back to synchronous `captureDrawElementFrame`).
 */
export async function produceDrawElementFrame(
  page: Page,
  width: number,
  height: number,
  quality = 80,
  syncToPaintEvent = true,
): Promise<{ encodeResult: Promise<Buffer> }> {
  const state = workerEncodeStates.get(page);
  if (!state) {
    throw new Error(
      "drawElement worker encode not initialized; call initDrawElementWorkerEncode first",
    );
  }

  const frameId = ++state.nextId;
  const encodeResult = new Promise<Buffer>((resolve, reject) => {
    // Watchdog: worker.onerror (→ id=-1, reject-all) covers worker CRASHES, but
    // a lost message (page navigation, OOM-killed worker with no ErrorEvent, a
    // dropped postMessage) would never settle this promise — `drainPrev`'s
    // `await encodeResult` would then hang the whole render to the protocol
    // timeout. Bound it so the render fails with a clear error. Generous vs the
    // ~10ms encode to avoid false positives on large frames.
    const timer = setTimeout(() => {
      if (state.pending.delete(frameId)) {
        reject(new Error(`drawElement worker encode timed out (frame ${frameId})`));
      }
    }, 30_000);
    state.pending.set(frameId, {
      resolve: (b) => {
        clearTimeout(timer);
        resolve(b);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
  });
  // Guard against an unhandled rejection if the caller never awaits this promise
  // (the depth-2 pipeline loop orphans the just-produced frame's encode when an
  // earlier frame's drain throws or the render aborts). The loop's own
  // `await encodeResult` still observes rejections on its separate reaction
  // chain; this only suppresses the no-awaiter case.
  void encodeResult.catch(() => {});

  // Do paint-wait + drawElement composite + createImageBitmap + postMessage.
  // Resolves as soon as the bitmap is transferred (not when encode is done).
  await page.evaluate(
    ({ w, h, q, sync, fid }: { w: number; h: number; q: number; sync: boolean; fid: number }) => {
      const canvas = document.getElementById("__hf_de_canvas") as HTMLCanvasElement | null;
      const root = document.querySelector("[data-composition-id]") as HTMLElement | null;
      if (!canvas || !root) throw new Error("drawElement canvas not initialized");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("drawElement: 2d context unavailable");

      type AccelWindow = Window & {
        __hf_accel_canvases?: HTMLCanvasElement[];
        __hf_canvas_2d?: HTMLCanvasElement[];
        __hf3d?: { update: () => void };
        __hfDeInvalidate?: () => boolean;
        __HF_ROOT_PROPS__?: boolean;
        __HF_ROOT_BASE_OPACITY__?: number;
      };
      const aw = window as AccelWindow;
      aw.__hf3d?.update();
      const accel = (aw.__hf_accel_canvases ?? []).filter((c) => root.contains(c));
      if (!sync) {
        for (const c of (aw.__hf_canvas_2d ?? []).filter((c2) => root.contains(c2))) {
          if (!accel.includes(c)) accel.push(c);
        }
        accel.sort((a, b) =>
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
        );
      }
      for (const c of accel) {
        if (c.style.visibility !== "hidden") c.style.visibility = "hidden";
      }

      return new Promise<void>((resolveCapture, rejectCapture) => {
        let settled = false;
        let usedRequestPaint = false;
        const drawAndKick = () => {
          if (settled) return;
          settled = true;
          try {
            ctx.clearRect(0, 0, w, h);
            let bg = "";
            for (let el = root.parentElement; el; el = el.parentElement) {
              const c = getComputedStyle(el).backgroundColor;
              if (c && c !== "transparent" && c !== "rgba(0, 0, 0, 0)") {
                bg = c;
                break;
              }
            }
            if (!bg) bg = "#fff";
            if (bg) {
              ctx.fillStyle = bg;
              ctx.fillRect(0, 0, w, h);
            }
            // fallow-ignore-next-line code-duplication
            const rootRect = root.getBoundingClientRect();
            for (const c of accel) {
              if (c.hasAttribute("data-hf-3d")) continue;
              const r = c.getBoundingClientRect();
              try {
                ctx.drawImage(c, r.left - rootRect.left, r.top - rootRect.top, r.width, r.height);
              } catch {
                // skip
              }
            }
            // Root compositor-prop corrections — identical to the serial path
            // (see drawAndEncode's comment): transform always; opacity ratio
            // only when this frame's paint was NOT requestPaint-driven.
            let __appliedTransform = false;
            let __appliedAlpha = false;
            if (aw.__HF_ROOT_PROPS__) {
              try {
                const rcs = getComputedStyle(root);
                if (!usedRequestPaint) {
                  const baseOp = aw.__HF_ROOT_BASE_OPACITY__ ?? 1;
                  const curOp = parseFloat(rcs.opacity);
                  if (baseOp > 0.001 && Number.isFinite(curOp)) {
                    const ratio = curOp / baseOp;
                    if (Math.abs(ratio - 1) > 0.002) {
                      ctx.globalAlpha = Math.max(0, Math.min(1, ratio));
                      __appliedAlpha = true;
                    }
                  }
                }
                const curTransform = rcs.transform;
                if (curTransform && curTransform !== "none") {
                  const m = new DOMMatrix(curTransform);
                  const origin = rcs.transformOrigin.split(" ");
                  const ox = parseFloat(origin[0] ?? "0") || 0;
                  const oy = parseFloat(origin[1] ?? "0") || 0;
                  ctx.translate(ox, oy);
                  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
                  ctx.translate(-ox, -oy);
                  __appliedTransform = true;
                }
              } catch {
                /* leave context unchanged → uncorrected (no worse than before) */
              }
            }
            (
              ctx as unknown as { drawElementImage(el: Element, x: number, y: number): void }
            ).drawElementImage(root, 0, 0);
            if (__appliedAlpha) ctx.globalAlpha = 1;
            if (__appliedTransform) ctx.setTransform(1, 0, 0, 1, 0, 0);
            // fallow-ignore-next-line code-duplication
            for (const c of accel) {
              if (!c.hasAttribute("data-hf-3d")) continue;
              const r = c.getBoundingClientRect();
              try {
                ctx.drawImage(c, r.left - rootRect.left, r.top - rootRect.top, r.width, r.height);
              } catch {
                // skip
              }
            }
          } catch (e) {
            rejectCapture(e instanceof Error ? e : new Error(String(e)));
            return;
          }
          // Snapshot the canvas and hand off to the encode worker. createImageBitmap
          // is async; resolveCapture only fires after the bitmap is transferred, so
          // the canvas is safe to overwrite for the next frame once this evaluate's
          // promise resolves.
          createImageBitmap(canvas)
            .then((bmp) => {
              type EncWin = Window & { __hfEncWorker?: Worker };
              const ew = window as EncWin;
              if (!ew.__hfEncWorker) {
                bmp.close(); // don't leak the GPU-backed ImageBitmap on this reject path
                rejectCapture(new Error("drawElement: encode worker not initialized"));
                return;
              }
              ew.__hfEncWorker.postMessage({ bmp, id: fid, w, h, q: q / 100 }, [bmp]);
              resolveCapture();
            })
            .catch((e: unknown) => {
              rejectCapture(e instanceof Error ? e : new Error(String(e)));
            });
        };

        if (!sync) {
          drawAndKick();
          return;
        }
        const onPaint = () => {
          canvas.removeEventListener("paint", onPaint);
          drawAndKick();
        };
        canvas.addEventListener("paint", onPaint);
        // Sentinel dirty + requestPaint() — see __hfDeInvalidate in
        // injectDrawElementCanvas.
        usedRequestPaint = aw.__hfDeInvalidate?.() === true;
        setTimeout(() => {
          canvas.removeEventListener("paint", onPaint);
          drawAndKick();
        }, 250);
      });
    },
    { w: width, h: height, q: quality, sync: syncToPaintEvent, fid: frameId },
  );

  return { encodeResult };
}

/**
 * P6 prototype (HF_DE_BATCH): batch-produce N consecutive frames in ONE CDP
 * round-trip. In-page loop per frame: `__hf.seek(t)` → paint-wait
 * (__hfDeInvalidate: sentinel dirty + requestPaint, then the canvas `paint`
 * event) → drawElementImage composite → createImageBitmap →
 * postMessage to the encode worker. Bitmaps are posted per-frame (encode starts
 * immediately); only the CDP protocol round-trips are amortized N-fold.
 * Micro-pipeline inside the batch: frame i+1's seek/paint-wait overlaps frame
 * i's createImageBitmap (the canvas is only redrawn after i's bitmap resolves).
 *
 * macOS-GPU sync path only (the worker-encode gate guarantees this at the call
 * site). On an in-page failure at frame k, frames < k are already at the worker
 * (their promises resolve normally); pending entries for frames >= k are
 * rejected here and `failedAt` tells the caller to re-capture k.. via the
 * per-frame path (which owns the screenshot-fallback semantics).
 */
export async function produceDrawElementFrameBatch(
  page: Page,
  times: number[],
  width: number,
  height: number,
  quality = 80,
): Promise<{ encodeResults: Array<Promise<Buffer>>; failedAt: number | null; error?: string }> {
  const state = workerEncodeStates.get(page);
  if (!state) {
    throw new Error(
      "drawElement worker encode not initialized; call initDrawElementWorkerEncode first",
    );
  }

  const fids: number[] = [];
  const encodeResults: Array<Promise<Buffer>> = [];
  for (let i = 0; i < times.length; i++) {
    const frameId = ++state.nextId;
    fids.push(frameId);
    const p = new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (state.pending.delete(frameId)) {
          reject(new Error(`drawElement worker encode timed out (frame ${frameId})`));
        }
      }, 30_000);
      state.pending.set(frameId, {
        resolve: (b) => {
          clearTimeout(timer);
          resolve(b);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
    void p.catch(() => {}); // same orphan-rejection guard as produceDrawElementFrame
    encodeResults.push(p);
  }

  const outcome = await page.evaluate(
    async ({
      frames,
      w,
      h,
      q,
    }: {
      frames: Array<{ t: number; fid: number }>;
      w: number;
      h: number;
      q: number;
    }): Promise<{ failedAt: number | null; error?: string }> => {
      const canvas = document.getElementById("__hf_de_canvas") as HTMLCanvasElement | null;
      const root = document.querySelector("[data-composition-id]") as HTMLElement | null;
      if (!canvas || !root) return { failedAt: 0, error: "drawElement canvas not initialized" };
      const ctx = canvas.getContext("2d");
      if (!ctx) return { failedAt: 0, error: "drawElement: 2d context unavailable" };

      type AccelWindow = Window & {
        __hf_accel_canvases?: HTMLCanvasElement[];
        __hf3d?: { update: () => void };
        __hf?: { seek?: (t: number) => void };
        __hfDecodeDynamicCssBackgroundImages?: () => Promise<void>;
        __hfDeInvalidate?: () => boolean;
        __HF_ROOT_PROPS__?: boolean;
        __HF_ROOT_BASE_OPACITY__?: number;
        __hfEncWorker?: Worker;
      };
      const aw = window as AccelWindow;
      let usedRequestPaint = false;

      const waitPaint = (): Promise<void> =>
        new Promise((res) => {
          let done = false;
          const settle = () => {
            if (done) return;
            done = true;
            canvas.removeEventListener("paint", settle);
            res();
          };
          canvas.addEventListener("paint", settle);
          // Sentinel dirty + requestPaint() — see __hfDeInvalidate in
          // injectDrawElementCanvas.
          usedRequestPaint = aw.__hfDeInvalidate?.() === true;
          setTimeout(settle, 250);
        });

      let prevBitmap: Promise<void> = Promise.resolve();
      let prevBitmapIdx = -1;
      const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        if (!frame) return { failedAt: i, error: "batch frame missing" };
        const { t, fid } = frame;
        try {
          if (aw.__hf && typeof aw.__hf.seek === "function") aw.__hf.seek(t);
          await aw.__hfDecodeDynamicCssBackgroundImages?.();
          aw.__hf3d?.update();
          const accel = (aw.__hf_accel_canvases ?? []).filter((c) => root.contains(c));
          for (const c of accel) {
            if (c.style.visibility !== "hidden") c.style.visibility = "hidden";
          }
          await waitPaint();
          // Wait for the previous frame's bitmap before overwriting the canvas.
          try {
            await prevBitmap;
          } catch (e) {
            return { failedAt: prevBitmapIdx, error: errMsg(e) };
          }

          ctx.clearRect(0, 0, w, h);
          let bg = "";
          for (let el = root.parentElement; el; el = el.parentElement) {
            const c = getComputedStyle(el).backgroundColor;
            if (c && c !== "transparent" && c !== "rgba(0, 0, 0, 0)") {
              bg = c;
              break;
            }
          }
          ctx.fillStyle = bg || "#fff";
          ctx.fillRect(0, 0, w, h);
          const rootRect = root.getBoundingClientRect();
          for (const c of accel) {
            if (c.hasAttribute("data-hf-3d")) continue;
            const r = c.getBoundingClientRect();
            try {
              ctx.drawImage(c, r.left - rootRect.left, r.top - rootRect.top, r.width, r.height);
            } catch {
              // skip
            }
          }
          // Root compositor-prop corrections — mirrors produceDrawElementFrame
          // (see drawAndEncode's comment): transform always; opacity ratio only
          // when this frame's paint was NOT requestPaint-driven.
          let appliedTransform = false;
          let appliedAlpha = false;
          if (aw.__HF_ROOT_PROPS__) {
            try {
              const rcs = getComputedStyle(root);
              if (!usedRequestPaint) {
                const baseOp = aw.__HF_ROOT_BASE_OPACITY__ ?? 1;
                const curOp = parseFloat(rcs.opacity);
                if (baseOp > 0.001 && Number.isFinite(curOp)) {
                  const ratio = curOp / baseOp;
                  if (Math.abs(ratio - 1) > 0.002) {
                    ctx.globalAlpha = Math.max(0, Math.min(1, ratio));
                    appliedAlpha = true;
                  }
                }
              }
              const curTransform = rcs.transform;
              if (curTransform && curTransform !== "none") {
                const m = new DOMMatrix(curTransform);
                const origin = rcs.transformOrigin.split(" ");
                const ox = parseFloat(origin[0] ?? "0") || 0;
                const oy = parseFloat(origin[1] ?? "0") || 0;
                ctx.translate(ox, oy);
                ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
                ctx.translate(-ox, -oy);
                appliedTransform = true;
              }
            } catch {
              /* leave context unchanged → uncorrected (no worse than before) */
            }
          }
          (
            ctx as unknown as { drawElementImage(el: Element, x: number, y: number): void }
          ).drawElementImage(root, 0, 0);
          if (appliedAlpha) ctx.globalAlpha = 1;
          if (appliedTransform) ctx.setTransform(1, 0, 0, 1, 0, 0);
          for (const c of accel) {
            if (!c.hasAttribute("data-hf-3d")) continue;
            const r = c.getBoundingClientRect();
            try {
              ctx.drawImage(c, r.left - rootRect.left, r.top - rootRect.top, r.width, r.height);
            } catch {
              // skip
            }
          }

          prevBitmapIdx = i;
          prevBitmap = createImageBitmap(canvas).then((bmp) => {
            if (!aw.__hfEncWorker) {
              bmp.close();
              throw new Error("drawElement: encode worker not initialized");
            }
            aw.__hfEncWorker.postMessage({ bmp, id: fid, w, h, q: q / 100 }, [bmp]);
          });
        } catch (e) {
          try {
            await prevBitmap;
          } catch {
            /* prior frame's failure surfaces via its own pending timeout path */
          }
          return { failedAt: i, error: errMsg(e) };
        }
      }
      try {
        await prevBitmap;
      } catch (e) {
        return { failedAt: prevBitmapIdx, error: errMsg(e) };
      }
      return { failedAt: null };
    },
    { frames: times.map((t, i) => ({ t, fid: fids[i] ?? 0 })), w: width, h: height, q: quality },
  );

  if (outcome.failedAt !== null) {
    // Frames >= failedAt never reached the worker — reject their pendings now
    // so nothing waits 30s on the watchdog.
    for (let k = outcome.failedAt; k < fids.length; k++) {
      const fid = fids[k];
      if (fid === undefined) continue;
      const entry = state.pending.get(fid);
      if (entry) {
        state.pending.delete(fid);
        entry.reject(
          new Error(`drawElement batch produce failed at frame ${k}: ${outcome.error ?? "?"}`),
        );
      }
    }
  }

  return { encodeResults, failedAt: outcome.failedAt, error: outcome.error };
}
