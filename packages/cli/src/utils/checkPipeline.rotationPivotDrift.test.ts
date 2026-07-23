import { describe, expect, it } from "vitest";

import { detectRotationPivotDrift } from "./checkPipeline.js";
import type { RotationSample } from "./checkTypes.js";

const CANVAS = { width: 1000, height: 1000 };

/** One rotation sample; defaults describe a large, size-stable element. */
function sample(overrides: Partial<RotationSample> = {}): RotationSample {
  return { time: 0, selector: "#spokes", cx: 250, cy: 250, w: 200, h: 200, angle: 0, ...overrides };
}

/** A group that SHOULD fire: spins (0→90→180), size-stable, sizable, and its
 * bbox center travels 50px — the wrong-pivot signature. threshold here is
 * max(0.1*200, 0.02*1000) = 20px, so 50px drift clears it. */
function driftingSpinner(): RotationSample[] {
  return [
    sample({ time: 0, angle: 0, cx: 250, cy: 250 }),
    sample({ time: 1, angle: 90, cx: 250, cy: 280 }),
    sample({ time: 2, angle: 180, cx: 250, cy: 300 }),
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
      sample({ time: 0, angle: 0, cx: 250, cy: 250 }),
      sample({ time: 1, angle: 2, cx: 250, cy: 280 }),
      sample({ time: 2, angle: 4, cx: 250, cy: 300 }),
    ];
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(0);
  });

  // Stage 3 — size stability, WIDTH axis (scale/entrance, not pivot drift).
  it("does not fire when width scales across samples", () => {
    const group = [
      sample({ time: 0, angle: 0, w: 100, cx: 250, cy: 250 }),
      sample({ time: 1, angle: 90, w: 200, cx: 250, cy: 280 }),
      sample({ time: 2, angle: 180, w: 300, cx: 250, cy: 300 }),
    ];
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(0);
  });

  // Stage 3 — size stability, HEIGHT axis. Regression for the width-only guard:
  // fixed width, top-anchored height growth (top=100 → cy = 100 + h/2) drifts
  // the AABB center 50px on its own. Must NOT be reported as pivot drift.
  it("does not fire when height scales (top-anchored) even though the AABB center moves", () => {
    const group = [
      sample({ time: 0, angle: 0, w: 100, h: 50, cx: 250, cy: 125 }),
      sample({ time: 1, angle: 90, w: 100, h: 100, cx: 250, cy: 150 }),
      sample({ time: 2, angle: 180, w: 100, h: 150, cx: 250, cy: 175 }),
    ];
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(0);
  });

  it("does not fire when a sample has a degenerate zero dimension", () => {
    const group = driftingSpinner().map((s, i) => (i === 0 ? { ...s, w: 0 } : s));
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(0);
  });

  // Stage 4 — sizable. Tiny decorative spinners are ignored (area < 2500px²).
  it("does not fire on a tiny element below the median-area floor", () => {
    const group = driftingSpinner().map((s) => ({ ...s, w: 40, h: 40 }));
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(0);
  });

  // Stage 5 — center drift. A correctly-centered spinner holds its bbox center.
  it("does not fire on a spinner whose bbox center stays put", () => {
    const group = [
      sample({ time: 0, angle: 0 }),
      sample({ time: 1, angle: 120 }),
      sample({ time: 2, angle: 240 }),
    ];
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(0);
  });

  it("uses the viewport floor when the element is small relative to a large canvas", () => {
    // medianSize=200 → sizeFloor=20; viewportFloor on a 3000px canvas = 60.
    // A 40px drift is below 60 → clean; the same group fired on CANVAS above.
    const group = [
      sample({ time: 0, angle: 0, cx: 250, cy: 250 }),
      sample({ time: 1, angle: 90, cx: 250, cy: 270 }),
      sample({ time: 2, angle: 180, cx: 250, cy: 290 }),
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
      sample({ time: 0, angle: -175, cx: 250, cy: 250 }),
      sample({ time: 1, angle: 175, cx: 250, cy: 280 }),
      sample({ time: 2, angle: -172, cx: 250, cy: 300 }),
    ];
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(0);
  });

  it("still detects a real spin that crosses the ±180° boundary", () => {
    // 170° → -100° → -10° is ~270° of genuine travel across the seam.
    const group = [
      sample({ time: 0, angle: 170, cx: 250, cy: 250 }),
      sample({ time: 1, angle: -100, cx: 250, cy: 280 }),
      sample({ time: 2, angle: -10, cx: 250, cy: 300 }),
    ];
    expect(detectRotationPivotDrift(group, CANVAS)).toHaveLength(1);
  });

  it("returns nothing for an empty sample set", () => {
    expect(detectRotationPivotDrift([], CANVAS)).toHaveLength(0);
  });
});
