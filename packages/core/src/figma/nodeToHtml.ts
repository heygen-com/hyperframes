/**
 * Phase 3 mapper: figma node tree → editable HTML with inline styles
 * (design spec §7, hybrid fidelity routing).
 *
 * - Geometry is exact for free: absolute positioning at figma bounds inside
 *   a fixed-size root — no responsive reflow, no drift.
 * - CSS where CSS is faithful: solid/linear-gradient fills, corner radius,
 *   opacity, drop shadow, blur, text styles.
 * - Everything CSS can't match faithfully (vectors, boolean ops, exotic
 *   paint, IMAGE fills) routes to the rasterize list — the caller exports
 *   those nodes as images (Phase 1) and fills in the placeholder src. A
 *   rasterized node's own fill/corner-radius CSS is never emitted — the
 *   exported image already contains it; adding both double-paints (a flat
 *   color block behind/around the real art).
 * - Bindings (§7.1): resolved sites emit var(--slug, literal) so a brand
 *   refresh propagates; unresolved sites bake the literal and carry a
 *   data-figma-unresolved flag. Never a dangling var().
 * - visible:false nodes and fills are skipped — figma's own renderer
 *   semantics, not ours.
 */

import type { FigmaNodeDocument } from "./client";
import { figmaColorToCss } from "./color";
import { childDocuments } from "./nodeDocument";
import type { ResolveBindingsResult } from "./resolveBindings";

export interface RasterizeRequest {
  nodeId: string;
  name: string;
  slug: string;
}

export interface NodeToHtmlResult {
  html: string;
  rasterize: RasterizeRequest[];
}

const RASTERIZE_TYPES = new Set([
  "VECTOR",
  "BOOLEAN_OPERATION",
  "STAR",
  "LINE",
  "POLYGON",
  "REGULAR_POLYGON",
]);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function boxOf(node: FigmaNodeDocument): Box | null {
  const b = node.absoluteBoundingBox;
  if (
    isRecord(b) &&
    typeof b.x === "number" &&
    typeof b.y === "number" &&
    typeof b.width === "number" &&
    typeof b.height === "number"
  )
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  return null;
}

export { slugify } from "../tokenSlug";
import { cssVariableName as cssVarName, slugify } from "../tokenSlug";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function firstVisibleFill(node: FigmaNodeDocument): Record<string, unknown> | null {
  const fills = node.fills;
  if (!Array.isArray(fills)) return null;
  for (const fill of fills) {
    if (isRecord(fill) && fill.visible !== false) return fill;
  }
  return null;
}

function gradientCss(fill: Record<string, unknown>): string | null {
  const stops = fill.gradientStops;
  if (!Array.isArray(stops)) return null;
  const parts: string[] = [];
  for (const stop of stops) {
    if (!isRecord(stop) || typeof stop.position !== "number") return null;
    const color = figmaColorToCss(stop.color);
    if (color === null) return null;
    parts.push(`${color} ${round(stop.position * 100)}%`);
  }
  if (parts.length === 0) return null;
  // ponytail: fixed 180deg; exact angle from gradientHandlePositions when the
  // probe confirms the handle-space math (spec §7.1 probe list).
  return `linear-gradient(180deg, ${parts.join(", ")})`;
}

function fillCss(node: FigmaNodeDocument): string | null {
  const fill = firstVisibleFill(node);
  if (fill === null) return null;
  if (fill.type === "SOLID") return figmaColorToCss(fill.color);
  if (fill.type === "GRADIENT_LINEAR") return gradientCss(fill);
  return null;
}

/** IMAGE fills (photos, icons pasted as bitmaps) have no CSS equivalent —
 * route to rasterize like vectors, regardless of node.type (a plain
 * RECTANGLE/FRAME carries the fill just as often as a dedicated image node). */
function hasImageFill(node: FigmaNodeDocument): boolean {
  return firstVisibleFill(node)?.type === "IMAGE";
}

function dropShadowCss(effect: Record<string, unknown>): string | null {
  if (!isRecord(effect.offset)) return null;
  const color = figmaColorToCss(effect.color);
  const { x, y } = effect.offset;
  if (color === null || typeof x !== "number" || typeof y !== "number") return null;
  const radius = typeof effect.radius === "number" ? effect.radius : 0;
  return `box-shadow: ${round(x)}px ${round(y)}px ${round(radius)}px ${color}`;
}

function effectCss(effect: unknown): string | null {
  if (!isRecord(effect) || effect.visible === false) return null;
  if (effect.type === "DROP_SHADOW") return dropShadowCss(effect);
  if (effect.type === "LAYER_BLUR" && typeof effect.radius === "number")
    return `filter: blur(${round(effect.radius)}px)`;
  return null;
}

function effectsCss(node: FigmaNodeDocument, styles: string[]): void {
  const effects = node.effects;
  if (!Array.isArray(effects)) return;
  for (const effect of effects) {
    const css = effectCss(effect);
    if (css !== null) styles.push(css);
  }
}

function textCss(node: FigmaNodeDocument, styles: string[]): void {
  const s = node.style;
  if (!isRecord(s)) return;
  // fontFamily is the one content-controlled string that reaches CSS — strip
  // quote/escape chars so it can't break out of the font-family value (the
  // whole style attribute is additionally HTML-escaped at emission).
  if (typeof s.fontFamily === "string")
    styles.push(`font-family: '${s.fontFamily.replace(/['"\\;]/g, "")}'`);
  if (typeof s.fontWeight === "number") styles.push(`font-weight: ${s.fontWeight}`);
  if (typeof s.fontSize === "number") styles.push(`font-size: ${round(s.fontSize)}px`);
  if (typeof s.lineHeightPx === "number") styles.push(`line-height: ${round(s.lineHeightPx)}px`);
  if (typeof s.letterSpacing === "number" && s.letterSpacing !== 0)
    styles.push(`letter-spacing: ${round(s.letterSpacing)}px`);
  if (isVerticallyTrimmed(node, s.lineHeightPx)) {
    styles.push("text-box-trim: trim-both", "text-box-edge: cap alphabetic");
  }
}

/**
 * Vertical trim: a figma text box SHORTER than its line-height is
 * cap-height-trimmed bounds. Browsers place glyphs with half-leading and
 * overflow the short box downward (~6px low on a 70px font, measured
 * against figma's own render). text-box-trim reproduces figma's trim in
 * the render engine (Chrome). Single-line text only.
 */
function isVerticallyTrimmed(node: FigmaNodeDocument, lineHeightPx: unknown): boolean {
  if (typeof lineHeightPx !== "number") return false;
  const box = boxOf(node);
  if (box === null || box.height >= lineHeightPx - 1) return false;
  return typeof node.characters === "string" && !node.characters.includes("\n");
}

interface RenderContext {
  origin: Box;
  bindings: ResolveBindingsResult;
  rasterize: RasterizeRequest[];
  usedSlugs: Set<string>;
}

function uniqueSlug(ctx: RenderContext, name: string): string {
  const raw = slugify(name);
  // A digit-leading id ("3D Object" → "3d-object") is valid HTML but not a
  // valid CSS selector — querySelector("#3d-object") throws, which breaks
  // GSAP targeting and figma-motion translation. Prefix so ids stay
  // selector-safe.
  const base = /^[0-9]/.test(raw) ? `n${raw}` : raw;
  let slug = base;
  let n = 2;
  while (ctx.usedSlugs.has(slug)) slug = `${base}-${n++}`;
  ctx.usedSlugs.add(slug);
  return slug;
}

function backgroundValue(node: FigmaNodeDocument, ctx: RenderContext): string | null {
  const literal = fillCss(node);
  if (literal === null) return null;
  const resolved = ctx.bindings.resolved.find(
    (r) => r.nodeId === node.id && r.property === "fills",
  );
  if (resolved) return `var(${cssVarName(resolved.compositionVariableId)}, ${literal})`;
  return literal;
}

function unresolvedAttr(node: FigmaNodeDocument, ctx: RenderContext): string {
  const props = ctx.bindings.unresolved.filter((u) => u.nodeId === node.id).map((u) => u.property);
  if (props.length === 0) return "";
  return ` data-figma-unresolved="${escapeHtml(props.join(" "))}"`;
}

function geometryCss(node: FigmaNodeDocument, parentBox: Box, isRoot: boolean): string[] {
  const box = boxOf(node);
  const styles: string[] = [];
  if (!box) return styles;
  if (isRoot) {
    styles.push(
      "position: relative",
      `width: ${round(box.width)}px`,
      `height: ${round(box.height)}px`,
    );
  } else {
    // CSS absolute positioning is relative to the nearest positioned
    // ancestor — the PARENT's box, not the root origin. Subtracting the root
    // for every depth double-offsets nested children (each level re-adds its
    // ancestors' offsets), drifting content down-right and off-frame.
    styles.push(
      "position: absolute",
      `left: ${round(box.x - parentBox.x)}px`,
      `top: ${round(box.y - parentBox.y)}px`,
      `width: ${round(box.width)}px`,
      `height: ${round(box.height)}px`,
    );
  }
  return styles;
}

/** Corner-radius + clip describe the node's OWN shape — meaningless once
 * that shape has already been baked into a rasterized image (see
 * decorationCss). Opacity stays separate: it's compositing, still correct
 * to apply on top of a raster/vector export. */
function cornerAndClipCss(node: FigmaNodeDocument, styles: string[]): void {
  if (node.type === "ELLIPSE") {
    styles.push("border-radius: 50%");
  } else if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    styles.push(`border-radius: ${round(node.cornerRadius)}px`);
  }
  if (node.clipsContent === true) styles.push("overflow: hidden");
}

function opacityCss(node: FigmaNodeDocument, styles: string[]): void {
  if (typeof node.opacity === "number" && node.opacity < 1)
    styles.push(`opacity: ${round(node.opacity)}`);
}

function decorationCss(node: FigmaNodeDocument, ctx: RenderContext, rasterized: boolean): string[] {
  const styles: string[] = [];
  // A rasterized node's fill/shape is already baked into the exported image
  // — background-color/border-radius on top of it would double-paint (a
  // flat color block behind or around the real art). Opacity and effects
  // (shadow/blur) aren't baked by the export, so those still apply.
  if (!rasterized) {
    // backgroundValue is the binding-aware path (var(--slug, literal)) — TEXT
    // color goes through it too, so a token-bound text fill keeps its link.
    const bg = backgroundValue(node, ctx);
    if (node.type === "TEXT") {
      if (bg !== null) styles.push(`color: ${bg}`);
      textCss(node, styles);
    } else if (bg !== null) {
      // background-color (longhand) for solid fills, never the shorthand: GSAP
      // backgroundColor tweens can't read a var() through the shorthand (its
      // pending-substitution longhands serialize empty), so .from/.to on an
      // imported node would settle on transparent instead of the token color.
      styles.push(bg.includes("gradient(") ? `background: ${bg}` : `background-color: ${bg}`);
    }
    cornerAndClipCss(node, styles);
  }
  opacityCss(node, styles);
  effectsCss(node, styles);
  return styles;
}

// ponytail: depth cap so a runaway auto-generated tree degrades to a skip
// instead of a RangeError; real figma frames are nowhere near this deep.
const MAX_DEPTH = 500;

function renderChildren(
  node: FigmaNodeDocument,
  ctx: RenderContext,
  depth: number,
  parentBox: Box,
): string {
  const childHtml: string[] = [];
  for (const child of childDocuments(node)) {
    const rendered = renderNodeHtml(child, ctx, false, depth + 1, parentBox);
    if (rendered.length > 0) childHtml.push(rendered);
  }
  return childHtml.length > 0 ? `\n${childHtml.join("\n")}\n` : "";
}

function renderNodeHtml(
  node: FigmaNodeDocument,
  ctx: RenderContext,
  isRoot: boolean,
  depth = 0,
  parentBox: Box = ctx.origin,
): string {
  if (node.visible === false || depth > MAX_DEPTH) return "";
  const slug = uniqueSlug(ctx, node.name);
  const rasterized = RASTERIZE_TYPES.has(node.type) || hasImageFill(node);
  const style = escapeHtml(
    [...geometryCss(node, parentBox, isRoot), ...decorationCss(node, ctx, rasterized)].join("; "),
  );
  // data-hf-snippet marks the file as a mountable fragment, not a standalone
  // composition — the project linter skips composition-root rules for it.
  const snippetAttr = isRoot ? ' data-hf-snippet=""' : "";
  const idAttrs = `id="${slug}"${snippetAttr} data-figma-id="${escapeHtml(node.id)}"${unresolvedAttr(node, ctx)}`;

  if (rasterized) {
    ctx.rasterize.push({ nodeId: node.id, name: node.name, slug });
    return `<img ${idAttrs} data-figma-rasterize="${escapeHtml(node.id)}" alt="${escapeHtml(node.name)}" style="${style}" />`;
  }

  if (node.type === "TEXT") {
    const text = typeof node.characters === "string" ? escapeHtml(node.characters) : "";
    return `<div ${idAttrs} style="${style}">${text}</div>`;
  }

  return `<div ${idAttrs} style="${style}">${renderChildren(node, ctx, depth, boxOf(node) ?? parentBox)}</div>`;
}

export interface NodeToHtmlOptions {
  /** override for the ROOT element's slug/id — variant frames are often all
   * named "Platform=Desktop", so the caller's --name must reach the DOM id,
   * not just the output directory */
  rootName?: string;
}

export function nodeToHtml(
  root: FigmaNodeDocument,
  bindings: ResolveBindingsResult,
  opts: NodeToHtmlOptions = {},
): NodeToHtmlResult {
  const origin = boxOf(root) ?? { x: 0, y: 0, width: 0, height: 0 };
  const ctx: RenderContext = { origin, bindings, rasterize: [], usedSlugs: new Set() };
  const rootForRender = opts.rootName !== undefined ? { ...root, name: opts.rootName } : root;
  const html = renderNodeHtml(rootForRender, ctx, true);
  return { html, rasterize: ctx.rasterize };
}
