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
 *       a. Captures the FROM-scene element to a GL texture via html2canvas.
 *       b. Captures the TO-scene element to a GL texture via html2canvas.
 *       c. Renders the active transition's fragment shader on the overlay
 *          canvas with both textures + computed progress + accent colours.
 *       d. Hides the FROM/TO scene elements (so the screenshot taken by the
 *          engine after the seek sees only the GL overlay's composited result).
 *     Outside a transition window the overlay is hidden and the seek runs
 *     verbatim — the engine captures the DOM as usual.
 *
 * The result: the engine takes ONE opaque RGB `Page.captureScreenshot` per
 * frame; the shader blend math runs in Chrome's WebGL on the GPU.
 *
 * Why html2canvas instead of the preview-path's drawElementImage (capture.ts):
 *
 * In engine render mode the virtual-time shim (fileServer.ts) replaces
 * requestAnimationFrame with a queue that only flushes during seekToTime().
 * The preview-path capture in capture.ts waits for two real rAFs so the
 * browser compositor paints the cloned element before drawElementImage reads
 * its paint record. Inside a seek wrapper we can't await shimmed rAFs
 * (deadlock — they flush on the *next* seek) and original rAFs don't produce
 * paint records under virtual-time control. drawElementImage returns
 * "InvalidStateError: No cached paint record" for any element that wasn't
 * painted by the browser's own compositor pass — which includes every clone
 * we create at capture time.
 *
 * html2canvas avoids the problem entirely: it clones the DOM, reads computed
 * styles, and renders to a canvas using its own JS drawing pipeline with no
 * dependency on the browser's paint/compositor cycle. This is the same
 * renderer used by the preview-mode fallback path (capture.ts,
 * foreignObjectRendering: false).
 *
 * Determinism note: html2canvas rendering differs slightly from native
 * Chromium rendering (text-shadow, gradient antialiasing, sub-pixel). The
 * WebGL shader also executes in f32 vs f64 on the Node-side path. Fixture
 * pins that assume byte-exact MP4 output must use the default-off path.
 */

import html2canvas from "html2canvas";
import {
  createContext,
  setupQuad,
  createProgram,
  createTexture,
  uploadTexture,
  renderShader,
  type AccentColors,
} from "./webgl.js";
import { getFragSource, type ShaderName } from "./shaders/registry.js";
import { stabilizeTransformedBoxShadows } from "./capture.js";

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
 * Returns true iff the runtime supports page-side compositing. Requires
 * a browser environment with WebGL. (html2canvas handles the DOM capture
 * without needing drawElementImage.)
 */
export function isPageSideCompositingSupported(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl") || probe.getContext("experimental-webgl");
  if (!gl) return false;
  (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context")?.loseContext();
  return true;
}

/**
 * Install the page-side compositor. Idempotent — second calls are no-ops.
 * Returns `true` when installation succeeded, `false` when the runtime
 * does not support WebGL (caller should fall back to opacity-flip mode).
 */
export function installPageSideCompositor(options: PageCompositorInstallOptions): boolean {
  // Canary string — kept on the runtime path so the bundle keeps it.
  if (typeof window === "undefined") return false;
  (window as unknown as { __HF_PAGE_COMPOSITOR_CANARY__?: string }).__HF_PAGE_COMPOSITOR_CANARY__ =
    PAGE_COMPOSITOR_BUILD_CANARY;
  if (!isPageSideCompositingSupported()) {
    // eslint-disable-next-line no-console
    console.warn(
      "[HyperShader] page-side compositing requested but WebGL is not " +
        "available; falling back to opacity-flip mode " +
        "(Node-side layered pipeline will handle the blend).",
    );
    return false;
  }
  if (document.getElementById(PAGE_COMPOSITOR_CANVAS_ID)) return true;

  const { scenes, transitions, accentColors, width, height, defaultDuration } = options;

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

  const resolved: ResolvedTransition[] = [];
  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    if (!t) continue;
    const fromSceneId = scenes[i];
    const toSceneId = scenes[i + 1];
    const prog = programs.get(t.shader);
    if (!fromSceneId || !toSceneId || !prog) continue;
    resolved.push({
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

  const fromTex = createTexture(gl);
  const toTex = createTexture(gl);

  async function captureSceneToTexture(sceneEl: HTMLElement, tex: WebGLTexture): Promise<boolean> {
    try {
      const canvas = await html2canvas(sceneEl, {
        width,
        height,
        scale: 1,
        backgroundColor: options.bgColor,
        logging: false,
        foreignObjectRendering: false,
        useCORS: true,
        allowTaint: true,
        onclone: (_doc, clone) => {
          if (clone instanceof HTMLElement) stabilizeTransformedBoxShadows(clone);
        },
        ignoreElements: (el: Element) =>
          el.tagName === "CANVAS" || el.hasAttribute("data-no-capture"),
      });
      uploadTexture(gl as WebGLRenderingContext, tex, canvas);
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[HyperShader] page-side compositor: scene capture failed:", err);
      return false;
    }
  }

  function findActive(time: number): ResolvedTransition | null {
    for (const t of resolved) {
      if (time >= t.time && time <= t.time + t.duration) return t;
    }
    return null;
  }

  // The seek wrapper returns a Promise so the engine's page.evaluate (which
  // now `return`s the seek result) awaits compositing before screenshotting.
  type HfWindow = Window & {
    __hf?: { seek?: (t: number) => unknown };
  };
  const hfWin = window as HfWindow;
  const wrapSeek = (): void => {
    if (!hfWin.__hf) return;
    const originalSeek = hfWin.__hf.seek;
    if (typeof originalSeek !== "function") return;
    let prevFromEl: HTMLElement | null = null;
    let prevToEl: HTMLElement | null = null;
    const wrapped = async (time: number): Promise<unknown> => {
      // Restore opacity on scenes hidden by the previous frame's compositor
      // pass BEFORE running GSAP seek — GSAP caches inline values and won't
      // re-write opacity if it thinks the value hasn't changed.
      if (prevFromEl) {
        prevFromEl.style.opacity = "";
        prevFromEl = null;
      }
      if (prevToEl) {
        prevToEl.style.opacity = "";
        prevToEl = null;
      }

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
      const [fromOk, toOk] = await Promise.all([
        captureSceneToTexture(fromEl, fromTex),
        captureSceneToTexture(toEl, toTex),
      ]);
      if (!fromOk || !toOk) {
        glCanvas.style.display = "none";
        return result;
      }
      try {
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
        glCanvas.style.display = "block";
      } finally {
        fromEl.style.opacity = "0";
        toEl.style.opacity = "0";
        prevFromEl = fromEl;
        prevToEl = toEl;
      }
      return result;
    };
    hfWin.__hf.seek = wrapped;
  };

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
