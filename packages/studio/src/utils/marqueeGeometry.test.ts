import { describe, expect, it } from "vitest";
import { marqueeIntersectsObb, rectsOverlap, type Point, type Rect } from "./marqueeGeometry";

type Corners = [Point, Point, Point, Point];

function rotateCorners(cx: number, cy: number, w: number, h: number, deg: number): Corners {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = w / 2;
  const hh = h / 2;
  const local: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  return local.map(([lx, ly]) => ({
    x: cx + cos * lx - sin * ly,
    y: cy + sin * lx + cos * ly,
  })) as Corners;
}

function aabbCorners(r: Rect): Corners {
  return [
    { x: r.left, y: r.top },
    { x: r.left + r.width, y: r.top },
    { x: r.left + r.width, y: r.top + r.height },
    { x: r.left, y: r.top + r.height },
  ];
}

describe("rectsOverlap", () => {
  it("overlapping rects", () => {
    expect(
      rectsOverlap(
        { left: 0, top: 0, width: 10, height: 10 },
        { left: 5, top: 5, width: 10, height: 10 },
      ),
    ).toBe(true);
  });

  it("non-overlapping rects", () => {
    expect(
      rectsOverlap(
        { left: 0, top: 0, width: 10, height: 10 },
        { left: 20, top: 20, width: 10, height: 10 },
      ),
    ).toBe(false);
  });
});

describe("marqueeIntersectsObb", () => {
  it("axis-aligned overlap", () => {
    const marquee: Rect = { left: 0, top: 0, width: 100, height: 100 };
    const corners = aabbCorners({ left: 50, top: 50, width: 80, height: 80 });
    expect(marqueeIntersectsObb(marquee, corners)).toBe(true);
  });

  it("axis-aligned no overlap", () => {
    const marquee: Rect = { left: 0, top: 0, width: 50, height: 50 };
    const corners = aabbCorners({ left: 100, top: 100, width: 50, height: 50 });
    expect(marqueeIntersectsObb(marquee, corners)).toBe(false);
  });

  it("marquee fully contains element", () => {
    const marquee: Rect = { left: 0, top: 0, width: 200, height: 200 };
    const corners = aabbCorners({ left: 50, top: 50, width: 20, height: 20 });
    expect(marqueeIntersectsObb(marquee, corners)).toBe(true);
  });

  it("element fully contains marquee", () => {
    const marquee: Rect = { left: 50, top: 50, width: 10, height: 10 };
    const corners = aabbCorners({ left: 0, top: 0, width: 200, height: 200 });
    expect(marqueeIntersectsObb(marquee, corners)).toBe(true);
  });

  it("45-degree rotated square: AABB overlaps but OBB does not", () => {
    // 100x100 square rotated 45° centered at (200,200)
    // Its AABB extends to ~(129,129)-(271,271)
    // A marquee at (0,0)-(135,135) overlaps the AABB but NOT the diamond
    const corners = rotateCorners(200, 200, 100, 100, 45);
    const marquee: Rect = { left: 0, top: 0, width: 135, height: 135 };
    expect(marqueeIntersectsObb(marquee, corners)).toBe(false);
  });

  it("45-degree rotated square: OBB overlaps", () => {
    // Same rotated square, marquee reaches the diamond's left point
    const corners = rotateCorners(200, 200, 100, 100, 45);
    const marquee: Rect = { left: 0, top: 150, width: 155, height: 100 };
    expect(marqueeIntersectsObb(marquee, corners)).toBe(true);
  });

  it("zero-width marquee returns false", () => {
    const corners = aabbCorners({ left: 0, top: 0, width: 100, height: 100 });
    expect(marqueeIntersectsObb({ left: 50, top: 50, width: 0, height: 50 }, corners)).toBe(false);
  });

  it("zero-area element returns false for degenerate OBB", () => {
    const corners: Corners = [
      { x: 50, y: 50 },
      { x: 50, y: 50 },
      { x: 50, y: 50 },
      { x: 50, y: 50 },
    ];
    const marquee: Rect = { left: 0, top: 0, width: 100, height: 100 };
    // Degenerate point — SAT still works (projections are zero-length intervals)
    // A point inside the marquee should still intersect
    expect(marqueeIntersectsObb(marquee, corners)).toBe(true);
  });

  it("30-degree rotated rectangle clips marquee corner", () => {
    const corners = rotateCorners(150, 150, 200, 50, 30);
    const marquee: Rect = { left: 0, top: 0, width: 80, height: 130 };
    expect(marqueeIntersectsObb(marquee, corners)).toBe(true);
  });

  it("30-degree rotated rectangle misses marquee", () => {
    const corners = rotateCorners(300, 300, 50, 50, 30);
    const marquee: Rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(marqueeIntersectsObb(marquee, corners)).toBe(false);
  });
});
