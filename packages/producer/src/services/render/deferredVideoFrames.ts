import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createFrameLookupTable,
  type EngineConfig,
  type ExtractedFrames,
  extractVideoFramesRange,
  type FrameRange,
  mediaIdPathSegment,
  runVideoExtractionWithRetry,
  type ShownBox,
  type VideoElement,
} from "@hyperframes/engine";
import { resolveRenderFpsConfig } from "../fileServer.js";

function contiguousRuns(sortedIndexes: readonly number[]): FrameRange[] {
  const runs: FrameRange[] = [];
  for (const index of sortedIndexes) {
    const last = runs[runs.length - 1];
    if (last && last.firstFrame + last.frames === index) last.frames++;
    else runs.push({ firstFrame: index, frames: 1 });
  }
  return runs;
}

/** The frame indexes each deferred video shows across `frames`, by video id. */
export function shownDeferredFrameIndexes(
  source: { videos: VideoElement[]; extracted: ExtractedFrames[] },
  frames: Iterable<number>,
  fps: { num: number; den: number },
): Map<string, Set<number>> {
  const shown = new Map<string, Set<number>>();
  const deferred = source.extracted.filter((video) => video.deferredRange);
  if (deferred.length === 0) return shown;
  const table = createFrameLookupTable(
    source.videos,
    deferred.map((video) => ({
      ...video,
      outputDir: "",
      framePaths: new Map(Array.from({ length: video.totalFrames }, (_, i) => [i, String(i)])),
    })),
    resolveRenderFpsConfig(fps).value,
  );
  for (const frame of frames) {
    const globalTime = (frame * fps.den) / fps.num;
    for (const [videoId, payload] of table.getActiveFramePayloads(globalTime)) {
      const indexes = shown.get(videoId) ?? new Set<number>();
      indexes.add(payload.frameIndex);
      shown.set(videoId, indexes);
    }
  }
  return shown;
}

/** Extracts the given frames of deferred videos under the names a full extraction gives them. */
export async function extractDeferredFrames(input: {
  videos: VideoElement[];
  extracted: ExtractedFrames[];
  frames: Iterable<number>;
  fps: { num: number; den: number };
  outputRoot: string;
  cfg: Pick<EngineConfig, "ffmpegProcessTimeout">;
  signal?: AbortSignal;
  /** Where the video's source is read from: a local path or a URL. May throw. */
  sourceOf: (video: ExtractedFrames) => string;
  shownBoxes?: ReadonlyMap<string, ShownBox>;
  /** The error to throw when the extractor returns no frame for an index the video shows. */
  onMissingFrame: (video: ExtractedFrames, index: number) => Error;
}): Promise<ExtractedFrames[]> {
  const deferred = input.extracted.filter((video) => video.deferredRange);
  if (deferred.length === 0) return [];
  const shown = shownDeferredFrameIndexes(input, input.frames, input.fps);
  return Promise.all(
    deferred.map(async (video) => {
      const outputDir = join(input.outputRoot, mediaIdPathSegment(video.videoId));
      const indexes = [...(shown.get(video.videoId) ?? [])].sort((a, b) => a - b);
      if (indexes.length === 0) {
        return { ...video, outputDir, framePaths: new Map<number, string>(), ownedByLookup: false };
      }
      const range = video.deferredRange!;
      const extracted = await extractVideoFramesRange(
        input.sourceOf(video),
        video.videoId,
        range.startTime,
        range.durationSeconds,
        {
          fps: input.fps,
          outputDir: input.outputRoot,
          format: range.format,
          frameRanges: contiguousRuns(indexes),
          shownBox: input.shownBoxes?.get(video.videoId),
        },
        input.signal,
        input.cfg,
      );
      const missing = indexes.find((index) => !extracted.framePaths.has(index));
      if (missing !== undefined) throw input.onMissingFrame(video, missing);
      return { ...video, outputDir, framePaths: extracted.framePaths, ownedByLookup: false };
    }),
  );
}

/**
 * Fills every deferred video in place with the frames a full extraction writes, into the folder it
 * already has. For a route that cannot read frames per segment.
 */
export async function extractAllDeferredFrames(
  extracted: ExtractedFrames[],
  input: {
    fps: { num: number; den: number };
    cfg: Pick<EngineConfig, "ffmpegProcessTimeout">;
    signal?: AbortSignal;
    sourceOf?: (video: ExtractedFrames) => string;
    maxTransientRetries?: number;
    onProgress?: (framesDone: number, framesTotal: number) => void;
  },
): Promise<void> {
  const framesTotal = extracted.reduce(
    (sum, video) => sum + (video.deferredRange ? video.totalFrames : 0),
    0,
  );
  let framesDone = 0;
  for (const video of extracted) {
    const range = video.deferredRange;
    if (!range) continue;
    const { result: filled } = await runVideoExtractionWithRetry(
      () =>
        extractVideoFramesRange(
          input.sourceOf?.(video) ?? video.srcPath,
          video.videoId,
          range.startTime,
          range.durationSeconds,
          { fps: input.fps, outputDir: dirname(video.outputDir), format: range.format },
          input.signal,
          input.cfg,
        ),
      {
        signal: input.signal,
        maxTransientRetries: input.maxTransientRetries,
        onRetry: () => {
          rmSync(video.outputDir, { recursive: true, force: true });
          mkdirSync(video.outputDir, { recursive: true });
        },
      },
    );
    if (filled.framePaths.size < video.totalFrames) {
      throw new Error(
        `[Render] video ${JSON.stringify(video.videoId)} has ${filled.framePaths.size} frames; ` +
          `it was expected to have ${video.totalFrames} frames.`,
      );
    }
    video.framePaths = filled.framePaths;
    delete video.deferredRange;
    framesDone += video.totalFrames;
    input.onProgress?.(framesDone, framesTotal);
  }
}
