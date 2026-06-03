import { describe, it, expect } from "vitest";
import { generateSpringEaseData, SPRING_PRESETS } from "./springEase";

/** Parse an SVG-path CustomEase string into {x, y} pairs. */
function parsePairs(data: string): { x: number; y: number }[] {
  // Strip "M0,0 L" prefix, then split on whitespace between coordinate pairs
  const body = data.replace(/^M0,0\s+L/, "");
  const tokens = body.split(/\s+/);
  return [
    { x: 0, y: 0 }, // from M0,0
    ...tokens.map((tok) => {
      const [xStr, yStr] = tok.split(",");
      return { x: Number(xStr), y: Number(yStr) };
    }),
  ];
}

describe("generateSpringEaseData", () => {
  it("generates a valid SVG-path CustomEase data string", () => {
    const data = generateSpringEaseData(1, 180, 12);
    expect(typeof data).toBe("string");
    // Must start with M0,0 (SVG moveTo)
    expect(data.startsWith("M0,0")).toBe(true);
    // Must contain L (lineTo) segments
    expect(data).toContain(" L");
    const pairs = parsePairs(data);
    expect(pairs.length).toBeGreaterThan(10);
    // First point at origin, last at (1,1)
    expect(pairs[0]).toEqual({ x: 0, y: 0 });
    expect(pairs[pairs.length - 1]).toEqual({ x: 1, y: 1 });
  });

  it("underdamped spring produces overshoot", () => {
    const data = generateSpringEaseData(1, 180, 8); // low damping = bouncy
    const pairs = parsePairs(data);
    const hasOvershoot = pairs.some((p) => p.y > 1.01);
    expect(hasOvershoot).toBe(true);
  });

  it("critically damped spring has no overshoot", () => {
    const mass = 1;
    const stiffness = 100;
    const criticalDamping = 2 * Math.sqrt(stiffness * mass); // zeta = 1
    const data = generateSpringEaseData(mass, stiffness, criticalDamping);
    const pairs = parsePairs(data);
    const maxY = Math.max(...pairs.map((p) => p.y));
    expect(maxY).toBeLessThanOrEqual(1.005);
  });

  it("overdamped spring has no overshoot and monotonically increases", () => {
    // zeta > 1 — heavy damping
    const data = generateSpringEaseData(1, 100, 30);
    const pairs = parsePairs(data);
    const maxY = Math.max(...pairs.map((p) => p.y));
    expect(maxY).toBeLessThanOrEqual(1.005);
    // Monotonically non-decreasing (within floating point tolerance)
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i].y).toBeGreaterThanOrEqual(pairs[i - 1].y - 0.001);
    }
  });

  it("all presets generate valid data", () => {
    for (const preset of SPRING_PRESETS) {
      const data = generateSpringEaseData(preset.mass, preset.stiffness, preset.damping);
      expect(data.length).toBeGreaterThan(0);
      expect(data.startsWith("M0,0")).toBe(true);
      const pairs = parsePairs(data);
      expect(pairs.length).toBeGreaterThan(50);
    }
  });

  it("output x values span [0,1] monotonically", () => {
    const data = generateSpringEaseData(1, 180, 12);
    const pairs = parsePairs(data);
    expect(pairs[0].x).toBe(0);
    expect(pairs[pairs.length - 1].x).toBe(1);
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i].x).toBeGreaterThan(pairs[i - 1].x - 0.0001);
      expect(pairs[i].x).toBeLessThanOrEqual(1);
    }
  });

  it("respects custom step count", () => {
    const data = generateSpringEaseData(1, 100, 15, 60);
    const pairs = parsePairs(data);
    // 60 steps + the M0,0 origin = 61 points
    expect(pairs.length).toBe(61);
  });
});
