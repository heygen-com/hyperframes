// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  applyShiftConstraint,
  automationTargets,
  curveForDrag,
  fromUnit,
  snapLaneTime,
  toUnit,
} from "./automationLaneGeometry";
import { applyCurve, sampleAutomationLane } from "@hyperframes/core/audio-automation";
import { resolveAutomationRange, VOLUME_RANGE } from "@hyperframes/core/audio-automation";
import type { HfAudioFxChain } from "@hyperframes/core/audio-fx";

const chain: HfAudioFxChain = {
  version: 1,
  nodes: [
    { type: "lowpass", id: "n1", enabled: true, params: {} },
    // No id: the panel has not touched it, so nothing can address it.
    { type: "peaking", enabled: true, params: {} },
    // Worklet-backed: no AudioParams to schedule.
    { type: "compressor", id: "n3", enabled: true, params: {} },
  ],
};

describe("automationTargets", () => {
  it("offers volume plus every addressable automatable knob", () => {
    const targets = automationTargets(chain).map((t) => t.target);
    expect(targets[0]).toBe("volume");
    expect(targets).toContain("fx.n1.frequency");
    expect(targets).toContain("fx.n1.q");
  });

  it("skips a node with no id — a lane could not address it stably", () => {
    expect(automationTargets(chain).some((t) => t.target.includes("peaking"))).toBe(false);
  });

  it("skips a worklet effect, which exposes no AudioParams", () => {
    expect(automationTargets(chain).some((t) => t.target.startsWith("fx.n3."))).toBe(false);
  });

  it("offers just the fader for a track with no chain", () => {
    expect(automationTargets(null).map((t) => t.target)).toEqual(["volume"]);
  });

  it("labels an fx target with its effect and knob", () => {
    const found = automationTargets(chain).find((t) => t.target === "fx.n1.frequency");
    expect(found?.label).toMatch(/Cutoff/);
    expect(found?.range.scale).toBe("log");
  });
});

describe("value ↔ lane position", () => {
  it("maps a linear range straight onto the lane", () => {
    expect(toUnit(VOLUME_RANGE, 0)).toBe(0);
    expect(toUnit(VOLUME_RANGE, 1)).toBe(1);
    expect(toUnit(VOLUME_RANGE, 0.25)).toBeCloseTo(0.25, 10);
  });

  it("maps a log-read knob on its own scale, so its middle is geometric", () => {
    const range = resolveAutomationRange("fx.n1.frequency", chain)!;
    const mid = fromUnit(range, 0.5);
    expect(mid).toBeCloseTo(Math.sqrt(range.min * range.max), 4);
    // Round trip: a value put in comes back out.
    expect(fromUnit(range, toUnit(range, 900))).toBeCloseTo(900, 6);
  });

  it("clamps a pointer that has left the lane", () => {
    expect(fromUnit(VOLUME_RANGE, -3)).toBe(0);
    expect(fromUnit(VOLUME_RANGE, 4)).toBe(1);
  });

  it("reads a zero-width range as the bottom rather than dividing by zero", () => {
    expect(toUnit({ ...VOLUME_RANGE, min: 1, max: 1 }, 1)).toBe(0);
  });
});

describe("curveForDrag", () => {
  const a = { t: 0, v: 1 };
  const b = { t: 4, v: 0 };

  it("puts the curved segment through the point that was dragged", () => {
    // The whole contract: whatever curve comes back, sampling the segment at the
    // dragged time has to give the dragged value back — otherwise the line runs
    // away from the pointer.
    for (const [t, v] of [
      [1, 0.9],
      [2, 0.8],
      [3, 0.15],
    ] as const) {
      const curve = curveForDrag({ range: VOLUME_RANGE, a, b, t, v });
      expect(curve).not.toBeNull();
      const lane = { target: "volume", points: [{ ...a, curve: curve ?? 0 }, b] };
      expect(sampleAutomationLane(lane, t, "linear")).toBeCloseTo(v, 2);
    }
  });

  it("stays inside the range the model will accept", () => {
    // Anything outside ±1 is clamped on parse, so a drag past the limit has to
    // saturate rather than round-trip to something else.
    const curve = curveForDrag({ range: VOLUME_RANGE, a, b, t: 0.05, v: 0.02 });
    expect(curve).not.toBeNull();
    expect(Math.abs(curve ?? 0)).toBeLessThanOrEqual(1);
    expect(applyCurve(0.5, curve ?? 0)).toBeGreaterThan(0);
  });

  it("declines a segment with no room to bend", () => {
    // Flat: every curve draws the same line, so there is nothing to solve.
    expect(curveForDrag({ range: VOLUME_RANGE, a, b: { t: 4, v: 1 }, t: 2, v: 0.5 })).toBeNull();
    // At the very ends the exponent divides by zero.
    expect(curveForDrag({ range: VOLUME_RANGE, a, b, t: 0, v: 1 })).toBeNull();
    expect(curveForDrag({ range: VOLUME_RANGE, a, b, t: 4, v: 0 })).toBeNull();
  });
});

describe("applyShiftConstraint", () => {
  const origin = { t: 1, v: 0.5 };
  const xOf = (t: number) => t * 100;
  const yOf = (v: number) => (1 - v) * 40;

  it("holds the value when the gesture is mostly sideways", () => {
    const out = applyShiftConstraint({
      range: VOLUME_RANGE,
      origin,
      raw: { t: 3, v: 0.55 },
      xOf,
      yOf,
    });
    expect(out).toEqual({ t: 3, v: 0.5 });
  });

  it("holds the time and fines the value when it is mostly vertical", () => {
    const out = applyShiftConstraint({
      range: VOLUME_RANGE,
      origin,
      raw: { t: 1.05, v: 0.9 },
      xOf,
      yOf,
    });
    expect(out.t).toBe(1);
    // A quarter of the travel: 0.5 + (0.9 - 0.5) / 4.
    expect(out.v).toBeCloseTo(0.6, 5);
  });

  it("decides which axis won in pixels, not in units", () => {
    // 0.2 s against 0.2 of a fader are not comparable numbers; at this zoom the
    // horizontal move is 20px and the vertical one is 8px.
    const out = applyShiftConstraint({
      range: VOLUME_RANGE,
      origin,
      raw: { t: 1.2, v: 0.7 },
      xOf,
      yOf,
    });
    expect(out.v).toBe(0.5);
  });
});

describe("snapLaneTime", () => {
  it("takes the nearest target inside the threshold", () => {
    expect(snapLaneTime(2.02, [1, 2, 3], 0.04)).toBe(2);
  });

  it("leaves a time alone when nothing is close enough", () => {
    expect(snapLaneTime(2.5, [1, 2, 3], 0.04)).toBe(2.5);
  });

  it("has nothing to snap to on an empty grid", () => {
    expect(snapLaneTime(2.5, [], 0.04)).toBe(2.5);
  });
});
