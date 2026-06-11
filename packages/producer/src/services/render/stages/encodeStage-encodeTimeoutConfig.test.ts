import { describe, expect, it, mock } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Mocks for runEncodeStage tests ───────────────────────────────────────────
// Capture the trailing `config` argument passed to encodeFramesFromDir so we
// can assert the encode stage threads `producerConfig ?? resolveConfig()`
// through (regression for #1348 — the call site dropped the 6th argument, so
// ffmpegEncodeTimeout always fell back to the hardcoded default and
// FFMPEG_ENCODE_TIMEOUT_MS was silently ignored).
const encodeCalls: { config: unknown }[] = [];
const runFfmpegCalls: { timeout: number | undefined }[] = [];
let resolveConfigCalls = 0;

const RESOLVED_ENCODE_TIMEOUT = 67_890;

const successResult = {
  success: true,
  outputPath: "/tmp/hf-encode-test/out.mp4",
  durationMs: 1,
  framesEncoded: 1,
  fileSize: 1,
};

mock.module("@hyperframes/engine", () => ({
  encodeFramesFromDir: async (
    _framesDir: string,
    _framePattern: string,
    _outputPath: string,
    _options: unknown,
    _signal: AbortSignal | undefined,
    config: unknown,
  ) => {
    encodeCalls.push({ config });
    return successResult;
  },
  encodeFramesChunkedConcat: async () => successResult,
  runFfmpeg: async (_args: string[], opts: { timeout?: number }) => {
    runFfmpegCalls.push({ timeout: opts.timeout });
    return { success: true, exitCode: 0, stderr: "", stdout: "" };
  },
  formatFfmpegError: (exitCode: number, stderr: string) => `exit ${exitCode}: ${stderr}`,
  getEncoderPreset: () => ({
    preset: "veryfast",
    quality: 23,
    codec: "h264",
    pixelFormat: "yuv420p",
  }),
  resolveConfig: () => {
    resolveConfigCalls += 1;
    return { ffmpegEncodeTimeout: RESOLVED_ENCODE_TIMEOUT };
  },
}));

// Minimal EngineConfig for the producerConfig-present case. Same field set as
// probeStage.test.ts — the full interface so the literal satisfies EngineConfig.
function makeProducerConfig(ffmpegEncodeTimeout: number) {
  return {
    forceScreenshot: false,
    lowMemoryMode: false,
    fps: 30,
    quality: "standard" as const,
    format: "jpeg" as const,
    jpegQuality: 80,
    concurrency: "auto" as const,
    coresPerWorker: 2.5,
    minParallelFrames: 120,
    largeRenderThreshold: 1000,
    disableGpu: false,
    browserGpuMode: "software" as const,
    enableBrowserPool: false,
    browserTimeout: 120_000,
    protocolTimeout: 300_000,
    enableChunkedEncode: false,
    chunkSizeFrames: 360,
    enableStreamingEncode: false,
    streamingEncodeMaxDurationSeconds: 240,
    ffmpegEncodeTimeout,
    ffmpegProcessTimeout: 300_000,
    ffmpegStreamingTimeout: 600_000,
    hdr: false,
    hdrAutoDetect: true,
    audioGain: 1,
    frameDataUriCacheLimit: 256,
    frameDataUriCacheBytesLimitMb: 1500,
    playerReadyTimeout: 45_000,
    renderReadyTimeout: 15_000,
    verifyRuntime: true,
    debug: false,
  };
}

function makeEncodeInput(overrides: {
  producerConfig?: ReturnType<typeof makeProducerConfig>;
  isGif?: boolean;
  framesDir?: string;
}) {
  const workDir = mkdtempSync(join(tmpdir(), "hf-encode-stage-test-"));
  return {
    job: {
      id: "encode-test",
      config: {
        fps: { num: 30, den: 1 },
        quality: "standard" as const,
        producerConfig: overrides.producerConfig,
      },
      status: "rendering" as const,
      progress: 0,
      currentStage: "Encode",
      createdAt: new Date(0),
    },
    log: {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    },
    outputPath: join(workDir, overrides.isGif ? "out.gif" : "out.mp4"),
    framesDir: overrides.framesDir ?? workDir,
    videoOnlyPath: join(workDir, "video-only.mp4"),
    width: 640,
    height: 360,
    needsAlpha: false,
    hasAudio: false,
    isPngSequence: false,
    isGif: overrides.isGif ?? false,
    preset: {
      preset: "veryfast",
      quality: 23,
      codec: "h264" as const,
      pixelFormat: "yuv420p",
    },
    effectiveQuality: 23,
    effectiveBitrate: undefined,
    enableChunkedEncode: false,
    chunkedEncodeSize: 360,
    abortSignal: undefined,
    assertNotAborted: () => {},
  };
}

function resetCaptures() {
  encodeCalls.length = 0;
  runFfmpegCalls.length = 0;
  resolveConfigCalls = 0;
}

describe("runEncodeStage — encode timeout config threading (#1348)", () => {
  it("passes producerConfig as the trailing config argument when present", async () => {
    resetCaptures();
    const { runEncodeStage } = await import("./encodeStage.js");

    const producerConfig = makeProducerConfig(12_345);
    await runEncodeStage(makeEncodeInput({ producerConfig }));

    expect(encodeCalls.length).toBe(1);
    const config = encodeCalls[0].config as { ffmpegEncodeTimeout: number };
    expect(config.ffmpegEncodeTimeout).toBe(12_345);
    // The pre-resolved distributed-render config wins; env is not re-read.
    expect(resolveConfigCalls).toBe(0);
  });

  it("falls back to resolveConfig() when producerConfig is absent (in-process renders)", async () => {
    resetCaptures();
    const { runEncodeStage } = await import("./encodeStage.js");

    await runEncodeStage(makeEncodeInput({}));

    expect(encodeCalls.length).toBe(1);
    expect(resolveConfigCalls).toBe(1);
    const config = encodeCalls[0].config as { ffmpegEncodeTimeout: number };
    expect(config.ffmpegEncodeTimeout).toBe(RESOLVED_ENCODE_TIMEOUT);
  });

  it("threads the resolved timeout into the GIF two-pass encode", async () => {
    resetCaptures();
    const { runEncodeStage } = await import("./encodeStage.js");

    // encodeGifFromDir reads the frames dir for real, so seed one frame.
    const framesDir = mkdtempSync(join(tmpdir(), "hf-encode-stage-gif-frames-"));
    writeFileSync(join(framesDir, "frame_000001.jpg"), "");

    await runEncodeStage(makeEncodeInput({ isGif: true, framesDir }));

    // Two ffmpeg passes (palettegen + paletteuse), both with the env-aware timeout.
    expect(runFfmpegCalls.length).toBe(2);
    expect(resolveConfigCalls).toBe(1);
    expect(runFfmpegCalls[0].timeout).toBe(RESOLVED_ENCODE_TIMEOUT);
    expect(runFfmpegCalls[1].timeout).toBe(RESOLVED_ENCODE_TIMEOUT);
  });
});
