// FROST: headline outlines as THREE.Shape[] in world units, from a TTF via opentype.js (kerning applied),
// so a headline goes through exactly the same extrusion / bevel / corner rounding / SDF voxelisation as the
// SVG mark (shape/logo.ts extrudeShapes + voxelize).
import * as THREE from "three/webgpu";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import opentype from "opentype.js";

export type Typeface = opentype.Font;

const fonts = new Map<string, Promise<Typeface>>();
export function loadTypeface(url: string): Promise<Typeface> {
  let p = fonts.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`typeface: ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => opentype.parse(buf));
    fonts.set(url, p);
  }
  return p;
}

/** Advance width of one line in world units for font size 1 (one em = 1). */
export function lineWidth(font: Typeface, line: string, letterSpacing = 0) {
  return font.getAdvanceWidth(line, 1, { kerning: true, letterSpacing } as any);
}

/**
 * `lines` set at `size` (em in world units), every line centred, stacked `lineHeight` ems apart, the block
 * centred on the origin (cap height centred on y = 0 for a single line). Returns shapes with holes resolved.
 */
export function textShapes(
  font: Typeface,
  lines: string[],
  size: number,
  lineHeight: number,
  letterSpacing = 0,
): THREE.Shape[] {
  const scale = size / font.unitsPerEm;
  const capHeight = ((font.tables as any)?.os2?.sCapHeight ?? font.ascender * 0.72) * scale;
  const step = lineHeight * size;
  const blockH = step * (lines.length - 1) + capHeight;
  const shapes: THREE.Shape[] = [];
  lines.forEach((line, i) => {
    const w = font.getAdvanceWidth(line, size, { kerning: true, letterSpacing } as any);
    const baseline = blockH / 2 - capHeight - i * step;
    const path = font.getPath(line, -w / 2, 0, size, { kerning: true, letterSpacing } as any);
    const sp = new THREE.ShapePath();
    // opentype paths are y-down: flip into the y-up object space
    const Y = (y: number) => baseline - y;
    for (const c of path.commands) {
      if (c.type === "M") sp.moveTo(c.x, Y(c.y));
      else if (c.type === "L") sp.lineTo(c.x, Y(c.y));
      else if (c.type === "Q") sp.quadraticCurveTo(c.x1, Y(c.y1), c.x, Y(c.y));
      else if (c.type === "C") sp.bezierCurveTo(c.x1, Y(c.y1), c.x2, Y(c.y2), c.x, Y(c.y));
      else if (c.type === "Z") sp.currentPath?.closePath();
    }
    shapes.push(...SVGLoader.createShapes(sp as any));
  });
  return shapes;
}
