/**
 * Tell a site's BARE MARK apart from its BADGE.
 *
 * A brand band wants the logo artwork, not the browser-tab tile. Those are usually the same
 * drawing in two packagings:
 *
 *   bare mark — the glyph alone, transparent margins. Reads on any background.
 *   badge     — that glyph knocked out of, or sitting on, a full-bleed disc or square.
 *
 * Shown on a transparency checker a badge reads as a solid blob, which is exactly the complaint
 * that produced this code. Neither is wrong; they belong in different tiles.
 *
 * Both rules below are deliberately cheap and deterministic — no rendering for SVG, one small
 * resize for raster. They answer "does this drawing carry its own backdrop", nothing more.
 */

import sharp from "sharp";
import { parseHTML } from "linkedom";

/** What a downloaded icon is, as a drawing. `unknown` when the format cannot be inspected. */
export type IconShape = "bare-mark" | "badge" | "unknown";

export interface IconVerdict {
  shape: IconShape;
  /** Why, in one human-readable clause. Recorded in the manifest so a pick is never unexplained. */
  reason: string;
}

/** Elements that describe paint without applying it; a shape inside one is never the backdrop. */
const NON_PAINTING = new Set(["defs", "clippath", "mask", "style", "title", "desc", "metadata"]);

/** Elements that paint. `g` is a container, so it is walked through rather than judged. */
const PAINTING = new Set(["rect", "circle", "ellipse", "path", "polygon", "image", "use"]);

function firstPaintedElement(root: Element): Element | null {
  for (const child of Array.from(root.children)) {
    const tag = child.tagName.toLowerCase();
    if (NON_PAINTING.has(tag)) continue;
    if (tag === "g" || tag === "svg") {
      const nested = firstPaintedElement(child);
      if (nested) return nested;
      continue;
    }
    if (PAINTING.has(tag)) return child;
  }
  return null;
}

function num(el: Element, attr: string): number | null {
  const raw = el.getAttribute(attr);
  if (raw === null) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function positiveBox(w: number | null, h: number | null): { w: number; h: number } | null {
  return w !== null && h !== null && w > 0 && h > 0 ? { w, h } : null;
}

/** The `viewBox`'s own width/height, ignoring its origin. */
function canvasFromViewBox(viewBox: string | null): { w: number; h: number } | null {
  if (!viewBox) return null;
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  return positiveBox(parts[2]!, parts[3]!);
}

/** viewBox width/height, falling back to the width/height attributes. */
function canvasOf(svg: Element): { w: number; h: number } | null {
  return (
    canvasFromViewBox(svg.getAttribute("viewBox")) ??
    positiveBox(num(svg, "width"), num(svg, "height"))
  );
}

/** A backdrop covers essentially the whole canvas; anything smaller leaves margins. */
const FULL_BLEED_RATIO = 0.95;

/**
 * Classify an SVG by MARKUP, not by rendering it.
 *
 * Rendering would be the obvious approach and it does not work here: these files routinely fill
 * with CSS custom properties under a `prefers-color-scheme` query, and librsvg (what sharp uses)
 * resolves neither — openai.com's favicon rasterises to a fully transparent image through sharp
 * while Chrome draws it correctly. Markup is the only reliable signal available offline.
 */
export function classifySvgIcon(source: string): IconVerdict {
  const { document } = parseHTML(`<!doctype html><body>${source}</body>`);
  const svg = document.querySelector("svg");
  if (!svg) return { shape: "unknown", reason: "no <svg> root found" };

  const canvas = canvasOf(svg);
  if (!canvas) return { shape: "unknown", reason: "no viewBox or width/height to measure against" };

  const first = firstPaintedElement(svg);
  if (!first) return { shape: "unknown", reason: "no painted element found" };

  const tag = first.tagName.toLowerCase();

  if (tag === "rect") {
    const w = num(first, "width");
    const h = num(first, "height");
    if (
      w !== null &&
      h !== null &&
      w >= canvas.w * FULL_BLEED_RATIO &&
      h >= canvas.h * FULL_BLEED_RATIO
    ) {
      const rounded = num(first, "rx");
      return {
        shape: "badge",
        reason: `first painted element is a full-bleed ${rounded ? "rounded " : ""}rect (${w}x${h} of ${canvas.w}x${canvas.h})`,
      };
    }
  }

  if (tag === "circle") {
    const r = num(first, "r");
    if (r !== null && r * 2 >= Math.min(canvas.w, canvas.h) * FULL_BLEED_RATIO) {
      return {
        shape: "badge",
        reason: `first painted element is a full-bleed circle (r=${r} of ${canvas.w}x${canvas.h})`,
      };
    }
  }

  return { shape: "bare-mark", reason: `first painted element is <${tag}> with margins` };
}

/** Alpha at or above this counts as opaque. */
const OPAQUE_ALPHA = 250;
/** How many of the four edge midpoints must be opaque before the drawing carries a backdrop. */
const BACKDROP_EDGE_HITS = 3;
/** Sampling grid. Small on purpose — this is a shape question, not an image-quality one. */
const SAMPLE_EDGE = 32;

/**
 * Classify a raster icon by sampling the MIDPOINT OF EACH EDGE.
 *
 * Corners alone are not enough, and getting that wrong is the whole trap: a disc badge on a
 * transparent canvas has four transparent corners and would read as a bare mark. Its edge
 * midpoints are opaque, because a full-bleed disc touches the middle of every side, and so are
 * a square badge's. A mark with margins has neither.
 *
 * ponytail: a bare mark drawn hard to the edges would read as a badge. Accepted — icon artwork
 * effectively always carries padding, and the fix would be a real alpha bounding box.
 */
export async function classifyRasterIcon(buffer: Buffer): Promise<IconVerdict> {
  let data: Buffer;
  let channels: number;
  try {
    const raw = await sharp(buffer)
      .resize(SAMPLE_EDGE, SAMPLE_EDGE, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    data = raw.data;
    channels = raw.info.channels;
  } catch {
    // .ico is the common case here: libvips ships no decoder for it.
    return { shape: "unknown", reason: "image format could not be decoded for inspection" };
  }

  const last = SAMPLE_EDGE - 1;
  const mid = SAMPLE_EDGE >> 1;
  const alphaAt = (x: number, y: number): number => data[(y * SAMPLE_EDGE + x) * channels + 3] ?? 0;
  const edgeMidpoints = [alphaAt(mid, 0), alphaAt(mid, last), alphaAt(0, mid), alphaAt(last, mid)];
  const opaqueEdges = edgeMidpoints.filter((a) => a >= OPAQUE_ALPHA).length;

  return opaqueEdges >= BACKDROP_EDGE_HITS
    ? {
        shape: "badge",
        reason: `${opaqueEdges} of 4 edge midpoints are opaque, so the drawing carries a backdrop`,
      }
    : {
        shape: "bare-mark",
        reason: `${opaqueEdges} of 4 edge midpoints are opaque, so the drawing has transparent margins`,
      };
}

/** Classify a downloaded icon by its bytes. `ext` selects the inspection, e.g. ".svg". */
export async function classifyIcon(buffer: Buffer, ext: string): Promise<IconVerdict> {
  return ext.toLowerCase() === ".svg"
    ? classifySvgIcon(buffer.toString("utf-8"))
    : classifyRasterIcon(buffer);
}
