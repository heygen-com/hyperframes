import { resolveConfig, type ExtractionResult, type VideoElement } from "@hyperframes/engine";
import { describe, expect, it, vi } from "vitest";

const extractionCalls = vi.hoisted(
  () => new Array<{ timelineEnd: number | undefined; durationSeconds: number }>(),
);
const fixtureState = vi.hoisted(() => ({ sourceDurationSeconds: 60 }));

vi.mock("@hyperframes/engine", async (importOriginal) => {
  const real = await importOriginal<typeof import("@hyperframes/engine")>();
  return {
    ...real,
    extractAllVideoFrames: async (
      videos: VideoElement[],
      _baseDir: string,
      options: { timelineEnd?: number },
    ): Promise<ExtractionResult> => {
      const sourceDurationSeconds = fixtureState.sourceDurationSeconds;
      const video = videos[0];
      if (!video) throw new Error("timeline-bound fixture requires one video");
      const requestedDuration = video.end - video.start;
      const naturalDuration = sourceDurationSeconds - video.mediaStart;
      const resolvedDuration =
        Number.isFinite(requestedDuration) && requestedDuration > 0
          ? requestedDuration
          : naturalDuration;
      const durationSeconds =
        options.timelineEnd === undefined
          ? resolvedDuration
          : Math.min(resolvedDuration, Math.max(0, options.timelineEnd - video.start));
      video.end = video.start + durationSeconds;
      extractionCalls.push({ timelineEnd: options.timelineEnd, durationSeconds });
      return {
        success: true,
        extracted: [],
        errors: [],
        totalFramesExtracted: 0,
        durationMs: 0,
        phaseBreakdown: {
          resolveMs: 0,
          cachePublishFailures: 0,
          cacheGcEvictions: 0,
          cacheGcBytesFreed: 0,
          cacheAgedPartialsCleared: 0,
          hdrProbeMs: 0,
          hdrPreflightMs: 0,
          hdrPreflightCount: 0,
          vfrProbeMs: 0,
          vfrPreflightMs: 0,
          vfrPreflightCount: 0,
          extractMs: 0,
          cacheHits: 0,
          cacheMisses: 0,
          transientRetries: 0,
        },
      };
    },
  };
});

import { createRenderJob } from "../../renderOrchestrator.js";
import { runExtractVideosStage } from "./extractVideosStage.js";

async function runStage(compositionDuration: number, materializeSymlinks: boolean): Promise<void> {
  const composition = {
    duration: compositionDuration,
    videos: [
      {
        id: "root-video",
        src: "long.mp4",
        start: 0,
        end: Number.POSITIVE_INFINITY,
        mediaStart: 0,
        loop: false,
        hasAudio: false,
      },
    ],
    audios: [],
    images: [],
    width: 1920,
    height: 1080,
  };
  await runExtractVideosStage({
    projectDir: "/tmp/hf-timeline-bound-project",
    compiledDir: "/tmp/hf-timeline-bound-compiled",
    job: createRenderJob({
      fps: { num: 30, den: 1 },
      quality: "standard",
      hdrMode: "force-sdr",
    }),
    cfg: resolveConfig(),
    composition,
    abortSignal: undefined,
    assertNotAborted: () => {},
    materializeSymlinks,
  });
}

describe.each([
  ["in-process", false],
  ["distributed plan", true],
] as const)("%s video extraction timeline bound", (_mode, materializeSymlinks) => {
  it("caps an open 60-second source to a two-second composition", async () => {
    extractionCalls.splice(0);
    fixtureState.sourceDurationSeconds = 60;

    await runStage(2, materializeSymlinks);

    expect(extractionCalls).toEqual([{ timelineEnd: 2, durationSeconds: 2 }]);
  });

  it("keeps a two-second natural source inside a ten-second composition", async () => {
    extractionCalls.splice(0);
    fixtureState.sourceDurationSeconds = 2;

    await runStage(10, materializeSymlinks);

    expect(extractionCalls).toEqual([{ timelineEnd: 10, durationSeconds: 2 }]);
  });
});
