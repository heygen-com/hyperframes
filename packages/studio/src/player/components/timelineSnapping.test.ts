import { describe, expect, it } from "vitest";
import {
  TIMELINE_SNAP_PX,
  collectTimelineSnapTargets,
  snapMoveToTargets,
  snapTimelineTime,
} from "./timelineSnapping";

describe("collectTimelineSnapTargets", () => {
  const elements = [
    { start: 2, duration: 3, key: "a", id: "a" },
    { start: 10, duration: 1.5, key: "b", id: "b" },
  ];

  it("collects clip starts and ends, playhead, and beats with types", () => {
    const targets = collectTimelineSnapTargets({
      elements,
      playheadTime: 7.25,
      beatTimes: [0.5, 1.0],
    });
    expect(targets).toContainEqual({ time: 2, type: "clip-edge" });
    expect(targets).toContainEqual({ time: 5, type: "clip-edge" });
    expect(targets).toContainEqual({ time: 10, type: "clip-edge" });
    expect(targets).toContainEqual({ time: 11.5, type: "clip-edge" });
    expect(targets).toContainEqual({ time: 7.25, type: "playhead" });
    expect(targets).toContainEqual({ time: 0.5, type: "beat" });
  });

  it("excludes the dragged element's own edges", () => {
    const targets = collectTimelineSnapTargets({
      elements,
      playheadTime: null,
      beatTimes: [],
      excludeElementKey: "a",
    });
    expect(targets.some((t) => t.time === 2)).toBe(false);
    expect(targets.some((t) => t.time === 5)).toBe(false);
    expect(targets).toContainEqual({ time: 10, type: "clip-edge" });
  });

  it("omits playhead when null and dedupes identical times preferring playhead > clip-edge > beat", () => {
    const targets = collectTimelineSnapTargets({
      elements: [{ start: 1, duration: 1, key: "x", id: "x" }],
      playheadTime: 2,
      beatTimes: [2],
    });
    const atTwo = targets.filter((t) => t.time === 2);
    expect(atTwo).toEqual([{ time: 2, type: "playhead" }]);
  });

  it("dedupes a coincident clip-edge and beat preferring clip-edge (no playhead)", () => {
    // A beat and a clip edge land on the same time (2). clip-edge has higher
    // priority than beat, so the deduped target is clip-edge — not beat.
    const targets = collectTimelineSnapTargets({
      elements: [{ start: 2, duration: 3, key: "x", id: "x" }],
      playheadTime: null,
      beatTimes: [2],
    });
    const atTwo = targets.filter((t) => t.time === 2);
    expect(atTwo).toEqual([{ time: 2, type: "clip-edge" }]);
  });
});

describe("snapTimelineTime", () => {
  const targets = [
    { time: 5, type: "clip-edge" as const },
    { time: 5.3, type: "playhead" as const },
  ];

  it("snaps to the nearest target within threshold", () => {
    expect(snapTimelineTime(5.05, targets, 0.1)).toEqual({
      time: 5,
      target: { time: 5, type: "clip-edge" },
    });
  });

  it("returns input unchanged when nothing is within threshold", () => {
    expect(snapTimelineTime(6, targets, 0.1)).toEqual({ time: 6, target: null });
  });
});

describe("snapMoveToTargets", () => {
  // pps=100 → threshold = TIMELINE_SNAP_PX/100 = 0.08s
  const targets = [{ time: 5, type: "playhead" as const }];

  it("snaps the start edge when it is the closer edge", () => {
    const r = snapMoveToTargets(5.05, 2, targets, 100, 60);
    expect(r).toEqual({ start: 5, snapTime: 5, snapType: "playhead" });
  });

  it("snaps the end edge, shifting start so the end lands on the target", () => {
    const r = snapMoveToTargets(3.03, 2, targets, 100, 60);
    expect(r.start).toBeCloseTo(3, 5);
    expect(r.snapTime).toBe(5);
    expect(r.snapType).toBe("playhead");
  });

  it("drops the snap when clamping to timeline bounds pulls it off target", () => {
    // duration 2, timeline 6 → maxStart 4; target at 5.05 wants start 5.05 → clamped to 4
    const r = snapMoveToTargets(5.0, 2, [{ time: 5.05, type: "beat" }], 100, 6);
    expect(r.snapTime).toBeNull();
  });

  it("threshold scales with pixels-per-second", () => {
    // pps=10 → threshold 0.8s: 5.5 snaps; pps=1000 → threshold 0.008s: it does not
    expect(snapMoveToTargets(5.5, 2, targets, 10, 60).snapTime).toBe(5);
    expect(snapMoveToTargets(5.5, 2, targets, 1000, 60).snapTime).toBeNull();
  });

  it("TIMELINE_SNAP_PX matches the historical beat-snap threshold", () => {
    expect(TIMELINE_SNAP_PX).toBe(8);
  });

  it("keeps the snap indicator for a frame-quantized duration (ms-rounding residue, no clamp)", () => {
    // duration 10/3 ≈ 3.3333…; end-snap onto a clip-edge at 5 gives a candidate
    // start of 5 - 10/3 = 1.6666…, whose ms-rounding residue (~3.3e-4) exceeds the
    // old 1e-6 tolerance. With a huge timeline (no bounds clamp), the snap must
    // survive — the clip snaps AND the indicator shows.
    const duration = 10 / 3;
    const edge = [{ time: 5, type: "clip-edge" as const }];
    const r = snapMoveToTargets(5 - duration + 0.001, duration, edge, 100, 1000);
    expect(r.snapTime).toBe(5);
    expect(r.snapType).toBe("clip-edge");
  });

  it("still drops the snap when the bounds clamp genuinely moves a frame-quantized clip off target", () => {
    // Same 10/3 duration, but the timeline is short enough that clamping to maxStart
    // pulls the clip off the target — the indicator must still vanish (the residue
    // widening must not mask a real clamp).
    const duration = 10 / 3;
    const r = snapMoveToTargets(5.0, duration, [{ time: 5.05, type: "beat" }], 100, 6);
    expect(r.snapTime).toBeNull();
  });
});
