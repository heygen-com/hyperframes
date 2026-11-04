import { resolveFrameFormat } from "@hyperframes/engine";
import type { ChunkSliceJson } from "../render/stages/freezePlan.js";
import type { PlanVideosJson } from "./shared.js";

/** Per-frame page cost, in megapixel-frames of jpg capture (measured: 0.03 s base / 0.045 s per MP). */
const PAGE_BASE_WEIGHT = 0.7;
/** png frames cost ~1.5x jpg per megapixel. */
const PNG_WEIGHT_FACTOR = 1.5;

/** Costs whose max/min stay within 5% count as uniform. */
function isUniformFrameCost(weights: Float64Array): boolean {
  let lightest = Infinity;
  let heaviest = 0;
  for (const weight of weights) {
    lightest = Math.min(lightest, weight);
    heaviest = Math.max(heaviest, weight);
  }
  return heaviest <= lightest * 1.05;
}

/** Estimated capture cost of every frame: page base plus each active video's pixels. */
export function planFrameWeights(input: {
  videos: PlanVideosJson["videos"];
  extracted: PlanVideosJson["extracted"];
  totalFrames: number;
  fps: number;
  width: number;
  height: number;
}): Float64Array {
  const { totalFrames, fps } = input;
  const delta = new Float64Array(totalFrames + 1);
  const outputPixels = input.width * input.height;
  const extractedById = new Map(input.extracted.map((entry) => [entry.videoId, entry]));
  for (const video of input.videos) {
    const entry = extractedById.get(video.id);
    if (!entry || video.hidden) continue;
    const start = Math.max(0, Math.round(video.start * fps));
    const end = Math.min(totalFrames, Math.round(video.end * fps));
    if (!(end > start)) continue;
    const { width, height } = entry.metadata;
    const factor = resolveFrameFormat(entry.metadata) === "png" ? PNG_WEIGHT_FACTOR : 1;
    const weight = (Math.min(width * height, outputPixels) / 1e6) * factor;
    delta[start] = delta[start]! + weight;
    delta[end] = delta[end]! - weight;
  }
  const weights = new Float64Array(totalFrames);
  let active = 0;
  for (let frame = 0; frame < totalFrames; frame++) {
    active += delta[frame]!;
    weights[frame] = PAGE_BASE_WEIGHT + active;
  }
  return weights;
}

export function withChunkCaptureCost(
  slices: ChunkSliceJson[],
  weights: Float64Array,
): ChunkSliceJson[] {
  const lightest = weights.reduce((least, weight) => Math.min(least, weight), Infinity);
  return slices.map((slice) => {
    let sum = 0;
    for (let frame = slice.startFrame; frame < slice.endFrame; frame++) sum += weights[frame]!;
    const cost = Math.round((sum / (slice.endFrame - slice.startFrame) / lightest) * 100) / 100;
    return cost > 1 ? { ...slice, captureCost: cost } : slice;
  });
}

export function effectiveChunkFrames(frames: number, captureCost = 1): number {
  return Math.round(frames * captureCost);
}

/**
 * Cut `[0, weights.length)` into `chunkCount` ranges of ~equal summed weight, each within
 * `[minFrames, maxFrames]` where the frame count allows. `null` when the cost is uniform.
 */
export function buildWeightedChunkSlices(
  weights: Float64Array,
  chunkCount: number,
  minFrames: number,
  maxFrames: number,
): ChunkSliceJson[] | null {
  if (isUniformFrameCost(weights)) return null;
  const totalFrames = weights.length;
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const minSize = Math.max(1, Math.min(minFrames, Math.floor(totalFrames / chunkCount)));
  const maxSize = Math.max(maxFrames, Math.ceil(totalFrames / chunkCount));
  const slices: ChunkSliceJson[] = [];
  let startFrame = 0;
  let frame = 0;
  let costBefore = 0;
  for (let index = 0; index < chunkCount - 1; index++) {
    const target = ((index + 1) * total) / chunkCount;
    // Advance while the boundary after `frame` lands nearer the target than the one before it.
    while (frame < totalFrames && costBefore + weights[frame]! / 2 < target) {
      costBefore += weights[frame++]!;
    }
    const remaining = chunkCount - index - 1;
    const low = Math.max(startFrame + minSize, totalFrames - remaining * maxSize);
    const high = Math.min(startFrame + maxSize, totalFrames - remaining * minSize);
    const endFrame = Math.min(high, Math.max(low, frame));
    slices.push({ index, startFrame, endFrame });
    startFrame = endFrame;
  }
  slices.push({ index: chunkCount - 1, startFrame, endFrame: totalFrames });
  return slices;
}
