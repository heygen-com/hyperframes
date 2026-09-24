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
  type HfVfxRefParam,
} from "../vfx";
import { registerSeekCompletion } from "./adapters/seek-dispatch";
import { isCanvasElement, isHtmlElement } from "./domRealm";

/**
 * Marks a `ref` wrapper whose element ALSO paints on its own — v1.1 assumed a
 * matte source is invisible in After Effects and that is not always true
 * (retro-wave `Logo Anim` layer 5 is layer 4's displacement map AND an enabled,
 * fully opaque layer). Without it the runtime would clear the wrapper's bitmap
 * after reading it and the layer would vanish from the page.
 */
const VFX_REF_VISIBLE_ATTR = "data-vfx-ref-visible";

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

/**
 * One captured texture: the `<canvas layoutsubtree class="hf-vfx-src">` wrapper
 * the exporter emitted, its single `.hf-vfx-in` child, and the GL texture the
 * capture is uploaded into.
 *
 * The same shape serves all three sources a chain can read — the host's own
 * pixels (`self`), everything below the host (`backdrop`), and a second element
 * named by a `ref` param (`u_src2`) — because at capture time they differ only
 * in WHICH element supplies the pixels.
 */
interface VfxCaptureSource {
  canvas: HTMLCanvasElement;
  inner: HTMLElement;
  ctx: DrawElementCtx;
  texture: WebGLTexture;
  /**
   * The wrapper was found through `data-vfx-for`, i.e. it wraps the layers
   * BELOW the host rather than the host's own content. Such a wrapper lives
   * outside the host, which is what makes a hidden host a pass-through rather
   * than a hole (see `capturePassThrough`).
   */
  backdrop: boolean;
  /**
   * The wrapper carries `data-vfx-ref-visible`: its bitmap is a layer the page
   * shows, not only a texture, so the capture keeps it and draws it at the
   * REF's own box rather than the host's.
   */
  visible: boolean;
  /** `.hf-vfx-in` measured 0×0 and that has already been reported once. */
  emptyBoxReported: boolean;
}

/**
 * Every uniform location one pass can bind, resolved once. `getUniformLocation`
 * is a synchronous driver query, and the paint loop used to make one per
 * uniform per param per pass per frame; the program is linked once at init, so
 * the answers never change.
 *
 * `null` is the correct cached value for a uniform the linker optimised out —
 * `gl.uniform*(null, …)` is a defined no-op, which is what the old per-frame
 * query did with it too.
 */
interface PassLocations {
  size: WebGLUniformLocation | null;
  t: WebGLUniformLocation | null;
  fps: WebGLUniformLocation | null;
  src: WebGLUniformLocation | null;
  /** Bound only for a def with a `ref` param (v1.1's second source). */
  src2: WebGLUniformLocation | null;
  /** 1 when this pass's optional ref actually resolved, 0 when it did not. */
  hasSrc2: WebGLUniformLocation | null;
  /** Keyed by the def's param key, without the `u_` prefix. */
  params: Record<string, WebGLUniformLocation | null>;
}

interface VfxPass {
  node: HfVfxNode;
  def: HfVfxDef;
  program: WebGLProgram;
  /** Chain params after clamp/defaults; CSS vars override per paint. */
  params: HfVfxParamValues;
  locations: PassLocations;
  /** `u_src2`: the element this node's `ref` param named. Per NODE, not per
   *  entry — two nodes in one chain may matte against different elements. */
  ref?: VfxCaptureSource;
  /**
   * The `ref` param names this pass's OWN host — the self-referential stencil
   * shape (`target === host` in `resolveRefSource`). There is no second
   * texture to capture, so `bindPass` points `u_src2` at unit 0 explicitly
   * instead of leaving it unbound.
   */
  selfRef?: boolean;
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
  /**
   * What this host RESOLVED to, not what its defs declare: `backdrop` when the
   * wrapper was found through `data-vfx-for`, else the chain's own requirement.
   * The two are the same kernel reading the same `u_src` — `self` and
   * `backdrop` differ only in which element the exporter put inside the
   * wrapper — so the DOM is the only place the distinction exists.
   */
  capture: HfVfxCapture;
  out: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  passes: VfxPass[];
  /** Present exactly when `capture !== "none"`. */
  src?: VfxCaptureSource;
  ping?: PingPong;
  /** Set once `out` fires `webglcontextlost`; the entry never paints again. */
  contextLost: boolean;
}

export type VfxRegistry = VfxEntry[];

let registry: VfxRegistry = [];
let registryFps = 30;
/** The time the last `paintVfx` was given; a capturing chain paints later. */
let lastPaintTime = 0;
/**
 * Monotonic seek token. Every `paintVfx` claims one; an async capture that
 * comes back to find a newer token has been superseded and must not repaint.
 */
let paintSeq = 0;
/** The token the page-composite resolver last completed, so a race can yield. */
let resolvedSeq = -1;
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

/**
 * The box the interface spec fixes for `.hf-vfx-out` ("it is `position:absolute;
 * inset:0` and sized to the host's box"). It belongs to the ELEMENT, not to
 * whoever created it, so an exporter-emitted canvas gets it too.
 */
const OUT_BOX = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";

/** The output canvas the exporter may already have emitted, else a new one. */
function findOrCreateOut(host: HTMLElement): HTMLCanvasElement {
  const existing = host.querySelector("canvas.hf-vfx-out");
  if (isCanvasElement(existing)) {
    // The exporter emits the canvas bare — `<canvas class="hf-vfx-out"></canvas>`
    // — "for layout stability". Adopted untouched it keeps the default
    // `position:static; display:inline`, so it is an inline box that wraps to
    // the line AFTER the (layer-wide) `.hf-vfx-src` canvas and paints one full
    // layer height below the host. Measured on retro-wave `#main-l6-text`:
    // `.hf-vfx-src` rect top 315.1 h 93.0, `.hf-vfx-out` rect top 409.2 — a
    // clean, unwarped second copy of the layer below where it belongs, with no
    // error anywhere (ae-mcp findings §Task 3.5b). Prepending rather than
    // assigning leaves any style the exporter DID write in the winning position.
    existing.style.cssText = OUT_BOX + existing.style.cssText;
    return existing;
  }
  const out = document.createElement("canvas");
  out.className = "hf-vfx-out";
  out.style.cssText = OUT_BOX;
  host.appendChild(out);
  return out;
}

function resolveUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  def: HfVfxDef,
): PassLocations {
  const params: Record<string, WebGLUniformLocation | null> = {};
  for (const param of def.params) {
    // `ref` params carry element ids, not numbers, and have no uniform.
    if (param.kind === "ref") continue;
    params[param.key] = gl.getUniformLocation(program, `u_${param.key}`);
  }
  return {
    size: gl.getUniformLocation(program, "u_size"),
    t: gl.getUniformLocation(program, "u_t"),
    fps: gl.getUniformLocation(program, "u_fps"),
    src: gl.getUniformLocation(program, "u_src"),
    src2: gl.getUniformLocation(program, "u_src2"),
    hasSrc2: gl.getUniformLocation(program, "u_hasSrc2"),
    params,
  };
}

/**
 * What a pass's `ref` param resolved to. A plain union return (rather than
 * overloading `undefined`/`null`) is what lets `buildPasses` tell "no ref
 * param on this def" apart from "ref param present, but self-referential" —
 * `VfxPass.selfRef` needs that distinction to bind `u_src2` explicitly instead
 * of relying on an unbound sampler's implicit unit-0 default.
 */
type RefResolution =
  | { kind: "none" }
  | { kind: "self" }
  | { kind: "error" }
  | { kind: "source"; source: VfxCaptureSource };

/**
 * The element a `ref` param names, wrapped in its own capture canvas.
 *
 * The exporter wraps a matte/map source the same way it wraps a `self` layer
 * (the interface spec's v1.1: "the exporter wraps the referenced element in its
 * own `.hf-vfx-src` canvas") — which is also why nothing is injected here. A
 * runtime-created `<canvas layoutsubtree>` would be invisible to
 * `detectRenderModeHints`, and the `htmlInCanvas` single-worker pin it derives
 * from the SOURCE markup is what keeps concurrent `drawElementImage` off.
 */
/**
 * A `ref` param with no id supplied. An optional ref left empty is the def's
 * own fallback (displacement-map reads `u_src` as its map), not a broken
 * chain; a mandatory one with nothing named is an authoring error.
 */
function resolveEmptyRefParam(
  host: HTMLElement,
  node: HfVfxNode,
  def: HfVfxDef,
  param: HfVfxRefParam,
): RefResolution {
  if (param.optional) return { kind: "none" };
  reportVfxError(
    `${describeHost(host)}: node "${node.id}" (${def.id}) needs a "${param.key}" ` +
      `param naming the id of the element to read as its second source.`,
  );
  return { kind: "error" };
}

function resolveRefSource(
  host: HTMLElement,
  node: HfVfxNode,
  def: HfVfxDef,
  params: HfVfxParamValues,
  gl: WebGL2RenderingContext,
  cache: Map<HTMLElement, VfxCaptureSource>,
): RefResolution {
  const param = def.params.find((p): p is HfVfxRefParam => p.kind === "ref");
  if (!param) return { kind: "none" };
  const id = params[param.key];
  if (typeof id !== "string" || id === "") return resolveEmptyRefParam(host, node, def, param);
  const target = host.ownerDocument.getElementById(id);
  if (!isHtmlElement(target)) {
    reportVfxError(
      `${describeHost(host)}: node "${node.id}" (${def.id}) names "${param.key}" element ` +
        `#${id}, which is not in the composition.`,
    );
    return { kind: "error" };
  }
  // A ref naming its own host is the self-referential form — `u_src` already
  // holds those pixels. Capturing it again would cost a second
  // `drawElementImage` per frame for the same image, and on a `backdrop` host
  // it would resolve the `data-vfx-for` sibling and read the layers BELOW as
  // the map.
  //
  // An OPTIONAL ref (displacement-map's `map`) already has a shader-side
  // branch keyed off `u_hasSrc2` for "nothing named" — self-reference means
  // exactly the same thing to it as leaving the param empty, so it is folded
  // into `"none"` rather than given its own kind: `u_hasSrc2` stays 0 and the
  // shader's own fallback reads `u_src`, unchanged from before this type.
  // A MANDATORY ref (luma-matte's `matte`) has no such branch — its shader
  // always samples `u_src2` — so a real `"self"` kind is the only way `u_src2`
  // gets bound at all; `bindPass` points it at `u_src`'s own texture unit.
  if (target === host) return param.optional ? { kind: "none" } : { kind: "self" };
  const cached = cache.get(target);
  if (cached) return { kind: "source", source: cached };
  const source = resolveCaptureSource(target, gl, `${describeHost(host)}: "${param.key}" source`);
  if (!source) return { kind: "error" };
  source.visible = source.canvas.hasAttribute(VFX_REF_VISIBLE_ATTR);
  cache.set(target, source);
  return { kind: "source", source };
}

function buildPasses(
  gl: WebGL2RenderingContext,
  chain: HfVfxChain,
  host: HTMLElement,
): VfxPass[] | null {
  const passes: VfxPass[] = [];
  // One source per referenced ELEMENT: two nodes matting against the same
  // matte capture it once and share the texture.
  const refs = new Map<HTMLElement, VfxCaptureSource>();
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
    const params = normalizeVfxParams(def.id, node.params);
    const resolved = resolveRefSource(host, node, def, params, gl, refs);
    if (resolved.kind === "error") return null;
    passes.push({
      node,
      def,
      program,
      params,
      locations: resolveUniformLocations(gl, program, def),
      ...(resolved.kind === "source" ? { ref: resolved.source } : {}),
      selfRef: resolved.kind === "self",
    });
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
 * The `backdrop` wrapper for `owner`: a `<canvas layoutsubtree class="hf-vfx-src"
 * data-vfx-for="<owner id>">` among the owner's SIBLINGS, holding every layer
 * below it (interface v1.1).
 *
 * Scoped to the parent rather than the document because that is where the
 * exporter puts it — z-order is DOM order, so the wrapper is the host's own
 * preceding sibling at whatever depth the host sits, stacked adjustment layers
 * included. Read attribute-by-attribute instead of through a selector: an id
 * goes into this comparison unescaped, and a `querySelector` built by
 * concatenation would throw on an id a selector cannot spell.
 */
function findBackdropWrapper(owner: HTMLElement): HTMLCanvasElement | null {
  const parent = owner.parentElement;
  if (!parent || owner.id === "") return null;
  const siblings = parent.children;
  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings.item(i);
    if (!isCanvasElement(sibling)) continue;
    if (!sibling.classList.contains("hf-vfx-src")) continue;
    if (sibling.getAttribute("data-vfx-for") === owner.id) return sibling;
  }
  return null;
}

/**
 * The `<canvas layoutsubtree class="hf-vfx-src">` that supplies `owner`'s
 * pixels, plus its 2-D context. Never injected at runtime: the compiler derives
 * the `htmlInCanvas` render-mode hint from this canvas being in the source, and
 * that pin exists for a measured reason.
 *
 * Resolution order, per plan Task 2.6: a `data-vfx-for` sibling (the
 * `backdrop` shape — the layers below) before the owner's own child (the
 * `self` shape — its own content). A def's `capture` says only THAT the kernel
 * needs a texture; which element fills it is the exporter's placement, and this
 * is where the runtime reads that placement off the DOM.
 *
 * `.hf-vfx-in` must be the canvas's IMMEDIATE child: Chrome refuses anything
 * else with "Only immediate children of the <canvas> element can be passed to
 * DrawElementImage", so a deeper wrapper is a registration-time error here
 * rather than a throw on every frame.
 */
function resolveCaptureSource(
  owner: HTMLElement,
  gl: WebGL2RenderingContext,
  label: string,
): VfxCaptureSource | undefined {
  const backdrop = findBackdropWrapper(owner);
  const canvas = backdrop ?? owner.querySelector("canvas.hf-vfx-src");
  const inner = isCanvasElement(canvas) ? canvas.querySelector(":scope > .hf-vfx-in") : null;
  if (!isCanvasElement(canvas) || !isHtmlElement(inner)) {
    reportVfxError(
      `${label}: a capturing chain needs ` +
        `<canvas layoutsubtree class="hf-vfx-src"><div class="hf-vfx-in">…</div></canvas> in ` +
        `source — inside the element for its own pixels, or beside it with ` +
        `data-vfx-for="${owner.id}" for the layers below it.`,
    );
    return undefined;
  }
  const ctx = canvas.getContext("2d") as DrawElementCtx | null;
  if (!ctx || typeof ctx.drawElementImage !== "function") {
    reportVfxError(
      `${label}: drawElementImage is unavailable, so the layer cannot be ` +
        `captured. In Studio, enable chrome://flags/#canvas-draw-element.`,
    );
    return undefined;
  }
  return {
    canvas,
    inner,
    ctx,
    texture: createCaptureTexture(gl),
    backdrop: backdrop !== null,
    // Only a `ref` source may be visible; `resolveRefSource` sets it.
    visible: false,
    emptyBoxReported: false,
  };
}

/**
 * Chrome caps live WebGL contexts (commonly 16, and `colorGrading.ts` holds
 * one per graded element too), and a driver reset can take one at any moment.
 * Calls on a lost context are spec'd to do nothing, so without this the chain
 * would go on "painting" an empty canvas in silence — the one thing this
 * module promises not to do.
 *
 * Only the OUTPUT canvas is watched: `.hf-vfx-src` is a 2-D context and is
 * unaffected by GL context loss.
 *
 * Restore is deliberately unhandled — the entry stays lost for as long as this
 * registry does. `initVfx` already re-scans and re-registers every host when
 * the composition mounts and again when a sub-composition arrives, rebuilding
 * every program, texture and framebuffer from scratch; a second, narrower
 * rebuild path for `webglcontextrestored` alone would duplicate that one and
 * be free to drift from it. `preventDefault()` still runs, so the context is
 * restorable if a follow-up wants to take it.
 */
function watchContextLoss(entry: VfxEntry): void {
  entry.out.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    // A later `initVfx` may have replaced the registry, and `findOrCreateOut`
    // hands the same canvas to the new entry — a released entry's loss is
    // nobody's frame, and reporting it would be a phantom error.
    if (!registry.includes(entry) || entry.contextLost) return;
    entry.contextLost = true;
    reportVfxError(`${describeHost(entry.host)}: WebGL context lost.`);
  });
}

/** The host's chain, or `null` once the reason it is unusable has been said. */
function readVfxChain(host: HTMLElement): HfVfxChain | null {
  try {
    return parseVfxChain(host.getAttribute(HF_VFX_ATTR) ?? "");
  } catch (err) {
    const detail = err instanceof VfxChainError ? err.message : String(err);
    reportVfxError(`${describeHost(host)}: ${detail}`);
    return null;
  }
}

function registerVfxHost(host: HTMLElement): VfxEntry | null {
  const chain = readVfxChain(host);
  if (!chain) return null;
  const out = findOrCreateOut(host);
  const gl = out.getContext("webgl2", GL_ATTRS);
  if (!gl) {
    reportVfxError(`${describeHost(host)}: WebGL2 is unavailable, so the chain cannot paint.`);
    out.remove();
    return null;
  }
  const passes = buildPasses(gl, chain, host);
  if (!passes) {
    out.remove();
    return null;
  }
  const declared = chainCapture(chain);
  const src = declared === "none" ? undefined : resolveCaptureSource(host, gl, describeHost(host));
  if (declared !== "none" && !src) {
    out.remove();
    return null;
  }
  const capture = src?.backdrop ? "backdrop" : declared;
  const entry: VfxEntry = { host, chain, capture, out, gl, passes, src, contextLost: false };
  watchContextLoss(entry);
  return entry;
}

/**
 * Whether an element is on screen, and so whether it has a paint record at
 * all: `drawElementImage` throws on a hidden subtree, and the clip runtime
 * hides everything outside its `data-start`/`data-duration` window, which
 * would otherwise fail the render on each of those frames.
 *
 * Asked of hosts (does this chain paint?) and of capture sources (is there
 * anything to read?) alike.
 */
function isPaintableHost(host: HTMLElement): boolean {
  const style = getComputedStyle(host);
  return style.display !== "none" && style.visibility !== "hidden";
}

/**
 * Whether a source's `.hf-vfx-in` has a paint record to capture. `visibility`
 * inherits, so one read at `inner` covers a matte hidden that way; `display`
 * does NOT, so a ref whose OWNING element is `display:none` (the clip
 * runtime's `data-hidden` and in-flow timed-leaf paths) still computes
 * `display:block` at `inner` — and would wait out the paint ceiling, then fail
 * as a misleading 0×0. Hence the ancestor walk. `checkVisibility()` and
 * `offsetParent` would say the same in Chrome but are absent or always-null
 * in the unit harness's DOM.
 */
function isPaintableSource(src: VfxCaptureSource): boolean {
  if (getComputedStyle(src.inner).visibility === "hidden") return false;
  for (let el: HTMLElement | null = src.inner; el; el = el.parentElement) {
    if (getComputedStyle(el).display === "none") return false;
  }
  return true;
}

function describeHost(host: HTMLElement): string {
  return host.id ? `#${host.id}` : `<${host.tagName.toLowerCase()}>`;
}

/**
 * Every texture this entry captures per frame, in binding order: `u_src`
 * first, then each node's `u_src2`. A ref shared by two nodes appears once —
 * `buildPasses` hands both passes the same source object.
 */
function entrySources(entry: VfxEntry): VfxCaptureSource[] {
  const sources: VfxCaptureSource[] = entry.src ? [entry.src] : [];
  for (const pass of entry.passes) {
    if (pass.ref && !sources.includes(pass.ref)) sources.push(pass.ref);
  }
  return sources;
}

/**
 * A chain whose source is the layers BELOW the host. Its wrapper is outside the
 * host, so the host's own visibility does not decide whether those layers are
 * on screen — `capturePassThrough` does.
 */
function isBackdropEntry(entry: VfxEntry): boolean {
  return entry.src?.backdrop === true;
}

/**
 * Every distinct VISIBLE ref this entry's passes read — element(s) that paint
 * on the page independently of whether this entry's own kernel currently
 * runs, exactly like `entrySources` but restricted to the sources whose
 * bitmap is itself the frame (`VFX_REF_VISIBLE_ATTR`). A ref shared by two
 * passes appears once, same rule as `entrySources`.
 */
function visibleRefSources(entry: VfxEntry): VfxCaptureSource[] {
  const sources: VfxCaptureSource[] = [];
  for (const pass of entry.passes) {
    if (pass.ref?.visible && !sources.includes(pass.ref)) sources.push(pass.ref);
  }
  return sources;
}

/** Drop the GL objects the outgoing registry owns before replacing it. */
function releaseRegistry(): void {
  for (const entry of registry) {
    const { gl } = entry;
    for (const pass of entry.passes) gl.deleteProgram(pass.program);
    for (const source of entrySources(entry)) gl.deleteTexture(source.texture);
    if (!entry.ping) continue;
    for (const texture of entry.ping.textures) gl.deleteTexture(texture);
    for (const framebuffer of entry.ping.framebuffers) gl.deleteFramebuffer(framebuffer);
  }
}

/**
 * Discover every chain host under `root`, compile its programs, and replace
 * the module registry. Called where the runtime finishes mounting the
 * composition and AGAIN once sub-compositions have loaded — a host inside a
 * `data-composition-src` mount is not in the DOM for the first pass, and an
 * unregistered host paints nothing and reports nothing. Re-initialising
 * forgets (and releases) the previous pass's hosts.
 */
export function initVfx(root: HTMLElement, fps: number): VfxRegistry {
  releaseRegistry();
  registry = [];
  registryFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const hosts = root.querySelectorAll(`[${HF_VFX_ATTR}]`);
  for (const host of hosts) {
    if (!isHtmlElement(host)) continue;
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
  const { gl } = entry;
  const { locations } = pass;
  gl.uniform2f(locations.size, width, height);
  gl.uniform1f(locations.t, t);
  gl.uniform1f(locations.fps, registryFps);
  // A def whose ref is optional needs to know which sampler holds its second
  // input; on a shader without the uniform the location is null and this is a
  // defined no-op. A self-referential ref counts as resolved too — `u_src2`
  // reads real data, just from unit 0 rather than a second capture.
  gl.uniform1f(locations.hasSrc2, pass.ref || pass.selfRef ? 1 : 0);
  for (const param of pass.def.params) {
    const value = paramUniformValue(param, pass, style);
    if (value === null) continue;
    gl.uniform1f(locations.params[param.key] ?? null, value);
  }
}

/** Where this pass draws: the visible canvas for the last one, else the
 *  ping-pong target the next pass will read. */
function passTarget(index: number, last: number, ping: PingPong | null): WebGLFramebuffer | null {
  if (index === last || !ping) return null;
  return ping.framebuffers[index % 2] ?? null;
}

/** What this pass reads as `u_src`: the capture for the first pass, the
 *  previous pass's target after that. */
function passInput(entry: VfxEntry, index: number, ping: PingPong | null): WebGLTexture | null {
  if (index === 0) return entry.src?.texture ?? null;
  return ping?.textures[(index - 1) % 2] ?? null;
}

/** Bind this pass's render target and its input textures. */
function bindPass(entry: VfxEntry, index: number, last: number, ping: PingPong | null): void {
  const { gl } = entry;
  const pass = entry.passes[index]!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, passTarget(index, last, ping));
  const source = passInput(entry, index, ping);
  if (source) bindSampler(gl, pass.locations.src, source, 0);
  // Unit 1 for `u_src2`, then back to unit 0 so every other bind in this
  // module — the next pass's, and `uploadCaptureTexture`'s — starts from the
  // same active unit no matter which passes carry a ref.
  if (pass.ref) {
    bindSampler(gl, pass.locations.src2, pass.ref.texture, 1);
    gl.activeTexture(gl.TEXTURE0);
  } else if (pass.selfRef && source) {
    // A `ref` param naming its own host: `u_src2` reads exactly what `u_src`
    // just bound. Previously left unbound, which happened to read unit 0 by
    // GLSL's default sampler binding — correct today, but implicit rather than
    // stated.
    gl.uniform1i(pass.locations.src2, 0);
  }
}

function bindSampler(
  gl: WebGL2RenderingContext,
  location: WebGLUniformLocation | null,
  texture: WebGLTexture,
  unit: 0 | 1,
): void {
  gl.activeTexture(unit === 0 ? gl.TEXTURE0 : gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(location, unit);
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
  gl.activeTexture(gl.TEXTURE0);
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
 * What a capture does with what it drew. Three combinations exist, and each
 * one is a different kind of source:
 *
 * - texture only — an invisible source read as `u_src`/`u_src2`. The bitmap is
 *   cleared after the upload because a `layoutsubtree` canvas's BITMAP is
 *   painted by the page compositor even though its children are not, and
 *   leaving the raw capture there would show through `.hf-vfx-out`.
 * - bitmap only — a `backdrop` wrapper whose host is not painting this frame
 *   (the bitmap IS the frame: it carries the layers below an adjustment layer
 *   that is currently off), or a VISIBLE ref whose owning host is not
 *   painting (the ref's own layer still has to show; no kernel will read the
 *   texture this frame, so there is nothing to upload).
 * - both — a `ref` source the exporter marked visible, captured while its
 *   owning host IS painting. Its layer paints on its own AND feeds a kernel,
 *   so the capture is uploaded and left on screen.
 */
interface CaptureMode {
  upload: boolean;
  keepBitmap: boolean;
}

const CAPTURE_TO_TEXTURE: CaptureMode = { upload: true, keepBitmap: false };
const CAPTURE_PASS_THROUGH: CaptureMode = { upload: false, keepBitmap: true };
const CAPTURE_VISIBLE_SOURCE: CaptureMode = { upload: true, keepBitmap: true };
/**
 * A visible ref captured while its owning entry's host is NOT painting: the
 * ref's own layer still has to stay current on screen, but no kernel will run
 * to read the texture this frame (`paintEntry` never fires), so the upload is
 * skipped.
 */
const CAPTURE_VISIBLE_ONLY: CaptureMode = { upload: false, keepBitmap: true };

/** Assigning `width`/`height` clears the bitmap, so only a real change does. */
function resizeCaptureCanvas(src: VfxCaptureSource, size: { width: number; height: number }): void {
  if (src.canvas.width !== size.width) src.canvas.width = size.width;
  if (src.canvas.height !== size.height) src.canvas.height = size.height;
}

/**
 * Read one source's pixels into its texture. Both `clearRect`s matter: the
 * first because `drawElementImage` composites onto whatever is there, the
 * second because a `layoutsubtree` canvas's BITMAP is painted by the page
 * compositor even though its children are not — leaving the captured frame in
 * it would show the unprocessed layer through every transparent pixel of
 * `.hf-vfx-out`.
 *
 * `keepBitmap` inverts exactly that second clear: for a `backdrop` wrapper
 * whose host is not painting this frame, where the bitmap IS the frame (see
 * `capturePassThrough`), and for a VISIBLE ref whose owning host is not
 * painting (see `captureVisibleRefsOnly`) — the ref's layer is on screen
 * either way.
 *
 * Every source is drawn at the HOST's device size (`captureBox`'s default),
 * so `u_src` and `u_src2` share one coordinate space with `.hf-vfx-out` and a
 * kernel can read both at the same `v_uv`. A matte whose own box differs from
 * the host's is therefore scaled into the host's box rather than placed in
 * composition space — v1's semantic, recorded because After Effects places it
 * in comp space. A VISIBLE ref is the one exception: `captureBox` draws it at
 * its OWN box, since it is a layer on the page and must paint at its own
 * size, not the host's.
 */
function captureSource(
  entry: VfxEntry,
  src: VfxCaptureSource,
  size: { width: number; height: number },
  quiet: boolean,
  mode: CaptureMode,
): boolean {
  // A hidden source is an EMPTY capture, not a failure. The clip runtime hides
  // a matte layer outside its own window (`visibility: hidden`, inherited by
  // the `.hf-vfx-in` inside it), and a hidden subtree has no paint record:
  // `drawElementImage` would throw "No cached paint record" on every one of
  // those frames, and the `paint` wait before it would burn its whole ceiling
  // first. An empty `u_src2` is also the right answer — under Alpha the layer
  // it mattes disappears, under Alpha Inverted it passes, which is what After
  // Effects does with a matte that is not there yet.
  if (!isPaintableSource(src)) {
    resizeCaptureCanvas(src, size);
    src.ctx.clearRect(0, 0, size.width, size.height);
    if (mode.upload) uploadCaptureTexture(entry.gl, src);
    return true;
  }
  // The one capture failure Chrome does NOT report: inside a `layoutsubtree`
  // canvas a child sized by `inset`/percentages measures 0×0, and
  // `drawElementImage` then succeeds and draws nothing at all — no throw, no
  // warning, a blank layer. Measured (vault `layoutsubtree-capture-rules`),
  // so it is checked here and said out loud, once per source rather than once
  // per frame.
  if (deviceSize(src.inner) === null) {
    if (!src.emptyBoxReported) {
      src.emptyBoxReported = true;
      reportVfxError(
        `${describeHost(entry.host)}: the .hf-vfx-in wrapper measures 0×0, so its capture ` +
          `would be empty. Inside a layoutsubtree canvas an inset or percentage box has no ` +
          `size — the wrapper must state an explicit width and height in px.`,
      );
    }
    return false;
  }
  resizeCaptureCanvas(src, size);
  src.ctx.clearRect(0, 0, size.width, size.height);
  try {
    src.ctx.drawElementImage(src.inner, 0, 0, size.width, size.height);
  } catch (err) {
    // A speculative capture is quiet on purpose: it is the engine path's SECOND
    // attempt at the same frame, racing the host's own `resolve`, and "no cached
    // paint record yet" there is expected, recoverable, and must not fail a
    // render. The authoritative attempt (preview paint, or `resolveVfxCapture`)
    // still owns the loud error contract.
    if (!quiet) {
      reportVfxError(
        `${describeHost(entry.host)}: drawElementImage failed: ${(err as Error).message} ` +
          `In Studio, enable chrome://flags/#canvas-draw-element.`,
      );
    }
    return false;
  }
  if (mode.upload) uploadCaptureTexture(entry.gl, src);
  if (!mode.keepBitmap) src.ctx.clearRect(0, 0, size.width, size.height);
  return true;
}

/**
 * The box one source is drawn at. The host's, so `u_src`, `u_src2` and
 * `.hf-vfx-out` share a pixel grid — except for a VISIBLE ref, which is a
 * layer on the page and must paint at its own size and resolution. Sampling is
 * unaffected either way: `drawElementImage(el, 0, 0, w, h)` scales the element
 * into the whole canvas, so normalized `v_uv` addresses the same point in the
 * element's box whatever the bitmap's pixel size — which is the v1 rule, a
 * ref scaled into the host's box rather than placed in composition space.
 */
function captureBox(
  src: VfxCaptureSource,
  hostSize: { width: number; height: number },
): { width: number; height: number } {
  if (!src.visible) return hostSize;
  return deviceSize(src.inner) ?? hostSize;
}

/**
 * Capture everything this entry's kernels read for one frame: `u_src`, then
 * each node's `u_src2`. A source that fails does not stop the others — the
 * failure is reported where it happened — but the frame is only "captured"
 * when all of them are, so a half-captured paint never counts as authoritative.
 */
function captureEntry(entry: VfxEntry, quiet = false): boolean {
  const size = deviceSize(entry.host);
  const sources = entrySources(entry);
  if (!size || sources.length === 0) return false;
  let captured = true;
  for (const source of sources) {
    const mode = source.visible ? CAPTURE_VISIBLE_SOURCE : CAPTURE_TO_TEXTURE;
    if (!captureSource(entry, source, captureBox(source, size), quiet, mode)) {
      captured = false;
    }
  }
  return captured;
}

/**
 * A `backdrop` host that is not painting this frame — the clip runtime hides
 * every host outside its `data-start`/`data-duration` window — still has to
 * draw its source, because that source is every layer BELOW it and those
 * layers are children of a `layoutsubtree` canvas: the page compositor paints
 * the canvas bitmap and nothing else. Skipping the capture the way a `self`
 * host is skipped would delete them from the frame instead of passing them
 * through unprocessed.
 *
 * So: capture, keep the bitmap, paint no kernel. The adjustment layer is off,
 * its input is on. Sized from the wrapper's own box when the host has none, so
 * a host hidden with `display:none` (the timed-clip leaf path) still passes its
 * layers through.
 */
function capturePassThrough(entry: VfxEntry, quiet = false): boolean {
  const src = entry.src;
  if (!src) return false;
  const size = deviceSize(entry.host) ?? deviceSize(src.inner);
  if (!size) return false;
  return captureSource(entry, src, size, quiet, CAPTURE_PASS_THROUGH);
}

/**
 * A host that is not painting this frame but owns a VISIBLE ref: that ref's
 * AE layer can outlive the kernel host's own `data-start`/`data-duration`
 * window (retro-wave `Logo Anim` layer 5 again — it is layer 4's displacement
 * map AND a layer with its own, different, on-screen span), so its bitmap has
 * to stay current even though no kernel reads it this frame. Capture only,
 * never upload: nothing will bind the texture, since `paintEntry` does not
 * run for a host that is not painting.
 *
 * A `hostSize` fallback of `{0, 0}` is safe here: `captureBox` only falls back
 * to it when a VISIBLE source's own box (`deviceSize(src.inner)`) is null, and
 * that is already reported by `captureSource`'s own 0×0 check.
 */
function captureVisibleRefsOnly(entry: VfxEntry, quiet = false): boolean {
  let ok = true;
  for (const ref of visibleRefSources(entry)) {
    const size = captureBox(ref, { width: 0, height: 0 });
    if (!captureSource(entry, ref, size, quiet, CAPTURE_VISIBLE_ONLY)) ok = false;
  }
  return ok;
}

/**
 * A hidden host still needs capturing when it's a backdrop's layers-below
 * source, or when one of its passes' ref sources paints visibly elsewhere —
 * and a host can be BOTH (a backdrop whose displacement map is itself a
 * visible layer), so this always runs whichever apply, not one or the other.
 */
function captureHiddenEntry(entry: VfxEntry): boolean {
  let ok = false;
  if (isBackdropEntry(entry) && capturePassThrough(entry)) ok = true;
  if (visibleRefSources(entry).length > 0 && captureVisibleRefsOnly(entry)) ok = true;
  return ok;
}

/** Phase 2 of the page-composite protocol: the paint records are valid now. */
function resolveVfxCapture(): boolean {
  let painted = false;
  for (const entry of registry) {
    if (entry.contextLost) continue;
    if (entrySources(entry).length === 0) continue;
    if (!isPaintableHost(entry.host)) {
      if (captureHiddenEntry(entry)) painted = true;
      continue;
    }
    if (!captureEntry(entry)) continue;
    paintEntry(entry, lastPaintTime);
    painted = true;
  }
  // Deliberately NOT idempotent: the engine resolves only after its own
  // before-capture hooks have mutated the DOM (video frames injected as <img>,
  // scenes cloned), so its capture is the authoritative one even when a
  // fallback already painted this frame from the pre-hook DOM. Recording the
  // token is what lets that earlier fallback stand down, not the reverse.
  resolvedSeq = paintSeq;
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
 * Ceiling on ONE host's `paint` wait before its capture is abandoned.
 *
 * A real paint is two animation frames — under 100 ms at any plausible frame
 * rate — so 2 s is roughly a 20x margin, and it is short next to what a hung
 * barrier would otherwise burn (Puppeteer's ~180 s CDP `protocolTimeout`). It
 * is also the deadline this repo already uses for a BeginFrame-shaped wait
 * (`BEGINFRAME_PROBE_TIMEOUT_MS`, `engine/src/services/browserManager.ts`).
 *
 * Deliberately longer than the comparable 250 ms `paint`-event fallback in
 * `engine/src/services/drawElementService.ts`: that one falls back to DRAWING a
 * frame-stale snapshot, so a false positive costs a frame of staleness, while
 * this one skips the host's capture and reports loudly — so its false positives
 * are expensive and it gets the wider margin.
 */
const CAPTURE_PAINT_TIMEOUT_MS = 2000;

/**
 * Preview/Studio readiness: `drawElementImage` throws "No cached paint record
 * for element" unless the subtree has been painted since it last changed, and
 * a synchronous `requestPaint()` does not create one within the same task.
 *
 * BOUNDED, because this wait is part of the shared seek-completion barrier
 * (see `paintVfx`) and neither thing that settles it is guaranteed to happen.
 * Under BeginFrame control (Linux headless-shell, `drawelement` capture) the
 * compositor advances only on an explicit `HeadlessExperimental.beginFrame`,
 * and `frameCapture.ts` issues that inside its per-frame capture stage — AFTER
 * `prepareFrameForCapture` has already drained this barrier. With no tick yet
 * for the frame, no `paint` event fires, and the rAF fallback does not fire
 * either: the engine's own notes say rAF is gated the same way
 * (`frameCapture.ts` ~line 2445, "waitForFunction uses rAF polling internally,
 * which won't fire in beginFrame mode"; ~line 4755, "headless only fires rAF
 * when a frame is produced, and nothing produces one until a screenshot
 * asks"). `setTimeout` is the one clock that is NOT compositor-gated there —
 * `drawElementService.ts` (~line 341) describes its 250 ms paint-wait fallback
 * as burning "on every frame" under BeginFrame control, which can only happen
 * if the timer fires — so this ceiling is what keeps the barrier live.
 */
function awaitCanvasPaint(canvas: HTMLCanvasElement): Promise<"painted" | "timeout"> {
  return new Promise<"painted" | "timeout">((resolve) => {
    let settled = false;
    const finish = (outcome: "painted" | "timeout"): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      canvas.removeEventListener("paint", onPaint);
      resolve(outcome);
    };
    const onPaint = (): void => finish("painted");
    // Cleared by `finish`, so the common case adds no latency and leaves no
    // timer behind; on a canvas that never paints it is the only way out.
    const timer = setTimeout(() => finish("timeout"), CAPTURE_PAINT_TIMEOUT_MS);
    canvas.addEventListener("paint", onPaint, { once: true });
    try {
      (canvas as RequestPaintCanvas).requestPaint?.();
    } catch {
      // Feature drift on this build — the rAF fallback below still fires.
    }
    if (typeof requestAnimationFrame !== "function") {
      finish("painted");
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => finish("painted")));
  });
}

/** Every source's canvas, awaited together; `false` once a timeout has been
 *  reported. In parallel because one canvas's wait does not inform another's. */
async function awaitSourcePaints(entry: VfxEntry, sources: VfxCaptureSource[]): Promise<boolean> {
  const outcomes = await Promise.all(sources.map((source) => awaitCanvasPaint(source.canvas)));
  if (!outcomes.includes("timeout")) return true;
  reportVfxError(
    `${describeHost(entry.host)}: no paint arrived within ${CAPTURE_PAINT_TIMEOUT_MS}ms, so ` +
      `this frame's capture was skipped (a BeginFrame-controlled compositor without a tick ` +
      `for this frame is a known cause).`,
  );
  return false;
}

/**
 * Which of an entry's three capture shapes this frame needs, decided once so
 * every step of `capturePaintedHost` reads the same answer: the host's own
 * kernel paint, the backdrop pass-through (which ALSO captures any visible
 * ref the host owns — a backdrop's displacement map can itself be a layer
 * with its own on-screen span), or — a host that is hidden and NOT a
 * backdrop, but owns a visible ref whose own layer must keep showing — a
 * ref-only capture that skips the kernel entirely.
 */
type FrameCaptureMode = "paint" | "passThrough" | "refOnly";

function frameCaptureMode(entry: VfxEntry): FrameCaptureMode {
  if (isPaintableHost(entry.host)) return "paint";
  return isBackdropEntry(entry) ? "passThrough" : "refOnly";
}

/** The sources this frame needs: all of them to paint; the backdrop wrapper
 *  plus any visible ref(s) to pass through (a backdrop host can itself own a
 *  visible ref — its displacement map may be a layer with its own on-screen
 *  span); or just the visible ref(s) alone to keep them current. */
function sourcesForFrame(entry: VfxEntry, mode: FrameCaptureMode): VfxCaptureSource[] {
  const sources =
    mode === "passThrough"
      ? [...(entry.src ? [entry.src] : []), ...visibleRefSources(entry)]
      : mode === "refOnly"
        ? visibleRefSources(entry)
        : entrySources(entry);
  // A hidden source never fires `paint`, and under a BeginFrame-controlled
  // compositor the rAF fallback does not either — waiting on one would spend
  // the whole ceiling, every frame, to arrive at the empty capture
  // `captureSource` gives it for free.
  return sources.filter(isPaintableSource);
}

/**
 * Nothing has taken this frame over during the paint wait: no newer seek, no
 * engine resolve that already owns the pixels, and no `initVfx` re-scan — that
 * releases the outgoing registry's programs and textures, and painting a
 * released entry is a silent GL error rather than a frame.
 */
function stillOwnsFrame(entry: VfxEntry, seq: number): boolean {
  if (seq !== paintSeq || resolvedSeq === seq) return false;
  return registry.includes(entry) && !entry.contextLost;
}

/**
 * Wait for one host's canvas to paint, then capture and paint that host.
 *
 * Per host, not per batch: a host whose compositor genuinely cannot paint this
 * frame must not make every other host on the page wait out the ceiling too.
 * A host that times out is skipped for this paint — no capture, no guess at
 * pixels — and says so loudly. The report is NOT suppressed in engine mode
 * even though a capture failure there is quiet (`speculative`): that quiet is
 * for the engine's second attempt at the same frame, and in `drawelement` /
 * `beginframe` capture mode there is no second attempt — `frameCapture.ts`
 * (~line 2708) skips `__hf_page_composite_resolve` in exactly those modes, so
 * this wait is the only capture path the frame has.
 */
async function capturePaintedHost(
  entry: VfxEntry,
  t: number,
  seq: number,
  speculative: boolean,
): Promise<void> {
  // A pass-through frame needs the backdrop wrapper's paint record plus any
  // visible ref's; a ref-only frame needs only the visible ref's; a painting
  // frame needs one per source the kernels read. Records are per canvas, so
  // the waits are too.
  const mode = frameCaptureMode(entry);
  if (!(await awaitSourcePaints(entry, sourcesForFrame(entry, mode)))) return;
  if (!stillOwnsFrame(entry, seq)) return;
  if (mode === "passThrough") {
    capturePassThrough(entry, speculative);
    captureVisibleRefsOnly(entry, speculative);
    return;
  }
  if (mode === "refOnly") {
    captureVisibleRefsOnly(entry, speculative);
    return;
  }
  if (captureEntry(entry, speculative)) paintEntry(entry, t);
}

async function capturePreviewThenPaint(
  entries: VfxEntry[],
  t: number,
  seq: number,
  speculative: boolean,
): Promise<void> {
  // In parallel, not in sequence: each wait costs up to two animation frames,
  // so N hosts awaited one after another cost 2N — more slack than the CLI's
  // post-barrier settle leaves, and the cost grows with the composition.
  await Promise.all(entries.map((entry) => capturePaintedHost(entry, t, seq, speculative)));
}

/**
 * Repaint every registered chain for composition-local time `t`. Called from
 * the runtime transport's `seek` (preview) and `renderSeek` (engine) — the two
 * places a frame's DOM state is finished changing.
 *
 * A chain with no capture paints inline. A capturing chain cannot: its texture
 * comes from `drawElementImage`, which needs a paint record that does not exist
 * yet at this point in the task.
 *
 * That deferred capture is REGISTERED INTO THE SHARED SEEK-COMPLETION BARRIER
 * (`adapters/seek-dispatch.ts`) rather than left fire-and-forget, so the paths
 * that already drain the barrier wait for it instead of racing it:
 * `seekCompositionTimeline` awaits `window.__hfWaitForSeekCompletion` before
 * its settle race and screenshot, which covers `snapshot`, `check`, `compare`,
 * `validate` and `layout`. Racing it is the silent-blank-under-snapshot defect
 * this module has already shipped once (dcfbda9fd) — there the capture never
 * ran at all, here it ran too late, and both read as an unpainted layer.
 *
 * Joining that barrier makes this module's wait able to STALL every caller of
 * `__hfWaitForSeekCompletion`, the engine's render path included:
 * `frameCapture.ts` drains the barrier inside `prepareFrameForCapture` (~line
 * 2692), which on a BeginFrame-controlled host (Linux headless-shell,
 * `drawelement` capture) runs BEFORE the per-frame
 * `HeadlessExperimental.beginFrame` that the compositor needs to paint at all
 * (~line 3797). Fire-and-forget, that could not hurt anyone; registered, it
 * can. `awaitCanvasPaint` is therefore bounded at
 * `CAPTURE_PAINT_TIMEOUT_MS`, which converts an indefinite hang into a loud,
 * bounded, per-host failure — the other hosts on the page still paint on their
 * own schedule, and the barrier always resolves.
 */
export function paintVfx(t: number, options?: { engineMode?: boolean }): void {
  lastPaintTime = t;
  const seq = ++paintSeq;
  const capturing: VfxEntry[] = [];
  for (const entry of registry) {
    // Reported once, at the moment of loss; repeating it per frame is spam.
    if (entry.contextLost) continue;
    if (!isPaintableHost(entry.host)) {
      // A hidden `backdrop` host is an adjustment layer that is off, not a
      // reason to drop the layers below it — those live in the wrapper
      // OUTSIDE the host and are invisible until something draws them. A
      // hidden non-backdrop host with a VISIBLE ref is the same shape one
      // level removed: the ref's own AE layer can outlive this host's
      // data-start/data-duration window, and skipping the whole entry would
      // leave that layer missing (before its host's window) or stale (after
      // it, since `CAPTURE_VISIBLE_SOURCE`/`CAPTURE_VISIBLE_ONLY` both keep
      // the bitmap).
      if (isBackdropEntry(entry) || visibleRefSources(entry).length > 0) capturing.push(entry);
      continue;
    }
    if (entrySources(entry).length > 0) capturing.push(entry);
    else paintEntry(entry, t);
  }
  if (capturing.length === 0) return;
  // Engine mode arms the page-composite protocol AND the preview-side capture,
  // then paints on whichever completes first. Arming alone was a bet that every
  // capture host runs under `frameCapture.ts`, and it does not: `hyperframes
  // snapshot` (and `check`/`compare`/`validate`/`layout`, and Studio's
  // thumbnail capture) seek through the same `seekCompositionTimeline` →
  // `renderSeek`, never read `__hf_page_composite_pending`, and never call
  // `__hf_page_composite_resolve` — so a `self` chain painted nothing there, in
  // silence. The runtime has to be able to finish its own frame.
  if (options?.engineMode) armPageComposite();
  registerSeekCompletion(capturePreviewThenPaint(capturing, t, seq, options?.engineMode === true));
}
