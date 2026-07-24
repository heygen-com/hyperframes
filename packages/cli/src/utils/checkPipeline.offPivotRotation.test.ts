import { describe, expect, it } from "vitest";

import { countAngularBodies, detectOffPivotRotation } from "./checkPipeline.js";
import type { OffPivotFrame, OffPivotRotationSample } from "./checkTypes.js";

/** A sample carrying its frame time, for test ergonomics; {@link toFrames}
 * re-hoists the time into the on-the-wire {@link OffPivotFrame} envelope. */
type TimedSample = OffPivotRotationSample & { time: number };

/** One needle sample; defaults describe a sizable pointer on a hub at (500,500). */
function sample(overrides: Partial<TimedSample> = {}): TimedSample {
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

/** Merge per-selector timed samples into the time-hoisted frame envelope the
 * detector consumes (all samples sharing a time land in one frame). */
function toFrames(...groups: TimedSample[][]): OffPivotFrame[] {
  const byTime = new Map<number, OffPivotRotationSample[]>();
  for (const { time, ...rest } of groups.flat()) {
    const frame = byTime.get(time);
    if (frame) frame.push(rest);
    else byTime.set(time, [rest]);
  }
  return [...byTime.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, samples]) => ({ time, samples }));
}

interface SweepOptions {
  /** Center the endpoints actually orbit (the recovered center-of-rotation). */
  cx: number;
  cy: number;
  /** Screen hub the check compares the recovered center against. */
  hx?: number;
  hy?: number;
  selector?: string;
  frames?: number;
  spreadDeg?: number;
  /** Outer/inner material-point radii; both share one angle so the pointer is
   * rigid (constant separation |a-b| = rOuter - rInner). */
  rOuter?: number;
  rInner?: number;
  /** Per-frame inner-radius growth — breaks rigidity (endpoint deformation). */
  innerGrowth?: number;
  hubCount?: number;
}

/** A rigid pointer swept about `(cx,cy)`: two material points on one radial line
 * orbit that center, so their separation is constant (rigid body). */
function sweep(options: SweepOptions): TimedSample[] {
  const {
    cx,
    cy,
    hx = 500,
    hy = 500,
    selector = "#needle",
    frames = 6,
    spreadDeg = 180,
    rOuter = 100,
    rInner = 40,
    innerGrowth = 0,
    hubCount = 3,
  } = options;
  return Array.from({ length: frames }, (_, i) => {
    const deg = frames <= 1 ? 0 : (spreadDeg * i) / (frames - 1);
    const rad = (deg * Math.PI) / 180;
    const inner = rInner + innerGrowth * i;
    const ax = cx + rOuter * Math.cos(rad);
    const ay = cy + rOuter * Math.sin(rad);
    const bx = cx + inner * Math.cos(rad);
    const by = cy + inner * Math.sin(rad);
    return sample({
      selector,
      time: i,
      angle: deg,
      ax,
      ay,
      bx,
      by,
      len: Math.hypot(ax - bx, ay - by),
      hx,
      hy,
      hubCount,
    });
  });
}

describe("detectOffPivotRotation", () => {
  it("fires when the recovered center-of-rotation is far from the dial hub", () => {
    // Rigid pointer orbits (500,300) — 200px above the hub at (500,500).
    const findings = detectOffPivotRotation(toFrames(sweep({ cx: 500, cy: 300 })));
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f?.code).toBe("off_pivot_rotation");
    expect(f?.severity).toBe("warning");
    expect(f?.selector).toBe("#needle");
    expect(f?.message).toContain("200px");
    expect(f?.fixHint).toContain("hub");
  });

  it("does not fire on a correctly-hubbed needle (center-of-rotation on the hub)", () => {
    expect(detectOffPivotRotation(toFrames(sweep({ cx: 500, cy: 500 })))).toHaveLength(0);
  });

  it("does not fire with fewer than the minimum (overdetermined) samples", () => {
    // Blocker-1 core: any 3 non-collinear points fit a circle with ~0 residual,
    // so a 3-sample "clean circle" guard is vacuous. Below 5 samples we refuse.
    expect(detectOffPivotRotation(toFrames(sweep({ cx: 500, cy: 300, frames: 4 })))).toHaveLength(
      0,
    );
    expect(detectOffPivotRotation(toFrames(sweep({ cx: 500, cy: 300, frames: 5 })))).toHaveLength(
      1,
    );
  });

  it("does not fire on arbitrary 3-point endpoint deformation (the reviewer repro)", () => {
    // Three arbitrary non-collinear endpoint positions: geometrically they fit a
    // circle exactly, but there are too few samples to be an overdetermined fit.
    const group = [
      sample({ time: 0, angle: 0, ax: 600, ay: 300, bx: 540, by: 300 }),
      sample({ time: 1, angle: 90, ax: 505, ay: 402, bx: 500, by: 341 }),
      sample({ time: 2, angle: 180, ax: 402, ay: 305, bx: 461, by: 299 }),
    ];
    expect(detectOffPivotRotation(toFrames(group))).toHaveLength(0);
  });

  it("does not fire when the tracked points deform (non-rigid) even with >=5 samples", () => {
    // Endpoint A traces a clean wide circle about (500,300) — a naive fit would
    // recover a 200px-off center and flag it — but the inner point drifts outward
    // each frame, so the figure is deforming, not rotating rigidly.
    const group = sweep({ cx: 500, cy: 300, frames: 6, innerGrowth: 8 });
    expect(detectOffPivotRotation(toFrames(group))).toHaveLength(0);
  });

  it("does not fire when the >=5-sample trajectory is not a clean circle (high residual)", () => {
    // Rigid separation (len constant) but the points jitter along a rough path,
    // not one circle — the overdetermined RMS-residual guard rejects it.
    const scatter = [
      [600, 300],
      [520, 420],
      [470, 260],
      [610, 350],
      [430, 400],
      [560, 250],
    ];
    const group = scatter.map(([ax, ay], i) =>
      sample({
        time: i,
        angle: i * 40,
        ax: ax ?? 0,
        ay: ay ?? 0,
        bx: (ax ?? 0) - 60,
        by: ay ?? 0,
        len: 60,
      }),
    );
    expect(detectOffPivotRotation(toFrames(group))).toHaveLength(0);
  });

  it("does not fire when the pointer barely sweeps (fixed tilt)", () => {
    expect(
      detectOffPivotRotation(toFrames(sweep({ cx: 500, cy: 300, spreadDeg: 10 }))),
    ).toHaveLength(0);
  });

  it("does not fire when no dial hub is resolvable", () => {
    const group = sweep({ cx: 500, cy: 300 }).map((s) => ({
      ...s,
      hx: null,
      hy: null,
      hubCount: 0,
    }));
    expect(detectOffPivotRotation(toFrames(group))).toHaveLength(0);
  });

  it("does not fire when the hub has too few concentric circles", () => {
    const group = sweep({ cx: 500, cy: 300 }).map((s) => ({ ...s, hubCount: 1 }));
    expect(detectOffPivotRotation(toFrames(group))).toHaveLength(0);
  });

  it("requires the hub to be present for a sustained majority, not just the last frame", () => {
    // Hub resolves only on the final frame; every earlier frame lacks it. A
    // single-frame hub is not a reliable anchor — suppression is structural.
    const group = sweep({ cx: 500, cy: 300 }).map((s, i, all) =>
      i === all.length - 1 ? s : { ...s, hx: null, hy: null, hubCount: 0 },
    );
    expect(detectOffPivotRotation(toFrames(group))).toHaveLength(0);
  });

  it("collapses nested candidates on the same hub to a single finding", () => {
    const group = sweep({ cx: 500, cy: 300 });
    const child = sweep({ cx: 500, cy: 300, selector: "#needle > path:nth-of-type(1)" });
    const findings = detectOffPivotRotation(toFrames(group, child));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.selector).toBe("#needle");
  });

  it("suppresses multiple distinct bodies orbiting one hub (orbit/atom system)", () => {
    // Two rigid bodies at DIFFERENT angular positions about the same hub — an
    // orbit/radial system, not a single dial pointer.
    const bodyA = sweep({ cx: 700, cy: 500, selector: "#electron-a" });
    const bodyB = sweep({ cx: 300, cy: 500, selector: "#electron-b" });
    expect(detectOffPivotRotation(toFrames(bodyA, bodyB))).toHaveLength(0);
  });

  it("flags one off-pivot hand on a multi-hand clock whose sibling hands are correctly hubbed", () => {
    // Analog clock: three hands on one hub at (500,500). Two are correctly
    // hubbed (center-of-rotation on the hub → not eligible findings); one is
    // off-pivot (orbits (500,300), 200px above the hub). The multi-body
    // suppression must count only ELIGIBLE candidates — the two hubbed hands
    // are not orbiting bodies, so the lone off-pivot hand is NOT suppressed.
    const offPivot = sweep({ cx: 500, cy: 300, selector: "#hand-second" });
    const hubbedA = sweep({ cx: 500, cy: 500, selector: "#hand-hour" });
    const hubbedB = sweep({ cx: 500, cy: 500, selector: "#hand-minute" });
    const findings = detectOffPivotRotation(toFrames(offPivot, hubbedA, hubbedB));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.selector).toBe("#hand-second");
  });

  it("returns nothing for an empty sample set", () => {
    expect(detectOffPivotRotation([])).toHaveLength(0);
  });
});

describe("countAngularBodies (multi-body / orbit-atom suppression guard)", () => {
  it("collapses tightly-clustered angles to a single body", () => {
    expect(countAngularBodies([10, 12, 13, -8])).toBe(1);
  });

  it("counts well-separated angular positions as distinct bodies", () => {
    expect(countAngularBodies([0, 90, 180])).toBe(3);
  });

  it("wraps around 360 so 350 and 5 are the same body", () => {
    expect(countAngularBodies([350, 5])).toBe(1);
    expect(countAngularBodies([])).toBe(0);
  });
});
