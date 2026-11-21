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
import { sampleAutomationLane, type HfAutomationLane } from "../audioAutomation.js";
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

const curvedRamp: HfAutomationLane = {
  target: "volume",
  points: [
    { t: 0, v: 0, curve: 1 },
    { t: 2, v: 1 },
  ],
};

type Booked = Extract<Call, { op: "set" | "ramp" }>;

function booked(calls: readonly Call[]): Booked[] {
  return calls.flatMap((c): Booked[] => {
    if (c.op === "set" || c.op === "ramp") return [c];
    if (c.op === "cancel") return [];
    throw new Error(`booked a ${c.op}`);
  });
}

/** What the booked events play at context time `t`, read as the AudioParam would. */
function valueAt(calls: readonly Call[], t: number): number {
  const events = booked(calls);
  const i = events.findIndex((c) => c.time > t || (c.time === t && c.op === "set"));
  const next = events[i];
  const prev = events[i === -1 ? events.length - 1 : i - 1] ?? next;
  if (!next || !prev) return prev?.value ?? Number.NaN;
  if (next.op === "set") return next.time === t ? next.value : prev.value;
  return prev.value + ((next.value - prev.value) * (t - prev.time)) / (next.time - prev.time);
}

describe("scheduleParamLane", () => {
  it("seeds the current value, then ramps to each later point", () => {
    const { target, param } = fake();
    scheduleParamLane([target], ramp, "linear", at(0));
    expect(param.calls).toEqual([
      { op: "cancel", time: 0 },
      // Before the first point the envelope holds that point's value.
      { op: "set", value: 0.2, time: 10 },
      { op: "set", value: 0.2, time: 11 },
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
      { op: "cancel", time: 0 },
      { op: "set", value: 0.8, time: 10 },
    ]);
  });

  it("waits for a clip that has not started yet", () => {
    const { target, param } = fake();
    scheduleParamLane([target], ramp, "linear", at(-2));
    // Clip time 1 is three seconds of context time away.
    expect(param.calls[1]).toEqual({ op: "set", value: 0.2, time: 10 });
    expect(param.calls[2]).toEqual({ op: "set", value: 0.2, time: 13 });
    expect(param.calls[3]).toEqual({ op: "ramp", value: 0.8, time: 15 });
  });

  it("compresses the envelope by the playback rate", () => {
    const { target, param } = fake();
    scheduleParamLane([target], ramp, "linear", at(0, 2));
    // Clip time 3 arrives after 1.5 s of context time at double speed.
    expect(param.calls[3]).toEqual({ op: "ramp", value: 0.8, time: 11.5 });
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
      { op: "cancel", time: 0 },
      { op: "set", value: 0.4, time: 10 },
    ]);
  });

  it("samples a curved segment rather than ramping through the bend", () => {
    const { target, param } = fake();
    scheduleParamLane([target], curvedRamp, "linear", at(0));
    expect(valueAt(param.calls, 10)).toBeCloseTo(0, 6);
    expect(valueAt(param.calls, 12)).toBeCloseTo(1, 6);
    // Curved, so the midpoint is not halfway.
    expect(valueAt(param.calls, 11)).toBeLessThan(0.4);
  });

  it("samples a segment bent by a via point, not just one bent by `curve`", () => {
    // Both express the same thing — a segment that is not a straight line — and
    // the via form is what the timeline writes when a bend is dragged. Read as
    // straight, the whole bend was played as a linear ramp: the envelope drawn in
    // the lane and the envelope heard were different shapes.
    const { target, param } = fake();
    scheduleParamLane(
      [target],
      {
        target: "volume",
        points: [
          { t: 0, v: 0, viaX: 0.5, viaY: 0.9 },
          { t: 2, v: 1 },
        ],
      },
      "linear",
      at(0),
    );
    // Through the via point: 90% of the way up at the halfway mark.
    expect(valueAt(param.calls, 11)).toBeGreaterThan(0.8);
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
    // Halfway is the geometric mean; one linear ramp would have been at 4100.
    expect(valueAt(param.calls, 11) / Math.sqrt(200 * 8000)).toBeCloseTo(1, 1);
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
    // The dry side moves the opposite way.
    expect(valueAt(dry.calls, 10)).toBeCloseTo(0.75, 6);
    expect(valueAt(dry.calls, 14)).toBeCloseTo(0.25, 6);
  });

  it("ignores an empty lane", () => {
    const { target, param } = fake();
    scheduleParamLane([target], { target: "volume", points: [] }, "linear", at(0));
    expect(param.calls).toEqual([]);
  });
});

describe("never a value curve", () => {
  it("plays consecutive bent segments as ramps through the lane", () => {
    const lane: HfAutomationLane = {
      target: "fx.n1.frequency",
      points: [
        { t: 0, v: 200, curve: 1 },
        { t: 1, v: 4000, curve: -1 },
        { t: 2, v: 500 },
      ],
    };
    const { target, param } = fake();
    scheduleParamLane([target], lane, "log", at(0.1));
    expect(param.calls.filter((c) => c.op === "curve")).toEqual([]);
    for (const t of [0.1, 0.3, 0.5, 0.9, 1, 1.2, 1.6, 2, 3]) {
      const want = sampleAutomationLane(lane, t, "log");
      expect(
        Math.abs(valueAt(param.calls, 10 + t - 0.1) / want - 1),
        `clip time ${t}`,
      ).toBeLessThan(0.02);
    }
  });

  it("holds the first point's value until the clip reaches it", () => {
    for (const lane of [
      ramp,
      { ...ramp, points: [{ ...ramp.points[0]!, curve: 1 }, ramp.points[1]!] },
    ]) {
      const { target, param } = fake();
      scheduleParamLane([target], lane, "linear", at(-2));
      // Clip time 1 is context time 13.
      expect(valueAt(param.calls, 12.9)).toBeCloseTo(0.2, 6);
      expect(valueAt(param.calls, 15)).toBeCloseTo(0.8, 6);
    }
  });
});

describe("cancelParamLane", () => {
  it("holds the value the envelope had reached rather than snapping back", () => {
    const { target, param } = fake();
    const written: number[] = [];
    Object.defineProperty(param, "value", { get: () => 0.42, set: (v: number) => written.push(v) });
    cancelParamLane([target]);
    // Never `cancelAndHoldAtTime`: Chromium before 160 crashes the page when that hold lands in a value curve.
    expect(param.calls).toEqual([{ op: "cancel", time: 0 }]);
    expect(written).toEqual([0.42]);
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
