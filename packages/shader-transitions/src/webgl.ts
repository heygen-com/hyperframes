import { vertSrc } from "./shaders/common.js";

export const DEFAULT_WIDTH = 1920;
export const DEFAULT_HEIGHT = 1080;

export function createContext(
  canvas: HTMLCanvasElement,
  width: number = DEFAULT_WIDTH,
  height: number = DEFAULT_HEIGHT,
): WebGLRenderingContext | null {
  const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true });
  if (!gl) return null;
  gl.viewport(0, 0, width, height);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  return gl as WebGLRenderingContext;
}

/**
 * Keep `gl` recoverable, and hand it back explicitly when the caller is done.
 *
 * Browsers cap concurrent WebGL contexts (~16) and silently drop the oldest.
 * The default action of `webglcontextlost` makes that drop permanent, so
 * without `preventDefault()` a transition just stops rendering with no
 * diagnostic. The returned teardown releases the context instead of waiting
 * for the canvas to become collectable.
 */
export function manageContextLoss(
  canvas: HTMLCanvasElement,
  gl: WebGLRenderingContext,
  handlers: { onLost: () => void; onRestored: () => void },
): () => void {
  const handleLost = (event: Event): void => {
    event.preventDefault();
    handlers.onLost();
  };
  const handleRestored = (): void => handlers.onRestored();
  canvas.addEventListener("webglcontextlost", handleLost);
  canvas.addEventListener("webglcontextrestored", handleRestored);
  return () => {
    canvas.removeEventListener("webglcontextlost", handleLost);
    canvas.removeEventListener("webglcontextrestored", handleRestored);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
}

export function setupQuad(gl: WebGLRenderingContext): WebGLBuffer {
  const buf = gl.createBuffer();
  if (!buf) throw new Error("[HyperShader] Failed to create quad buffer");
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  return buf;
}

function compileShader(gl: WebGLRenderingContext, src: string, type: number): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error("[HyperShader] Failed to create shader");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(`[HyperShader] Shader compile: ${gl.getShaderInfoLog(s) || "unknown"}`);
  }
  return s;
}

function linkProgram(
  gl: WebGLRenderingContext,
  vertexShader: WebGLShader,
  fragSrc: string,
): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error("[HyperShader] Failed to create program");
  gl.attachShader(p, vertexShader);
  gl.attachShader(p, compileShader(gl, fragSrc, gl.FRAGMENT_SHADER));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`[HyperShader] Program link: ${gl.getProgramInfoLog(p) || "unknown"}`);
  }
  return p;
}

// The shared vertex shader used to be cached in a module-level singleton. That
// made it outlive both the context it was compiled in and any second context on
// the page, so every program linked after a context loss would link against a
// dead shader. It is five lines of GLSL compiled a handful of times per init —
// cheaper to recompile than to invalidate.
export function createProgram(gl: WebGLRenderingContext, fragSrc: string): WebGLProgram {
  return createProgramWithVertex(gl, vertSrc, fragSrc);
}

export function createProgramWithVertex(
  gl: WebGLRenderingContext,
  vertexSrc: string,
  fragSrc: string,
): WebGLProgram {
  return linkProgram(gl, compileShader(gl, vertexSrc, gl.VERTEX_SHADER), fragSrc);
}

export interface AccentColors {
  accent: [number, number, number];
  dark: [number, number, number];
  bright: [number, number, number];
}

interface ProgramLocations {
  from: WebGLUniformLocation | null;
  to: WebGLUniformLocation | null;
  progress: WebGLUniformLocation | null;
  resolution: WebGLUniformLocation | null;
  accent: WebGLUniformLocation | null;
  accentDark: WebGLUniformLocation | null;
  accentBright: WebGLUniformLocation | null;
  aPos: number;
}

const locationsCache = new WeakMap<WebGLProgram, ProgramLocations>();

function getLocations(gl: WebGLRenderingContext, prog: WebGLProgram): ProgramLocations {
  let loc = locationsCache.get(prog);
  if (loc) return loc;
  loc = {
    from: gl.getUniformLocation(prog, "u_from"),
    to: gl.getUniformLocation(prog, "u_to"),
    progress: gl.getUniformLocation(prog, "u_progress"),
    resolution: gl.getUniformLocation(prog, "u_resolution"),
    accent: gl.getUniformLocation(prog, "u_accent"),
    accentDark: gl.getUniformLocation(prog, "u_accent_dark"),
    accentBright: gl.getUniformLocation(prog, "u_accent_bright"),
    aPos: gl.getAttribLocation(prog, "a_pos"),
  };
  locationsCache.set(prog, loc);
  return loc;
}

export function renderShader(
  gl: WebGLRenderingContext,
  quadBuf: WebGLBuffer,
  prog: WebGLProgram,
  texFrom: WebGLTexture,
  texTo: WebGLTexture,
  progress: number,
  colors?: AccentColors,
  width: number = DEFAULT_WIDTH,
  height: number = DEFAULT_HEIGHT,
): void {
  const loc = getLocations(gl, prog);
  gl.useProgram(prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texFrom);
  gl.uniform1i(loc.from, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texTo);
  gl.uniform1i(loc.to, 1);
  gl.uniform1f(loc.progress, progress);
  gl.uniform2f(loc.resolution, width, height);
  if (colors) {
    gl.uniform3f(loc.accent, ...colors.accent);
    gl.uniform3f(loc.accentDark, ...colors.dark);
    gl.uniform3f(loc.accentBright, ...colors.bright);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(loc.aPos);
  gl.vertexAttribPointer(loc.aPos, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

export function createTexture(gl: WebGLRenderingContext): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error("[HyperShader] Failed to create texture");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return tex;
}

export function uploadTextureSource(
  gl: WebGLRenderingContext,
  tex: WebGLTexture,
  source: TexImageSource,
): void {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
}
