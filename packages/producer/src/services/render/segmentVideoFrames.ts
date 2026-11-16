import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "puppeteer-core";
import {
  createFrameLookupTable,
  createVideoFrameInjector,
  type BeforeCaptureHook,
  type EngineConfig,
  type ExtractedFrames,
  type ShownBox,
  type VideoElement,
} from "@hyperframes/engine";
import { resolveRenderFpsConfig } from "../fileServer.js";
import { extractDeferredFrames } from "./deferredVideoFrames.js";
import type { SegmentSlice } from "./segmentPlan.js";

export interface SegmentWorkerFrames {
  /**
   * One hook for the worker's whole life, so a recycled session keeps it. Inside a
   * prepared window it injects from the window; outside one it extracts the frames
   * it is asked for and removes them again.
   */
  hook: BeforeCaptureHook;
  /** Extracts the frames `segment` shows and points the hook at them. */
  prepare(segment: SegmentSlice): Promise<void>;
  /** Deletes the segment's frames. Safe to call again. */
  release(): void;
}

export interface SegmentVideoFrames {
  forWorker(): SegmentWorkerFrames;
  /** Extracts the given output frames into `segment-frames/<name>/` ahead of time; `release()` is idempotent. */
  forFrames(
    frames: readonly number[],
    name: string,
  ): Promise<{ injector(): BeforeCaptureHook | null; release(): void }>;
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
  shownBoxes?: ReadonlyMap<string, ShownBox>;
  extractFrames?: FrameExtractor;
}): SegmentVideoFrames {
  const extractFrames = input.extractFrames ?? extractDeferredFrames;
  const sourceOf = input.sourceOf ?? ((video: ExtractedFrames) => video.srcPath);
  const fullyExtracted = input.extracted.filter((video) => !video.deferredRange);

  /** Extracts the given output frames into `dir` and returns a lookup over them plus the fully extracted videos. */
  const tableFor = async (frames: number[], dir: string) => {
    const sliced = await extractFrames({
      videos: input.videos,
      extracted: input.extracted,
      frames,
      fps: input.fps,
      outputRoot: dir,
      cfg: input.cfg,
      signal: input.abortSignal,
      sourceOf,
      shownBoxes: input.shownBoxes,
      onMissingFrame: (video, index) =>
        new Error(
          `[Render] video ${JSON.stringify(video.videoId)} has no frame ${index}; ` +
            `it was expected to have ${video.totalFrames} frames.`,
        ),
    });
    return createFrameLookupTable(
      input.videos,
      [...fullyExtracted, ...sliced],
      resolveRenderFpsConfig(input.fps).value,
    );
  };
  const injectorFor = async (frames: number[], dir: string): Promise<BeforeCaptureHook | null> =>
    createVideoFrameInjector(await tableFor(frames, dir), input.injectorOptions);

  /**
   * The drawElement self-verify runs the hook at session open and after every
   * recycle, outside any prepared window, to photograph the video frames the
   * full route would show. Each call reads just the frames it is asked for.
   */
  let onDemandCalls = 0;
  const onDemandHook = (): BeforeCaptureHook =>
    Object.assign(
      async (page: Page, time: number, heldVideoTime?: number) => {
        const dir = join(
          input.rootDir,
          "segment-frames",
          `on-demand_${String(onDemandCalls++).padStart(5, "0")}`,
        );
        try {
          const frames = [time, heldVideoTime]
            .filter((t): t is number => t !== undefined)
            .map((t) => Math.round((t * input.fps.num) / input.fps.den));
          const injector = await injectorFor(frames, dir);
          await injector?.(page, time, heldVideoTime);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
      { fresh: onDemandHook },
    );

  return {
    async forFrames(frames, name) {
      const dir = join(input.rootDir, "segment-frames", name);
      const release = () => rmSync(dir, { recursive: true, force: true });
      try {
        release();
        mkdirSync(dir, { recursive: true });
        const table = await tableFor([...frames], dir);
        return { injector: () => createVideoFrameInjector(table, input.injectorOptions), release };
      } catch (error) {
        release();
        throw error;
      }
    },
    forWorker() {
      let injector: BeforeCaptureHook | null = null;
      let folder: string | null = null;
      const onDemand = onDemandHook();

      const release = () => {
        injector = null;
        if (folder) rmSync(folder, { recursive: true, force: true });
        folder = null;
      };

      return {
        hook: Object.assign(
          (page: Page, time: number, heldVideoTime?: number) =>
            (injector ?? onDemand)(page, time, heldVideoTime),
          { fresh: onDemandHook },
        ),
        release,
        async prepare(segment) {
          release();
          const dir = segmentFramesDir(input.rootDir, segment.index);
          folder = dir;
          try {
            rmSync(dir, { recursive: true, force: true });
            mkdirSync(dir, { recursive: true });
            injector = await injectorFor(
              Array.from(
                { length: segment.endFrame - segment.startFrame },
                (_, i) => segment.startFrame + i,
              ),
              dir,
            );
          } catch (error) {
            release();
            throw error;
          }
        },
      };
    },
  };
}
