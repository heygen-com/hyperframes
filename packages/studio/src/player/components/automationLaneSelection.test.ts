import { describe, expect, it } from "vitest";
import { pointsIn, replaceRange, retimeRange } from "./automationLaneSelection";
import { sampleAutomationLane, VOLUME_RANGE } from "@hyperframes/core/audio-automation";
import type { HfAutomationLane } from "@hyperframes/core/audio-automation";

const ramp: HfAutomationLane = {
  target: "volume",
  points: [
    { t: 0, v: 1 },
    { t: 2, v: 0.6 },
    { t: 3, v: 0.4 },
    { t: 6, v: 0 },
  ],
};

describe("pointsIn", () => {
  it("returns only the points inside the range, endpoints inclusive", () => {
    expect(pointsIn(ramp, 2, 3).map((p) => p.t)).toEqual([2, 3]);
    expect(pointsIn(ramp, 2.1, 2.9)).toEqual([]);
  });
});

describe("replaceRange", () => {
  it("never moves the envelope outside the selection", () => {
    // THE invariant. Deleting the middle of a ramp must not reshape the rest.
    const next: HfAutomationLane = {
      target: "volume",
      points: replaceRange({ lane: ramp, range: VOLUME_RANGE, t0: 1.5, t1: 3.5, inner: [] }),
    };
    for (const t of [0, 0.5, 1.0, 1.5, 3.5, 4, 5, 6]) {
      expect(sampleAutomationLane(next, t, "linear")).toBeCloseTo(
        sampleAutomationLane(ramp, t, "linear"),
        5,
      );
    }
  });

  it("pins anchors at both edges when the interior empties", () => {
    const pts = replaceRange({ lane: ramp, range: VOLUME_RANGE, t0: 1.5, t1: 3.5, inner: [] });
    const times = pts.map((p) => p.t);
    expect(times).toContain(1.5);
    expect(times).toContain(3.5);
    expect(times).not.toContain(2);
    expect(times).not.toContain(3);
  });

  it("lets inner points at the edges stand in for the anchors", () => {
    // A ramp generator emits its own boundary points; pinning a second anchor
    // at the same time would fight it.
    const pts = replaceRange({
      lane: ramp,
      range: VOLUME_RANGE,
      t0: 2,
      t1: 3,
      inner: [
        { t: 2, v: 0 },
        { t: 3, v: 1 },
      ],
    });
    expect(pts.filter((p) => p.t === 2)).toHaveLength(1);
    expect(pts.find((p) => p.t === 2)?.v).toBe(0);
  });

  it("sorts and respects the point cap", () => {
    const dense = Array.from({ length: 600 }, (_, i) => ({ t: 1.5 + i * 0.001, v: 0.5 }));
    const pts = replaceRange({ lane: ramp, range: VOLUME_RANGE, t0: 1.5, t1: 3.5, inner: dense });
    expect(pts.length).toBeLessThanOrEqual(512);
    expect([...pts].sort((a, b) => a.t - b.t)).toEqual(pts);
  });

  it("keeps a constant flat when the lane has no points", () => {
    const empty: HfAutomationLane = { target: "volume", points: [] };
    const pts = replaceRange({ lane: empty, range: VOLUME_RANGE, t0: 1, t1: 2, inner: [] });
    // Nothing to preserve, nothing to pin: an empty lane stays empty.
    expect(pts).toEqual([]);
  });

  it("keeps the far anchor and every outside point when inner would overflow the cap", () => {
    const dense = Array.from({ length: 600 }, (_, i) => ({ t: 1.5 + i * 0.001, v: 0.5 }));
    const pts = replaceRange({ lane: ramp, range: VOLUME_RANGE, t0: 1.5, t1: 3.5, inner: dense });
    const times = pts.map((p) => p.t);
    expect(times).toContain(1.5); // near anchor
    expect(times).toContain(3.5); // far anchor — this is what the bug dropped
    expect(times).toContain(0); // outside point before the range
    expect(times).toContain(6); // outside point after the range
    expect(pts.length).toBeLessThanOrEqual(512);
  });

  it("thins the interior evenly rather than dropping its tail", () => {
    const dense = Array.from({ length: 2001 }, (_, i) => ({ t: 1.5 + i * 0.001, v: 0.5 }));
    const pts = replaceRange({ lane: ramp, range: VOLUME_RANGE, t0: 1.5, t1: 3.5, inner: dense });
    const innerTimes = pts.map((p) => p.t).filter((t) => t > 1.5 && t < 3.5);
    // Evenly spread across the range, not clustered at the start.
    expect(Math.max(...innerTimes)).toBeGreaterThan(3.0);
  });
});

describe("retimeRange", () => {
  it("scales interior points proportionally into the new span", () => {
    const pts = retimeRange({ lane: ramp, range: VOLUME_RANGE, t0: 2, t1: 3, newT0: 2, newT1: 5 });
    const moved = pts.find((p) => p.v === 0.4); // the t=3 point
    expect(moved?.t).toBe(5);
  });

  it("preserves the envelope outside the union of old and new spans", () => {
    const before: HfAutomationLane = { target: "volume", points: ramp.points };
    const after: HfAutomationLane = {
      target: "volume",
      points: retimeRange({ lane: ramp, range: VOLUME_RANGE, t0: 2, t1: 3, newT0: 2, newT1: 5 }),
    };
    for (const t of [0, 1, 1.9, 5.1, 6]) {
      expect(sampleAutomationLane(after, t, "linear")).toBeCloseTo(
        sampleAutomationLane(before, t, "linear"),
        5,
      );
    }
  });

  it("rejects a degenerate span", () => {
    expect(
      retimeRange({ lane: ramp, range: VOLUME_RANGE, t0: 2, t1: 3, newT0: 4, newT1: 4 }),
    ).toEqual(ramp.points);
  });
});
