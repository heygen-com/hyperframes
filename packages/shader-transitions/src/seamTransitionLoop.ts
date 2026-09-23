/**
 * playSeamTransitionLoop — plays a catalog transition's real WebGL effect
 * between two already-decoded frames, looping so a caller (Desktop's seam
 * popover) can show it on hover without owning any WebGL of its own.
 *
 * Deliberately decoupled from hyper-shader.ts's full composition engine: no
 * GSAP timeline, no scene capture, no multi-transition scheduling. The
 * caller supplies the two frames directly (Desktop decodes PNGs from its own
 * hidden-window capture, so nothing here assumes a DOM scene exists).
 */

import {
  createContext,
  setupQuad,
  createProgram,
  createTexture,
  uploadTextureSource,
  renderShader,
} from "./webgl.js";
import { getFragSource, type ShaderName } from "./shaders/registry.js";

/** The subset of CanvasImageSource that WebGL's texImage2D actually accepts. */
export type SeamTransitionFrameSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

/**
 * Catalog block name -> shader-transitions registry key, for the two catalog
 * names that don't match their registry key verbatim. Those registry keys
 * are also used as-is by engine/producer's render pipeline
 * (packages/engine/src/utils/shaderTransitions.ts), so they were not renamed
 * to match the catalog; this map is the one place the two naming schemes are
 * reconciled. Every other catalog shader name (including "glitch", an
 * unquoted — but real — registry key) matches its registry key verbatim.
 */
const CATALOG_SHADER_ALIASES: Readonly<Record<string, ShaderName>> = {
  "domain-warp-dissolve": "domain-warp",
  "chromatic-radial-split": "chromatic-split",
};

export interface SeamTransitionLoopOptions {
  /** Defaults to the canvas's own drawing-buffer size. A mismatched size here
   * silently under-fills the canvas instead of erroring — WebGL clips to the
   * smaller of the two, so most of each frame renders outside the visible
   * buffer and the canvas reads back as a near-flat blend. */
  width?: number;
  height?: number;
  /** Full 0→1→0 cycle length. Default 1000ms (D-280's one-second loop). */
  loopMs?: number;
}

export interface SeamTransitionLoopHandle {
  /** Stops the loop and releases the WebGL context. Idempotent. */
  stop: () => void;
  /** Resolves once the first frame has been drawn to `canvas`. */
  ready: Promise<void>;
}

/**
 * Throws synchronously when `shaderName` has no WebGL implementation (a
 * catalog block with only a CSS/motion effect, not one of the 14 shader
 * blocks) or when `canvas` yields no WebGL context.
 */
export function playSeamTransitionLoop(
  canvas: HTMLCanvasElement,
  fromSource: SeamTransitionFrameSource,
  toSource: SeamTransitionFrameSource,
  shaderName: string,
  options: SeamTransitionLoopOptions = {},
): SeamTransitionLoopHandle {
  const registryName = (CATALOG_SHADER_ALIASES[shaderName] ?? shaderName) as ShaderName;
  const fragSrc = getFragSource(registryName);

  const width = options.width ?? canvas.width;
  const height = options.height ?? canvas.height;
  const loopMs = options.loopMs ?? 1000;

  const gl = createContext(canvas, width, height);
  if (!gl) {
    throw new Error(`[playSeamTransitionLoop] No WebGL context available for "${shaderName}"`);
  }
  const glContext = gl;

  const quadBuf = setupQuad(glContext);
  const prog = createProgram(glContext, fragSrc);
  const texFrom = createTexture(glContext);
  const texTo = createTexture(glContext);
  uploadTextureSource(glContext, texFrom, fromSource);
  uploadTextureSource(glContext, texTo, toSource);

  let stopped = false;
  let rafId = 0;
  let startMs: number | null = null;
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  function frame(nowMs: number): void {
    if (stopped) return;
    if (startMs === null) startMs = nowMs;
    const phase = ((nowMs - startMs) % loopMs) / loopMs;
    const progress = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    renderShader(glContext, quadBuf, prog, texFrom, texTo, progress, undefined, width, height);
    resolveReady();
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return {
    ready,
    stop: () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(rafId);
      glContext.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
