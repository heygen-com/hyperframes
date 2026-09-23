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

// vertexShader is caller-owned (compiled by createProgramWithVertex); this
// function only deletes what it creates itself, the fragment shader.
function linkProgram(
  gl: WebGLRenderingContext,
  vertexShader: WebGLShader,
  fragSrc: string,
): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error("[HyperShader] Failed to create program");
  const fragmentShader = compileShader(gl, fragSrc, gl.FRAGMENT_SHADER);
  gl.attachShader(p, vertexShader);
  gl.attachShader(p, fragmentShader);
  gl.linkProgram(p);
  // WebGL never frees an attached shader object on its own; deleting once
  // linked is safe either way, including on a failed link below.
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) || "unknown";
    gl.deleteProgram(p);
    throw new Error(`[HyperShader] Program link: ${log}`);
  }
  return p;
}

export function createProgram(gl: WebGLRenderingContext, fragSrc: string): WebGLProgram {
  return createProgramWithVertex(gl, vertSrc, fragSrc);
}

export function createProgramWithVertex(
  gl: WebGLRenderingContext,
  vertexSrc: string,
  fragSrc: string,
): WebGLProgram {
  const vertexShader = compileShader(gl, vertexSrc, gl.VERTEX_SHADER);
  try {
    return linkProgram(gl, vertexShader, fragSrc);
  } finally {
    gl.deleteShader(vertexShader);
  }
}

export interface AccentColors {
  accent: [number, number, number];
  dark: [number, number, number];
  bright: [number, number, number];
}

/** Fallback when a composition sets no accentColor (hyper-shader.ts's own default). */
export const DEFAULT_ACCENT_COLORS: AccentColors = {
  accent: [1, 0.6, 0.2],
  dark: [0.4, 0.15, 0],
  bright: [1, 0.85, 0.5],
};

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
  colors: AccentColors = DEFAULT_ACCENT_COLORS,
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
  gl.uniform3f(loc.accent, ...colors.accent);
  gl.uniform3f(loc.accentDark, ...colors.dark);
  gl.uniform3f(loc.accentBright, ...colors.bright);
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
