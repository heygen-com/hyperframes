// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { scheduleParamLane } from "./audioFxAutomation.js";
import type { HfAutomationLane } from "../audioAutomation.js";

class ClampedParam implements AudioParam {
  automationRate: AutomationRate = "a-rate";
  defaultValue = 1;
  minValue = -Infinity;
  maxValue = Infinity;
  value = 1;
  ramps = 0;
  curves: { time: number; duration: number }[] = [];

  constructor(readonly currentTime: number) {}

  private rejectOverlap(time: number): void {
    if (this.curves.some((curve) => time >= curve.time && time < curve.time + curve.duration)) {
      throw new DOMException("An event overlaps the active curve", "NotSupportedError");
    }
  }

  setValueAtTime(value: number, time: number): AudioParam {
    this.rejectOverlap(Math.max(time, this.currentTime));
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): AudioParam {
    this.setValueAtTime(value, time);
    this.ramps++;
    return this;
  }

  setValueCurveAtTime(
    values: Float32Array<ArrayBuffer> | number[],
    time: number,
    duration: number,
  ): AudioParam {
    // WebAudio clamps the start to its current time without shortening the duration.
    const start = Math.max(time, this.currentTime);
    this.rejectOverlap(start);
    this.curves.push({ time: start, duration });
    this.value = values[values.length - 1] ?? this.value;
    return this;
  }

  cancelScheduledValues(time: number): AudioParam {
    const now = Math.max(time, this.currentTime);
    this.curves = this.curves.filter((curve) => curve.time + curve.duration <= now);
    return this;
  }

  cancelAndHoldAtTime(time: number): AudioParam {
    return this.cancelScheduledValues(time);
  }

  exponentialRampToValueAtTime(value: number, time: number): AudioParam {
    return this.linearRampToValueAtTime(value, time);
  }

  setTargetAtTime(value: number, time: number): AudioParam {
    return this.setValueAtTime(value, time);
  }
}

const lane: HfAutomationLane = {
  target: "volume",
  points: [
    { t: 0, v: 0.1, curve: 0.7 },
    { t: 0.004, v: 0.3, curve: 0.7 },
    { t: 0.008, v: 0.5, curve: 0.7 },
    { t: 0.012, v: 0.7 },
  ],
};

it("finishes the lane when clamping a curve also blocks its fallback ramp", () => {
  const param = new ClampedParam(0.032);
  expect(() =>
    scheduleParamLane([{ param }], lane, "linear", { scheduledAt: 0, elapsed: 0, rate: 1 }),
  ).not.toThrow();
  expect(param.ramps).toBe(3);
  expect(param.curves).toHaveLength(0);
  expect(param.value).toBeCloseTo(0.7);
});

it("retains each bend when the curves are scheduled ahead of the audio clock", () => {
  const param = new ClampedParam(0.032);
  scheduleParamLane([{ param }], lane, "linear", { scheduledAt: 1, elapsed: 0, rate: 1 });
  expect(param.curves).toHaveLength(3);
  expect(param.ramps).toBe(0);
});
