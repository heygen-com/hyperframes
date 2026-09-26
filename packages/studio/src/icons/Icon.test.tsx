import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Icon, strokeWidthFor } from "./Icon";
import { GLYPHS, ICON_NAMES } from "./glyphs";
import * as named from "./index";

const NUMBER = /-?\d*\.?\d+/g;
const ARGS: Record<string, number> = { m: 2, l: 2, t: 2, h: 1, v: 1, c: 6, s: 4, q: 4, a: 7, z: 0 };

type Pen = { x: number; y: number; sx: number; sy: number };

// One command's points as x,y pairs before resolving relative offsets.
function segmentPairs(k: string, seg: number[], pen: Pen, rel: boolean): number[] {
  if (k === "a") return [seg[5], seg[6]];
  if (k === "h") return [seg[0], rel ? 0 : pen.y];
  if (k === "v") return [rel ? 0 : pen.x, seg[0]];
  return seg;
}

function resolvePairs(pairs: number[], pen: Pen, rel: boolean): number[] {
  return rel ? pairs.map((v, i) => (i % 2 ? pen.y : pen.x) + v) : pairs;
}

function advance(k: string, pts: number[], pen: Pen): void {
  pen.x = pts[pts.length - 2];
  pen.y = pts[pts.length - 1];
  if (k === "m") [pen.sx, pen.sy] = [pen.x, pen.y];
}

// Every point a path visits (anchors and control points), relative commands
// resolved against the current point; arcs contribute their end points.
function pathPoints(d: string): number[] {
  const out: number[] = [];
  const pen: Pen = { x: 0, y: 0, sx: 0, sy: 0 };
  for (const [, cmd, body] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const k = cmd.toLowerCase();
    const n = ARGS[k];
    const nums = (body.match(NUMBER) ?? []).map(Number);
    if (k === "z") [pen.x, pen.y] = [pen.sx, pen.sy];
    for (let i = 0; n > 0 && i + n <= nums.length; i += n) {
      const pts = resolvePairs(
        segmentPairs(k, nums.slice(i, i + n), pen, cmd === k),
        pen,
        cmd === k,
      );
      out.push(...pts);
      advance(k, pts, pen);
    }
  }
  return out;
}

function primitiveBox(shape: string): number[] {
  const [x, y, a, b] = shape.split(" ").slice(1).map(Number);
  return shape.startsWith("c") || shape.startsWith("d")
    ? [x - a, y - a, x + a, y + a]
    : [x, y, x + a, y + b];
}

describe("studio icon set", () => {
  it("has a named export for every glyph and nothing else", () => {
    const pascal = (n: string) =>
      n
        .split("-")
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join("") + "Icon";
    for (const name of ICON_NAMES) {
      expect(typeof named[pascal(name) as keyof typeof named]).toBe("function");
    }
    const extra = Object.keys(named).filter((k) => !k.endsWith("Icon") || k === "Icon");
    expect(extra.sort()).toEqual(["GLYPHS", "ICON_NAMES", "Icon", "strokeWidthFor"]);
  });

  it("resolves relative path commands when checking the margin", () => {
    expect(pathPoints("M8 8h-8")).toEqual([8, 8, 0, 8]);
    expect(pathPoints("M8 8v9")).toEqual([8, 8, 8, 17]);
    expect(pathPoints("M2 2l1 1c1 1 2 2 3 3z")).toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
    expect(pathPoints("M2 2a1 1 0 0 1 3 3")).toEqual([2, 2, 5, 5]);
  });

  it.each(ICON_NAMES)("%s renders in currentColor on the 16 grid", (name) => {
    const html = renderToStaticMarkup(<Icon name={name} />);
    expect(html).toContain('viewBox="0 0 16 16"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).not.toMatch(/#[0-9a-f]{3,8}|rgb\(/i);
    expect(html).toContain('aria-hidden="true"');
  });

  it("announces itself only when given a title", () => {
    const html = renderToStaticMarkup(<Icon name="check" title="Done" />);
    expect(html).toContain("<title>Done</title>");
    expect(html).toContain('role="img"');
    expect(html).not.toContain("aria-hidden");
  });

  it("paints solid only for silhouettes", () => {
    expect(renderToStaticMarkup(<Icon name="keyframe" filled />)).toContain('fill="currentColor"');
    expect(renderToStaticMarkup(<Icon name="undo" filled />)).toContain('fill="none"');
    expect(renderToStaticMarkup(<Icon name="caret-down" />)).toContain('fill="currentColor"');
  });

  it("draws the small variant below 14 px", () => {
    expect(renderToStaticMarkup(<Icon name="file-code" size={12} />)).not.toContain(
      "M9.5 2v3.5H13",
    );
    expect(renderToStaticMarkup(<Icon name="file-code" size={14} />)).toContain("M9.5 2v3.5H13");
  });

  it("picks the stroke by size class", () => {
    expect(strokeWidthFor(12)).toBe(1.25);
    expect(strokeWidthFor(13)).toBe(1.25);
    expect(strokeWidthFor(14)).toBe(1.5);
    expect(strokeWidthFor("20px")).toBe(1.5);
    expect(renderToStaticMarkup(<Icon name="x" size={12} />)).toContain('stroke-width="1.25"');
  });
});

describe("studio icon set safe margin", () => {
  it.each(ICON_NAMES)("%s stays inside the 1 px safe margin", (name) => {
    const glyph = GLYPHS[name] as { shapes: readonly string[]; small?: readonly string[] };
    for (const shape of [...glyph.shapes, ...(glyph.small ?? [])]) {
      const points = /^[Mm]/.test(shape) ? pathPoints(shape) : primitiveBox(shape);
      for (const v of points) {
        expect(v, `${name}: ${shape}`).toBeGreaterThanOrEqual(1);
        expect(v, `${name}: ${shape}`).toBeLessThanOrEqual(15);
      }
    }
  });
});
