import { describe, expect, it } from "vitest";
import { resample } from "./audioResample";

const tone = (hz: number, rate: number, seconds: number) =>
  Float32Array.from({ length: seconds * rate }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));

const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);

/** Upward zero crossings per second, over the middle of the signal. */
function frequency(x: Float32Array, rate: number): number {
  const from = Math.floor(x.length / 4);
  const to = Math.floor((3 * x.length) / 4);
  let crossings = 0;
  for (let i = from + 1; i < to; i++) if (x[i - 1]! < 0 && x[i]! >= 0) crossings++;
  return (crossings * rate) / (to - from);
}

describe("resample", () => {
  it("keeps a tone's pitch and level from 48 kHz to 22.05 kHz", () => {
    const out = resample(tone(1000, 48_000, 2), 48_000, 22_050);
    expect(out.length).toBe(44_100);
    expect(frequency(out, 22_050)).toBeCloseTo(1000, -1);
    expect(rms(out.subarray(1000, -1000))).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it("removes what the lower rate cannot hold instead of folding it down", () => {
    const out = resample(tone(15_000, 48_000, 1), 48_000, 22_050);
    expect(rms(out.subarray(1000, -1000))).toBeLessThan(0.01);
  });

  it("returns the samples untouched at the same rate", () => {
    const x = tone(440, 22_050, 1);
    expect(resample(x, 22_050, 22_050)).toBe(x);
  });
});
