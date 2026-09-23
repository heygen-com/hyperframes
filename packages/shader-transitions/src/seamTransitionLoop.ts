/**
 * playSeamTransitionLoop — plays a catalog transition's real WebGL effect
 * between two already-decoded frames, looping so a caller (Desktop's seam
 * popover) can show it on hover without owning any WebGL of its own.
 *
 * Deliberately decoupled from hyper-shader.ts's full composition engine: no
 * GSAP timeline, no scene capture — the caller supplies the frames directly.
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
 * Catalog block name -> shader-transitions registry key, for the two names
 * that don't match their registry key verbatim (those keys are also used
 * as-is by engine/producer's render pipeline, so they weren't renamed to
 * match the catalog). Every other name, including "glitch", matches as-is.
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
 * Throws synchronously for a shader with no WebGL implementation, a canvas
 * that yields no WebGL context, or a non-finite/non-positive width, height
 * or loopMs — a bad size otherwise renders nothing forever with no error.
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
  // A const would still narrow through the closures below on its own, but
  // `frame` is a hoisted function declaration, not a nested arrow — TS
  // widens gl back to WebGLRenderingContext | null inside it. This alias
  // carries the non-null narrowing across that boundary.
  const glContext = gl;

  // A mid-setup throw (a bad fromSource/toSource reaching
  // uploadTextureSource, most realistically) must free what already
  // succeeded — the caller never gets a handle back to call stop() on.
  let quadBuf: WebGLBuffer | null = null;
  let prog: WebGLProgram | null = null;
  let texFrom: WebGLTexture | null = null;
  let texTo: WebGLTexture | null = null;
  let resources: {
    quadBuf: WebGLBuffer;
    prog: WebGLProgram;
    texFrom: WebGLTexture;
    texTo: WebGLTexture;
  };
  try {
    quadBuf = setupQuad(glContext);
    prog = createProgram(glContext, fragSrc);
    texFrom = createTexture(glContext);
    texTo = createTexture(glContext);
    uploadTextureSource(glContext, texFrom, fromSource);
    uploadTextureSource(glContext, texTo, toSource);
    resources = { quadBuf, prog, texFrom, texTo };
  } catch (err) {
    if (texFrom) glContext.deleteTexture(texFrom);
    if (texTo) glContext.deleteTexture(texTo);
    if (prog) glContext.deleteProgram(prog);
    if (quadBuf) glContext.deleteBuffer(quadBuf);
    throw err;
  }

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
    renderShader(
      glContext,
      resources.quadBuf,
      resources.prog,
      resources.texFrom,
      resources.texTo,
      progress,
      undefined,
      width,
      height,
    );
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
      glContext.deleteTexture(resources.texFrom);
      glContext.deleteTexture(resources.texTo);
      glContext.deleteProgram(resources.prog);
      glContext.deleteBuffer(resources.quadBuf);
    },
  };
}
