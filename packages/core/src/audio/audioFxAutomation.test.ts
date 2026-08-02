// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  cancelParamLane,
  scheduleChainAutomation,
  scheduleParamLane,
  volumeLane,
  type AutomationTiming,
} from "./audioFxAutomation.js";
import type { FxParamTarget } from "./audioFxGraph.js";
import type { HfAutomationLane } from "../audioAutomation.js";
import type { HfAudioFxChain } from "../audioFx.js";

/**
 * happy-dom has no Web Audio. These record what the scheduler asks an
 * AudioParam to do — the shape of the envelope handed to the audio thread —
 * which is the part that has to be right; whether Chrome then plays a ramp
 * accurately is not ours to test.
 */
type Call =
  | { op: "set"; value: number; time: number }
  | { op: "ramp"; value: number; time: number }
  | { op: "curve"; values: number[]; time: number; duration: number }
  | { op: "cancel"; time: number }
  | { op: "hold"; time: number };

class FakeParam {
  calls: Call[] = [];
  value = 0;
  setValueAtTime(value: number, time: number): void {
    this.calls.push({ op: "set", value, time });
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.calls.push({ op: "ramp", value, time });
  }
  setValueCurveAtTime(values: Float32Array, time: number, duration: number): void {
    this.calls.push({ op: "curve", values: Array.from(values), time, duration });
  }
  cancelScheduledValues(time: number): void {
    this.calls.push({ op: "cancel", time });
  }
  cancelAndHoldAtTime(time: number): void {
    this.calls.push({ op: "hold", time });
  }
}

const fake = (): { target: FxParamTarget; param: FakeParam } => {
  const param = new FakeParam();
  return { target: { param: param as unknown as AudioParam }, param };
};

const at = (elapsed = 0, rate = 1, scheduledAt = 10): AutomationTiming => ({
  scheduledAt,
  elapsed,
  rate,
});

const ramp: HfAutomationLane = {
  target: "volume",
  points: [
    { t: 1, v: 0.2 },
    { t: 3, v: 0.8 },
  ],
};

describe("scheduleParamLane", () => {
  it("seeds the current value, then ramps to each later point", () => {
    const { target, param } = fake();
    scheduleParamLane([target], ramp, "linear", at(0));
    expect(param.calls).toEqual([
      { op: "cancel", time: 10 },
      // Before the first point the envelope holds that point's value.
      { op: "set", value: 0.2, time: 10 },
      { op: "ramp", value: 0.8, time: 13 },
    ]);
  });

  it("enters a segment mid-way when the playhead landed inside it", () => {
    const { target, param } = fake();
    scheduleParamLane([target], ramp, "linear", at(2));
    // Half way along a 0.2 → 0.8 ramp.
    expect(param.calls[1]).toEqual({ op: "set", value: 0.5, time: 10 });
    expect(param.calls[2]).toEqual({ op: "ramp", value: 0.8, time: 11 });
  });

  it("holds the last value once the envelope is behind the playhead", () => {
    const { target, param } = fake();
    scheduleParamLane([target], ramp, "linear", at(9));
    expect(param.calls).toEqual([
      { op: "cancel", time: 10 },
      { op: "set", value: 0.8, time: 10 },
    ]);
  });

  it("waits for a clip that has not started yet", () => {
    const { target, param } = fake();
    scheduleParamLane([target], ramp, "linear", at(-2));
    // Clip time 1 is three seconds of context time away.
    expect(param.calls[1]).toEqual({ op: "set", value: 0.2, time: 10 });
    expect(param.calls[2]).toEqual({ op: "ramp", value: 0.8, time: 15 });
  });

  it("compresses the envelope by the playback rate", () => {
    const { target, param } = fake();
    scheduleParamLane([target], ramp, "linear", at(0, 2));
    // Clip time 3 arrives after 1.5 s of context time at double speed.
    expect(param.calls[2]).toEqual({ op: "ramp", value: 0.8, time: 11.5 });
  });

  it("sets a constant lane once instead of scheduling it", () => {
    const { target, param } = fake();
    scheduleParamLane(
      [target],
      {
        target: "volume",
        points: [
          { t: 0, v: 0.4 },
          { t: 5, v: 0.4 },
        ],
      },
      "linear",
      at(0),
    );
    expect(param.calls).toEqual([
      { op: "cancel", time: 10 },
      { op: "set", value: 0.4, time: 10 },
    ]);
  });

  it("samples a curved segment rather than ramping through the bend", () => {
    const { target, param } = fake();
    scheduleParamLane(
      [target],
      {
        target: "volume",
        points: [
          { t: 0, v: 0, curve: 1 },
          { t: 2, v: 1 },
        ],
      },
      "linear",
      at(0),
    );
    const curve = param.calls.find((c) => c.op === "curve");
    expect(curve).toBeTruthy();
    if (curve?.op !== "curve") throw new Error("expected a curve");
    expect(curve.time).toBe(10);
    expect(curve.duration).toBe(2);
    expect(curve.values[0]).toBeCloseTo(0, 6);
    expect(curve.values[curve.values.length - 1]).toBeCloseTo(1, 6);
    // Curved, so the midpoint is not halfway.
    expect(curve.values[Math.floor(curve.values.length / 2)]).toBeLessThan(0.4);
  });

  it("samples a log-scaled sweep, which a linear ramp would get wrong", () => {
    const { target, param } = fake();
    scheduleParamLane(
      [target],
      {
        target: "fx.n1.frequency",
        points: [
          { t: 0, v: 200 },
          { t: 2, v: 8000 },
        ],
      },
      "log",
      at(0),
    );
    const curve = param.calls.find((c) => c.op === "curve");
    if (curve?.op !== "curve") throw new Error("expected a curve");
    // Halfway is the geometric mean, not the arithmetic one. The array has an
    // even length so no sample sits exactly on it; both neighbours bracket it.
    const half = curve.values.length / 2;
    const geometric = Math.sqrt(200 * 8000);
    expect(curve.values[half - 1] ?? 0).toBeLessThan(geometric);
    expect(curve.values[half] ?? 0).toBeGreaterThan(geometric);
    expect((curve.values[half] ?? 0) / geometric).toBeCloseTo(1, 1);
    // A linear ramp would have been at 4100 by now — nowhere near.
    expect(curve.values[half] ?? 0).toBeLessThan(2000);
  });

  it("does not seed on top of a curve that starts at the same instant", () => {
    const { target, param } = fake();
    scheduleParamLane(
      [target],
      {
        target: "volume",
        points: [
          { t: 0, v: 0, curve: 1 },
          { t: 2, v: 1 },
        ],
      },
      "linear",
      at(0),
    );
    // A value curve may not overlap another event, so there is no set at 10.
    expect(param.calls.filter((c) => c.op === "set")).toEqual([]);
    expect(param.calls[1]?.op).toBe("curve");
  });

  it("writes every AudioParam behind one knob, each through its own mapping", () => {
    const wet = new FakeParam();
    const dry = new FakeParam();
    scheduleParamLane(
      [
        { param: wet as unknown as AudioParam },
        { param: dry as unknown as AudioParam, map: (v) => 1 - v },
      ],
      {
        target: "fx.n1.mix",
        points: [
          { t: 0, v: 0.25 },
          { t: 4, v: 0.75 },
        ],
      },
      "linear",
      at(0),
    );
    expect(wet.calls[1]).toEqual({ op: "set", value: 0.25, time: 10 });
    // The dry side moves the opposite way. A mapping may be non-linear, so the
    // segment is sampled rather than ramped.
    const dryCurve = dry.calls.find((c) => c.op === "curve");
    if (dryCurve?.op !== "curve") throw new Error("expected a curve");
    expect(dryCurve.values[0]).toBeCloseTo(0.75, 6);
    expect(dryCurve.values[dryCurve.values.length - 1]).toBeCloseTo(0.25, 6);
  });

  it("ignores an empty lane", () => {
    const { target, param } = fake();
    scheduleParamLane([target], { target: "volume", points: [] }, "linear", at(0));
    expect(param.calls).toEqual([]);
  });
});

describe("cancelParamLane", () => {
  it("holds the value the envelope had reached rather than snapping back", () => {
    const { target, param } = fake();
    cancelParamLane([target], 12);
    expect(param.calls).toEqual([{ op: "hold", time: 12 }]);
  });
});

describe("scheduleChainAutomation", () => {
  const chain: HfAudioFxChain = {
    version: 1,
    nodes: [{ type: "peaking", id: "n1", enabled: true, params: {} }],
  };

  const nodeWith = (automation: Record<string, FxParamTarget[]> | undefined) => [
    {
      id: "n1",
      handle: {
        input: {} as AudioNode,
        output: {} as AudioNode,
        update: () => {},
        dispose: () => {},
        automation,
      },
    },
  ];

  it("routes a lane to the AudioParam its node exposes", () => {
    const param = new FakeParam();
    const nodes = nodeWith({ frequency: [{ param: param as unknown as AudioParam }] });
    const scheduled = scheduleChainAutomation(
      {
        version: 1,
        lanes: [
          {
            target: "fx.n1.frequency",
            points: [
              { t: 0, v: 200 },
              { t: 2, v: 8000 },
            ],
          },
        ],
      },
      chain,
      nodes,
      at(0),
    );
    expect(scheduled.length).toBe(1);
    expect(param.calls.length).toBeGreaterThan(1);
  });

  it("skips a lane whose node exposes nothing, instead of failing", () => {
    const scheduled = scheduleChainAutomation(
      {
        version: 1,
        lanes: [
          {
            target: "fx.n1.frequency",
            points: [
              { t: 0, v: 200 },
              { t: 2, v: 900 },
            ],
          },
        ],
      },
      chain,
      nodeWith(undefined),
      at(0),
    );
    expect(scheduled).toEqual([]);
  });

  it("skips a lane addressed to a node that is not in the chain", () => {
    const param = new FakeParam();
    const scheduled = scheduleChainAutomation(
      {
        version: 1,
        lanes: [
          {
            target: "fx.gone.frequency",
            points: [
              { t: 0, v: 200 },
              { t: 2, v: 900 },
            ],
          },
        ],
      },
      chain,
      nodeWith({ frequency: [{ param: param as unknown as AudioParam }] }),
      at(0),
    );
    expect(scheduled).toEqual([]);
    expect(param.calls).toEqual([]);
  });

  it("leaves the volume lane alone — the transport owns the fader", () => {
    const param = new FakeParam();
    const automation = {
      version: 1,
      lanes: [
        {
          target: "volume",
          points: [
            { t: 0, v: 1 },
            { t: 2, v: 0 },
          ],
        },
      ],
    };
    const scheduled = scheduleChainAutomation(
      automation,
      chain,
      nodeWith({ frequency: [{ param: param as unknown as AudioParam }] }),
      at(0),
    );
    expect(scheduled).toEqual([]);
    expect(volumeLane(automation)?.points.length).toBe(2);
  });
});
