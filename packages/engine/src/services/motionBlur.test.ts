import { describe, it, expect } from "vitest";
import {
  MAX_SAMPLES_PER_FRAME,
  MotionBlurAccumulator,
  motionBlurSampleTimes,
  resolveMotionBlurPlan,
  type MotionBlurBlendSpace,
} from "./motionBlur.js";
import { encodePng } from "../utils/alphaBlit.js";

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

  it("defaults to After Effects: 16 samples, 180 degree shutter, phase -90, sRGB", () => {
    const plan = resolveMotionBlurPlan({});
    expect(plan).not.toBeNull();
    expect(plan?.sampleTickOffsets).toHaveLength(16);
    expect(plan?.blend).toBe("srgb");
    // 180 degrees at phase -90 is a window of a quarter frame either side of the instant.
    expect(plan?.sampleTickOffsets[0]).toBe(-960);
    expect(plan?.sampleTickOffsets[15]).toBe(960);
  });

  it("places the default samples symmetrically across a quarter frame either side", () => {
    // From the shutter formula, by hand: offset_k = (-90/360 + ((k+0.5)/16) * 180/360)
    // frames, so k=0 is -0.234375 and k=15 is +0.234375. At 4096 ticks per frame that
    // is exactly -960 and +960, with 128 ticks between neighbours.
    const plan = resolveMotionBlurPlan({});
    expect(plan?.subFrameDivisions).toBe(4096);
    expect(plan?.sampleTickOffsets[0]).toBe(-960);
    expect(plan?.sampleTickOffsets[15]).toBe(960);
    expect(plan?.sampleTickOffsets).toHaveLength(16);
    const gaps = plan?.sampleTickOffsets
      .slice(1)
      .map((t, i) => t - (plan.sampleTickOffsets[i] as number));
    expect(new Set(gaps)).toEqual(new Set([128]));
  });

  it("clamps the sample count to 1..64 and ignores non-finite input", () => {
    expect(resolveMotionBlurPlan({ samplesPerFrame: 200 })?.sampleTickOffsets).toHaveLength(
      MAX_SAMPLES_PER_FRAME,
    );
    expect(resolveMotionBlurPlan({ samplesPerFrame: 0 })?.sampleTickOffsets).toHaveLength(1);
    expect(resolveMotionBlurPlan({ samplesPerFrame: Number.NaN })?.sampleTickOffsets).toHaveLength(
      16,
    );
  });

  it("follows the shutter window when the angle and phase are changed", () => {
    // The AD5 measurement of the real After Effects export: a window one frame either
    // side of t, which is shutterAngle 720 at phase -360.
    const plan = resolveMotionBlurPlan({ shutterAngle: 720, shutterPhase: -360 });
    expect(plan?.sampleTickOffsets[0]).toBe(Math.round((-1 + 1 / 16) * 4096));
    expect(plan?.sampleTickOffsets[15]).toBe(Math.round((1 - 1 / 16) * 4096));
  });
});

describe("motionBlurSampleTimes", () => {
  it("returns ascending distinct sub-frame times around the frame instant", () => {
    const plan = resolveMotionBlurPlan({});
    if (!plan) throw new Error("plan");
    const times = motionBlurSampleTimes(plan, 10, 30);

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
    const times = motionBlurSampleTimes(plan, 0, 30);

    expect(times[0]).toBe(0);
    expect(times[15]).toBe(960 / 122880);
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
