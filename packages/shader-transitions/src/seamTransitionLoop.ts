import {
  createContext,
  setupQuad,
  createProgram,
  createTexture,
  uploadTextureSource,
  renderShader,
} from "./webgl.js";
import { getFragSource, type ShaderName } from "./shaders/registry.js";

/** What texImage2D accepts; LINEAR filtering scales it to the canvas, so a larger frame adds no quality. */
export type SeamTransitionFrameSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

/** Catalog names whose registry key differs; engine and producer render under those keys. */
const CATALOG_SHADER_ALIASES = new Map<string, ShaderName>([
  ["domain-warp-dissolve", "domain-warp"],
  ["chromatic-radial-split", "chromatic-split"],
]);

export interface SeamTransitionLoopOptions {
  /** Defaults to the canvas's own drawing-buffer size. */
  width?: number;
  height?: number;
  loopMs?: number;
}

export interface SeamTransitionLoopHandle {
  /** Frees what this call created and keeps the WebGL context for the canvas's next loop. Idempotent. */
  stop: () => void;
  /** Resolves at the first drawn frame or at `stop()`, whichever comes first. */
  ready: Promise<void>;
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `[playSeamTransitionLoop] ${name} must be a finite number above 0, got ${value}`,
    );
  }
}

/** Loops a catalog shader transition between two frames; throws for an unknown shader, no WebGL or a bad size. */
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

  // A setup that throws midway frees what it made: the caller has no handle to stop().
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
