import { describe, expect, it } from "vitest";

import { detectRotationPivotDrift } from "./checkPipeline.js";
import type { RotationSample } from "./checkTypes.js";

const CANVAS = { width: 1000, height: 1000 };

/** AABB of an unrotated (elemW×elemH) box after CSS rotation — mirrors the detector model. */
function rotatedAabb(elemW: number, elemH: number, angleDeg: number): { w: number; h: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const cosAbs = Math.abs(Math.cos(rad));
  const sinAbs = Math.abs(Math.sin(rad));
  return { w: elemW * cosAbs + elemH * sinAbs, h: elemW * sinAbs + elemH * cosAbs };
}

/** One rotation sample; defaults describe a large square. */
function sample(overrides: Partial<RotationSample> = {}): RotationSample {
  return { time: 0, selector: "#spokes", cx: 250, cy: 250, w: 200, h: 200, angle: 0, ...overrides };
}

/** Rigid rectangle sample: AABB is derived from unrotated size + angle. */
function rigidSample(
  elemW: number,
  elemH: number,
  overrides: Partial<RotationSample> & { angle: number },
): RotationSample {
  return sample({ ...rotatedAabb(elemW, elemH, overrides.angle), ...overrides });
}

/** A group that SHOULD fire: rigid square spin with bbox center traveling 50px. */
function driftingSpinner(): RotationSample[] {
  return [
    rigidSample(200, 200, { time: 0, angle: 0, cx: 250, cy: 250 }),
    rigidSample(200, 200, { time: 1, angle: 90, cx: 250, cy: 280 }),
    rigidSample(200, 200, { time: 2, angle: 180, cx: 250, cy: 300 }),
  ];
}

describe("detectRotationPivotDrift", () => {
  it("fires on a spinning, size-stable element whose bbox center drifts past threshold", () => {
    const findings = detectRotationPivotDrift(driftingSpinner(), CANVAS);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f?.code).toBe("rotation_pivot_drift");
    expect(f?.severity).toBe("warning");
    expect(f?.selector).toBe("#spokes");
    expect(f?.message).toContain("50px");
    expect(f?.fixHint).toContain("transformOrigin");
  });

  // Stage 1 — sample count.
  it("does not fire with fewer than the minimum samples", () => {
    const group = driftingSpinner().slice(0, 2);
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(0);
  });

  // Stage 2 — real spin. A translating-but-not-spinning element is not our bug.
  it("does not fire when the element barely rotates (fixed tilt, not spinning)", () => {
    const group = [
      rigidSample(200, 200, { time: 0, angle: 0, cx: 250, cy: 250 }),
      rigidSample(200, 200, { time: 1, angle: 2, cx: 250, cy: 280 }),
      rigidSample(200, 200, { time: 2, angle: 4, cx: 250, cy: 300 }),
    ];
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(0);
  });

  // Stage 3 — size stability, WIDTH axis (scale/entrance, not pivot drift).
  it("does not fire when width scales across samples", () => {
    const group = [
      sample({ time: 0, angle: 0, w: 100, h: 200, cx: 250, cy: 250 }),
      sample({ time: 1, angle: 90, w: 200, h: 200, cx: 250, cy: 280 }),
      sample({ time: 2, angle: 180, w: 300, h: 200, cx: 250, cy: 300 }),
    ];
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(0);
  });

  // Stage 3 — single-axis scale: fixed width + growing height moves the AABB center without a bad pivot.
  it("does not fire when height scales (top-anchored) even though the AABB center moves", () => {
    const group = [
      sample({ time: 0, angle: 0, w: 100, h: 50, cx: 250, cy: 125 }),
      sample({ time: 1, angle: 90, w: 100, h: 100, cx: 250, cy: 150 }),
      sample({ time: 2, angle: 180, w: 100, h: 150, cx: 250, cy: 175 }),
    ];
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(0);
  });

  // Elongated rotators: every AABB fits one 400×80 rectangle; center drifts → fire.
  it("fires on an elongated spinner whose long side is stable but per-axis AABB swings", () => {
    const group = [
      rigidSample(400, 80, { time: 0, angle: 0, cx: 250, cy: 250 }),
      rigidSample(400, 80, { time: 1, angle: 45, cx: 250, cy: 310 }),
      rigidSample(400, 80, { time: 2, angle: 90, cx: 250, cy: 370 }),
    ];
    const findings = detectRotationPivotDrift(group, CANVAS);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("rotation_pivot_drift");
  });

  // Partial arc with no 90° pair: still one rigid 400×80 rectangle across 0°→20°→40°.
  it("fires on a rigid elongated partial arc without a 90-degree sample pair", () => {
    const group = [
      rigidSample(400, 80, { time: 0, angle: 0, cx: 250, cy: 250 }),
      rigidSample(400, 80, { time: 1, angle: 20, cx: 250, cy: 310 }),
      rigidSample(400, 80, { time: 2, angle: 40, cx: 250, cy: 370 }),
    ];
    const findings = detectRotationPivotDrift(group, CANVAS);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("rotation_pivot_drift");
  });

  // All samples singular (|cos2θ|<0.15): no invertible estimator — near-square AABB agreement is the fallback.
  it("fires on a rigid elongated spin sampled only at singular 45-degree-class phases", () => {
    const group = [
      rigidSample(400, 80, { time: 0, angle: 45, cx: 250, cy: 250 }),
      rigidSample(400, 80, { time: 1, angle: 135, cx: 250, cy: 310 }),
      rigidSample(400, 80, { time: 2, angle: 225, cx: 250, cy: 370 }),
    ];
    const findings = detectRotationPivotDrift(group, CANVAS);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("rotation_pivot_drift");
    expect(findings[0]?.message).toContain("120px");
  });

  // Two-axis scale/entrance: AABBs are not one rotated rectangle.
  it("does not fire on two-axis scale/entrance that shrinks the long side while growing the short", () => {
    const group = [
      sample({ time: 0, angle: 0, w: 400, h: 100, cx: 200, cy: 50 }),
      sample({ time: 1, angle: 45, w: 340, h: 200, cx: 170, cy: 100 }),
      sample({ time: 2, angle: 90, w: 300, h: 300, cx: 150, cy: 150 }),
    ];
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(0);
  });

  // Scale pulse returns to the start size mid-trajectory — still not one rigid rectangle.
  it("does not fire on a scale pulse that returns to the start AABB", () => {
    const group = [
      sample({ time: 0, angle: 0, w: 400, h: 100, cx: 200, cy: 50 }),
      sample({ time: 1, angle: 45, w: 340, h: 300, cx: 170, cy: 150 }),
      sample({ time: 2, angle: 90, w: 400, h: 100, cx: 200, cy: 50 }),
    ];
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(0);
  });

  // One valid 90° swap then a later scale — must not over-admit via pairwise swap.
  it("does not fire when an early axis-swap is followed by a non-rigid scale sample", () => {
    const group = [
      sample({ time: 0, angle: 0, w: 400, h: 100, cx: 200, cy: 50 }),
      sample({ time: 1, angle: 90, w: 100, h: 400, cx: 150, cy: 150 }),
      sample({ time: 2, angle: 180, w: 400, h: 300, cx: 200, cy: 250 }),
    ];
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(0);
  });

  it("does not fire when a sample has a degenerate zero dimension", () => {
    const group = driftingSpinner().map((s, i) => (i === 0 ? { ...s, w: 0 } : s));
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(0);
  });

  // Stage 4 — sizable. Tiny decorative spinners are ignored (area < 2500px²).
  it("does not fire on a tiny element below the median-area floor", () => {
    const group = [
      rigidSample(40, 40, { time: 0, angle: 0, cx: 250, cy: 250 }),
      rigidSample(40, 40, { time: 1, angle: 90, cx: 250, cy: 280 }),
      rigidSample(40, 40, { time: 2, angle: 180, cx: 250, cy: 300 }),
    ];
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(0);
  });

  // Stage 5 — center drift. A correctly-centered spinner holds its bbox center.
  it("does not fire on a spinner whose bbox center stays put", () => {
    const group = [
      rigidSample(200, 200, { time: 0, angle: 0 }),
      rigidSample(200, 200, { time: 1, angle: 120 }),
      rigidSample(200, 200, { time: 2, angle: 240 }),
    ];
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(0);
  });

  it("uses the viewport floor when the element is small relative to a large canvas", () => {
    // medianSize≈200 → sizeFloor=20; viewportFloor on a 3000px canvas = 60.
    // A 40px drift is below 60 → clean; the same group fired on CANVAS above.
    const group = [
      rigidSample(200, 200, { time: 0, angle: 0, cx: 250, cy: 250 }),
      rigidSample(200, 200, { time: 1, angle: 90, cx: 250, cy: 270 }),
      rigidSample(200, 200, { time: 2, angle: 180, cx: 250, cy: 290 }),
    ];
    expect(detectRotationPivotDrift(group, { width: 3000, height: 3000 })).toHaveLength(0);
  });

  it("reports each drifting selector independently and leaves clean ones alone", () => {
    const clean = driftingSpinner().map((s) => ({ ...s, selector: "#hub", cx: 500, cy: 500 }));
    const findings = detectRotationPivotDrift([...driftingSpinner(), ...clean], CANVAS);
    expect(findings.map((f) => f.selector)).toEqual(["#spokes"]);
  });

  // Wrap-aware angle spread across the ±180° discontinuity. A wobble between
  // -175° and 175° is ~10° of travel, not ~350°; naive abs-diff would misread it
  // as a fast spin and (with a drifting center) fire falsely.
  it("does not treat a ±180° boundary wobble as spinning", () => {
    const group = [
      rigidSample(200, 200, { time: 0, angle: -175, cx: 250, cy: 250 }),
      rigidSample(200, 200, { time: 1, angle: 175, cx: 250, cy: 280 }),
      rigidSample(200, 200, { time: 2, angle: -172, cx: 250, cy: 300 }),
    ];
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(0);
  });

  it("still detects a real spin that crosses the ±180° boundary", () => {
    // 170° → -100° → -10° is ~270° of genuine travel across the seam.
    const group = [
      rigidSample(200, 200, { time: 0, angle: 170, cx: 250, cy: 250 }),
      rigidSample(200, 200, { time: 1, angle: -100, cx: 250, cy: 280 }),
      rigidSample(200, 200, { time: 2, angle: -10, cx: 250, cy: 300 }),
    ];
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(1);
  });

  it("returns nothing for an empty sample set", () => {
    expect(detectRotationPivotDrift([], CANVAS)).toHaveLength(0);
  });
});
