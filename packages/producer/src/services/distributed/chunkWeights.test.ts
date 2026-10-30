import { describe, expect, it } from "bun:test";
import {
  buildWeightedChunkSlices,
  effectiveChunkFrames,
  planFrameWeights,
} from "./chunkWeights.js";
import {
  buildChunkSlices,
  buildPlanChunkSlices,
  MAX_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  resolveChunkPlan,
} from "./plan.js";
import type { PlanVideosJson } from "./shared.js";

type Slices = ReturnType<typeof buildChunkSlices>;

function chunkCosts(weights: Float64Array, slices: Slices) {
  return slices.map((slice) =>
    weights.slice(slice.startFrame, slice.endFrame).reduce((sum, weight) => sum + weight, 0),
  );
}

function expectExactCover(slices: Slices, totalFrames: number) {
  expect(slices[0]?.startFrame).toBe(0);
  expect(slices.at(-1)?.endFrame).toBe(totalFrames);
  slices.forEach((slice, index) => {
    expect(slice.index).toBe(index);
    expect(slice.endFrame).toBeGreaterThan(slice.startFrame);
    if (index > 0) expect(slice.startFrame).toBe(slices[index - 1]?.endFrame ?? -1);
  });
}

function weightsWithHeavyWindow(totalFrames: number, from: number, to: number, heavy: number) {
  const weights = new Float64Array(totalFrames).fill(1);
  weights.fill(heavy, from, to);
  return weights;
}

function video(id: string, start: number, end: number, hidden?: boolean) {
  return { id, start, end, hidden } as PlanVideosJson["videos"][number];
}

function extractedVideo(videoId: string, width: number, height: number, hasAlpha = false) {
  return {
    videoId,
    metadata: { width, height, hasAlpha, videoCodec: "h264" },
  } as PlanVideosJson["extracted"][number];
}

describe("buildPlanChunkSlices", () => {
  it.each([
    [1500, 18],
    [660, 16],
    [121, 12],
    [50, 16],
    [1, 16],
    [54000, 256],
  ])("uniform cost keeps the equal-frame cut (%d frames, max %d chunks)", (frames, max) => {
    const { chunkCount, effectiveChunkSize } = resolveChunkPlan(frames, undefined, max);
    const fullLengthVideo = planFrameWeights({
      videos: [video("v", 0, frames)],
      extracted: [extractedVideo("v", 1920, 1080)],
      totalFrames: frames,
      fps: 1,
      width: 1920,
      height: 1080,
    });
    for (const weights of [new Float64Array(frames).fill(0.7), fullLengthVideo]) {
      expect(buildPlanChunkSlices(weights, {}, chunkCount, effectiveChunkSize)).toEqual(
        buildChunkSlices(frames, chunkCount, effectiveChunkSize),
      );
    }
  });

  it("balances a heavy window across the same number of chunks", () => {
    const frames = 1500;
    const { chunkCount, effectiveChunkSize } = resolveChunkPlan(frames, undefined, 18);
    const weights = weightsWithHeavyWindow(frames, 700, 783, 4);
    const slices = buildPlanChunkSlices(weights, {}, chunkCount, effectiveChunkSize);

    expect(slices).toHaveLength(chunkCount);
    expectExactCover(slices, frames);
    for (const slice of slices) {
      expect(slice.endFrame - slice.startFrame).toBeGreaterThanOrEqual(MIN_CHUNK_SIZE);
    }
    const costs = chunkCosts(weights, slices);
    const mean = costs.reduce((sum, cost) => sum + cost, 0) / costs.length;
    expect(Math.max(...costs)).toBeLessThanOrEqual(mean * 1.15);

    const uniformCosts = chunkCosts(
      weights,
      buildChunkSlices(frames, chunkCount, effectiveChunkSize),
    );
    expect(Math.max(...uniformCosts)).toBeGreaterThan(mean * 1.5);
    const heavyChunk = slices.find((slice) => slice.startFrame <= 740 && slice.endFrame > 740);
    expect((heavyChunk?.endFrame ?? 0) - (heavyChunk?.startFrame ?? 0)).toBeLessThan(
      effectiveChunkSize,
    );
  });

  it("keeps the equal-frame cut when the caller passed a chunkSize", () => {
    const weights = weightsWithHeavyWindow(1500, 700, 783, 4);
    const ranges = (slices: Slices) =>
      slices.map(({ index, startFrame, endFrame }) => ({ index, startFrame, endFrame }));
    expect(ranges(buildPlanChunkSlices(weights, { chunkSize: 84 }, 18, 84))).toEqual(
      buildChunkSlices(1500, 18, 84),
    );
  });

  it.each([
    [25, 16],
    [11, 16],
    [12, 1],
  ])("stays a valid cover on tiny compositions (%d frames, max %d chunks)", (frames, max) => {
    const { chunkCount, effectiveChunkSize } = resolveChunkPlan(frames, undefined, max);
    const weights = weightsWithHeavyWindow(frames, 0, 3, 6);
    const slices = buildPlanChunkSlices(weights, {}, chunkCount, effectiveChunkSize);
    expect(slices).toHaveLength(chunkCount);
    expectExactCover(slices, frames);
    for (const slice of slices) {
      expect(slice.endFrame - slice.startFrame).toBeGreaterThanOrEqual(
        Math.floor(frames / chunkCount),
      );
    }
  });

  it("keeps every chunk under MAX_CHUNK_SIZE or the equal cut, whichever is larger", () => {
    const frames = 9000;
    const weights = weightsWithHeavyWindow(frames, 0, 100, 50);
    const slices = buildPlanChunkSlices(weights, {}, 2, 4500);
    expectExactCover(slices, frames);
    for (const slice of slices) expect(slice.endFrame - slice.startFrame).toBeLessThanOrEqual(4500);

    const fourChunks = buildPlanChunkSlices(
      weightsWithHeavyWindow(frames, 0, 100, 200),
      {},
      4,
      2250,
    );
    expectExactCover(fourChunks, frames);
    for (const slice of fourChunks) {
      expect(slice.endFrame - slice.startFrame).toBeLessThanOrEqual(MAX_CHUNK_SIZE);
    }
  });

  it("keeps targetChunkFrames as a per-chunk frame ceiling", () => {
    const frames = 1500;
    const { chunkCount, effectiveChunkSize } = resolveChunkPlan(frames, undefined, 18, 120);
    const weights = weightsWithHeavyWindow(frames, 700, 783, 4);
    const slices = buildPlanChunkSlices(
      weights,
      { targetChunkFrames: 120 },
      chunkCount,
      effectiveChunkSize,
    );
    expect(slices).toHaveLength(chunkCount);
    expectExactCover(slices, frames);
    for (const slice of slices) expect(slice.endFrame - slice.startFrame).toBeLessThanOrEqual(120);
  });
});

describe("buildWeightedChunkSlices", () => {
  it("returns null for uniform cost so the caller keeps the equal-frame cut", () => {
    expect(buildWeightedChunkSlices(new Float64Array(100).fill(2), 4, 10, 3600)).toBeNull();
  });
});

describe("planFrameWeights", () => {
  const base = { totalFrames: 100, fps: 10, width: 3840, height: 2160 };
  const uhd = (3840 * 2160) / 1e6;

  it("weights active frames by video megapixels and frame format", () => {
    const weights = planFrameWeights({
      ...base,
      videos: [video("jpg", 1, 3), video("png", 2, 4), video("hidden", 0, 10, true)],
      extracted: [
        extractedVideo("jpg", 3840, 2160),
        extractedVideo("png", 3840, 2160, true),
        extractedVideo("hidden", 3840, 2160),
      ],
    });
    expect(weights[5]).toBeCloseTo(0.7);
    expect(weights[15]).toBeCloseTo(0.7 + uhd);
    expect(weights[25]).toBeCloseTo(0.7 + uhd + 1.5 * uhd);
    expect(weights[35]).toBeCloseTo(0.7 + 1.5 * uhd);
    expect(weights[40]).toBeCloseTo(0.7);
  });

  it("caps megapixels at the composition size and clamps windows to the timeline", () => {
    const weights = planFrameWeights({
      ...base,
      width: 1920,
      height: 1080,
      videos: [video("big", -5, 500), video("unextracted", 0, 5)],
      extracted: [extractedVideo("big", 3840, 2160)],
    });
    expect(weights).toHaveLength(100);
    expect(weights[0]).toBeCloseTo(0.7 + (1920 * 1080) / 1e6);
    expect(weights[99]).toBeCloseTo(0.7 + (1920 * 1080) / 1e6);
  });

  it("holds every chunk to the worker time limit's frame cap", () => {
    const frames = 1500;
    const { chunkCount, effectiveChunkSize } = resolveChunkPlan(frames, undefined, 18);
    const weights = weightsWithHeavyWindow(frames, 700, 783, 4);
    const capped = buildPlanChunkSlices(weights, {}, chunkCount, effectiveChunkSize, 90);
    expectExactCover(capped, frames);
    for (const slice of capped) expect(slice.endFrame - slice.startFrame).toBeLessThanOrEqual(90);

    const uncapped = buildPlanChunkSlices(weights, {}, chunkCount, effectiveChunkSize);
    expect(Math.max(...uncapped.map((s) => s.endFrame - s.startFrame))).toBeGreaterThan(90);
  });
});

describe("chunk capture cost", () => {
  const frames = 1500;
  const weights = weightsWithHeavyWindow(frames, 700, 783, 4);
  const { chunkCount, effectiveChunkSize } = resolveChunkPlan(frames, undefined, 22);
  const slices = buildPlanChunkSlices(weights, {}, chunkCount, effectiveChunkSize);

  it("stamps the costly window's chunks and leaves light chunks unmarked", () => {
    const window = slices.filter((s) => s.startFrame < 783 && s.endFrame > 700);
    expect(window.length).toBeGreaterThan(0);
    for (const slice of window) expect(slice.captureCost).toBeGreaterThan(1);
    expect(slices[0]?.captureCost).toBeUndefined();
  });

  it("sizes a short costly chunk like the longer light chunks beside it", () => {
    const short = slices.filter(
      (s) => s.captureCost !== undefined && s.endFrame - s.startFrame < 60,
    );
    expect(short.length).toBeGreaterThan(0);
    for (const slice of short) {
      expect(
        effectiveChunkFrames(slice.endFrame - slice.startFrame, slice.captureCost),
      ).toBeGreaterThanOrEqual(60);
    }
  });

  it("keeps a light chunk's frame count as is", () => {
    expect(effectiveChunkFrames(75, undefined)).toBe(75);
  });
});
