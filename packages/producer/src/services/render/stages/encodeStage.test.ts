import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { buildGifPalettegenArgs, buildGifPaletteuseArgs } from "./gifEncodeArgs.js";
import type { EncodeStageInput } from "./encodeStage.js";

const resolvedEngineConfig = { ffmpegEncodeTimeout: 12_345 };
const encodeFramesFromDirMock = mock(
  async (_framesDir: string, _framePattern: string, outputPath: string) => ({
    success: true,
    outputPath,
    durationMs: 1,
    framesEncoded: 1,
    fileSize: 1,
  }),
);
const encodeFramesChunkedConcatMock = mock(
  async (_framesDir: string, _framePattern: string, outputPath: string) => ({
    success: true,
    outputPath,
    durationMs: 1,
    framesEncoded: 1,
    fileSize: 1,
  }),
);
const runFfmpegMock = mock(async () => ({
  success: true,
  exitCode: 0,
  stderr: "",
  durationMs: 1,
}));

mock.module("@hyperframes/engine", () => ({
  DEFAULT_CONFIG: { ffmpegEncodeTimeout: 600_000 },
  encodeFramesChunkedConcat: encodeFramesChunkedConcatMock,
  encodeFramesFromDir: encodeFramesFromDirMock,
  formatFfmpegError: (code: number | null, stderr: string) => `${String(code)} ${stderr}`,
  getEncoderPreset: () => ({
    codec: "h264",
    preset: "ultrafast",
    quality: 28,
    pixelFormat: "yuv420p",
  }),
  resolveConfig: () => resolvedEngineConfig,
  runFfmpeg: runFfmpegMock,
}));

const tempDirs: string[] = [];

afterEach(() => {
  encodeFramesFromDirMock.mockClear();
  encodeFramesChunkedConcatMock.mockClear();
  runFfmpegMock.mockClear();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createFramesDir(ext: "jpg" | "png"): { root: string; framesDir: string } {
  const root = mkdtempSync(join(tmpdir(), "hf-encode-stage-"));
  tempDirs.push(root);
  const framesDir = join(root, "frames");
  mkdirSync(framesDir);
  writeFileSync(join(framesDir, `frame_000001.${ext}`), "stub");
  return { root, framesDir };
}

function makeInput(overrides: Partial<EncodeStageInput> = {}): EncodeStageInput {
  const paths = createFramesDir("jpg");
  return {
    job: {
      id: "encode-stage-config-test",
      config: {
        fps: { num: 30, den: 1 },
        quality: "draft",
      },
      status: "queued",
      progress: 0,
      currentStage: "queued",
      createdAt: new Date(0),
      duration: 1,
    },
    log: {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    },
    outputPath: join(paths.root, "out.mp4"),
    framesDir: paths.framesDir,
    videoOnlyPath: join(paths.root, "video-only.mp4"),
    width: 2,
    height: 2,
    needsAlpha: false,
    hasAudio: false,
    isPngSequence: false,
    isGif: false,
    preset: {
      codec: "h264",
      preset: "ultrafast",
      quality: 28,
      pixelFormat: "yuv420p",
    },
    effectiveQuality: 28,
    effectiveBitrate: undefined,
    enableChunkedEncode: false,
    chunkedEncodeSize: 30,
    abortSignal: undefined,
    assertNotAborted: () => {},
    ...overrides,
  };
}

describe("gif encode args", () => {
  const input = {
    framesDir: "/tmp/hf/captured-frames",
    framePattern: "frame_%06d.jpg",
    palettePath: "/tmp/hf/gif-palette.png",
    outputPath: "/tmp/hf/demo.gif",
    fps: { num: 15, den: 1 },
    loop: 0,
  };

  it("builds the palettegen pass with diff statistics", () => {
    expect(buildGifPalettegenArgs(input)).toEqual([
      "-y",
      "-framerate",
      "15",
      "-i",
      "/tmp/hf/captured-frames/frame_%06d.jpg",
      "-vf",
      "fps=15,palettegen=stats_mode=diff",
      "/tmp/hf/gif-palette.png",
    ]);
  });

  it("builds the paletteuse pass with Sierra dithering and loop count", () => {
    expect(buildGifPaletteuseArgs({ ...input, loop: 3 })).toEqual([
      "-y",
      "-framerate",
      "15",
      "-i",
      "/tmp/hf/captured-frames/frame_%06d.jpg",
      "-i",
      "/tmp/hf/gif-palette.png",
      "-lavfi",
      "fps=15 [x]; [x][1:v] paletteuse=dither=sierra2_4a",
      "-loop",
      "3",
      "/tmp/hf/demo.gif",
    ]);
  });
});

describe("runEncodeStage config plumbing", () => {
  it("scales the encode timeout for long compositions", async () => {
    const { runEncodeStage } = await import("./encodeStage.js");

    await runEncodeStage(
      makeInput({
        job: {
          ...makeInput().job,
          duration: 754.8,
        },
        engineConfig: { ffmpegEncodeTimeout: 600_000 },
      }),
    );

    expect(encodeFramesFromDirMock.mock.calls[0]?.[5]).toEqual({
      ffmpegEncodeTimeout: 3_019_200,
    });
  });

  it("prefers engine config supplied by the orchestrator", async () => {
    const { runEncodeStage } = await import("./encodeStage.js");
    const orchestratorEngineConfig = { ffmpegEncodeTimeout: 54_321 };

    await runEncodeStage(makeInput({ engineConfig: orchestratorEngineConfig }));

    expect(encodeFramesFromDirMock).toHaveBeenCalledTimes(1);
    expect(encodeFramesFromDirMock.mock.calls[0]?.[5]).toBe(orchestratorEngineConfig);
  });

  it("passes resolved engine config to encodeFramesFromDir", async () => {
    const { runEncodeStage } = await import("./encodeStage.js");

    await runEncodeStage(makeInput());

    expect(encodeFramesFromDirMock).toHaveBeenCalledTimes(1);
    expect(encodeFramesFromDirMock.mock.calls[0]?.[5]).toBe(resolvedEngineConfig);
  });

  it("passes resolved engine config to encodeFramesChunkedConcat", async () => {
    const { runEncodeStage } = await import("./encodeStage.js");

    await runEncodeStage(makeInput({ enableChunkedEncode: true }));

    expect(encodeFramesChunkedConcatMock).toHaveBeenCalledTimes(1);
    expect(encodeFramesChunkedConcatMock.mock.calls[0]?.[6]).toBe(resolvedEngineConfig);
  });

  it("uses resolved engine config for GIF ffmpeg timeouts", async () => {
    const { runEncodeStage } = await import("./encodeStage.js");
    const paths = createFramesDir("jpg");

    await runEncodeStage(
      makeInput({
        framesDir: paths.framesDir,
        outputPath: join(paths.root, "out.gif"),
        videoOnlyPath: join(paths.root, "video-only.mp4"),
        isGif: true,
      }),
    );

    expect(runFfmpegMock).toHaveBeenCalledTimes(2);
    expect(runFfmpegMock.mock.calls[0]?.[1]?.timeout).toBe(
      resolvedEngineConfig.ffmpegEncodeTimeout,
    );
    expect(runFfmpegMock.mock.calls[1]?.[1]?.timeout).toBe(
      resolvedEngineConfig.ffmpegEncodeTimeout,
    );
  });
});
