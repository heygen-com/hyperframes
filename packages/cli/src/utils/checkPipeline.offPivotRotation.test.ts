import { describe, expect, it } from "vitest";

import { detectOffPivotRotation } from "./checkPipeline.js";
import type { OffPivotRotationSample } from "./checkTypes.js";

/** One needle sample; defaults describe a sizable pointer on a hub at (500,500). */
function sample(overrides: Partial<OffPivotRotationSample> = {}): OffPivotRotationSample {
  return {
    time: 0,
    selector: "#needle",
    ax: 0,
    ay: 0,
    bx: 0,
    by: 0,
    len: 200,
    angle: 0,
    hx: 500,
    hy: 500,
    hr: 220,
    hubCount: 3,
    ...overrides,
  };
}

/** Endpoint positions on a circle of `radius` about `(cx,cy)` at 0/90/180°. */
function orbit(cx: number, cy: number, radius: number): Array<[number, number]> {
  return [
    [cx + radius, cy],
    [cx, cy + radius],
    [cx - radius, cy],
  ];
}

/** A group that SHOULD fire: the pointer sweeps (0→90→180) about a recovered
 * center at (500,300) — 200px above the dial hub at (500,500). Two material
 * endpoints trace concentric circles about that wrong center. */
function offPivotIndicator(selector = "#needle"): OffPivotRotationSample[] {
  const a = orbit(500, 300, 100);
  const b = orbit(500, 300, 40);
  return [0, 1, 2].map((i) =>
    sample({
      selector,
      time: i,
      angle: i * 90,
      ax: a[i]?.[0] ?? 0,
      ay: a[i]?.[1] ?? 0,
      bx: b[i]?.[0] ?? 0,
      by: b[i]?.[1] ?? 0,
    }),
  );
}

describe("detectOffPivotRotation", () => {
  it("fires when the recovered center-of-rotation is far from the dial hub", () => {
    const findings = detectOffPivotRotation(offPivotIndicator());
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f?.code).toBe("off_pivot_rotation");
    expect(f?.severity).toBe("warning");
    expect(f?.selector).toBe("#needle");
    expect(f?.message).toContain("200px");
    expect(f?.fixHint).toContain("hub");
  });

  it("does not fire with fewer than the minimum samples", () => {
    expect(detectOffPivotRotation(offPivotIndicator().slice(0, 2))).toHaveLength(0);
  });

  it("does not fire when the pointer barely sweeps (fixed tilt)", () => {
    const group = offPivotIndicator().map((s, i) => ({ ...s, angle: i * 3 }));
    expect(detectOffPivotRotation(group)).toHaveLength(0);
  });

  it("does not fire when no dial hub is resolvable", () => {
    const group = offPivotIndicator().map((s) => ({ ...s, hx: null, hy: null, hubCount: 0 }));
    expect(detectOffPivotRotation(group)).toHaveLength(0);
  });

  it("does not fire when the hub has too few concentric circles", () => {
    const group = offPivotIndicator().map((s) => ({ ...s, hubCount: 1 }));
    expect(detectOffPivotRotation(group)).toHaveLength(0);
  });

  it("does not fire on a correctly-hubbed needle (center-of-rotation on the hub)", () => {
    const a = orbit(500, 500, 100);
    const b = orbit(500, 500, 40);
    const group = [0, 1, 2].map((i) =>
      sample({
        time: i,
        angle: i * 90,
        ax: a[i]?.[0] ?? 0,
        ay: a[i]?.[1] ?? 0,
        bx: b[i]?.[0] ?? 0,
        by: b[i]?.[1] ?? 0,
      }),
    );
    expect(detectOffPivotRotation(group)).toHaveLength(0);
  });

  it("does not fire when the endpoint trajectory is not a clean circle", () => {
    const group = [
      sample({ time: 0, angle: 0, ax: 600, ay: 300, bx: 540, by: 300 }),
      sample({ time: 1, angle: 90, ax: 505, ay: 402, bx: 500, by: 341 }),
      sample({ time: 2, angle: 180, ax: 402, ay: 305, bx: 461, by: 299 }),
    ].map((s) => ({ ...s, ax: s.ax + (s.time === 1 ? 180 : 0) }));
    expect(detectOffPivotRotation(group)).toHaveLength(0);
  });

  it("collapses nested candidates on the same hub to a single finding", () => {
    const group = offPivotIndicator().map((s) => ({ ...s, len: 200 }));
    const child = offPivotIndicator("#needle > path:nth-of-type(1)").map((s) => ({
      ...s,
      len: 150,
    }));
    const findings = detectOffPivotRotation([...group, ...child]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.selector).toBe("#needle");
  });

  it("returns nothing for an empty sample set", () => {
    expect(detectOffPivotRotation([])).toHaveLength(0);
  });
});
