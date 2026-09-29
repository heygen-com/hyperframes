import { describe, expect, it } from "vitest";
import { RATE_TARGET, type HfAutomationLane } from "./audioAutomation.js";
import {
  SPEED_PRESETS,
  parseRateLane,
  rateAt,
  resolveRateSpec,
  shiftRateLane,
  sourceTimeAt,
  speedPresetLane,
  timeAtSourceTime,
} from "./speedRamp.js";

const ramp = (points: Array<[number, number]>): HfAutomationLane => ({
  target: RATE_TARGET,
  points: points.map(([t, v]) => ({ t, v })),
});

describe("sourceTimeAt", () => {
  it("is t * rate for a constant", () => {
    expect(sourceTimeAt(2, 3)).toBe(6);
  });

  it("integrates a geometric 1x to 3x ramp: 2s * (3-1)/ln 3 source seconds", () => {
    expect(
      sourceTimeAt(
        ramp([
          [0, 1],
          [2, 3],
        ]),
        2,
      ),
    ).toBeCloseTo(3.641, 3);
  });

  it("holds the last rate past the final point", () => {
    expect(
      sourceTimeAt(
        ramp([
          [0, 1],
          [2, 3],
        ]),
        4,
      ),
    ).toBeCloseTo(3.641 + 2 * 3, 3);
  });

  it("round-trips through timeAtSourceTime", () => {
    const lane = ramp([
      [0, 0.5],
      [1, 4],
      [3, 0.25],
    ]);
    for (const t of [0, 0.4, 1, 2.2, 3, 5]) {
      expect(timeAtSourceTime(lane, sourceTimeAt(lane, t))).toBeCloseTo(t, 3);
    }
  });
});

describe("rateAt", () => {
  it("interpolates geometrically: the midpoint of 1x to 3x is sqrt(3)", () => {
    expect(
      rateAt(
        ramp([
          [0, 1],
          [2, 3],
        ]),
        1,
      ),
    ).toBeCloseTo(Math.sqrt(3), 5);
  });
});

describe("shiftRateLane", () => {
  it("sees the lane from dt seconds in: integrating from 1s of a 4s 1x to 3x ramp", () => {
    const lane = ramp([
      [0, 1],
      [4, 3],
    ]);
    // source(3) - source(1) = 4.6586 - 1.1508
    expect(sourceTimeAt(shiftRateLane(lane, 1), 2)).toBeCloseTo(3.5078, 2);
  });
});

describe("shiftRateLane with a shaped segment", () => {
  it("keeps the curve of a segment cut in the middle: shifted integral equals the original's difference", () => {
    const lane: HfAutomationLane = {
      target: RATE_TARGET,
      points: [
        { t: 0, v: 1, curve: 0.8 },
        { t: 4, v: 3 },
      ],
    };
    const expected = sourceTimeAt(lane, 4) - sourceTimeAt(lane, 1);
    expect(sourceTimeAt(shiftRateLane(lane, 1), 3)).toBeCloseTo(expected, 2);
  });
});

describe("lane parsing", () => {
  const attr = JSON.stringify({
    version: 1,
    lanes: [{ target: "rate", points: [{ t: 0, v: 20 }] }],
  });

  it("clamps a stored rate to the shared 0.1..10 range", () => {
    expect(rateAt(resolveRateSpec(attr, 1), 0)).toBe(10);
  });

  it("falls back to the constant when the attribute is absent or unreadable", () => {
    expect(resolveRateSpec(null, 1.5)).toBe(1.5);
    expect(resolveRateSpec("{nope", 2)).toBe(2);
    expect(parseRateLane("{nope")).toBeNull();
  });
});

describe("presets", () => {
  it("stretches every preset over the clip and keeps it in range", () => {
    for (const { id } of SPEED_PRESETS) {
      const lane = speedPresetLane(id, 8);
      expect(lane.points[lane.points.length - 1]!.t).toBe(8);
      for (const p of lane.points) expect(p.v).toBeGreaterThanOrEqual(0.1);
    }
  });
});
