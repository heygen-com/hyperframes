/**
 * engineModePageComposite — page-side WebGL compositor for engine render mode.
 *
 * Opt-in via `window.__HF_PAGE_SIDE_COMPOSITING__ = true` (set by the producer
 * when `EngineConfig.enablePageSideCompositing` is true). When the flag is
 * off, hyper-shader's engine-mode path stays on the opacity-flip-only timeline
 * and the producer's hf#677 Node-side layered pipeline runs the shader blend.
 *
 * Two-phase capture protocol:
 *
 *  Phase 1 (seek wrapper, runs inside page.evaluate):
 *    - Runs original GSAP seek to position the timeline
 *    - If inside a transition window, clones FROM/TO scene elements into
 *      layoutsubtree staging canvases
 *    - Sets window.__hf_page_composite_pending with transition metadata
 *    - Returns immediately (seek resolves)
 *
 *  Paint force (engine-side, frameCapture.ts):
 *    - Engine detects the pending flag and fires a micro Page.captureScreenshot
 *      to force the browser compositor to paint the staging canvas clones
 *
 *  Phase 2 (engine calls window.__hf_page_composite_resolve):
 *    - drawElementImage reads the now-valid paint records from the clones
 *    - Uploads textures to WebGL, runs the shader, shows the GL overlay
 *    - Cleans up staging canvases
 *
 * This gives native-fidelity capture (identical to preview-path
 * drawElementImage) without depending on requestAnimationFrame for paint.
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

interface PageCompositeTransitionConfig {
  time: number;
  /**
   * Shader id. Undefined entries are CSS crossfades — the page-side
   * compositor skips them, and the GSAP timeline in `initEngineMode`
   * schedules an actual opacity-crossfade tween for those entries so the
   * single page screenshot contains a correct blended frame. The entry
   * stays in the array to preserve `transitions[i]` ↔ `scenes[i]`/
   * `scenes[i+1]` index alignment for the surrounding shader entries.
   */
  shader?: ShaderName;
  duration?: number;
}

export interface PageCompositorInstallOptions {
  scenes: string[];
  transitions: PageCompositeTransitionConfig[];
  bgColor: string;
  accentColors: AccentColors;
  width: number;
  height: number;
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

export const PAGE_COMPOSITOR_CANVAS_ID = "__hf-page-side-compositor";
export const PAGE_COMPOSITOR_BUILD_CANARY = "__hf_page_compositor_v1__";

export function isPageSideCompositingSupported(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (!isHtmlInCanvasCaptureSupported()) return false;
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl") || probe.getContext("experimental-webgl");
  if (!gl) return false;
  (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context")?.loseContext();
  return true;
}

export function installPageSideCompositor(options: PageCompositorInstallOptions): boolean {
  if (typeof window === "undefined") return false;
  (window as unknown as { __HF_PAGE_COMPOSITOR_CANARY__?: string }).__HF_PAGE_COMPOSITOR_CANARY__ =
    PAGE_COMPOSITOR_BUILD_CANARY;
  if (!isPageSideCompositingSupported()) {
    // eslint-disable-next-line no-console
    console.warn(
      "[HyperShader] page-side compositing requested but drawElementImage/WebGL is not " +
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
    // CSS crossfade entries (shader undefined) carry no program. Use a
    // strict undefined check so a misconfigured empty string still fails
    // loudly through the createProgram path below.
    if (t.shader === undefined) continue;
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
    // CSS-only transitions stay on the GSAP opacity timeline; the page-
    // side compositor only handles shader entries. Index i is preserved
    // so subsequent shader transitions still pair with the right scenes.
    if (t.shader === undefined) continue;
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

  type DrawElementImageCtx = CanvasRenderingContext2D & {
    drawElementImage: (el: Element, x: number, y: number, w: number, h: number) => void;
  };

  interface StagingCanvas extends HTMLCanvasElement {
    layoutSubtree?: boolean;
  }

  // Persistent staging canvases — children are swapped per transition frame.
  // Kept in the DOM so the compositor paints them on the next frame.
  const fromStaging = document.createElement("canvas") as StagingCanvas;
  const toStaging = document.createElement("canvas") as StagingCanvas;
  for (const s of [fromStaging, toStaging]) {
    s.width = width;
    s.height = height;
    s.setAttribute("layoutsubtree", "");
    s.style.cssText =
      "position:fixed;top:0;left:0;width:" +
      width +
      "px;height:" +
      height +
      "px;z-index:-9998;pointer-events:none;";
    document.body.appendChild(s);
  }

  function findActive(time: number): ResolvedTransition | null {
    for (const t of resolved) {
      if (time >= t.time && time <= t.time + t.duration) return t;
    }
    return null;
  }

  let currentActive: ResolvedTransition | null = null;
  let currentProgress = 0;

  type PendingWindow = Window & {
    __hf_page_composite_pending?: boolean;
    __hf_page_composite_resolve?: () => boolean;
  };
  const pWin = window as PendingWindow;

  // Phase 2a: clone scenes into staging canvases. Called after video frame
  // injection so cloneNode picks up <img> replacements for <video> elements.
  // Awaits decode on cloned data-URI images so drawElementImage reads
  // the current frame, not a stale paint cache entry.
  async function prepareComposite(): Promise<boolean> {
    const active = currentActive;
    if (!active) {
      pWin.__hf_page_composite_pending = false;
      return false;
    }

    const fromEl = document.getElementById(active.fromSceneId);
    const toEl = document.getElementById(active.toSceneId);
    if (!(fromEl instanceof HTMLElement) || !(toEl instanceof HTMLElement)) {
      pWin.__hf_page_composite_pending = false;
      return false;
    }
    while (fromStaging.firstChild) fromStaging.removeChild(fromStaging.firstChild);
    while (toStaging.firstChild) toStaging.removeChild(toStaging.firstChild);
    fromStaging.appendChild(fromEl.cloneNode(true));
    toStaging.appendChild(toEl.cloneNode(true));

    // Decode any data-URI images in clones so the browser has current
    // bitmaps before the micro-screenshot forces a paint pass.
    const decodes: Promise<void>[] = [];
    for (const staging of [fromStaging, toStaging]) {
      for (const img of staging.querySelectorAll("img")) {
        if (img.src && img.src.startsWith("data:") && typeof img.decode === "function") {
          decodes.push(img.decode().catch(() => {}));
        }
      }
    }
    if (decodes.length > 0) await Promise.all(decodes);

    return true;
  }

  // Phase 2b: drawElementImage from painted clones + shader composite.
  // Called after micro-screenshot forces the browser to paint the clones.
  function resolveComposite(): boolean {
    const active = currentActive;
    if (!active) {
      pWin.__hf_page_composite_pending = false;
      return false;
    }

    const fromChild = fromStaging.firstElementChild;
    const toChild = toStaging.firstElementChild;
    if (!fromChild || !toChild) {
      pWin.__hf_page_composite_pending = false;
      return false;
    }

    const fromCtx = fromStaging.getContext("2d") as DrawElementImageCtx | null;
    const toCtx = toStaging.getContext("2d") as DrawElementImageCtx | null;
    if (!fromCtx?.drawElementImage || !toCtx?.drawElementImage) {
      pWin.__hf_page_composite_pending = false;
      return false;
    }

    try {
      fromCtx.fillStyle = options.bgColor;
      fromCtx.fillRect(0, 0, width, height);
      fromCtx.drawElementImage(fromChild, 0, 0, width, height);

      toCtx.fillStyle = options.bgColor;
      toCtx.fillRect(0, 0, width, height);
      toCtx.drawElementImage(toChild, 0, 0, width, height);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[HyperShader] page-side compositor: drawElementImage failed:", err);
      pWin.__hf_page_composite_pending = false;
      return false;
    }

    uploadTextureSource(gl as WebGLRenderingContext, fromTex, fromStaging);
    uploadTextureSource(gl as WebGLRenderingContext, toTex, toStaging);

    try {
      renderShader(
        gl as WebGLRenderingContext,
        quadBuf,
        active.prog,
        fromTex,
        toTex,
        currentProgress,
        accentColors,
        width,
        height,
      );
      glCanvas.style.display = "block";
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[HyperShader] page-side compositor: renderShader failed:", err);
      glCanvas.style.display = "none";
    }
    pWin.__hf_page_composite_pending = false;
    return true;
  }

  pWin.__hf_page_composite_resolve = resolveComposite;
  (
    pWin as unknown as { __hf_page_composite_prepare?: () => Promise<boolean> }
  ).__hf_page_composite_prepare = prepareComposite;

  type HfWindow = Window & {
    __hf?: { seek?: (t: number) => unknown };
  };
  const hfWin = window as HfWindow;
  const wrapSeek = (): void => {
    if (!hfWin.__hf) return;
    const originalSeek = hfWin.__hf.seek;
    if (typeof originalSeek !== "function") return;
    const wrapped = (time: number): unknown => {
      const result = originalSeek.call(hfWin.__hf, time);
      const active = findActive(time);
      if (!active) {
        glCanvas.style.display = "none";
        pWin.__hf_page_composite_pending = false;
        while (fromStaging.firstChild) fromStaging.removeChild(fromStaging.firstChild);
        while (toStaging.firstChild) toStaging.removeChild(toStaging.firstChild);
        return result;
      }
      currentActive = active;
      currentProgress =
        active.duration === 0
          ? 1
          : Math.min(1, Math.max(0, (time - active.time) / active.duration));
      pWin.__hf_page_composite_pending = true;

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
