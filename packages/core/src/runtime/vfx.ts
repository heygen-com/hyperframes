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

/** The html-in-canvas 2-D context, behind the Chrome flag. */
interface DrawElementCtx extends CanvasRenderingContext2D {
  drawElementImage: (el: Element, x: number, y: number, w: number, h: number) => void;
}

/** Chrome's paint-record invalidation hook on a `layoutsubtree` canvas. */
interface RequestPaintCanvas extends HTMLCanvasElement {
  requestPaint?: () => void;
}

interface CompositeWindow extends Window {
  __hf_page_composite_pending?: boolean;
  __hf_page_composite_resolve?: () => boolean;
}

/** Everything a `self` host needs to read its own pixels back. */
interface VfxCaptureSource {
  canvas: HTMLCanvasElement;
  inner: HTMLElement;
  ctx: DrawElementCtx;
  texture: WebGLTexture;
}

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
  /** Present exactly when `capture !== "none"`. */
  src?: VfxCaptureSource;
  ping?: PingPong;
}

export type VfxRegistry = VfxEntry[];

let registry: VfxRegistry = [];
let registryFps = 30;
/** The time the last `paintVfx` was given; engine mode paints later, on resolve. */
let lastPaintTime = 0;
/** The resolver we installed, and whoever owned the slot when we wrapped it. */
let vfxResolver: (() => boolean) | null = null;
let priorResolver: (() => boolean) | null = null;

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

function createCaptureTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/**
 * The `<canvas layoutsubtree class="hf-vfx-src">` the exporter emits for a
 * `self` chain, plus its 2-D context. Never injected at runtime: the compiler
 * derives the `htmlInCanvas` render-mode hint from this canvas being in the
 * source, and that pin exists for a measured reason.
 */
function resolveCaptureSource(
  host: HTMLElement,
  gl: WebGL2RenderingContext,
): VfxCaptureSource | null {
  const canvas = host.querySelector("canvas.hf-vfx-src");
  const inner = canvas?.querySelector(".hf-vfx-in");
  if (!(canvas instanceof HTMLCanvasElement) || !(inner instanceof HTMLElement)) {
    reportVfxError(
      `${describeHost(host)}: a capturing chain needs ` +
        `<canvas layoutsubtree class="hf-vfx-src"><div class="hf-vfx-in">…</div></canvas> in source.`,
    );
    return null;
  }
  const ctx = canvas.getContext("2d") as DrawElementCtx | null;
  if (!ctx || typeof ctx.drawElementImage !== "function") {
    reportVfxError(
      `${describeHost(host)}: drawElementImage is unavailable, so the layer cannot be ` +
        `captured. In Studio, enable chrome://flags/#canvas-draw-element.`,
    );
    return null;
  }
  return { canvas, inner, ctx, texture: createCaptureTexture(gl) };
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
  const capture = chainCapture(chain);
  const src = capture === "none" ? undefined : resolveCaptureSource(host, gl);
  if (capture !== "none" && !src) {
    out.remove();
    return null;
  }
  return { host, chain, capture, out, gl, passes, src };
}

/**
 * A hidden host has no paint record, so `drawElementImage` would throw on it —
 * and the clip runtime hides every host outside its `data-start`/`data-duration`
 * window, which would otherwise fail the render on each of those frames.
 */
function isPaintableHost(host: HTMLElement): boolean {
  const style = getComputedStyle(host);
  return style.display !== "none" && style.visibility !== "hidden";
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

/**
 * Device-pixel size of the host's box; `null` when it has no area to paint.
 *
 * `offsetWidth`/`offsetHeight`, not `getBoundingClientRect()`: the latter is
 * the element's transformed axis-aligned bounding box, so a host carrying a
 * GSAP scale or rotation would get an inflated output canvas and a stretched
 * capture. An After Effects effect operates on the layer's own untransformed
 * box, which is what the layout size gives.
 */
function deviceSize(host: HTMLElement): { width: number; height: number } | null {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const width = Math.round(host.offsetWidth * dpr);
  const height = Math.round(host.offsetHeight * dpr);
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
  const source =
    index === 0 ? (entry.src?.texture ?? null) : ping && ping.textures[(index - 1) % 2];
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
    // useProgram FIRST: bindPass sets the `u_src` sampler, and uniforms land on
    // whichever program is current at the time of the call.
    gl.useProgram(pass.program);
    bindPass(entry, i, last, ping);
    gl.viewport(0, 0, size.width, size.height);
    setPassUniforms(entry, pass, style, t, size.width, size.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

function uploadCaptureTexture(gl: WebGL2RenderingContext, src: VfxCaptureSource): void {
  gl.bindTexture(gl.TEXTURE_2D, src.texture);
  // The full-screen triangle's `v_uv` is y-up and a canvas is y-down; the
  // kernels write premultiplied colour, so the source must arrive that way too.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src.canvas);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
}

/**
 * Read the host's own pixels into `u_src`. Both `clearRect`s matter: the first
 * because `drawElementImage` composites onto whatever is there, the second
 * because a `layoutsubtree` canvas's BITMAP is painted by the page compositor
 * even though its children are not — leaving the captured frame in it would
 * show the unprocessed layer through every transparent pixel of `.hf-vfx-out`.
 */
function captureEntry(entry: VfxEntry): boolean {
  const src = entry.src;
  const size = deviceSize(entry.host);
  if (!src || !size) return false;
  if (src.canvas.width !== size.width) src.canvas.width = size.width;
  if (src.canvas.height !== size.height) src.canvas.height = size.height;
  src.ctx.clearRect(0, 0, size.width, size.height);
  try {
    src.ctx.drawElementImage(src.inner, 0, 0, size.width, size.height);
  } catch (err) {
    reportVfxError(
      `${describeHost(entry.host)}: drawElementImage failed: ${(err as Error).message} ` +
        `In Studio, enable chrome://flags/#canvas-draw-element.`,
    );
    return false;
  }
  uploadCaptureTexture(entry.gl, src);
  src.ctx.clearRect(0, 0, size.width, size.height);
  return true;
}

/** Phase 2 of the page-composite protocol: the paint records are valid now. */
function resolveVfxCapture(): boolean {
  let painted = false;
  for (const entry of registry) {
    if (!entry.src || !isPaintableHost(entry.host)) continue;
    if (!captureEntry(entry)) continue;
    paintEntry(entry, lastPaintTime);
    painted = true;
  }
  (window as CompositeWindow).__hf_page_composite_pending = false;
  return painted;
}

/**
 * Claim the engine's two-phase readiness protocol, COMPOSING with whoever else
 * owns it rather than replacing them: shader-transitions runs first (its
 * composite is whole-scene, ours is per-layer). Re-checked on every paint
 * because `installPageSideCompositor` polls for `__hf.seek` on a 50 ms interval
 * and plainly assigns the slot, so an install after ours would replace us.
 */
function armPageComposite(): void {
  const w = window as CompositeWindow;
  const current = w.__hf_page_composite_resolve;
  if (current !== vfxResolver) {
    priorResolver = typeof current === "function" ? current : null;
    vfxResolver = () => {
      const prior = priorResolver ? priorResolver() : false;
      return resolveVfxCapture() || prior;
    };
    w.__hf_page_composite_resolve = vfxResolver;
  }
  w.__hf_page_composite_pending = true;
}

/**
 * Preview/Studio readiness: `drawElementImage` throws "No cached paint record
 * for element" unless the subtree has been painted since it last changed, and
 * a synchronous `requestPaint()` does not create one within the same task.
 */
function awaitCanvasPaint(canvas: HTMLCanvasElement): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      canvas.removeEventListener("paint", finish);
      resolve();
    };
    canvas.addEventListener("paint", finish, { once: true });
    try {
      (canvas as RequestPaintCanvas).requestPaint?.();
    } catch {
      // Feature drift on this build — the rAF fallback below still fires.
    }
    if (typeof requestAnimationFrame !== "function") {
      finish();
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(finish));
  });
}

async function capturePreviewThenPaint(entries: VfxEntry[], t: number): Promise<void> {
  for (const entry of entries) await awaitCanvasPaint(entry.src!.canvas);
  for (const entry of entries) {
    if (captureEntry(entry)) paintEntry(entry, t);
  }
}

/**
 * Repaint every registered chain for composition-local time `t`. Called from
 * the runtime transport's `seek` (preview) and `renderSeek` (engine) — the two
 * places a frame's DOM state is finished changing.
 *
 * A chain with no capture paints inline. A capturing chain cannot: its texture
 * comes from `drawElementImage`, which needs a paint record that does not exist
 * yet at this point in the task.
 */
export function paintVfx(t: number, options?: { engineMode?: boolean }): void {
  lastPaintTime = t;
  const capturing: VfxEntry[] = [];
  for (const entry of registry) {
    if (!isPaintableHost(entry.host)) continue;
    if (entry.src) capturing.push(entry);
    else paintEntry(entry, t);
  }
  if (capturing.length === 0) return;
  if (options?.engineMode) {
    armPageComposite();
    return;
  }
  void capturePreviewThenPaint(capturing, t);
}
