import { describe, expect, it } from "vitest";
import type { MoverFrame } from "./composite";
import { planFilter } from "./filterPlan";
import { type Affine, IDENTITY, translate } from "./pose";

const mat = (a: number, b: number, c: number, d: number, e: number, f: number): Affine => ({
  a,
  b,
  c,
  d,
  e,
  f,
});
const rot = (deg: number, e = 0, f = 0): Affine => {
  const r = (deg * Math.PI) / 180;
  return mat(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), e, f);
};
const frame = (now: Affine, taps: Affine[], w = 100, h = 50): MoverFrame => ({ w, h, now, taps });
const slide = (from: number, to: number, n = 32, scale = 1): Affine[] =>
  Array.from({ length: n }, (_, k) =>
    mat(scale, 0, 0, scale, from + ((to - from) * k) / (n - 1), 0),
  );
/** Turned by `deg` about the middle of a w x h box whose middle is at (cx, cy). */
const spin = (deg: number, cx: number, cy: number, w: number, h: number): Affine => {
  const m = rot(deg);
  return { ...m, e: cx - (m.a * w) / 2 - (m.c * h) / 2, f: cy - (m.b * w) / 2 - (m.d * h) / 2 };
};

describe("planFilter", () => {
  it("turns a slide into one offset per tap, centred on where the element is", () => {
    const plan = planFilter(frame(translate(IDENTITY, 100, 0), slide(50, 150)), 0, 1920);
    expect(plan?.offsets).toHaveLength(32);
    expect(plan?.offsets[0]?.[0]).toBeCloseTo(-50, 5);
    expect(plan?.offsets[31]?.[0]).toBeCloseTo(50, 5);
    expect(plan?.offsets.every(([, y]) => Math.abs(y) < 1e-9)).toBe(true);
  });

  it("takes the offsets back through the element's own scale", () => {
    const plan = planFilter(frame(mat(2, 0, 0, 2, 100, 0), slide(50, 150, 32, 2)), 0, 1920);
    expect(plan?.offsets[0]?.[0]).toBeCloseTo(-25, 5);
  });

  it("softens along the motion only, not across it", () => {
    const plan = planFilter(frame(translate(IDENTITY, 100, 0), slide(50, 150)), 0, 1920);
    const [sx, sy] = plan?.sigma ?? [0, 0];
    expect(sx).toBeGreaterThan(0.5);
    expect(sy).toBeLessThan(1e-9);
  });

  it("softens a turn on the spot, with no offsets", () => {
    const taps = [-6, -2, 2, 6].map((d) => spin(108 + d, 140, 80, 80, 80));
    const plan = planFilter(frame(spin(108, 140, 80, 80, 80), taps, 80, 80), 0, 1920);
    expect(plan?.offsets.every(([x, y]) => Math.hypot(x, y) < 1e-6)).toBe(true);
    expect(plan?.sigma[0]).toBeGreaterThan(0.5);
    expect(plan?.sigma[1]).toBeGreaterThan(0.5);
  });

  it("covers every copy, the softening and the ink around the box", () => {
    const plan = planFilter(frame(translate(IDENTITY, 100, 0), slide(50, 150)), 20, 1920);
    const r = plan?.region;
    expect(r?.x).toBeLessThanOrEqual(-50 - 20);
    expect((r?.x ?? 0) + (r?.w ?? 0)).toBeGreaterThanOrEqual(100 + 50 + 20);
    expect(r?.y).toBeLessThanOrEqual(-20);
  });

  it("leaves a mover that does not move, and one with a collapsed box", () => {
    expect(planFilter(frame(IDENTITY, slide(0, 0.1)), 0, 1920)).toBeNull();
    expect(planFilter(frame(mat(0, 0, 0, 0, 0, 0), slide(0, 100)), 0, 1920)).toBeNull();
  });
});
