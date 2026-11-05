import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  createFrameLookupTable,
  createVideoFrameInjector,
  type BeforeCaptureHook,
  type EngineConfig,
  type ExtractedFrames,
  type VideoElement,
} from "@hyperframes/engine";
import { resolveRenderFpsConfig } from "../fileServer.js";
import { extractDeferredFrames } from "./deferredVideoFrames.js";
import type { SegmentSlice } from "./segmentPlan.js";

export interface SegmentWorkerFrames {
  /** One hook for the worker's whole life, so a recycled session keeps it. */
  hook: BeforeCaptureHook;
  /** Extracts the frames `segment` shows and points the hook at them. */
  prepare(segment: SegmentSlice): Promise<void>;
  /** Deletes the segment's frames. Safe to call again. */
  release(): void;
}

export interface SegmentVideoFrames {
  forWorker(): SegmentWorkerFrames;
}

type FrameExtractor = typeof extractDeferredFrames;

function segmentFramesDir(rootDir: string, index: number): string {
  return join(rootDir, "segment-frames", `segment_${String(index).padStart(5, "0")}`);
}

/** Each worker reads only the video frames its current segment shows, and deletes them when the segment closes. */
export function createSegmentVideoFrames(input: {
  videos: VideoElement[];
  extracted: ExtractedFrames[];
  fps: { num: number; den: number };
  /** The render's work dir; frames go under `segment-frames/segment_NNNNN/`. */
  rootDir: string;
  cfg: EngineConfig;
  injectorOptions: Parameters<typeof createVideoFrameInjector>[1];
  abortSignal?: AbortSignal;
  sourceOf?: (video: ExtractedFrames) => string;
  extractFrames?: FrameExtractor;
}): SegmentVideoFrames {
  const extractFrames = input.extractFrames ?? extractDeferredFrames;
  const sourceOf = input.sourceOf ?? ((video: ExtractedFrames) => video.srcPath);
  const fullyExtracted = input.extracted.filter((video) => !video.deferredRange);

  return {
    forWorker() {
      let injector: BeforeCaptureHook | null = null;
      let folder: string | null = null;

      const release = () => {
        injector = null;
        if (folder) rmSync(folder, { recursive: true, force: true });
        folder = null;
      };

      return {
        hook: async (page, time, heldVideoTime) => {
          await injector?.(page, time, heldVideoTime);
        },
        release,
        async prepare(segment) {
          release();
          const dir = segmentFramesDir(input.rootDir, segment.index);
          folder = dir;
          try {
            rmSync(dir, { recursive: true, force: true });
            mkdirSync(dir, { recursive: true });
            const sliced = await extractFrames({
              videos: input.videos,
              extracted: input.extracted,
              frames: Array.from(
                { length: segment.endFrame - segment.startFrame },
                (_, i) => segment.startFrame + i,
              ),
              fps: input.fps,
              outputRoot: dir,
              cfg: input.cfg,
              signal: input.abortSignal,
              sourceOf,
              onMissingFrame: (video, index) =>
                new Error(
                  `[Render] video ${JSON.stringify(video.videoId)} has no frame ${index}; ` +
                    `it was expected to have ${video.totalFrames} frames.`,
                ),
            });
            const table = createFrameLookupTable(
              input.videos,
              [...fullyExtracted, ...sliced],
              resolveRenderFpsConfig(input.fps).value,
            );
            injector = createVideoFrameInjector(table, input.injectorOptions);
          } catch (error) {
            release();
            throw error;
          }
        },
      };
    },
  };
}
