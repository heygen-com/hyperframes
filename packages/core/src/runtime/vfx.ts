/**
 * VFX chain runtime — paints every `data-vfx-chain` host's WebGL2 canvas from
 * `(t, params)` after each seek.
 *
 * One registry entry per host element. Shaders are compiled once at init; a
 * paint binds uniforms and draws one full-screen triangle per enabled node,
 * ping-ponging through two framebuffers when a chain has more than one node so
 * the last pass always lands on the visible `.hf-vfx-out` canvas.
 *
 * A paint may read only `(u_size, u_t, u_fps, params, u_src)` — no clock, no
 * randomness, no state carried between paints. That is the determinism
 * contract the exporter's gate depends on.
 *
 * Every failure is loud: the `[HyperFrames] composition script error:` prefix
 * is what the engine turns into `runtime-error:<compId>` and fails fast on, so
 * a broken chain stops a render instead of silently rendering the wrong frame.
 */

import {
  HF_VFX_ATTR,
  VfxChainError,
  chainCapture,
  enabledVfxNodes,
  getVfxDef,
  normalizeVfxParams,
  parseVfxChain,
  type HfVfxCapture,
  type HfVfxChain,
  type HfVfxDef,
  type HfVfxNode,
  type HfVfxParam,
  type HfVfxParamValues,
} from "../vfx";

/** The prefix `frameCapture.ts` matches to fail a render fast. */
const VFX_ERROR_LABEL = "[HyperFrames] composition script error:";

/**
 * `preserveDrawingBuffer` is what the engine's accelerated-canvas composite
 * needs to `drawImage` this canvas later (Phase 5); it costs nothing now.
 */
const GL_ATTRS: WebGLContextAttributes = {
  preserveDrawingBuffer: true,
  antialias: false,
  premultipliedAlpha: true,
  alpha: true,
};

/**
 * A full-screen triangle from `gl_VertexID` alone — no buffers, no attributes,
 * so nothing about the geometry can differ between backends. `v_uv` is 0..1
 * across the viewport with y UP, matching texture space rather than canvas
 * space.
 */
const VERTEX_SHADER = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

interface VfxPass {
  node: HfVfxNode;
  def: HfVfxDef;
  program: WebGLProgram;
  /** Chain params after clamp/defaults; CSS vars override per paint. */
  params: HfVfxParamValues;
}

/** Two colour targets a multi-node chain alternates between. */
interface PingPong {
  textures: [WebGLTexture, WebGLTexture];
  framebuffers: [WebGLFramebuffer, WebGLFramebuffer];
  width: number;
  height: number;
}

export interface VfxEntry {
  host: HTMLElement;
  chain: HfVfxChain;
  capture: HfVfxCapture;
  out: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  passes: VfxPass[];
  ping?: PingPong;
}

export type VfxRegistry = VfxEntry[];

let registry: VfxRegistry = [];
let registryFps = 30;

function reportVfxError(message: string): void {
  // eslint-disable-next-line no-console
  console.error(VFX_ERROR_LABEL, `vfx: ${message}`);
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  reportVfxError(`shader failed to compile: ${gl.getShaderInfoLog(shader) ?? "(no log)"}`);
  gl.deleteShader(shader);
  return null;
}

// The attach/link/delete sequence is the same six WebGL calls colorGrading.ts
// makes; the two differ in their failure reporting (loud here, `swallow` there)
// and in who owns the vertex shader, so sharing one helper would couple the
// vfx runtime's error contract to the colour pipeline's.
// fallow-ignore-next-line code-duplication
function linkVfxProgram(gl: WebGL2RenderingContext, frag: string): WebGLProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = vertex ? compileShader(gl, gl.FRAGMENT_SHADER, frag) : null;
  if (!vertex || !fragment) return null;
  // fallow-ignore-next-line code-duplication
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  reportVfxError(`program failed to link: ${gl.getProgramInfoLog(program) ?? "(no log)"}`);
  gl.deleteProgram(program);
  return null;
}

/** The output canvas the exporter may already have emitted, else a new one. */
function findOrCreateOut(host: HTMLElement): HTMLCanvasElement {
  const existing = host.querySelector("canvas.hf-vfx-out");
  if (existing instanceof HTMLCanvasElement) return existing;
  const out = document.createElement("canvas");
  out.className = "hf-vfx-out";
  out.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
  host.appendChild(out);
  return out;
}

function buildPasses(gl: WebGL2RenderingContext, chain: HfVfxChain): VfxPass[] | null {
  const passes: VfxPass[] = [];
  for (const node of enabledVfxNodes(chain)) {
    const def = getVfxDef(node.type);
    if (!def) {
      reportVfxError(`node "${node.id}" has unknown effect type "${node.type}"`);
      return null;
    }
    const program = linkVfxProgram(gl, def.frag);
    if (!program) {
      reportVfxError(`node "${node.id}" (${def.id}) has no usable program`);
      return null;
    }
    passes.push({ node, def, program, params: normalizeVfxParams(def.id, node.params) });
  }
  return passes;
}

function registerVfxHost(host: HTMLElement): VfxEntry | null {
  let chain: HfVfxChain;
  try {
    chain = parseVfxChain(host.getAttribute(HF_VFX_ATTR) ?? "");
  } catch (err) {
    const detail = err instanceof VfxChainError ? err.message : String(err);
    reportVfxError(`${describeHost(host)}: ${detail}`);
    return null;
  }
  const out = findOrCreateOut(host);
  const gl = out.getContext("webgl2", GL_ATTRS);
  if (!gl) {
    reportVfxError(`${describeHost(host)}: WebGL2 is unavailable, so the chain cannot paint.`);
    out.remove();
    return null;
  }
  const passes = buildPasses(gl, chain);
  if (!passes) {
    out.remove();
    return null;
  }
  return { host, chain, capture: chainCapture(chain), out, gl, passes };
}

function describeHost(host: HTMLElement): string {
  return host.id ? `#${host.id}` : `<${host.tagName.toLowerCase()}>`;
}

/**
 * Discover every chain host under `root`, compile its programs, and replace
 * the module registry. Called once where the runtime finishes mounting the
 * composition; re-initialising forgets the previous composition's hosts.
 */
export function initVfx(root: HTMLElement, fps: number): VfxRegistry {
  registry = [];
  registryFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const hosts = root.querySelectorAll(`[${HF_VFX_ATTR}]`);
  for (const host of hosts) {
    if (!(host instanceof HTMLElement)) continue;
    const entry = registerVfxHost(host);
    if (entry) registry.push(entry);
  }
  return registry;
}

/** Device-pixel size of the host's box; `null` when it has no area to paint. */
function deviceSize(host: HTMLElement): { width: number; height: number } | null {
  const rect = host.getBoundingClientRect();
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  return width > 0 && height > 0 ? { width, height } : null;
}

function makePingTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): [WebGLTexture, WebGLFramebuffer] {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const framebuffer = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  return [texture, framebuffer];
}

function ensurePingPong(entry: VfxEntry, width: number, height: number): PingPong {
  const existing = entry.ping;
  if (existing && existing.width === width && existing.height === height) return existing;
  const { gl } = entry;
  if (existing) {
    for (const t of existing.textures) gl.deleteTexture(t);
    for (const f of existing.framebuffers) gl.deleteFramebuffer(f);
  }
  const a = makePingTarget(gl, width, height);
  const b = makePingTarget(gl, width, height);
  const ping: PingPong = {
    textures: [a[0], b[0]],
    framebuffers: [a[1], b[1]],
    width,
    height,
  };
  entry.ping = ping;
  return ping;
}

/**
 * A number for `u_<key>`: the `--vfx-<nodeId>-<key>` CSS var when the def says
 * the param is animatable and the var resolves, else the chain's clamped value.
 * Booleans become 0/1; `ref` params carry element ids and have no uniform.
 */
function paramUniformValue(
  param: HfVfxParam,
  pass: VfxPass,
  style: CSSStyleDeclaration,
): number | null {
  if (param.kind === "ref") return null;
  if (param.kind === "number" && param.animatable) {
    const raw = style.getPropertyValue(`--vfx-${pass.node.id}-${param.key}`).trim();
    const n = raw === "" ? Number.NaN : Number.parseFloat(raw);
    if (Number.isFinite(n)) return Math.min(param.max, Math.max(param.min, n));
  }
  const value = pass.params[param.key];
  if (typeof value === "boolean") return value ? 1 : 0;
  return typeof value === "number" ? value : 0;
}

function setPassUniforms(
  entry: VfxEntry,
  pass: VfxPass,
  style: CSSStyleDeclaration,
  t: number,
  width: number,
  height: number,
): void {
  const { gl, program } = { gl: entry.gl, program: pass.program };
  gl.uniform2f(gl.getUniformLocation(program, "u_size"), width, height);
  gl.uniform1f(gl.getUniformLocation(program, "u_t"), t);
  gl.uniform1f(gl.getUniformLocation(program, "u_fps"), registryFps);
  for (const param of pass.def.params) {
    const value = paramUniformValue(param, pass, style);
    if (value === null) continue;
    gl.uniform1f(gl.getUniformLocation(program, `u_${param.key}`), value);
  }
}

/** Bind this pass's render target and its input texture. */
function bindPass(entry: VfxEntry, index: number, last: number, ping: PingPong | null): void {
  const { gl } = entry;
  gl.bindFramebuffer(gl.FRAMEBUFFER, index === last || !ping ? null : ping.framebuffers[index % 2]);
  const source = index === 0 ? null : ping && ping.textures[(index - 1) % 2];
  if (!source) return;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, source);
  gl.uniform1i(gl.getUniformLocation(entry.passes[index]!.program, "u_src"), 0);
}

function paintEntry(entry: VfxEntry, t: number): void {
  const size = deviceSize(entry.host);
  if (!size) return;
  const { gl, out, passes } = entry;
  if (out.width !== size.width) out.width = size.width;
  if (out.height !== size.height) out.height = size.height;
  const ping = passes.length > 1 ? ensurePingPong(entry, size.width, size.height) : null;
  const style = getComputedStyle(entry.host);
  const last = passes.length - 1;
  for (let i = 0; i <= last; i++) {
    const pass = passes[i]!;
    bindPass(entry, i, last, ping);
    gl.viewport(0, 0, size.width, size.height);
    gl.useProgram(pass.program);
    setPassUniforms(entry, pass, style, t, size.width, size.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

/**
 * Repaint every registered chain for composition-local time `t`. Called from
 * the runtime transport's `seek` (preview) and `renderSeek` (engine) — the two
 * places a frame's DOM state is finished changing.
 */
export function paintVfx(t: number, options?: { engineMode?: boolean }): void {
  void options;
  for (const entry of registry) paintEntry(entry, t);
}
