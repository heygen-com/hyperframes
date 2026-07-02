/**
 * Phase 3 mapper: figma node tree → editable HTML with inline styles
 * (design spec §7, hybrid fidelity routing).
 *
 * - Geometry is exact for free: absolute positioning at figma bounds inside
 *   a fixed-size root — no responsive reflow, no drift.
 * - CSS where CSS is faithful: solid/linear-gradient fills, corner radius,
 *   opacity, drop shadow, blur, text styles.
 * - Everything CSS can't match faithfully (vectors, boolean ops, exotic
 *   paint) routes to the rasterize list — the caller exports those nodes as
 *   images (Phase 1) and fills in the placeholder src.
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

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "node";
}

function cssVarName(compositionVariableId: string): string {
  return `--${slugify(compositionVariableId)}`;
}

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
}

interface RenderContext {
  origin: Box;
  bindings: ResolveBindingsResult;
  rasterize: RasterizeRequest[];
  usedSlugs: Set<string>;
}

function uniqueSlug(ctx: RenderContext, name: string): string {
  const base = slugify(name);
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

function geometryCss(node: FigmaNodeDocument, ctx: RenderContext, isRoot: boolean): string[] {
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
    styles.push(
      "position: absolute",
      `left: ${round(box.x - ctx.origin.x)}px`,
      `top: ${round(box.y - ctx.origin.y)}px`,
      `width: ${round(box.width)}px`,
      `height: ${round(box.height)}px`,
    );
  }
  return styles;
}

function decorationCss(node: FigmaNodeDocument, ctx: RenderContext): string[] {
  const styles: string[] = [];
  // backgroundValue is the binding-aware path (var(--slug, literal)) — TEXT
  // color goes through it too, so a token-bound text fill keeps its link.
  const bg = backgroundValue(node, ctx);
  if (node.type === "TEXT") {
    if (bg !== null) styles.push(`color: ${bg}`);
    textCss(node, styles);
  } else if (bg !== null) {
    styles.push(`background: ${bg}`);
  }
  if (node.type === "ELLIPSE") {
    styles.push("border-radius: 50%");
  } else if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    styles.push(`border-radius: ${round(node.cornerRadius)}px`);
  }
  if (node.clipsContent === true) styles.push("overflow: hidden");
  if (typeof node.opacity === "number" && node.opacity < 1)
    styles.push(`opacity: ${round(node.opacity)}`);
  effectsCss(node, styles);
  return styles;
}

// ponytail: depth cap so a runaway auto-generated tree degrades to a skip
// instead of a RangeError; real figma frames are nowhere near this deep.
const MAX_DEPTH = 500;

function renderChildren(node: FigmaNodeDocument, ctx: RenderContext, depth: number): string {
  const childHtml: string[] = [];
  for (const child of childDocuments(node)) {
    const rendered = renderNodeHtml(child, ctx, false, depth + 1);
    if (rendered.length > 0) childHtml.push(rendered);
  }
  return childHtml.length > 0 ? `\n${childHtml.join("\n")}\n` : "";
}

function renderNodeHtml(
  node: FigmaNodeDocument,
  ctx: RenderContext,
  isRoot: boolean,
  depth = 0,
): string {
  if (node.visible === false || depth > MAX_DEPTH) return "";
  const slug = uniqueSlug(ctx, node.name);
  const style = escapeHtml(
    [...geometryCss(node, ctx, isRoot), ...decorationCss(node, ctx)].join("; "),
  );
  const idAttrs = `id="${slug}" data-figma-id="${escapeHtml(node.id)}"${unresolvedAttr(node, ctx)}`;

  if (RASTERIZE_TYPES.has(node.type)) {
    ctx.rasterize.push({ nodeId: node.id, name: node.name, slug });
    return `<img ${idAttrs} data-figma-rasterize="${escapeHtml(node.id)}" alt="${escapeHtml(node.name)}" style="${style}" />`;
  }

  if (node.type === "TEXT") {
    const text = typeof node.characters === "string" ? escapeHtml(node.characters) : "";
    return `<div ${idAttrs} style="${style}">${text}</div>`;
  }

  return `<div ${idAttrs} style="${style}">${renderChildren(node, ctx, depth)}</div>`;
}

export function nodeToHtml(
  root: FigmaNodeDocument,
  bindings: ResolveBindingsResult,
): NodeToHtmlResult {
  const origin = boxOf(root) ?? { x: 0, y: 0, width: 0, height: 0 };
  const ctx: RenderContext = { origin, bindings, rasterize: [], usedSlugs: new Set() };
  const html = renderNodeHtml(root, ctx, true);
  return { html, rasterize: ctx.rasterize };
}
