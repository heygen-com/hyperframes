import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendAutoDetectedVideoAudio,
  runExtractVideosStage,
  type ExtractVideosStageInput,
} from "./extractVideosStage.js";
import type { EngineConfig, ExtractedFrames, VideoElement } from "@hyperframes/engine";
import type { RenderJob } from "../../renderOrchestrator.js";

// Stub only the two boundaries the staging path crosses, so the regression
// below runs the REAL `runExtractVideosStage` (the exact function the render
// orchestrator invokes) without ffmpeg or disk:
//   - `extractAllVideoFrames` returns an empty extraction so the stage reaches
//     its `materializeExtractedFramesForCompiledDir` call without decoding.
//   - `materializeExtractedFramesForCompiledDir` is spied so we can assert the
//     `materializeSymlinks` value the caller propagated. Everything else in
//     both modules stays real.
const { extractAllVideoFramesMock, materializeSpy } = vi.hoisted(() => ({
  extractAllVideoFramesMock: vi.fn(async () => ({ extracted: [] as ExtractedFrames[] })),
  materializeSpy: vi.fn(),
}));

vi.mock("@hyperframes/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/engine")>();
  return { ...actual, extractAllVideoFrames: extractAllVideoFramesMock };
});

vi.mock("../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared.js")>();
  return { ...actual, materializeExtractedFramesForCompiledDir: materializeSpy };
});

function makeVideo(overrides: Partial<VideoElement> = {}): VideoElement {
  return {
    id: "v1",
    src: "clip.mp4",
    start: 0,
    end: 5,
    mediaStart: 0,
    loop: false,
    hasAudio: true,
    ...overrides,
  };
}

function makeExtracted(videoId: string, fileHasAudio: boolean): ExtractedFrames {
  return {
    videoId,
    srcPath: "/tmp/clip.mp4",
    outputDir: "/tmp/frames",
    framePattern: "frame_%05d.jpg",
    fps: 30,
    totalFrames: 150,
    framePaths: new Map(),
    metadata: {
      durationSeconds: 5,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "h264",
      hasAudio: fileHasAudio,
    },
  } as ExtractedFrames;
}

describe("appendAutoDetectedVideoAudio", () => {
  it("adds audio for an audible video whose file has an audio track", () => {
    const composition = { videos: [makeVideo()], audios: [] as never[] };
    appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", true)]);
    expect(composition.audios).toHaveLength(1);
    expect(composition.audios[0]).toMatchObject({
      id: "v1-audio",
      src: "clip.mp4",
    });
  });

  it("skips a muted video even when the source file has audio", () => {
    const composition = {
      videos: [makeVideo({ hasAudio: false })],
      audios: [] as never[],
    };
    appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", true)]);
    expect(composition.audios).toHaveLength(0);
  });

  it("skips when the source file has no audio track", () => {
    const composition = { videos: [makeVideo()], audios: [] as never[] };
    appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", false)]);
    expect(composition.audios).toHaveLength(0);
  });

  it("does not duplicate audio for a src already in the mix", () => {
    const composition = {
      videos: [makeVideo()],
      audios: [
        {
          id: "existing",
          src: "clip.mp4",
          start: 0,
          end: 5,
          mediaStart: 0,
          layer: 0,
          volume: 1,
          type: "video" as const,
        },
      ],
    };
    appendAutoDetectedVideoAudio(composition, [makeExtracted("v1", true)]);
    expect(composition.audios).toHaveLength(1);
  });
});

// Regression for the win32 bypass: the render orchestrator forced an eager copy
// on Windows (`materializeSymlinks: shouldCopyExtractedFrames(process.platform)`,
// which was `true`), so `stageExtractedFrameDirOnce` copied directly and the
// symlink → junction → copy ladder in `linkOrCopyFrameDir` was never reached on
// the very platform it was written to optimize. These tests pin the actual
// `runExtractVideosStage` contract at both call sites so it can't regress: the
// local render path must NOT request an eager copy, and only the distributed
// `plan()` may — proven at the stage the orchestrator really calls, not a helper.
describe("runExtractVideosStage — frame staging mode", () => {
  afterEach(() => {
    extractAllVideoFramesMock.mockClear();
    materializeSpy.mockClear();
  });

  function makeInput(overrides: Partial<ExtractVideosStageInput> = {}): ExtractVideosStageInput {
    return {
      projectDir: "/proj",
      compiledDir: "/proj/compiled",
      // force-sdr skips the HDR color-space probes, so the only engine call the
      // stage makes is the mocked `extractAllVideoFrames`.
      job: {
        config: { fps: 30, hdrMode: "force-sdr", videoFrameFormat: "auto" },
      } as unknown as RenderJob,
      cfg: {} as EngineConfig,
      composition: {
        duration: 5,
        videos: [makeVideo()],
        audios: [],
        images: [],
        width: 1920,
        height: 1080,
      },
      abortSignal: undefined,
      assertNotAborted: () => {},
      ...overrides,
    };
  }

  it("does not request an eager copy on the local render path (win32 must reach the symlink→junction→copy ladder, not bypass it)", async () => {
    await runExtractVideosStage(makeInput({ materializeSymlinks: false }));
    expect(materializeSpy).toHaveBeenCalledTimes(1);
    expect(materializeSpy.mock.calls[0]?.[2]).toEqual({ materializeSymlinks: false });
  });

  it("leaves staging on the ladder when the caller omits the flag (the safe default the local renderer relies on)", async () => {
    await runExtractVideosStage(makeInput());
    expect(materializeSpy).toHaveBeenCalledTimes(1);
    expect(materializeSpy.mock.calls[0]?.[2]?.materializeSymlinks).not.toBe(true);
  });

  it("requests an eager copy only when the distributed plan() explicitly asks for a self-contained dir", async () => {
    await runExtractVideosStage(makeInput({ materializeSymlinks: true }));
    expect(materializeSpy).toHaveBeenCalledTimes(1);
    expect(materializeSpy.mock.calls[0]?.[2]).toEqual({ materializeSymlinks: true });
  });
});
