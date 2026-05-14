/**
 * engineModePageComposite — page-side WebGL compositor for engine render mode.
 *
 * Opt-in via `window.__HF_PAGE_SIDE_COMPOSITING__ = true` (set by the producer
 * when `EngineConfig.enablePageSideCompositing` is true). When the flag is
 * off, hyper-shader's engine-mode path stays on the opacity-flip-only timeline
 * and the producer's hf#677 Node-side layered pipeline runs the shader blend.
 *
 * When the flag is ON:
 *
 *  1. We install a fullscreen `<canvas id="__hf-gl-compositor">` overlay
 *     (z-index above everything; pointer-events:none).
 *  2. We wrap `window.__hf.seek` so each seek into a transition window:
 *       a. Captures the FROM-scene element to a GL texture.
 *       b. Captures the TO-scene element to a GL texture.
 *       c. Renders the active transition's fragment shader on the overlay
 *          canvas with both textures + computed progress + accent colours.
 *       d. Hides the FROM-scene element's contribution (so the screenshot
 *          taken by the engine after the seek sees only the GL overlay's
 *          composited result, not the DOM's own opacity-blended layers).
 *     Outside a transition window the overlay is hidden and the seek runs
 *     verbatim — the engine captures the DOM as usual.
 *
 * The result: the engine takes ONE opaque RGB `Page.captureScreenshot` per
 * frame; the shader blend math runs in Chrome's WebGL on the GPU (Metal on
 * Mac via CoreAnimation, ANGLE/D3D on Windows, SwiftShader as the software
 * fallback on Linux headless). Wall-time savings vs. the Node-side path
 * come from (a) eliminating the two per-frame transparent-alpha screenshots
 * (one per scene), (b) eliminating the rgb48le ↔ rgba8 transfer-space
 * conversion, (c) eliminating the Node-side per-pixel shader-blend loop
 * (the worker pool from hf#677 #758).
 *
 * Determinism note: WebGL shaders execute in f32 on the GPU; the Node-side
 * path executes in f64 on the CPU. The two are NOT bit-identical. Fixture
 * pins that assume byte-exact MP4 output (the published harness baseline)
 * must use the default-off path. PSNR ≥ 50dB pins are the correctness gate
 * for the page-side path.
 *
 * Why the producer can't just take a screenshot of the gl-canvas only:
 * the streaming capture path snaps the whole page, which is what we want —
 * the overlay sits on top, opaque inside the transition window, fully
 * transparent (display:none) outside. The composition's DOM still renders
 * the static parts (e.g. background, header chrome) outside transitions.
 */

import {
  createContext,
  setupQuad,
  createProgram,
  createTexture,
  uploadTextureSource,
  renderShader,
  type AccentColors,
} from "./webgl.js";
import { getFragSource, type ShaderName } from "./shaders/registry.js";
import { isHtmlInCanvasCaptureSupported } from "./capture.js";

// Locally redeclared — see the same pattern in hyper-shader.ts. The package
// must not depend on @hyperframes/engine.
interface PageCompositeTransitionConfig {
  time: number;
  shader: ShaderName;
  duration?: number;
}

export interface PageCompositorInstallOptions {
  scenes: string[];
  transitions: PageCompositeTransitionConfig[];
  bgColor: string;
  accentColors: AccentColors;
  width: number;
  height: number;
  /** Default duration in seconds for transitions that don't declare one. */
  defaultDuration: number;
}

interface ResolvedTransition {
  index: number;
  time: number;
  duration: number;
  shader: string;
  fromSceneId: string;
  toSceneId: string;
  prog: WebGLProgram;
}

/**
 * Sentinel id for the engine to recognize that page-side compositing is
 * actively running (vs. merely opted in). The presence of this id on the
 * page is independent of the active-transition state; the engine doesn't
 * need to read it — it's used by tests and by the bundled-CLI canary
 * check in the validation script.
 */
export const PAGE_COMPOSITOR_CANVAS_ID = "__hf-page-side-compositor";

/**
 * Search string the bundled-CLI smoke greps for, to confirm the page-side
 * compositor module is present in the shipped bundle (not just the source
 * tree). Keep this string in the runtime path so dead-code elimination
 * cannot remove it.
 */
export const PAGE_COMPOSITOR_BUILD_CANARY = "__hf_page_compositor_v1__";

/**
 * Returns true iff this Chromium build exposes the HTML-in-Canvas
 * `drawElementImage` API. Re-exported here so the engine-mode wrapper has
 * a single import surface; the underlying probe is the existing one in
 * `capture.ts` (used by the preview path).
 */
export function isPageSideCompositingSupported(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  return isHtmlInCanvasCaptureSupported();
}

/**
 * Install the page-side compositor. Idempotent — second calls are no-ops.
 * Returns `true` when installation succeeded, `false` when the Chromium
 * runtime does not support the required `drawElementImage` API (caller
 * should fall back to opacity-flip mode).
 */
export function installPageSideCompositor(options: PageCompositorInstallOptions): boolean {
  // Canary string — kept on the runtime path so the bundle keeps it.
  if (typeof window === "undefined") return false;
  (window as unknown as { __HF_PAGE_COMPOSITOR_CANARY__?: string }).__HF_PAGE_COMPOSITOR_CANARY__ =
    PAGE_COMPOSITOR_BUILD_CANARY;
  if (!isPageSideCompositingSupported()) {
    // eslint-disable-next-line no-console
    console.warn(
      "[HyperShader] page-side compositing requested but drawElementImage is not " +
        "supported in this Chromium build; falling back to opacity-flip mode " +
        "(Node-side layered pipeline will handle the blend).",
    );
    return false;
  }
  if (document.getElementById(PAGE_COMPOSITOR_CANVAS_ID)) return true;

  const { scenes, transitions, accentColors, width, height, defaultDuration } = options;

  // Fullscreen GL canvas overlay. `display:none` by default — only made
  // visible while a transition is active.
  const glCanvas = document.createElement("canvas");
  glCanvas.id = PAGE_COMPOSITOR_CANVAS_ID;
  glCanvas.width = width;
  glCanvas.height = height;
  glCanvas.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483646;pointer-events:none;display:none;";
  document.body.appendChild(glCanvas);

  const gl = createContext(glCanvas, width, height);
  if (!gl) {
    // eslint-disable-next-line no-console
    console.warn("[HyperShader] page-side compositor: WebGL context unavailable.");
    glCanvas.remove();
    return false;
  }
  const quadBuf = setupQuad(gl);

  // Pre-compile + cache fragment programs per shader name. Compiling on
  // first transition would stall the very first transition frame; the
  // engine's deterministic seek loop is sensitive to that.
  const programs = new Map<string, WebGLProgram>();
  for (const t of transitions) {
    if (programs.has(t.shader)) continue;
    try {
      programs.set(t.shader, createProgram(gl, getFragSource(t.shader)));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[HyperShader] page-side compositor: failed to compile "${t.shader}":`, err);
    }
  }

  // Resolve transitions to fully-typed records the seek wrapper consults.
  const resolved: ResolvedTransition[] = [];
  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    if (!t) continue;
    const fromSceneId = scenes[i];
    const toSceneId = scenes[i + 1];
    const prog = programs.get(t.shader);
    if (!fromSceneId || !toSceneId || !prog) continue;
    resolved.push({
      index: i,
      time: t.time,
      duration: t.duration ?? defaultDuration,
      shader: t.shader,
      fromSceneId,
      toSceneId,
      prog,
    });
  }
  if (resolved.length === 0) {
    glCanvas.remove();
    return false;
  }

  // Per-scene background canvases. We capture each scene element to its own
  // backing canvas via `drawElementImage`, then upload to a GL texture.
  // The two textures persist across frames; only the texture *contents*
  // change per frame.
  const fromTex = createTexture(gl);
  const toTex = createTexture(gl);
  const sceneCaptureCanvas = document.createElement("canvas");
  sceneCaptureCanvas.width = width;
  sceneCaptureCanvas.height = height;
  // Layout-attached canvas (so drawElementImage has live layout to sample).
  // Kept off-screen; never inserted into the document layout flow.
  const stagingCanvas = document.createElement("canvas") as HTMLCanvasElement & {
    layoutSubtree?: boolean;
  };
  stagingCanvas.width = width;
  stagingCanvas.height = height;
  stagingCanvas.setAttribute("layoutsubtree", "");
  stagingCanvas.style.cssText =
    "position:fixed;top:0;left:0;width:" +
    String(width) +
    "px;height:" +
    String(height) +
    "px;z-index:-9999;pointer-events:none;opacity:0;";
  document.body.appendChild(stagingCanvas);

  type DrawElementImageCtx = CanvasRenderingContext2D & {
    drawElementImage: (el: Element, x: number, y: number, w: number, h: number) => void;
  };

  function captureSceneToTexture(sceneEl: HTMLElement, tex: WebGLTexture): boolean {
    const ctx = stagingCanvas.getContext("2d") as DrawElementImageCtx | null;
    if (!ctx || typeof ctx.drawElementImage !== "function") return false;
    ctx.fillStyle = options.bgColor;
    ctx.fillRect(0, 0, width, height);
    try {
      ctx.drawElementImage(sceneEl, 0, 0, width, height);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[HyperShader] page-side compositor: drawElementImage threw:", err);
      return false;
    }
    uploadTextureSource(gl as WebGLRenderingContext, tex, stagingCanvas);
    return true;
  }

  function findActive(time: number): ResolvedTransition | null {
    for (const t of resolved) {
      if (time >= t.time && time <= t.time + t.duration) return t;
    }
    return null;
  }

  // Wrap window.__hf.seek so each seek into a transition window does the
  // page-side compose BEFORE returning (the engine's capture awaits the
  // seek promise then immediately screenshots). Outside the window we hide
  // the overlay and let the engine see the bare DOM.
  type HfWindow = Window & {
    __hf?: { seek?: (t: number) => unknown };
  };
  const hfWin = window as HfWindow;
  const wrapSeek = (): void => {
    if (!hfWin.__hf) return;
    const originalSeek = hfWin.__hf.seek;
    if (typeof originalSeek !== "function") return;
    const wrapped = (time: number): unknown => {
      // Run the engine's original seek first — populates the DOM at the
      // correct timeline position so element computed styles + GSAP-driven
      // transforms are valid before we sample.
      const result = originalSeek.call(hfWin.__hf, time);
      const active = findActive(time);
      if (!active) {
        glCanvas.style.display = "none";
        return result;
      }
      const fromEl = document.getElementById(active.fromSceneId);
      const toEl = document.getElementById(active.toSceneId);
      if (!(fromEl instanceof HTMLElement) || !(toEl instanceof HTMLElement)) {
        glCanvas.style.display = "none";
        return result;
      }
      // The opacity-flip timeline in initEngineMode has set both scenes
      // to opacity 1 during the transition window. We need to render
      // each one in isolation to texture, then composite via shader.
      // Briefly force each scene visible-and-alone during its own capture
      // by reading via drawElementImage with the live DOM (drawElementImage
      // captures THIS element subtree with its current computed style;
      // siblings outside the subtree don't bleed in).
      const fromOk = captureSceneToTexture(fromEl, fromTex);
      const toOk = captureSceneToTexture(toEl, toTex);
      if (!fromOk || !toOk) {
        glCanvas.style.display = "none";
        return result;
      }
      const progress =
        active.duration === 0
          ? 1
          : Math.min(1, Math.max(0, (time - active.time) / active.duration));
      renderShader(
        gl as WebGLRenderingContext,
        quadBuf,
        active.prog,
        fromTex,
        toTex,
        progress,
        accentColors,
        width,
        height,
      );
      // Hide both DOM scenes during the overlay-visible window so they
      // don't double-paint under the screenshot. Original opacity is
      // restored on the next out-of-window seek.
      fromEl.style.opacity = "0";
      toEl.style.opacity = "0";
      glCanvas.style.display = "block";
      return result;
    };
    hfWin.__hf.seek = wrapped;
  };

  // window.__hf.seek is wired up only after the producer's bridge script
  // runs (which itself fires only after window.__player is ready). Poll
  // for it briefly. Once wrapped, the wrapper is permanent for the page
  // lifetime — the engine never re-wraps `seek`.
  let attempts = 0;
  const ivHandle = window.setInterval(() => {
    attempts += 1;
    if (hfWin.__hf?.seek) {
      wrapSeek();
      window.clearInterval(ivHandle);
    } else if (attempts > 200) {
      window.clearInterval(ivHandle);
      // eslint-disable-next-line no-console
      console.warn(
        "[HyperShader] page-side compositor: window.__hf.seek never appeared after 10s; " +
          "the engine bridge did not initialize. Falling back to opacity-flip mode.",
      );
    }
  }, 50);

  return true;
}
