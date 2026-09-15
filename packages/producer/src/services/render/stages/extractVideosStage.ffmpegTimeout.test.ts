import { resolveConfig, type EngineConfig, type ExtractionResult } from "@hyperframes/engine";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The optional engine-config argument the stage passes to `extractAllVideoFrames`. */
type ExtractionConfigArg = Partial<EngineConfig> | undefined;

const capturedConfigs = vi.hoisted(() => new Array<ExtractionConfigArg>());

vi.mock("@hyperframes/engine", async (importOriginal) => {
  const real = await importOriginal<typeof import("@hyperframes/engine")>();
  return {
    ...real,
    extractAllVideoFrames: async (
      _videos: unknown,
      _baseDir: unknown,
      _options: unknown,
      _signal: unknown,
      config: ExtractionConfigArg,
    ): Promise<ExtractionResult> => {
      capturedConfigs.push(config);
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

async function runStage(cfg: EngineConfig): Promise<void> {
  const composition = {
    duration: 5,
    videos: [
      {
        id: "root-video",
        src: "clip.mp4",
        start: 0,
        end: 5,
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
    projectDir: "/tmp/hf-ffmpeg-timeout-project",
    compiledDir: "/tmp/hf-ffmpeg-timeout-compiled",
    job: createRenderJob({
      fps: { num: 30, den: 1 },
      quality: "standard",
      hdrMode: "force-sdr",
    }),
    cfg,
    composition,
    abortSignal: undefined,
    assertNotAborted: () => {},
    materializeSymlinks: false,
  });
}

describe("video extraction ffmpeg timeout threading", () => {
  beforeEach(() => {
    capturedConfigs.splice(0);
  });

  it("forwards a non-default FFMPEG_PROCESS_TIMEOUT_MS into the video extraction config", async () => {
    await runStage(resolveConfig({ ffmpegProcessTimeout: 5_000 }));

    expect(capturedConfigs).toEqual([expect.objectContaining({ ffmpegProcessTimeout: 5_000 })]);
  });

  it("forwards the default timeout unchanged when no override is configured", async () => {
    const cfg = resolveConfig();

    await runStage(cfg);

    expect(capturedConfigs).toEqual([
      expect.objectContaining({ ffmpegProcessTimeout: cfg.ffmpegProcessTimeout }),
    ]);
  });
});
