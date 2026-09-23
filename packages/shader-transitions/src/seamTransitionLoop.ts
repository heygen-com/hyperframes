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

/** The subset of CanvasImageSource that WebGL's texImage2D actually accepts.
 * Pass a frame at or near the render canvas's own size — LINEAR filtering
 * samples it down to that size regardless, so a much larger source only
 * costs an upload, not extra quality. */
export type SeamTransitionFrameSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

/**
 * Catalog block name -> shader-transitions registry key, for the two catalog
 * names that don't match their registry key verbatim. Those registry keys
 * are also used as-is by engine/producer's render pipeline
 * (packages/engine/src/utils/shaderTransitions.ts), so they were not renamed
 * to match the catalog; this map is the one place the two naming schemes are
 * reconciled. Every other catalog shader name (including "glitch", an
 * unquoted — but real — registry key) matches its registry key verbatim.
 * A Map, not a plain object, so a bogus name like "constructor" can never
 * resolve to an Object.prototype member instead of falling through to
 * getFragSource's own unknown-shader check.
 */
const CATALOG_SHADER_ALIASES = new Map<string, ShaderName>([
  ["domain-warp-dissolve", "domain-warp"],
  ["chromatic-radial-split", "chromatic-split"],
]);

export interface SeamTransitionLoopOptions {
  /** Defaults to the canvas's own drawing-buffer size. */
  width?: number;
  height?: number;
  /** Full 0→1→0 cycle length. Default 1000ms (D-280's one-second loop). */
  loopMs?: number;
}

export interface SeamTransitionLoopHandle {
  /** Stops the loop and deletes the program, textures and buffer this call
   * created, leaving the canvas's WebGL context itself alive so a caller
   * that reuses the canvas across hovers doesn't force a lost-context path
   * on the next `playSeamTransitionLoop` call. Idempotent. */
  stop: () => void;
  /** Resolves once the first frame has been drawn to `canvas`, or once
   * `stop()` runs, whichever comes first — a hover that ends before the
   * first frame never leaves an awaiting caller hanging. */
  ready: Promise<void>;
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `[playSeamTransitionLoop] ${name} must be a finite number above 0, got ${value}`,
    );
  }
}

/**
 * Throws synchronously when `shaderName` has no WebGL implementation (a
 * catalog block with only a CSS/motion effect, not one of the 14 shader
 * blocks), when `canvas` yields no WebGL context, or when `width`, `height`
 * or `loopMs` (explicit or defaulted from the canvas) isn't a finite number
 * above 0 — a bad size otherwise renders nothing forever with no error.
 */
export function playSeamTransitionLoop(
  canvas: HTMLCanvasElement,
  fromSource: SeamTransitionFrameSource,
  toSource: SeamTransitionFrameSource,
  shaderName: string,
  options: SeamTransitionLoopOptions = {},
): SeamTransitionLoopHandle {
  const fragSrc = getFragSource(CATALOG_SHADER_ALIASES.get(shaderName) ?? shaderName);

  const width = options.width ?? canvas.width;
  const height = options.height ?? canvas.height;
  const loopMs = options.loopMs ?? 1000;
  assertPositiveFinite("width", width);
  assertPositiveFinite("height", height);
  assertPositiveFinite("loopMs", loopMs);

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
    let isFirstFrame = false;
    if (startMs === null) {
      startMs = nowMs;
      isFirstFrame = true;
    }
    const phase = ((nowMs - startMs) % loopMs) / loopMs;
    const progress = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    renderShader(glContext, quadBuf, prog, texFrom, texTo, progress, undefined, width, height);
    if (isFirstFrame) resolveReady();
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return {
    ready,
    stop: () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(rafId);
      resolveReady();
      glContext.deleteTexture(texFrom);
      glContext.deleteTexture(texTo);
      glContext.deleteProgram(prog);
      glContext.deleteBuffer(quadBuf);
    },
  };
}
