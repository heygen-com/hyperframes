/**
 * Same-origin iframe PreviewAdapter — WS-A1 (hit-test + selection) +
 * WS-A2 (applyDraft / commitPreview / cancelPreview → moveElement) +
 * WS-G (image-alpha hit-test, phase 1).
 *
 * Requirements:
 * - The iframe MUST be same-origin (srcdoc / blob URL). Cross-origin access to
 *   contentDocument throws a DOMException; this adapter does not guard that —
 *   the caller is responsible for ensuring same-origin.
 *
 * Image-alpha (phase 1):
 * - Replaces elementFromPoint with elementsFromPoint (z-stack) so transparent
 *   image hits fall through to the element behind.
 * - For <img> hits, maps the client point to the natural-pixel coordinate
 *   (object-fit/object-position aware), draws to an offscreen canvas (cached
 *   by src + natural dimensions, so a srcset re-render gets a fresh canvas),
 *   samples alpha. Transparent pixel → miss, continue the stack.
 * - Cross-origin images taint the canvas → getImageData throws SecurityError
 *   → falls back to treating the pixel as OPAQUE (never drop an unverifiable
 *   hit) and warns once per src. Callers must ensure CORS or accept the fallback.
 * - A CSS rotation/skew on the image or an ancestor also falls back to opaque
 *   (the axis-aligned rect mapping can't sample a rotated image correctly);
 *   transform-inverse mapping is phase 2.
 * - Images above a pixel budget skip alpha-testing (opaque) to bound canvas
 *   memory. Limitation: animated <img> (gif) or src swaps invalidate the cache
 *   only when currentSrc/dimensions change. Phase 1 is optimized for static images.
 * - Phase 2 (full per-pixel alpha via drawElement rasterization) is NOT built
 *   here — gated on a perf spike.
 */

import {
  EDIT_BASE_X_ATTR,
  EDIT_BASE_Y_ATTR,
  EDIT_ORIGINAL_TRANSLATE_ATTR,
  applyPositionEditToElement,
  composeTranslate,
  readCurrentTranslate,
} from "@hyperframes/core/runtime/position-edits";
import type { PreviewAdapter, ElementAtPointResult, DraftProps } from "./types.js";
import type { EditOp, Composition } from "../types.js";
import { applyPatchesToDocument, applyOverrideSet } from "../engine/apply-patches.js";

// ─── Pure resolver (testable without a browser) ───────────────────────────────

/**
 * Walk from `el` upward through parentElement, looking for the nearest node
 * that carries `[data-hf-id]` and is NOT `[data-hf-root]`.
 *
 * Returns null when:
 * - The walk exits the tree without finding `[data-hf-id]`
 * - The matching node is `[data-hf-root]` (transparent to hit-testing)
 * - `isVisible(node)` returns false for the matching node
 *
 * Keeping this a pure function (no elementFromPoint, no window access) makes
 * it unit-testable in a plain Node environment.
 */
export function resolveNearestHfElement(
  el: Element | null,
  isVisible: (el: Element) => boolean,
): ElementAtPointResult | null {
  let node = el;
  while (node !== null) {
    const id = node.getAttribute("data-hf-id");
    if (id !== null) {
      if (node.hasAttribute("data-hf-root")) return null;
      if (!isVisible(node)) return null;
      return { id, tag: node.tagName.toLowerCase() };
    }
    node = node.parentElement;
  }
  return null;
}

// ─── Draft position math (pure — testable without a browser) ─────────────────

/**
 * Compute the new absolute x/y for a moveElement op given:
 * - the element's current `data-x` / `data-y` string values (may be null)
 * - the accumulated drag delta (dx, dy) from applyDraft calls
 *
 * `data-x` / `data-y` default to 0 when absent or non-numeric.
 */
export function computeDraftPosition(
  dataX: string | null,
  dataY: string | null,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const baseX = parseFloat(dataX ?? "0") || 0;
  const baseY = parseFloat(dataY ?? "0") || 0;
  return { x: baseX + dx, y: baseY + dy };
}

// ─── Image-alpha pure helpers (WS-G phase 1) ──────────────────────────────────

/**
 * Returns true when the first pixel in `imageData` has alpha >= threshold.
 *
 * Pure — no DOM access; unit-testable with a plain Uint8ClampedArray.
 * threshold defaults to 1 so a fully-transparent pixel (a=0) is a miss.
 */
export function alphaIsOpaque(imageData: ImageData, threshold = 1): boolean {
  // ImageData.data is [R, G, B, A, R, G, B, A, ...]
  const alpha = imageData.data[3] ?? 0;
  return alpha >= threshold;
}

/**
 * Map a client-space point to the natural-pixel coordinates of the image.
 *
 * Handles object-fit: fill | cover | contain (default=fill when unset).
 * object-position is parsed as two percentage/px values (default "50% 50%").
 *
 * Returns null when the point falls outside the rendered image area (e.g.
 * the letterbox region of a contain-fitted image). A null result means the
 * image does not own this pixel — the caller should continue the z-stack.
 *
 * Pure — no DOM/window access; unit-testable with plain objects.
 */
// fallow-ignore-next-line complexity
export function mapPointToImagePixel(
  rect: { left: number; top: number; width: number; height: number },
  natural: { width: number; height: number },
  objectFit: string,
  objectPosition: string,
  point: { x: number; y: number },
): { px: number; py: number } | null {
  // Local coords within the CSS box
  const lx = point.x - rect.left;
  const ly = point.y - rect.top;

  if (lx < 0 || ly < 0 || lx > rect.width || ly > rect.height) return null;

  const fit = objectFit || "fill";

  // For fill (or unrecognized values): the natural image is stretched to the
  // box; direct linear mapping.
  if (fit !== "cover" && fit !== "contain" && fit !== "none") {
    if (rect.width === 0 || rect.height === 0) return null;
    const px = Math.floor((lx / rect.width) * natural.width);
    const py = Math.floor((ly / rect.height) * natural.height);
    return { px: clamp(px, 0, natural.width - 1), py: clamp(py, 0, natural.height - 1) };
  }

  // For none: image is drawn at its natural size; no scaling.
  if (fit === "none") {
    const pos = parseObjectPosition(objectPosition, rect, natural);
    const ox = pos.x;
    const oy = pos.y;
    const px = Math.floor(lx - ox);
    const py = Math.floor(ly - oy);
    if (px < 0 || py < 0 || px >= natural.width || py >= natural.height) return null;
    return { px, py };
  }

  // cover: scale uniformly so the image covers the box; may clip edges.
  // contain: scale uniformly so the image fits within the box; may letterbox.
  if (natural.width === 0 || natural.height === 0) return null;
  const scaleX = rect.width / natural.width;
  const scaleY = rect.height / natural.height;
  const scale = fit === "cover" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);

  const renderedW = natural.width * scale;
  const renderedH = natural.height * scale;

  const pos = parseObjectPosition(objectPosition, rect, {
    width: renderedW,
    height: renderedH,
  });

  // Offset of the rendered image's top-left within the CSS box
  const imgLeft = pos.x;
  const imgTop = pos.y;

  // Local coords relative to the rendered image's top-left
  const rx = lx - imgLeft;
  const ry = ly - imgTop;

  if (rx < 0 || ry < 0 || rx > renderedW || ry > renderedH) return null;

  if (scale === 0) return null;

  const px = Math.floor(rx / scale);
  const py = Math.floor(ry / scale);
  return { px: clamp(px, 0, natural.width - 1), py: clamp(py, 0, natural.height - 1) };
}

// ─── object-position parser (pure) ───────────────────────────────────────────

/**
 * Parse a CSS object-position value into x/y offsets (top-left of the
 * rendered content relative to the CSS box top-left).
 *
 * Supports the common subset: keyword pairs, percentage pairs, pixel pairs,
 * and single-value shorthand. Mixed units (e.g. "50% 10px") are supported.
 *
 * Pure — no DOM access.
 */
function parseObjectPosition(
  objectPosition: string,
  box: { width: number; height: number },
  content: { width: number; height: number },
): { x: number; y: number } {
  const raw = (objectPosition || "50% 50%").trim();
  const parts = raw.split(/\s+/);

  // Resolve a single token into a pixel offset along the given axis.
  // `available` is the "slack" (box dimension - content dimension).
  // fallow-ignore-next-line complexity
  function resolveToken(token: string, available: number): number {
    if (token === "left" || token === "top") return 0;
    if (token === "right" || token === "bottom") return available;
    if (token === "center") return available / 2;
    if (token.endsWith("%")) {
      const pct = parseFloat(token) / 100;
      return isNaN(pct) ? available / 2 : pct * available;
    }
    if (token.endsWith("px")) {
      const px = parseFloat(token);
      return isNaN(px) ? available / 2 : px;
    }
    // Bare number — treat as px
    const n = parseFloat(token);
    return isNaN(n) ? available / 2 : n;
  }

  const availX = box.width - content.width;
  const availY = box.height - content.height;

  const isVert = (t: string) => t === "top" || t === "bottom";
  const isHoriz = (t: string) => t === "left" || t === "right";

  if (parts.length === 1) {
    const tokenX = parts[0] ?? "50%";
    // Single value: if it's a vertical keyword the x defaults to center
    if (isVert(tokenX)) {
      return { x: availX / 2, y: resolveToken(tokenX, availY) };
    }
    return { x: resolveToken(tokenX, availX), y: availY / 2 };
  }

  // Keyword pairs may be given vertical-first ("bottom left"); normalize so the
  // first token addresses the x-axis and the second the y-axis.
  let xToken = parts[0] ?? "50%";
  let yToken = parts[1] ?? "50%";
  if (isVert(xToken) || isHoriz(yToken)) {
    [xToken, yToken] = [yToken, xToken];
  }
  return {
    x: resolveToken(xToken, availX),
    y: resolveToken(yToken, availY),
  };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

// ─── Visibility check ─────────────────────────────────────────────────────────

/**
 * Returns true when no element in the ancestor chain (inclusive) has
 * computed opacity === 0. Checks ancestors because a parent at opacity:0
 * makes the child invisible even if the child's own opacity is 1.
 *
 * This reflects the current GSAP timeline state (whatever the player has
 * seeked to). For atTime values matching the live playhead this is always
 * accurate. For speculative times this is NOT seeked — WS-A1 does not mutate
 * the timeline; accurate out-of-band opacity queries are WS-G follow-on.
 */
function isOpacityVisible(el: Element, win: Window & typeof globalThis): boolean {
  let node: Element | null = el;
  while (node !== null) {
    const style = win.getComputedStyle(node);
    if (parseFloat(style.opacity) === 0) return false;
    node = node.parentElement;
  }
  return true;
}

// ─── Image-alpha canvas cache (WS-G phase 1) ─────────────────────────────────

/**
 * Cache of offscreen canvases keyed by image currentSrc.
 *
 * Canvases are drawn once; the same canvas is reused across hit-tests.
 * Animated images (gif) or dynamic src swaps are NOT tracked — this is a
 * phase-1 static-image optimization. A tainted entry stores null to record
 * that the image is cross-origin and all pixels should be treated as opaque.
 *
 * Exported for tests that need to reset the cache between runs.
 */
export const _imgCanvasCache = new Map<string, OffscreenCanvas | null>();

/**
 * Bounded cap so a long session can't accumulate one full-resolution
 * OffscreenCanvas per image src indefinitely.
 * ponytail: FIFO eviction, upgrade to LRU if cache hit-rate matters.
 */
const _IMG_CANVAS_CACHE_MAX = 64;

function cacheCanvas(key: string, value: OffscreenCanvas | null): void {
  if (!_imgCanvasCache.has(key) && _imgCanvasCache.size >= _IMG_CANVAS_CACHE_MAX) {
    const oldest = _imgCanvasCache.keys().next().value;
    if (oldest !== undefined) _imgCanvasCache.delete(oldest);
  }
  _imgCanvasCache.set(key, value);
}

/**
 * Skip alpha-testing images above this pixel budget — allocating a full-res
 * OffscreenCanvas for one hit-test is memory-prohibitive (a 4000×3000 image is
 * ~46 MB). Above the cap we fail safe to opaque.
 * ponytail: per-image pixel cap; a byte-budget cache is phase 2.
 */
const _MAX_ALPHA_TEST_PIXELS = 16_000_000;

/**
 * Srcs we've already warned about taint for — keeps the cross-origin warning to
 * once per image instead of once per hit-test. Cleared with `_imgCanvasCache`
 * is not necessary; suppressing duplicate warnings across resets is harmless.
 */
const _warnedTaintSrcs = new Set<string>();

function warnTaintOnce(src: string): void {
  if (_warnedTaintSrcs.has(src)) return;
  _warnedTaintSrcs.add(src);
  // Visibility for the silent-failure path: a cross-origin / uncorsed image
  // taints the canvas, so alpha hit-test is unavailable and we fall back to
  // opaque. Without this, the fall-back is invisible ("hit-test feels wrong").
  console.warn(
    `[hyperframes] image-alpha hit-test unavailable for cross-origin/tainted image; treating as opaque: ${src}`,
  );
}

/**
 * True when the element or any ancestor carries a CSS rotation or skew. Such a
 * transform makes getBoundingClientRect() return the axis-aligned bounding box,
 * so the rect→natural-pixel mapping would sample the wrong pixel. Pure translate
 * / scale keep the matrix b and c components at 0 and map correctly. No-op
 * (returns false) when DOMMatrix is unavailable (e.g. the test env), preserving
 * existing behavior there.
 */
function hasRotationOrSkew(el: Element | null, win: Window & typeof globalThis): boolean {
  if (typeof win.DOMMatrix !== "function") return false;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const t = win.getComputedStyle(node).transform;
    if (!t || t === "none") continue;
    try {
      const m = new win.DOMMatrix(t);
      if (Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6) return true;
    } catch {
      return true; // unparseable transform — fail safe (treat as non-axis-aligned)
    }
  }
  return false;
}

/**
 * Sample the alpha at (clientX, clientY) for an <img> element.
 *
 * Returns true (opaque) when:
 * - The image has not finished loading (naturalWidth/naturalHeight === 0)
 * - The point maps outside the rendered image area (not this image's pixel)
 * - The canvas is tainted (cross-origin, SecurityError) — fallback: opaque
 * - Alpha >= 1
 *
 * Returns false (transparent/miss) only when the canvas is readable AND the
 * alpha at the mapped pixel is 0. A click on the element's border/padding maps
 * outside the content box → also false (the click falls through to the layer
 * behind), since border/padding pixels aren't part of the image — intentional.
 *
 * `win` is the iframe's contentWindow, used to call getComputedStyle on the
 * element which lives in the iframe's document.
 */
// fallow-ignore-next-line complexity
function imageAlphaOpaqueAt(
  img: HTMLImageElement,
  clientX: number,
  clientY: number,
  win: Window & typeof globalThis,
): boolean {
  // Not loaded yet — treat as opaque (safe fallback)
  if (img.naturalWidth === 0 || img.naturalHeight === 0) return true;

  const src = img.currentSrc || img.src;
  if (!src) return true;

  // CSS rotation/skew on the image or an ancestor breaks the axis-aligned
  // rect→natural-pixel mapping below (getBoundingClientRect returns the AABB),
  // so we'd sample the wrong pixel. Fail safe to opaque rather than guess.
  // Full transform-inverse mapping is phase 2.
  if (hasRotationOrSkew(img, win)) return true;

  // Pathological-size guard: don't allocate a huge canvas for one hit-test.
  if (img.naturalWidth * img.naturalHeight > _MAX_ALPHA_TEST_PIXELS) return true;

  // object-fit/object-position lay the image out within the CONTENT box, not
  // the border box that getBoundingClientRect() returns. Inset by border +
  // padding so the mapping is correct for an <img> that has a border or padding.
  const rect = img.getBoundingClientRect();
  const style = win.getComputedStyle(img);
  const borderL = parseFloat(style.borderLeftWidth) || 0;
  const borderT = parseFloat(style.borderTopWidth) || 0;
  const borderR = parseFloat(style.borderRightWidth) || 0;
  const borderB = parseFloat(style.borderBottomWidth) || 0;
  const padL = parseFloat(style.paddingLeft) || 0;
  const padT = parseFloat(style.paddingTop) || 0;
  const padR = parseFloat(style.paddingRight) || 0;
  const padB = parseFloat(style.paddingBottom) || 0;
  const objectFit = style.objectFit || "fill";
  const objectPosition = style.objectPosition || "50% 50%";

  const mapped = mapPointToImagePixel(
    {
      left: rect.left + borderL + padL,
      top: rect.top + borderT + padT,
      width: rect.width - borderL - borderR - padL - padR,
      height: rect.height - borderT - borderB - padT - padB,
    },
    { width: img.naturalWidth, height: img.naturalHeight },
    objectFit,
    objectPosition,
    { x: clientX, y: clientY },
  );

  // Point is outside the rendered image area — not this image's pixel.
  // Continue the z-stack (return false = miss on this element).
  if (mapped === null) return false;

  // Retrieve or build the offscreen canvas. Key on src + natural dimensions: a
  // srcset/responsive layout can serve the same URL at a different natural size,
  // and keying on src alone would reuse a canvas drawn at the prior dimensions.
  const cacheKey = `${src}@${img.naturalWidth}x${img.naturalHeight}`;
  let canvas: OffscreenCanvas | null | undefined = _imgCanvasCache.get(cacheKey);
  if (canvas === undefined) {
    // First time: draw to an offscreen canvas and cache.
    try {
      const oc = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
      const ctx = oc.getContext("2d");
      if (!ctx) {
        // OffscreenCanvas 2D unavailable — treat as opaque.
        cacheCanvas(cacheKey, null);
        return true;
      }
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
      cacheCanvas(cacheKey, oc);
      canvas = oc;
    } catch {
      // SecurityError from tainted canvas — record null and fall back opaque.
      warnTaintOnce(src);
      cacheCanvas(cacheKey, null);
      return true;
    }
  }

  // null means we already know this src is tainted — treat as opaque.
  if (canvas === null) return true;

  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) return true;
    // The mapped-pixel read also surfaces lazy canvas taint (SecurityError),
    // so no separate taint probe is needed.
    const data = ctx.getImageData(mapped.px, mapped.py, 1, 1);
    return alphaIsOpaque(data);
  } catch {
    // Taint discovered on getImageData — update cache and fall back opaque.
    warnTaintOnce(src);
    cacheCanvas(cacheKey, null);
    return true;
  }
}

// ─── IframePreviewAdapter ─────────────────────────────────────────────────────

/**
 * The hit-test z-stack at (x, y): the full elementsFromPoint stack, or a
 * single-element fallback for hosts that lack elementsFromPoint.
 */
function hitStack(doc: Document, x: number, y: number): Element[] {
  if (typeof doc.elementsFromPoint === "function") return doc.elementsFromPoint(x, y);
  const top = doc.elementFromPoint(x, y);
  return top ? [top] : [];
}

type SelectionHandler = (ids: string[]) => void;

class IframePreviewAdapter implements PreviewAdapter {
  private readonly iframe: HTMLIFrameElement;
  private readonly _dispatch: ((op: EditOp) => void) | undefined;

  private _selection: string[] = [];
  private _handlers: SelectionHandler[] = [];

  /** Tracked id and element for the in-progress drag. */
  private _draftId: string | null = null;
  private _draftEl: HTMLElement | null = null;
  /** Accumulated drag deltas from applyDraft calls. */
  private _draftDx = 0;
  private _draftDy = 0;
  /**
   * The element's effective `translate` when the drag started (inline value,
   * or computed when no inline one was set; "" = none). Drafts compose onto
   * this.
   */
  private _draftPrevTranslate: string | null = null;
  /**
   * The element's raw INLINE `translate` when the drag started ("" = not
   * inline). Reverts restore exactly this, so a stylesheet-authored translate
   * is never promoted to a permanent inline style.
   */
  private _draftPrevInlineTranslate: string | null = null;

  /** Unsubscribe for the current attachSync subscription, if any. */
  private _syncDetach: (() => void) | null = null;

  constructor(iframe: HTMLIFrameElement, dispatch?: (op: EditOp) => void) {
    this.iframe = iframe;
    this._dispatch = dispatch;
  }

  /**
   * Synchronous hit-test. Returns the nearest `[data-hf-id]` element under
   * (x, y) in the iframe's coordinate space, or null for a transparent hit
   * (root, opacity-0, nothing at all, or a transparent image pixel).
   *
   * WS-G phase 1: uses elementsFromPoint (z-stack) so a transparent-image hit
   * falls through to the layer behind. For <img> elements, the alpha at the
   * mapped natural pixel is sampled from an offscreen canvas. Cross-origin
   * images that taint the canvas are treated as opaque (safe fallback).
   *
   * atTime: reflects the GSAP state at the playhead when this is called.
   * Seeking to a different time to check visibility is WS-G follow-on.
   */
  elementAtPoint(x: number, y: number, _opts?: { atTime?: number }): ElementAtPointResult | null {
    const doc = this.iframe.contentDocument;
    if (!doc) return null;
    const win = this.iframe.contentWindow as (Window & typeof globalThis) | null;
    if (!win) return null;

    const stack = hitStack(doc, x, y);

    for (const candidate of stack) {
      // One opacity walk per candidate (candidate → root). An opacity:0 element
      // is skipped, so the click falls through to the layer painted behind it.
      if (!isOpacityVisible(candidate, win)) continue;

      // Image-alpha check: if this is an <img>, verify the pixel is opaque.
      if (win.HTMLImageElement && candidate instanceof win.HTMLImageElement) {
        if (!imageAlphaOpaqueAt(candidate, x, y, win)) {
          // Transparent pixel — fall through to the next element in the stack.
          continue;
        }
      }

      // The candidate's whole ancestor chain is already known visible (the walk
      // above covers it, and the hf node is on that chain), so the resolver
      // needs no second visibility walk.
      const result = resolveNearestHfElement(candidate, () => true);
      if (result !== null) return result;
    }

    return null;
  }

  /**
   * Visually translate the target element inside the iframe at 60fps without
   * touching the model: sets the element's `translate` to its pre-drag value
   * composed with the accumulated delta. `translate` set after GSAP's first
   * parse is untouched by seeks, so this renders correctly on animated
   * elements too. (The `--hf-studio-dx/dy` custom properties are no longer
   * written — compositions with the authored Studio drag-bridge CSS would
   * move by twice the delta if both channels applied.)
   *
   * Calling applyDraft with a new id switches the tracked element, reverting
   * the previous element's draft translate first.
   *
   * width/height in DraftProps are not yet wired (resize → setStyle, future op).
   */
  applyDraft(id: string, props: DraftProps): void {
    const el = this._resolveDraftElement(id);
    if (!el) return;

    if (props.dx !== undefined) this._draftDx = props.dx;
    if (props.dy !== undefined) this._draftDy = props.dy;

    el.style.setProperty(
      "translate",
      composeTranslate(this._draftPrevTranslate ?? "", `${this._draftDx}px`, `${this._draftDy}px`),
    );
  }

  /**
   * Resolve and track the drag target. Reuses the tracked element across the
   * 60fps drag; only re-queries when the id changes or the cached node
   * detached (e.g. an iframe reload mid-drag). Switching to a different
   * element reverts the previous one's draft first, then captures the new
   * element's pre-drag translate.
   */
  private _resolveDraftElement(id: string): HTMLElement | null {
    const doc = this.iframe.contentDocument;
    if (!doc) return null;

    const cached = id === this._draftId && this._draftEl?.isConnected ? this._draftEl : null;
    const el =
      cached ??
      doc.querySelector<HTMLElement>(
        `[data-hf-id="${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`,
      );
    if (!el) return null;

    if (el !== this._draftEl) {
      // Abandoning a prior target mid-drag must not leave it displaced.
      this._revertDraftTranslate();
      this._draftDx = 0;
      this._draftDy = 0;
      this._draftPrevTranslate = readCurrentTranslate(el);
      const inline = el.style.getPropertyValue("translate").trim();
      this._draftPrevInlineTranslate = inline === "none" ? "" : inline;
    }
    this._draftId = id;
    this._draftEl = el;
    return el;
  }

  /**
   * Read the accumulated draft deltas, derive a moveElement op, dispatch it,
   * then clear the draft state.
   *
   * No-ops (reverting any draft translate) when:
   * - No applyDraft was called (nothing to commit)
   * - No dispatch callback was provided at construction
   *
   * If dispatch throws (e.g. the model no longer has the element), the draft
   * translate is reverted and the error propagates — the element is never
   * left displaced by an uncommitted draft.
   */
  commitPreview(): void {
    if (!this._draftId || !this._draftEl || !this._dispatch) {
      this._revertDraftTranslate();
      this._clearDraft();
      return;
    }

    const el = this._draftEl;
    const dataX = el.getAttribute("data-x");
    const dataY = el.getAttribute("data-y");
    const { x, y } = computeDraftPosition(dataX, dataY, this._draftDx, this._draftDy);

    try {
      this._dispatch({ type: "moveElement", target: this._draftId, x, y });
    } catch (err) {
      this._revertDraftTranslate();
      this._clearDraft();
      throw err;
    }
    this._mirrorCommittedMove(el, dataX, dataY, x, y);
    this._clearDraft();
  }

  /**
   * Mirror a committed move onto the live element so the position holds
   * without a document reload — same attributes handleMoveElement writes
   * into the model, rendered by the runtime's position-edit translate.
   *
   * The pre-edit translate is stamped from the value captured at drag start
   * (the element's current inline translate is the draft-composed one, which
   * must not be mistaken for the original), then the final translate is
   * recomputed the same way the runtime does at bind time.
   */
  private _mirrorCommittedMove(
    el: HTMLElement,
    dataX: string | null,
    dataY: string | null,
    x: number,
    y: number,
  ): void {
    if (el.getAttribute(EDIT_BASE_X_ATTR) === null) {
      el.setAttribute(EDIT_BASE_X_ATTR, dataX ?? "0");
    }
    if (el.getAttribute(EDIT_BASE_Y_ATTR) === null) {
      el.setAttribute(EDIT_BASE_Y_ATTR, dataY ?? "0");
    }
    if (el.getAttribute(EDIT_ORIGINAL_TRANSLATE_ATTR) === null) {
      el.setAttribute(EDIT_ORIGINAL_TRANSLATE_ATTR, this._draftPrevTranslate ?? "");
    }
    el.setAttribute("data-x", String(x));
    el.setAttribute("data-y", String(y));
    applyPositionEditToElement(el, { force: true });
  }

  /** Revert the draft translate without dispatching any op. */
  cancelPreview(): void {
    this._revertDraftTranslate();
    this._clearDraft();
  }

  /**
   * Restore the element's pre-drag INLINE `translate` (removing it when there
   * was none, so a stylesheet-authored translate is never promoted to inline).
   * NOT called on a successful commit — the committed position-edit translate
   * is recomputed onto the element by _mirrorCommittedMove.
   */
  private _revertDraftTranslate(): void {
    if (!this._draftEl || this._draftPrevInlineTranslate === null) return;
    if (this._draftPrevInlineTranslate === "") {
      this._draftEl.style.removeProperty("translate");
    } else {
      this._draftEl.style.setProperty("translate", this._draftPrevInlineTranslate);
    }
  }

  private _clearDraft(): void {
    this._draftId = null;
    this._draftEl = null;
    this._draftDx = 0;
    this._draftDy = 0;
    this._draftPrevTranslate = null;
    this._draftPrevInlineTranslate = null;
  }

  // Selection -----------------------------------------------------------------

  select(ids: string[], opts?: { additive?: boolean }): void {
    if (opts?.additive) {
      const merged = new Set([...this._selection, ...ids]);
      this._selection = [...merged];
    } else {
      this._selection = [...ids];
    }
    this._emit();
  }

  on(event: "selection", handler: SelectionHandler): () => void {
    if (event !== "selection") return () => {};
    this._handlers.push(handler);
    return () => {
      this._handlers = this._handlers.filter((h) => h !== handler);
    };
  }

  private _emit(): void {
    const ids = [...this._selection];
    for (const h of this._handlers) h(ids);
  }

  /**
   * Mirror `comp`'s edits onto this.iframe.contentDocument. See the
   * PreviewAdapter interface doc for the full contract.
   */
  attachSync(comp: Composition): () => void {
    this._syncDetach?.();

    const doc = this.iframe.contentDocument;
    if (doc) {
      try {
        applyOverrideSet({ document: doc, wrapped: false, stamped: "" }, comp.getOverrides());
      } catch (err) {
        // Don't let a bad initial snapshot prevent the ongoing subscription
        // below from attaching — future patches should still mirror even if
        // this composition's current overrides couldn't be applied.
        console.warn("[hyperframes] attachSync: initial override sync failed:", err);
      }
    }

    const rawUnsubscribe = comp.on("patch", ({ patches }) => {
      const liveDoc = this.iframe.contentDocument;
      if (!liveDoc) return;
      applyPatchesToDocument(
        { document: liveDoc, wrapped: false, stamped: "" },
        // "Never mirror script-tag rewrites" is the documented contract, not
        // just today's one known path — startsWith so a future script kind
        // (e.g. "/script/label") is covered by the same intent, not just an
        // exact string this filter happens to know about today.
        patches.filter((p) => !p.path.startsWith("/script/")),
      );
    });

    const detach = (): void => {
      rawUnsubscribe();
      if (this._syncDetach === detach) this._syncDetach = null;
    };
    this._syncDetach = detach;
    return detach;
  }
}

export function createIframePreviewAdapter(
  iframe: HTMLIFrameElement,
  dispatch?: (op: EditOp) => void,
): PreviewAdapter {
  return new IframePreviewAdapter(iframe, dispatch);
}
