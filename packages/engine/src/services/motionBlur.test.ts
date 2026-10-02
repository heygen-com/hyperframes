import { describe, it, expect } from "vitest";
import {
  ADAPTIVE_SAMPLE_STEPS,
  MAX_SAMPLES_PER_FRAME,
  MotionBlurAccumulator,
  adaptiveSampleCount,
  motionBlurProbeTimes,
  motionBlurSampleTimes,
  probeDiffMagnitude,
  resolveMotionBlurPlan,
  type MotionBlurBlendSpace,
} from "./motionBlur.js";
import { encodePng } from "../utils/alphaBlit.js";

/** Tick offsets from the frame instant for `samplesPerFrame` samples of `plan`, read
 * back from `motionBlurSampleTimes` at a frame far enough from 0 that no sample clamps. */
const offsetsAtFrame10Fps30 = (
  plan: NonNullable<ReturnType<typeof resolveMotionBlurPlan>>,
  samplesPerFrame: number,
): number[] =>
  motionBlurSampleTimes(plan, 10, 30, samplesPerFrame).map(
    (t) => Math.round(t * 30 * plan.subFrameDivisions) - 10 * plan.subFrameDivisions,
  );

const solid = (count: number, r: number, g: number, b: number, a = 255): Uint8Array => {
  const out = new Uint8Array(count * 4);
  for (let i = 0; i < count * 4; i += 4) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = a;
  }
  return out;
};

/** Average `samples` as the capture path does, one decoded PNG at a time. */
const average = (
  samples: readonly Uint8Array[],
  blend: MotionBlurBlendSpace,
  width = 1,
): { width: number; height: number; data: Uint8Array } => {
  const accumulator = new MotionBlurAccumulator(blend);
  for (const sample of samples) {
    accumulator.add(encodePng(width, sample.length / 4 / width, sample));
  }
  return accumulator.finish();
};

describe("resolveMotionBlurPlan", () => {
  it("is off when no options are given", () => {
    expect(resolveMotionBlurPlan(undefined)).toBeNull();
  });

  it("defaults to After Effects: 180 degree shutter, phase -90, sRGB, adaptive count", () => {
    const plan = resolveMotionBlurPlan({});
    expect(plan).not.toBeNull();
    expect(plan?.blend).toBe("srgb");
    expect(plan?.subFrameDivisions).toBe(4096);
    // A caller that never sets samplesPerFrame gets adaptive (null), not a fixed 16.
    expect(plan?.fixedSamplesPerFrame).toBeNull();
    // 180 degrees at phase -90 is a window of a quarter frame either side of the instant.
    expect(plan?.windowStartFrames).toBeCloseTo(-0.25, 10);
    expect(plan?.shutterFrames).toBeCloseTo(0.5, 10);
  });

  it("places 16 samples symmetrically across a quarter frame either side", () => {
    // From the shutter formula, by hand: offset_k = (-90/360 + ((k+0.5)/16) * 180/360)
    // frames, so k=0 is -0.234375 and k=15 is +0.234375. At 4096 ticks per frame that
    // is exactly -960 and +960, with 128 ticks between neighbours.
    const plan = resolveMotionBlurPlan({});
    if (!plan) throw new Error("plan");
    const offsets = offsetsAtFrame10Fps30(plan, 16);
    expect(offsets[0]).toBe(-960);
    expect(offsets[15]).toBe(960);
    expect(offsets).toHaveLength(16);
    const gaps = offsets.slice(1).map((t, i) => t - (offsets[i] as number));
    expect(new Set(gaps)).toEqual(new Set([128]));
  });

  it("clamps an explicit sample count to 1..64 and ignores non-finite input", () => {
    expect(resolveMotionBlurPlan({ samplesPerFrame: 200 })?.fixedSamplesPerFrame).toBe(
      MAX_SAMPLES_PER_FRAME,
    );
    expect(resolveMotionBlurPlan({ samplesPerFrame: 0 })?.fixedSamplesPerFrame).toBe(1);
    expect(resolveMotionBlurPlan({ samplesPerFrame: Number.NaN })?.fixedSamplesPerFrame).toBe(16);
  });

  it("follows the shutter window when the angle and phase are changed", () => {
    // The AD5 measurement of the real After Effects export: a window one frame either
    // side of t, which is shutterAngle 720 at phase -360.
    const plan = resolveMotionBlurPlan({ shutterAngle: 720, shutterPhase: -360 });
    if (!plan) throw new Error("plan");
    const offsets = offsetsAtFrame10Fps30(plan, 16);
    expect(offsets[0]).toBe(Math.round((-1 + 1 / 16) * 4096));
    expect(offsets[15]).toBe(Math.round((1 - 1 / 16) * 4096));
  });
});

describe("motionBlurSampleTimes", () => {
  it("returns ascending distinct sub-frame times around the frame instant, for the requested count", () => {
    const plan = resolveMotionBlurPlan({});
    if (!plan) throw new Error("plan");
    const times = motionBlurSampleTimes(plan, 10, 30, 16);

    // Frame 10 at 30fps is tick 40960 on the 122880-tick-per-second grid; the first
    // sample sits 960 ticks earlier and the last 960 later.
    expect(times[0]).toBe(40000 / 122880);
    expect(times[15]).toBe(41920 / 122880);
    expect(new Set(times).size).toBe(16);
    expect(times[0]).toBeLessThan(10 / 30);
    expect(times[15]).toBeGreaterThan(10 / 30);
  });

  it("clamps samples before the composition start to zero", () => {
    const plan = resolveMotionBlurPlan({});
    if (!plan) throw new Error("plan");
    const times = motionBlurSampleTimes(plan, 0, 30, 16);

    expect(times[0]).toBe(0);
    expect(times[15]).toBe(960 / 122880);
  });

  it("changing the count only changes how densely the SAME window is filled", () => {
    const plan = resolveMotionBlurPlan({});
    if (!plan) throw new Error("plan");
    const { windowStart, windowEnd } = motionBlurProbeTimes(plan, 10, 30);
    const times16 = motionBlurSampleTimes(plan, 10, 30, 16);
    const times64 = motionBlurSampleTimes(plan, 10, 30, 64);
    expect(times64).toHaveLength(64);
    // Every sample, at either count, stays strictly inside the true window edges, and
    // more samples pack closer to those edges (finer, not a wider or shifted window).
    for (const t of [...times16, ...times64]) {
      expect(t).toBeGreaterThan(windowStart);
      expect(t).toBeLessThan(windowEnd);
    }
    expect(times64[0] as number).toBeLessThan(times16[0] as number);
    expect(times64[63] as number).toBeGreaterThan(times16[15] as number);
  });
});

describe("motionBlurProbeTimes", () => {
  it("returns the TRUE window edges, outside every sample regardless of count", () => {
    const plan = resolveMotionBlurPlan({});
    if (!plan) throw new Error("plan");
    const { windowStart, windowEnd } = motionBlurProbeTimes(plan, 10, 30);
    const samples = motionBlurSampleTimes(plan, 10, 30, 16);

    expect(windowStart).toBeLessThan(samples[0] as number);
    expect(windowEnd).toBeGreaterThan(samples[15] as number);
  });
});

describe("adaptiveSampleCount", () => {
  it("is monotone non-decreasing and bottoms out at the first step's sample count", () => {
    expect(adaptiveSampleCount(0)).toBe(ADAPTIVE_SAMPLE_STEPS[0]?.samples);
    let previous = 0;
    for (const diff of [0, 1, 2, 3, 4, 5, 6, 7, 50]) {
      const count = adaptiveSampleCount(diff);
      expect(count).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
    expect(adaptiveSampleCount(1000)).toBe(MAX_SAMPLES_PER_FRAME);
  });
});

describe("probeDiffMagnitude", () => {
  const png = (r: number, g: number, b: number, a = 255) => encodePng(1, 1, solid(1, r, g, b, a));

  it("is zero for identical probes", () => {
    expect(probeDiffMagnitude(png(10, 20, 30), png(10, 20, 30))).toBe(0);
  });

  it("scales with the byte difference between probes", () => {
    // Per channel |0-255| for r,g,b and 0 for alpha (both opaque): mean = 3*255/4.
    expect(probeDiffMagnitude(png(0, 0, 0), png(255, 255, 255))).toBeCloseTo((3 * 255) / 4, 6);
  });

  it("rejects a geometry mismatch rather than diffing garbage", () => {
    expect(() => probeDiffMagnitude(encodePng(2, 1, solid(2, 0, 0, 0)), png(0, 0, 0))).toThrow(
      /geometry mismatch/,
    );
  });
});

describe("MotionBlurAccumulator", () => {
  it("averages opaque samples channel by channel in sRGB", () => {
    const blended = average([solid(2, 0, 10, 100), solid(2, 255, 30, 100)], "srgb", 2);
    // Independent: (0+255)/2 = 127.5 -> 128, (10+30)/2 = 20, (100+100)/2 = 100.
    expect([...blended.data.slice(0, 4)]).toEqual([128, 20, 100, 255]);
  });

  it("averages in linear light when asked, which lands well above the sRGB mean", () => {
    const blended = average([solid(1, 0, 64, 0), solid(1, 255, 192, 0)], "linear");
    // Independent (sRGB EOTF, mean, inverse EOTF): 0 with 255 -> 188, 64 with 192 -> 146.
    expect([...blended.data.slice(0, 4)]).toEqual([188, 146, 0, 255]);
  });

  it("returns a single sample unchanged", () => {
    expect([...average([solid(1, 7, 8, 9)], "srgb").data]).toEqual([7, 8, 9, 255]);
  });

  it("gives a transparent sample no colour weight and averages the alpha", () => {
    const blended = average([solid(1, 200, 0, 0, 255), solid(1, 0, 0, 0, 0)], "srgb");
    // The transparent sample contributes no colour, so the visible colour survives at
    // full strength while coverage halves.
    expect([...blended.data.slice(0, 4)]).toEqual([200, 0, 0, 128]);
  });

  it("rejects a sample whose geometry disagrees rather than blending garbage", () => {
    const accumulator = new MotionBlurAccumulator("srgb");
    accumulator.add(encodePng(2, 1, solid(2, 0, 0, 0)));
    expect(() => accumulator.add(encodePng(1, 2, solid(2, 0, 0, 0)))).toThrow(/geometry mismatch/);
  });

  it("refuses to finish with no samples rather than returning an empty frame", () => {
    expect(() => new MotionBlurAccumulator("srgb").finish()).toThrow(/no samples/);
  });

  it("holds precision across the full 64-sample maximum", () => {
    // Independent: the mean of 0, 4, 8 ... 252 is 126.
    const samples = Array.from({ length: 64 }, (_, k) => solid(1, 4 * k, 4 * k, 4 * k));
    expect([...average(samples, "srgb").data]).toEqual([126, 126, 126, 255]);
  });
});

describe("MotionBlurAccumulator geometry", () => {
  it("reports the decoded sample geometry", () => {
    const blended = average([solid(2, 0, 0, 0), solid(2, 100, 200, 40)], "srgb", 2);

    expect(blended.width).toBe(2);
    expect(blended.height).toBe(1);
    expect([...blended.data.slice(0, 4)]).toEqual([50, 100, 20, 255]);
  });
});
