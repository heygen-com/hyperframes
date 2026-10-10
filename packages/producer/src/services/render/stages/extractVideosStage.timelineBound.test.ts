import {
  resolveConfig,
  safeDownloadUrlIdentity,
  type ExtractionResult,
  type VideoElement,
} from "@hyperframes/engine";
import { describe, expect, it, vi } from "vitest";
import type { ProducerLogger } from "../../../logger.js";

const extractionCalls = vi.hoisted(
  () => new Array<{ timelineEnd: number | undefined; durationSeconds: number }>(),
);
const toneMapHdrToSdrCalls = vi.hoisted(() => new Array<boolean | undefined>());
const contentKeyedDirsCalls = vi.hoisted(() => new Array<readonly string[] | undefined>());
const requestedVideoIds = vi.hoisted(() => new Array<string[]>());
const fixtureState = vi.hoisted(() => ({ sourceDurationSeconds: 60 }));

vi.mock("@hyperframes/engine", async (importOriginal) => {
  const real = await importOriginal<typeof import("@hyperframes/engine")>();
  return {
    ...real,
    extractAllVideoFrames: async (
      videos: VideoElement[],
      _baseDir: string,
      options: {
        timelineEnd?: number;
        toneMapHdrToSdr?: boolean;
        contentKeyedDirs?: readonly string[];
      },
    ): Promise<ExtractionResult> => {
      requestedVideoIds.push(videos.map((v) => v.id));
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
      toneMapHdrToSdrCalls.push(options.toneMapHdrToSdr);
      contentKeyedDirsCalls.push(options.contentKeyedDirs);
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

import { join } from "node:path";
import { REMOTE_MEDIA_SUBDIR } from "../../htmlCompiler.js";
import { createRenderJob } from "../../renderOrchestrator.js";
import { runExtractVideosStage } from "./extractVideosStage.js";

async function runStage(
  compositionDuration: number,
  materializeSymlinks: boolean,
  options: { source?: string; log?: ProducerLogger; extraVideos?: VideoElement[] } = {},
): Promise<VideoElement[]> {
  const composition = {
    duration: compositionDuration,
    videos: [
      {
        id: "root-video",
        src: options.source ?? "long.mp4",
        start: 0,
        end: Number.POSITIVE_INFINITY,
        mediaStart: 0,
        loop: false,
        hasAudio: false,
      },
      ...(options.extraVideos ?? []),
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
    log: options.log,
    composition,
    abortSignal: undefined,
    assertNotAborted: () => {},
    materializeSymlinks,
  });
  return composition.videos;
}

describe.each([
  ["in-process", false],
  ["distributed plan", true],
] as const)("%s video extraction timeline bound", (_mode, materializeSymlinks) => {
  it("caps an open 60-second source to a two-second composition", async () => {
    extractionCalls.splice(0);
    toneMapHdrToSdrCalls.splice(0);
    fixtureState.sourceDurationSeconds = 60;

    await runStage(2, materializeSymlinks);

    expect(extractionCalls).toEqual([{ timelineEnd: 2, durationSeconds: 2 }]);
  });

  it("keeps a two-second natural source inside a ten-second composition", async () => {
    extractionCalls.splice(0);
    toneMapHdrToSdrCalls.splice(0);
    fixtureState.sourceDurationSeconds = 2;

    await runStage(10, materializeSymlinks);

    expect(extractionCalls).toEqual([{ timelineEnd: 10, durationSeconds: 2 }]);
  });

  it("requests HDR-to-SDR tone mapping for forced-SDR extraction", async () => {
    extractionCalls.splice(0);
    toneMapHdrToSdrCalls.splice(0);

    await runStage(2, materializeSymlinks);

    expect(toneMapHdrToSdrCalls).toEqual([true]);
  });

  it("drops clips starting at or after the end before extraction, keeping natural-length ones", async () => {
    requestedVideoIds.splice(0);
    const outside = (id: string, start: number, end: number): VideoElement => ({
      id,
      src: "outside.mp4",
      start,
      end,
      mediaStart: 0,
      loop: false,
      hasAudio: false,
    });

    const videos = await runStage(2, materializeSymlinks, {
      extraVideos: [
        outside("after-end", 2, 4),
        outside("just-before-end", 1.99, 0),
        outside("natural-length", 0, 0),
        outside("negative-natural-length", -1, 0),
      ],
    });

    const kept = ["root-video", "just-before-end", "natural-length", "negative-natural-length"];
    expect(requestedVideoIds).toEqual([kept]);
    expect(videos.map((v) => v.id)).toEqual(kept);
  });

  it("caches the compiled remote-media copies by content", async () => {
    contentKeyedDirsCalls.splice(0);

    await runStage(2, materializeSymlinks);

    expect(contentKeyedDirsCalls).toEqual([
      [join("/tmp/hf-timeline-bound-compiled", REMOTE_MEDIA_SUBDIR)],
    ]);
  });
});

describe("video extraction source logging", () => {
  it("keeps the actual logger message source-free and emits only safe remote metadata", async () => {
    const source =
      "https://media.customer-cdn.example/private/clip.mp4?X-Amz-Signature=must-not-log#fragment";
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    } satisfies ProducerLogger;

    await runStage(2, false, { source, log });

    const extractionCall = log.info.mock.calls.find(([message]) =>
      message.startsWith("Extracting frames from video"),
    );
    expect(extractionCall).toEqual([
      "Extracting frames from video 1/1",
      {
        sourceType: "remote",
        sourceFingerprint: `sha256:${safeDownloadUrlIdentity(source).urlFingerprint}`,
        host: "media.customer-cdn.example",
      },
    ]);
    const serializedCall = JSON.stringify(extractionCall);
    expect(serializedCall).not.toContain(source);
    expect(serializedCall).not.toContain("must-not-log");
    expect(serializedCall).not.toContain("/private/clip.mp4");
  });
});
