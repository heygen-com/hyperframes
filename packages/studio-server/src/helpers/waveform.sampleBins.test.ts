import { describe, expect, it } from "vitest";
import { addSamples, createSampleBins } from "./waveform.js";

const f32 = (...values: number[]) => Buffer.from(new Float32Array(values).buffer);

describe("addSamples", () => {
  it("keeps every sample while there is room", () => {
    const bins = createSampleBins(8);
    addSamples(bins, f32(0.1, -0.4, 0.2));
    expect(Array.from(bins.peaks.subarray(0, bins.length))).toEqual([
      Math.fround(0.1),
      Math.fround(0.4),
      Math.fround(0.2),
    ]);
  });

  it("never grows past its capacity, and keeps the loudest sample of each run", () => {
    const bins = createSampleBins(4);
    const samples = Array.from({ length: 1_000 }, (_, i) => (i === 777 ? -0.9 : 0.01));
    addSamples(bins, f32(...samples));
    expect(bins.length).toBeLessThanOrEqual(4);
    expect(bins.peaks).toHaveLength(4);
    expect(bins.samplesPerBin).toBe(256);
    expect(Math.max(...bins.peaks.subarray(0, bins.length))).toBe(Math.fround(0.9));
  });

  it("joins a sample split across two chunks", () => {
    const bins = createSampleBins(8);
    const whole = f32(0.25, 0.5);
    addSamples(bins, whole.subarray(0, 6));
    addSamples(bins, whole.subarray(6));
    expect(Array.from(bins.peaks.subarray(0, bins.length))).toEqual([0.25, 0.5]);
  });
});
