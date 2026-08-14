// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  cancelParamLane,
  clearParamLane,
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

const curvedRamp: HfAutomationLane = {
  target: "volume",
  points: [
    { t: 0, v: 0, curve: 1 },
    { t: 2, v: 1 },
  ],
};

/** Schedule `curvedRamp` and return the fake param it wrote to — the setup
 *  three tests below share, each checking something different about the
 *  curve it produces. */
function scheduleCurved(): { target: FxParamTarget; param: FakeParam } {
  const { target, param } = fake();
  scheduleParamLane([target], curvedRamp, "linear", at(0));
  return { target, param };
}

describe("scheduleParamLane", () => {
  it("seeds the current value, then ramps to each later point", () => {
    const { target, param } = fake();
    scheduleParamLane([target], ramp, "linear", at(0));
    expect(param.calls).toEqual([
      // Cleared from zero, not held: holding leaves the span of a running curve
      // booked, and Chrome refuses the next curve — or a plain `.value` write —
      // that lands inside it. The seed below restores the value in the same pass,
      // so clearing costs nothing audible.
      { op: "cancel", time: 0 },
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
      { op: "cancel", time: 0 },
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
      { op: "cancel", time: 0 },
      { op: "set", value: 0.4, time: 10 },
    ]);
  });

  it("samples a curved segment rather than ramping through the bend", () => {
    const { param } = scheduleCurved();
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
    const curve = param.calls.find((c) => c.op === "curve");
    expect(curve, "a via-bent segment must be sampled, not ramped").toBeTruthy();
    if (curve?.op !== "curve") throw new Error("expected a curve");
    // Through the via point: 90% of the way up at the halfway mark.
    expect(curve.values[Math.floor(curve.values.length / 2)]).toBeGreaterThan(0.8);
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
    const { param } = scheduleCurved();
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

/**
 * An AudioParam with Chrome's own overlap rule, and its own cancel semantics.
 *
 * The distinction that matters: `cancelScheduledValues(t)` drops events at or
 * after `t` but leaves a value curve that is already running — the spec only
 * special-cases an in-progress curve for `cancelAndHoldAtTime`, which truncates
 * it. Schedule a curve inside one that is still live and the browser throws.
 */
class OverlapAwareParam {
  curves: { time: number; duration: number }[] = [];
  value = 0;
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  setValueCurveAtTime(_values: Float32Array, time: number, duration: number): void {
    const clash = this.curves.find((c) => time < c.time + c.duration && time + duration > c.time);
    if (clash) {
      throw new Error(
        `Failed to execute 'setValueCurveAtTime' on 'AudioParam': ` +
          `setValueCurveAtTime(..., ${time}, ${duration}) overlaps ` +
          `setValueCurveAtTime(..., ${clash.time}, ${clash.duration})`,
      );
    }
    this.curves.push({ time, duration });
  }
  cancelScheduledValues(time: number): void {
    // Events at or after the cancel; a curve already under way is untouched.
    this.curves = this.curves.filter((c) => c.time < time);
  }
  cancelAndHoldAtTime(time: number): void {
    this.curves = this.curves
      .filter((c) => c.time < time)
      .map((c) => ({ time: c.time, duration: Math.min(c.duration, time - c.time) }));
  }
}

describe("rescheduling over a curve that is still playing", () => {
  const bent: HfAutomationLane = {
    target: "volume",
    points: [
      { t: 0, v: 1, curve: 1 },
      { t: 8, v: 0.2, curve: 1 },
      { t: 12, v: 1 },
    ],
  };

  it("takes over from an in-progress curve instead of throwing", () => {
    // Two schedule passes a few milliseconds apart is ordinary: an attribute edit
    // lands, the graph is re-parameterised, and the envelope is re-aimed at the
    // live playhead. The second pass has to displace the curve the first one
    // started, which `cancelScheduledValues` does not do for a curve that is
    // already running — the browser then refuses the new curve outright.
    const param = new OverlapAwareParam();
    const target = { param: param as unknown as AudioParam };
    scheduleParamLane([target], bent, "linear", at(0, 1, 9.109333));
    expect(() =>
      scheduleParamLane([target], bent, "linear", at(0.005334, 1, 9.114667)),
    ).not.toThrow();
  });

  it("survives a burst of reschedules, as a dragged knob produces", () => {
    const param = new OverlapAwareParam();
    const target = { param: param as unknown as AudioParam };
    for (let i = 0; i < 12; i++) {
      const when = 9.1 + i * 0.005;
      expect(() =>
        scheduleParamLane([target], bent, "linear", at(i * 0.005, 1, when)),
      ).not.toThrow();
    }
  });
});

describe("a curve the browser refuses", () => {
  /**
   * A param that rejects any curve overlapping one it has been given, and — like
   * Chrome — keeps counting a held curve's original span. Holding stops what is
   * audible; it does not free the slot for overlap checking.
   */
  class UnforgivingParam {
    curves: { time: number; duration: number }[] = [];
    ramps: { time: number; value: number }[] = [];
    sets: { time: number; value: number }[] = [];
    value = 0;
    setValueAtTime(value: number, time: number): void {
      this.sets.push({ time, value });
    }
    linearRampToValueAtTime(value: number, time: number): void {
      this.ramps.push({ time, value });
    }
    setValueCurveAtTime(_v: Float32Array, time: number, duration: number): void {
      const clash = this.curves.find((c) => time < c.time + c.duration && time + duration > c.time);
      if (clash) {
        throw new Error(
          `Failed to execute 'setValueCurveAtTime' on 'AudioParam': ` +
            `setValueCurveAtTime(..., ${time}, ${duration}) overlaps ` +
            `setValueCurveAtTime(..., ${clash.time}, ${clash.duration})`,
        );
      }
      this.curves.push({ time, duration });
    }
    // Measured against Chrome, in a live running context and in an offline one
    // suspended mid-curve: either cancel frees the span of a curve already under
    // way, so only a write with no cancel at all is refused.
    cancelScheduledValues(time: number): void {
      this.curves = this.curves.filter((c) => c.time + c.duration < time);
    }
    cancelAndHoldAtTime(time: number): void {
      this.cancelScheduledValues(time);
    }
  }

  const bent: HfAutomationLane = {
    target: "volume",
    points: [
      { t: 0, v: 1, curve: 1 },
      { t: 0.25, v: 0.4, curve: 1 },
      { t: 0.6, v: 1, curve: 1 },
      { t: 1.2, v: 0.3 },
    ],
  };

  it("reschedules mid-playback with its curves intact", () => {
    // Applying a carve while the transport runs reschedules into curves that are
    // already playing — one render quantum apart is the common case. Cancelling
    // the parameter first is what lets the new pass keep its shape instead of
    // being refused; this does not discriminate the strength of the cancel, which
    // the no-cancel test below is for.
    const param = new UnforgivingParam();
    const target = { param: param as unknown as AudioParam };
    scheduleParamLane([target], bent, "linear", at(0, 1, 1492.016));
    const first = param.curves.length;
    expect(() =>
      scheduleParamLane([target], bent, "linear", at(0.005333, 1, 1492.021333)),
    ).not.toThrow();
    expect(param.curves.length).toBeGreaterThan(0);
    // Curves, not ramps: nothing had to be degraded.
    expect(param.ramps).toHaveLength(0);
    expect(first).toBeGreaterThan(0);
  });

  it("still degrades to a ramp where the span cannot be freed at all", () => {
    // The last line of defence, for a hypothetical param that refuses to give the
    // span up. No engine has been measured behaving this way; it stands in for the
    // unexplained curve-over-curve refusals reported from the field. The envelope
    // loses a bend rather than the exception escaping and abandoning the rest.
    class ImmovableParam extends UnforgivingParam {
      override cancelScheduledValues(): void {
        // Nothing is ever freed.
      }
    }
    const param = new ImmovableParam();
    const target = { param: param as unknown as AudioParam };
    scheduleParamLane([target], bent, "linear", at(0, 1, 100));
    expect(() =>
      scheduleParamLane([target], bent, "linear", at(0.005333, 1, 100.005333)),
    ).not.toThrow();
    expect(param.ramps.length).toBeGreaterThan(0);
  });
});

describe("a curve that starts at this very instant", () => {
  /**
   * Chrome's behaviour at the boundary, which is where this bit: holding at a
   * time does not free a curve that *begins* at that time, so both a fresh curve
   * and a plain `.value` write at the same instant are refused. Only a cancel
   * clears it.
   */
  class BoundaryParam {
    curves: { time: number; duration: number }[] = [];
    #value = 0;
    constructor(private clock: { currentTime: number }) {}
    get value(): number {
      return this.#value;
    }
    set value(v: number) {
      const t = this.clock.currentTime;
      const clash = this.curves.find((c) => t >= c.time && t <= c.time + c.duration);
      if (clash) {
        throw new Error(
          `Failed to set the 'value' property on 'AudioParam': setValueAtTime(${v}, ${t}) ` +
            `overlaps setValueCurveAtTime(..., ${clash.time}, ${clash.duration})`,
        );
      }
      this.#value = v;
    }
    setValueAtTime(v: number): void {
      this.#value = v;
    }
    linearRampToValueAtTime(): void {}
    setValueCurveAtTime(_v: Float32Array, time: number, duration: number): void {
      this.curves.push({ time, duration });
    }
    // As Chrome behaves: either cancel frees a running curve's span.
    cancelScheduledValues(time: number): void {
      this.curves = this.curves.filter((c) => c.time + c.duration < time);
    }
    cancelAndHoldAtTime(time: number): void {
      this.cancelScheduledValues(time);
    }
  }

  const bent: HfAutomationLane = {
    target: "volume",
    points: [
      { t: 0, v: 1, curve: 1 },
      { t: 0.04, v: 0.2, curve: 1 },
      { t: 4, v: 1 },
    ],
  };

  it("clears the booked span so the next pass can schedule at all", () => {
    const clock = { currentTime: 91.069 };
    const param = new BoundaryParam(clock);
    const target = { param: param as unknown as AudioParam };
    scheduleParamLane([target], bent, "linear", at(0, 1, 91.069));
    expect(() => scheduleParamLane([target], bent, "linear", at(0, 1, 91.069))).not.toThrow();
  });

  it("leaves the parameter writable, which is what a chain edit does next", () => {
    // The re-parameterise after an edit writes every knob straight onto its param.
    // Landing inside a span the scheduler booked at this instant is the error the
    // console kept reporting, with the gain stage's own unity value in it.
    const clock = { currentTime: 91.069 };
    const param = new BoundaryParam(clock);
    const target = { param: param as unknown as AudioParam };
    scheduleParamLane([target], bent, "linear", at(0, 1, 91.069));
    clearParamLane([target]);
    expect(() => {
      (param as unknown as { value: number }).value = 1;
    }).not.toThrow();
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
