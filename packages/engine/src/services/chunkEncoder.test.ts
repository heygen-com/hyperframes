import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import { ENCODER_PRESETS, getEncoderPreset, buildEncoderArgs } from "./chunkEncoder.js";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEElEQVR4nGP8wwACLGCSAQANBAECv1AVswAAAABJRU5ErkJggg==",
  "base64",
);

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.resetModules();
  vi.doUnmock("child_process");
  vi.useRealTimers();
});

function createFrameFixture(): { root: string; framesDir: string } {
  const root = mkdtempSync(join(tmpdir(), "hf-chunk-encoder-"));
  tempDirs.push(root);
  const framesDir = join(root, "frames");
  mkdirSync(framesDir);
  for (let i = 1; i <= 2; i++) {
    writeFileSync(join(framesDir, `frame_${String(i).padStart(6, "0")}.png`), TINY_PNG);
  }
  return { root, framesDir };
}

const tinyEncodeOptions = {
  fps: { num: 30, den: 1 },
  width: 2,
  height: 2,
  codec: "h264" as const,
  preset: "ultrafast",
  quality: 28,
  pixelFormat: "yuv420p",
  useGpu: false,
};

function encodeTimeoutMessage(timeoutMs: number): string {
  return `FFmpeg killed after exceeding ffmpegEncodeTimeout (${timeoutMs} ms)`;
}

type FakeProc = EventEmitter & {
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
};

type SpawnCall = {
  command: string;
  args: readonly string[];
  proc: FakeProc;
};

function createFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn(() => {
    proc.killed = true;
    return true;
  });
  proc.killed = false;
  return proc;
}

function createSpawnSpy(): {
  spawn: (command: string, args: readonly string[]) => FakeProc;
  calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  const spawn = (command: string, args: readonly string[]): FakeProc => {
    const proc = createFakeProc();
    calls.push({ command, args, proc });
    return proc;
  };
  return { spawn, calls };
}

function emitClose(proc: FakeProc, code: number): void {
  proc.emit("exit", code);
  proc.emit("close", code);
}

describe("ENCODER_PRESETS", () => {
  it("has draft, standard, and high presets", () => {
    expect(ENCODER_PRESETS).toHaveProperty("draft");
    expect(ENCODER_PRESETS).toHaveProperty("standard");
    expect(ENCODER_PRESETS).toHaveProperty("high");
  });

  it("draft uses ultrafast preset with high CRF", () => {
    expect(ENCODER_PRESETS.draft.preset).toBe("ultrafast");
    expect(ENCODER_PRESETS.draft.quality).toBeGreaterThan(ENCODER_PRESETS.standard.quality);
    expect(ENCODER_PRESETS.draft.codec).toBe("h264");
  });

  it("high uses slow preset with low CRF for better quality", () => {
    expect(ENCODER_PRESETS.high.preset).toBe("slow");
    expect(ENCODER_PRESETS.high.quality).toBeLessThan(ENCODER_PRESETS.standard.quality);
    expect(ENCODER_PRESETS.high.codec).toBe("h264");
  });

  it("standard sits between draft and high in quality", () => {
    expect(ENCODER_PRESETS.standard.quality).toBeGreaterThan(ENCODER_PRESETS.high.quality);
    expect(ENCODER_PRESETS.standard.quality).toBeLessThan(ENCODER_PRESETS.draft.quality);
  });
});

describe("encodeFramesFromDir ffmpegEncodeTimeout", () => {
  it("kills ffmpeg when config timeout elapses", async () => {
    vi.useFakeTimers();
    const { spawn, calls } = createSpawnSpy();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { encodeFramesFromDir } = await import("./chunkEncoder.js");
    const { root, framesDir } = createFrameFixture();

    const encodePromise = encodeFramesFromDir(
      framesDir,
      "frame_%06d.png",
      join(root, "timeout.mp4"),
      tinyEncodeOptions,
      undefined,
      { ffmpegEncodeTimeout: 1000 },
    );

    expect(calls).toHaveLength(1);
    const proc = calls[0]!.proc;
    vi.advanceTimersByTime(999);
    expect(proc.kill).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");

    proc.stderr.emit("data", Buffer.from("terminated by timeout\n"));
    emitClose(proc, 143);

    const result = await encodePromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain("FFmpeg exited with code 143");
    expect(result.error).toContain("terminated by timeout");
    expect(result.error).toContain(encodeTimeoutMessage(1000));
  });

  it("keeps non-timeout ffmpeg failures unchanged", async () => {
    vi.useFakeTimers();
    const { spawn, calls } = createSpawnSpy();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { encodeFramesFromDir } = await import("./chunkEncoder.js");
    const { root, framesDir } = createFrameFixture();

    const encodePromise = encodeFramesFromDir(
      framesDir,
      "frame_%06d.png",
      join(root, "failure.mp4"),
      tinyEncodeOptions,
      undefined,
      { ffmpegEncodeTimeout: 1000 },
    );

    expect(calls).toHaveLength(1);
    const proc = calls[0]!.proc;
    proc.stderr.emit("data", Buffer.from("encoder failed\n"));
    emitClose(proc, 1);

    const result = await encodePromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain("FFmpeg exited with code 1");
    expect(result.error).toContain("encoder failed");
    expect(result.error).not.toContain("ffmpegEncodeTimeout");
  });

  it("uses the default timeout when config is omitted", async () => {
    vi.useFakeTimers();
    const { spawn, calls } = createSpawnSpy();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { encodeFramesFromDir } = await import("./chunkEncoder.js");
    const { root, framesDir } = createFrameFixture();

    const encodePromise = encodeFramesFromDir(
      framesDir,
      "frame_%06d.png",
      join(root, "default.mp4"),
      tinyEncodeOptions,
    );

    expect(calls).toHaveLength(1);
    const proc = calls[0]!.proc;
    vi.advanceTimersByTime(599_999);
    expect(proc.kill).not.toHaveBeenCalled();

    emitClose(proc, 0);

    const result = await encodePromise;
    expect(result.success).toBe(true);
    expect(result.framesEncoded).toBe(2);
    expect(result.fileSize).toBe(0);
  });
});

describe("encodeFramesChunkedConcat ffmpegEncodeTimeout", () => {
  it("passes config timeout to per-chunk encodes", async () => {
    vi.useFakeTimers();
    const { spawn, calls } = createSpawnSpy();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { encodeFramesChunkedConcat } = await import("./chunkEncoder.js");
    const { root, framesDir } = createFrameFixture();

    const encodePromise = encodeFramesChunkedConcat(
      framesDir,
      "frame_%06d.png",
      join(root, "chunked.mp4"),
      tinyEncodeOptions,
      30,
      undefined,
      { ffmpegEncodeTimeout: 1000 },
    );

    expect(calls).toHaveLength(1);
    const proc = calls[0]!.proc;
    vi.advanceTimersByTime(999);
    expect(proc.kill).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");

    proc.stderr.emit("data", Buffer.from("chunk timeout\n"));
    emitClose(proc, 143);

    const result = await encodePromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain("Chunk 0 encode failed");
    expect(result.error).toContain("chunk timeout");
    expect(result.error).toContain(encodeTimeoutMessage(1000));
  });

  it("keeps non-timeout chunk failures unchanged", async () => {
    vi.useFakeTimers();
    const { spawn, calls } = createSpawnSpy();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { encodeFramesChunkedConcat } = await import("./chunkEncoder.js");
    const { root, framesDir } = createFrameFixture();

    const encodePromise = encodeFramesChunkedConcat(
      framesDir,
      "frame_%06d.png",
      join(root, "chunked-failure.mp4"),
      tinyEncodeOptions,
      30,
      undefined,
      { ffmpegEncodeTimeout: 1000 },
    );

    expect(calls).toHaveLength(1);
    const proc = calls[0]!.proc;
    proc.stderr.emit("data", Buffer.from("chunk failed\n"));
    emitClose(proc, 1);

    const result = await encodePromise;
    expect(result.success).toBe(false);
    expect(result.error).toBe("Chunk 0 encode failed: chunk failed\n");
    expect(result.error).not.toContain("ffmpegEncodeTimeout");
  });

  it("kills concat ffmpeg when config timeout elapses", async () => {
    vi.useFakeTimers();
    const { spawn, calls } = createSpawnSpy();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { encodeFramesChunkedConcat } = await import("./chunkEncoder.js");
    const { root, framesDir } = createFrameFixture();

    const encodePromise = encodeFramesChunkedConcat(
      framesDir,
      "frame_%06d.png",
      join(root, "concat-timeout.mp4"),
      tinyEncodeOptions,
      30,
      undefined,
      { ffmpegEncodeTimeout: 1000 },
    );

    expect(calls).toHaveLength(1);
    emitClose(calls[0]!.proc, 0);
    await Promise.resolve();

    expect(calls).toHaveLength(2);
    const concatProc = calls[1]!.proc;
    vi.advanceTimersByTime(999);
    expect(concatProc.kill).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(concatProc.kill).toHaveBeenCalledWith("SIGTERM");

    concatProc.stderr.emit("data", Buffer.from("concat timeout\n"));
    emitClose(concatProc, 143);

    const result = await encodePromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain("Chunk concat failed");
    expect(result.error).toContain("concat timeout");
    expect(result.error).toContain(encodeTimeoutMessage(1000));
  });

  it("uses the default timeout for per-chunk encodes when config is omitted", async () => {
    vi.useFakeTimers();
    const { spawn, calls } = createSpawnSpy();
    vi.resetModules();
    vi.doMock("child_process", () => ({ spawn }));

    const { encodeFramesChunkedConcat } = await import("./chunkEncoder.js");
    const { root, framesDir } = createFrameFixture();

    const encodePromise = encodeFramesChunkedConcat(
      framesDir,
      "frame_%06d.png",
      join(root, "chunked-default.mp4"),
      tinyEncodeOptions,
      30,
    );

    expect(calls).toHaveLength(1);
    const chunkProc = calls[0]!.proc;
    vi.advanceTimersByTime(599_999);
    expect(chunkProc.kill).not.toHaveBeenCalled();

    emitClose(chunkProc, 0);
    await Promise.resolve();

    expect(calls).toHaveLength(2);
    const concatProc = calls[1]!.proc;
    emitClose(concatProc, 0);

    const result = await encodePromise;
    expect(result.success).toBe(true);
    expect(result.framesEncoded).toBe(2);
    expect(result.fileSize).toBe(0);
  });
});

describe("getEncoderPreset", () => {
  it("returns h264 with yuv420p for mp4 format", () => {
    const preset = getEncoderPreset("standard", "mp4");
    expect(preset.codec).toBe("h264");
    expect(preset.pixelFormat).toBe("yuv420p");
  });

  it("returns vp9 with yuva420p for webm format", () => {
    const preset = getEncoderPreset("standard", "webm");
    expect(preset.codec).toBe("vp9");
    expect(preset.pixelFormat).toBe("yuva420p");
  });

  it("maps draft ultrafast to vp9 realtime deadline", () => {
    const preset = getEncoderPreset("draft", "webm");
    expect(preset.preset).toBe("realtime");
    expect(preset.codec).toBe("vp9");
  });

  it("maps standard/high to vp9 good deadline", () => {
    expect(getEncoderPreset("standard", "webm").preset).toBe("good");
    expect(getEncoderPreset("high", "webm").preset).toBe("good");
  });

  it("preserves quality values across formats", () => {
    for (const q of ["draft", "standard", "high"] as const) {
      expect(getEncoderPreset(q, "webm").quality).toBe(ENCODER_PRESETS[q].quality);
    }
  });

  it("returns prores 4444 with yuva444p10le for mov format", () => {
    const preset = getEncoderPreset("standard", "mov");
    expect(preset.codec).toBe("prores");
    expect(preset.preset).toBe("4444");
    expect(preset.pixelFormat).toBe("yuva444p10le");
  });

  it("uses prores 4444 for all mov quality levels", () => {
    for (const q of ["draft", "standard", "high"] as const) {
      const preset = getEncoderPreset(q, "mov");
      expect(preset.codec).toBe("prores");
      expect(preset.preset).toBe("4444");
    }
  });

  it("defaults to mp4 when format is omitted", () => {
    const preset = getEncoderPreset("standard");
    expect(preset.codec).toBe("h264");
    expect(preset.pixelFormat).toBe("yuv420p");
  });
});

describe("buildEncoderArgs anti-banding", () => {
  const baseOptions = { fps: { num: 30, den: 1 }, width: 1920, height: 1080 };

  it("adds aq-mode=3 x264-params for h264 CPU encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23 },
      ["-framerate", "30", "-i", "frames/%04d.png"],
      "out.mp4",
    );
    const paramIdx = args.indexOf("-x264-params");
    expect(paramIdx).toBeGreaterThan(-1);
    expect(args[paramIdx + 1]).toContain("aq-mode=3");
  });

  it("adds aq-mode=3 x265-params for h265 CPU encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23 },
      ["-framerate", "30", "-i", "frames/%04d.png"],
      "out.mp4",
    );
    const paramIdx = args.indexOf("-x265-params");
    expect(paramIdx).toBeGreaterThan(-1);
    expect(args[paramIdx + 1]).toContain("aq-mode=3");
  });

  it("includes deblock for non-ultrafast presets", () => {
    for (const preset of ["medium", "slow"]) {
      const args = buildEncoderArgs(
        { ...baseOptions, codec: "h264", preset, quality: 23 },
        ["-framerate", "30", "-i", "frames/%04d.png"],
        "out.mp4",
      );
      const paramIdx = args.indexOf("-x264-params");
      expect(args[paramIdx + 1]).toContain("deblock=1,1");
    }
  });

  it("omits deblock for ultrafast (draft) preset", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "ultrafast", quality: 28 },
      ["-framerate", "30", "-i", "frames/%04d.png"],
      "out.mp4",
    );
    const paramIdx = args.indexOf("-x264-params");
    expect(paramIdx).toBeGreaterThan(-1);
    expect(args[paramIdx + 1]).toContain("aq-mode=3");
    expect(args[paramIdx + 1]).not.toContain("deblock");
  });

  it("does not add x264-params for GPU encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23, useGpu: true },
      ["-framerate", "30", "-i", "frames/%04d.png"],
      "out.mp4",
      "nvenc",
    );
    expect(args.indexOf("-x264-params")).toBe(-1);
  });

  it("does not add x264-params for VP9 encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "vp9", preset: "good", quality: 23 },
      ["-framerate", "30", "-i", "frames/%04d.png"],
      "out.webm",
    );
    expect(args.indexOf("-x264-params")).toBe(-1);
    expect(args.indexOf("-x265-params")).toBe(-1);
  });
});

describe("buildEncoderArgs fps rational forwarding", () => {
  // Regression for the fps fraction-syntax feature: rational fps must reach
  // ffmpeg's `-r` flag verbatim (e.g. "30000/1001") so NTSC stays exact end-
  // to-end rather than being rounded to 29.97 decimal at the encoder boundary.
  it("emits integer -r for { num: 30, den: 1 }", () => {
    const args = buildEncoderArgs(
      { fps: { num: 30, den: 1 }, width: 1920, height: 1080, codec: "h264" },
      ["-framerate", "30", "-i", "frames/%04d.png"],
      "out.mp4",
    );
    const rIdx = args.indexOf("-r");
    expect(rIdx).toBeGreaterThan(-1);
    expect(args[rIdx + 1]).toBe("30");
  });

  it("emits rational -r for NTSC { num: 30000, den: 1001 }", () => {
    const args = buildEncoderArgs(
      { fps: { num: 30000, den: 1001 }, width: 1920, height: 1080, codec: "h264" },
      ["-framerate", "30000/1001", "-i", "frames/%04d.png"],
      "out.mp4",
    );
    const rIdx = args.indexOf("-r");
    expect(rIdx).toBeGreaterThan(-1);
    expect(args[rIdx + 1]).toBe("30000/1001");
  });
});

describe("buildEncoderArgs GPU preset mapping", () => {
  const baseOptions = { fps: { num: 30, den: 1 }, width: 1920, height: 1080 };
  const inputArgs = ["-framerate", "30", "-i", "frames/%04d.png"];

  function presetArg(args: string[]): string | undefined {
    const idx = args.indexOf("-preset");
    return idx === -1 ? undefined : args[idx + 1];
  }

  // Regression for the "draft quality + --gpu fails with code -22" bug:
  // NVENC rejects the libx264 preset name `ultrafast` with AVERROR(EINVAL),
  // so the `draft` quality tier must not forward that value to h264_nvenc.
  it("translates the draft ultrafast preset to NVENC p1", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "ultrafast", quality: 28, useGpu: true },
      inputArgs,
      "out.mp4",
      "nvenc",
    );
    expect(presetArg(args)).toBe("p1");
  });

  it("translates the standard medium preset to NVENC p4", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 18, useGpu: true },
      inputArgs,
      "out.mp4",
      "nvenc",
    );
    expect(presetArg(args)).toBe("p4");
  });

  it("translates the high slow preset to NVENC p5", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "slow", quality: 15, useGpu: true },
      inputArgs,
      "out.mp4",
      "nvenc",
    );
    expect(presetArg(args)).toBe("p5");
  });

  // hevc_nvenc uses the same p1..p7 preset vocabulary as h264_nvenc, so the
  // mapping must apply to both codecs. Locks in "H.264 and H.265 NVENC share
  // the preset mapping" against a future refactor that might split the path.
  it("translates libx264 preset names to NVENC p1..p7 for h265 as well", () => {
    for (const [libx264, nvencPreset] of [
      ["ultrafast", "p1"],
      ["medium", "p4"],
      ["veryslow", "p7"],
    ] as const) {
      const args = buildEncoderArgs(
        { ...baseOptions, codec: "h265", preset: libx264, quality: 23, useGpu: true },
        inputArgs,
        "out.mp4",
        "nvenc",
      );
      expect(args[args.indexOf("-c:v") + 1]).toBe("hevc_nvenc");
      expect(presetArg(args)).toBe(nvencPreset);
    }
  });

  it("rewrites QSV's unsupported ultrafast preset to veryfast", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "ultrafast", quality: 28, useGpu: true },
      inputArgs,
      "out.mp4",
      "qsv",
    );
    expect(presetArg(args)).toBe("veryfast");
  });

  it("passes QSV-supported preset names through unchanged", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23, useGpu: true },
      inputArgs,
      "out.mp4",
      "qsv",
    );
    expect(presetArg(args)).toBe("medium");
  });

  it("uses AMD AMF encoder names and quality flags when selected", () => {
    const h264Args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23, useGpu: true },
      inputArgs,
      "out.mp4",
      "amf",
    );
    expect(h264Args[h264Args.indexOf("-c:v") + 1]).toBe("h264_amf");
    expect(h264Args[h264Args.indexOf("-qp_i") + 1]).toBe("23");
    expect(h264Args).toContain("-bf");
    expect(h264Args[h264Args.indexOf("-bf") + 1]).toBe("0");

    const h265Args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23, useGpu: true },
      inputArgs,
      "out.mp4",
      "amf",
    );
    expect(h265Args[h265Args.indexOf("-c:v") + 1]).toBe("hevc_amf");
    expect(h265Args[h265Args.indexOf("-qp_i") + 1]).toBe("23");
  });
});

describe("buildEncoderArgs color space", () => {
  const baseOptions = { fps: { num: 30, den: 1 }, width: 1920, height: 1080 };
  const inputArgs = ["-framerate", "30", "-i", "frames/%04d.png"];

  it("adds bt709 color space metadata for h264 CPU encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23 },
      inputArgs,
      "out.mp4",
    );
    // FFmpeg-level metadata tags
    expect(args).toContain("-colorspace:v");
    expect(args[args.indexOf("-colorspace:v") + 1]).toBe("bt709");
    expect(args[args.indexOf("-color_primaries:v") + 1]).toBe("bt709");
    expect(args[args.indexOf("-color_trc:v") + 1]).toBe("bt709");
    expect(args[args.indexOf("-color_range") + 1]).toBe("tv");
    // x264-params VUI embedding
    const paramIdx = args.indexOf("-x264-params");
    expect(args[paramIdx + 1]).toContain("colorprim=bt709");
    expect(args[paramIdx + 1]).toContain("transfer=bt709");
    expect(args[paramIdx + 1]).toContain("colormatrix=bt709");
  });

  it("adds bt709 color space metadata for h265 CPU encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23 },
      inputArgs,
      "out.mp4",
    );
    expect(args).toContain("-colorspace:v");
    expect(args[args.indexOf("-colorspace:v") + 1]).toBe("bt709");
    // x265-params VUI embedding
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).toContain("colorprim=bt709");
  });

  it("adds range conversion filter for CPU h264 encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23 },
      inputArgs,
      "out.mp4",
    );
    const vfIdx = args.indexOf("-vf");
    expect(vfIdx).toBeGreaterThan(-1);
    expect(args[vfIdx + 1]).toContain("scale=in_range=pc:out_range=tv");
  });

  it("prepends range conversion to VAAPI filter chain", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23, useGpu: true },
      inputArgs,
      "out.mp4",
      "vaapi",
    );
    const vfIdx = args.indexOf("-vf");
    expect(vfIdx).toBeGreaterThan(-1);
    expect(args[vfIdx + 1]).toBe("scale=in_range=pc:out_range=tv,format=nv12,hwupload");
  });

  it("skips range conversion filter for non-VAAPI GPU encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23, useGpu: true },
      inputArgs,
      "out.mp4",
      "nvenc",
    );
    expect(args.indexOf("-vf")).toBe(-1);
    // but still has color metadata
    expect(args).toContain("-colorspace:v");
  });

  it("does not add color metadata for VP9", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "vp9", preset: "good", quality: 23 },
      inputArgs,
      "out.webm",
    );
    expect(args).not.toContain("-colorspace:v");
  });

  it("adds video_track_timescale for h264", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23 },
      inputArgs,
      "out.mp4",
    );
    expect(args).toContain("-video_track_timescale");
    expect(args[args.indexOf("-video_track_timescale") + 1]).toBe("90000");
  });

  it("does not add timescale for VP9", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "vp9", preset: "good", quality: 23 },
      inputArgs,
      "out.webm",
    );
    expect(args).not.toContain("-video_track_timescale");
  });
});

describe("getEncoderPreset HDR", () => {
  it("returns h265 with 10-bit for HDR HLG", () => {
    const preset = getEncoderPreset("standard", "mp4", { transfer: "hlg" });
    expect(preset.codec).toBe("h265");
    expect(preset.pixelFormat).toBe("yuv420p10le");
    expect(preset.hdr).toEqual({ transfer: "hlg" });
  });

  it("returns h265 with 10-bit for HDR PQ", () => {
    const preset = getEncoderPreset("high", "mp4", { transfer: "pq" });
    expect(preset.codec).toBe("h265");
    expect(preset.pixelFormat).toBe("yuv420p10le");
    expect(preset.hdr).toEqual({ transfer: "pq" });
  });

  it("avoids ultrafast preset for HDR (upgrades to fast)", () => {
    const preset = getEncoderPreset("draft", "mp4", { transfer: "hlg" });
    expect(preset.preset).toBe("fast");
  });

  it("ignores HDR for webm format", () => {
    const preset = getEncoderPreset("standard", "webm", { transfer: "hlg" });
    expect(preset.codec).toBe("vp9");
    expect(preset.hdr).toBeUndefined();
  });

  it("ignores HDR for mov format", () => {
    const preset = getEncoderPreset("standard", "mov", { transfer: "pq" });
    expect(preset.codec).toBe("prores");
    expect(preset.hdr).toBeUndefined();
  });
});

describe("buildEncoderArgs lockGopForChunkConcat", () => {
  const baseOptions = { fps: { num: 30, den: 1 }, width: 1920, height: 1080 };
  const inputArgs = ["-framerate", "30", "-i", "frames/%04d.png"];

  // Default path must emit zero closed-GOP args — in-process renders rely on
  // libx264/libx265 defaults to stay byte-identical with their PSNR baselines.
  it("default (false) omits closed-GOP args for libx264", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23 },
      inputArgs,
      "out.mp4",
    );
    expect(args).not.toContain("-g");
    expect(args).not.toContain("-keyint_min");
    expect(args).not.toContain("-force_key_frames");
    expect(args).not.toContain("-sc_threshold");
    const paramIdx = args.indexOf("-x264-params");
    expect(args[paramIdx + 1]).not.toContain("scenecut=0");
    expect(args[paramIdx + 1]).not.toContain("open-gop=0");
    expect(args[paramIdx + 1]).not.toContain("repeat-headers=1");
  });

  it("default (false) omits closed-GOP args for libx265", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23 },
      inputArgs,
      "out.mp4",
    );
    expect(args).not.toContain("-g");
    expect(args).not.toContain("-keyint_min");
    expect(args).not.toContain("-force_key_frames");
    expect(args).not.toContain("-sc_threshold");
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).not.toContain("scenecut=0");
    expect(args[paramIdx + 1]).not.toContain("keyint=");
    expect(args[paramIdx + 1]).not.toContain("open-gop=0");
    expect(args[paramIdx + 1]).not.toContain("repeat-headers=1");
  });

  it("true appends closed-GOP ffmpeg flags and x264-params for libx264", () => {
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "h264",
        preset: "medium",
        quality: 23,
        lockGopForChunkConcat: true,
        gopSize: 240,
      },
      inputArgs,
      "out.mp4",
    );
    expect(args[args.indexOf("-g") + 1]).toBe("240");
    expect(args[args.indexOf("-keyint_min") + 1]).toBe("240");
    expect(args[args.indexOf("-sc_threshold") + 1]).toBe("0");
    expect(args[args.indexOf("-force_key_frames") + 1]).toBe("expr:eq(mod(n,240),0)");
    const paramIdx = args.indexOf("-x264-params");
    expect(args[paramIdx + 1]).toContain("scenecut=0");
    expect(args[paramIdx + 1]).toContain("open-gop=0");
    expect(args[paramIdx + 1]).toContain("repeat-headers=1");
    // -bf 0 was already present for h264; closed-GOP doesn't change that.
    expect(args).toContain("-bf");
    expect(args[args.indexOf("-bf") + 1]).toBe("0");
    // 90000 timescale is required for clean concat-copy — already enforced for h264/h265.
    expect(args[args.indexOf("-video_track_timescale") + 1]).toBe("90000");
  });

  it("true appends closed-GOP x265-params keyint controls for libx265", () => {
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "h265",
        preset: "medium",
        quality: 23,
        lockGopForChunkConcat: true,
        gopSize: 360,
      },
      inputArgs,
      "out.mp4",
    );
    expect(args[args.indexOf("-g") + 1]).toBe("360");
    expect(args[args.indexOf("-keyint_min") + 1]).toBe("360");
    expect(args[args.indexOf("-sc_threshold") + 1]).toBe("0");
    expect(args[args.indexOf("-force_key_frames") + 1]).toBe("expr:eq(mod(n,360),0)");
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).toContain("keyint=360");
    expect(args[paramIdx + 1]).toContain("min-keyint=360");
    expect(args[paramIdx + 1]).toContain("scenecut=0");
    expect(args[paramIdx + 1]).toContain("open-gop=0");
    expect(args[paramIdx + 1]).toContain("repeat-headers=1");
    // h265 normally tolerates B-frames; closed-GOP concat-copy doesn't.
    expect(args[args.indexOf("-bf") + 1]).toBe("0");
  });

  it("true preserves the x264-params anti-banding controls", () => {
    // The closed-GOP params join onto the existing aq-mode/deblock string —
    // make sure we didn't accidentally drop the anti-banding tuning.
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "h264",
        preset: "medium",
        quality: 23,
        lockGopForChunkConcat: true,
        gopSize: 240,
      },
      inputArgs,
      "out.mp4",
    );
    const paramIdx = args.indexOf("-x264-params");
    expect(args[paramIdx + 1]).toContain("aq-mode=3");
    expect(args[paramIdx + 1]).toContain("aq-strength=0.8");
    expect(args[paramIdx + 1]).toContain("deblock=1,1");
    expect(args[paramIdx + 1]).toContain("colorprim=bt709");
  });

  it("true with ultrafast preset still emits closed-GOP params and skips deblock", () => {
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "h264",
        preset: "ultrafast",
        quality: 28,
        lockGopForChunkConcat: true,
        gopSize: 240,
      },
      inputArgs,
      "out.mp4",
    );
    expect(args[args.indexOf("-g") + 1]).toBe("240");
    const paramIdx = args.indexOf("-x264-params");
    expect(args[paramIdx + 1]).toContain("aq-mode=3");
    expect(args[paramIdx + 1]).toContain("scenecut=0");
    expect(args[paramIdx + 1]).not.toContain("deblock");
  });

  it("true is a no-op on GPU encoders", () => {
    // GPU encoders take a separate code path; lockGopForChunkConcat does not
    // wire `-g` / `-keyint_min` into nvenc/amf/qsv/vaapi.
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "h264",
        preset: "medium",
        quality: 23,
        useGpu: true,
        lockGopForChunkConcat: true,
        gopSize: 240,
      },
      inputArgs,
      "out.mp4",
      "nvenc",
    );
    expect(args).not.toContain("-g");
    expect(args).not.toContain("-keyint_min");
    expect(args).not.toContain("-force_key_frames");
    expect(args).not.toContain("-sc_threshold");
    expect(args.indexOf("-x264-params")).toBe(-1);
  });

  it("true appends closed-GOP args for libvpx-vp9", () => {
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "vp9",
        preset: "good",
        quality: 23,
        lockGopForChunkConcat: true,
        gopSize: 240,
      },
      inputArgs,
      "out.webm",
    );
    expect(args[args.indexOf("-g") + 1]).toBe("240");
    expect(args[args.indexOf("-keyint_min") + 1]).toBe("240");
    expect(args[args.indexOf("-auto-alt-ref") + 1]).toBe("0");
    expect(args[args.indexOf("-cpu-used") + 1]).toBe("4");
    expect(args[args.indexOf("-deadline") + 1]).toBe("good");
    expect(args.indexOf("-x264-params")).toBe(-1);
    expect(args.indexOf("-x265-params")).toBe(-1);
    expect(args.indexOf("-sc_threshold")).toBe(-1);
    expect(args.indexOf("-force_key_frames")).toBe(-1);
  });

  it("default (false) omits closed-GOP args for libvpx-vp9", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "vp9", preset: "good", quality: 23 },
      inputArgs,
      "out.webm",
    );
    expect(args).not.toContain("-g");
    expect(args).not.toContain("-keyint_min");
    expect(args[args.indexOf("-cpu-used") + 1]).toBe("4");
    // The non-locked, non-alpha VP9 path leaves `-auto-alt-ref` at the
    // libvpx default. Alpha branches still emit `-auto-alt-ref 0` for an
    // unrelated reason (alpha + alt-ref is unsupported), but that's a
    // separate test below.
    expect(args).not.toContain("-auto-alt-ref");
  });

  it("honors the resolved engine VP9 cpu-used override", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "vp9", preset: "good", quality: 23, vp9CpuUsed: 6 },
      inputArgs,
      "out.webm",
    );

    expect(args[args.indexOf("-cpu-used") + 1]).toBe("6");
  });

  it("true with alpha pixel format keeps alpha metadata and emits -auto-alt-ref once", () => {
    // Regression: alpha + closed-GOP must NOT double-push `-auto-alt-ref 0`.
    // Both paths want it disabled; the encoder branch emits it exactly once.
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "vp9",
        preset: "good",
        quality: 23,
        pixelFormat: "yuva420p",
        lockGopForChunkConcat: true,
        gopSize: 240,
      },
      inputArgs,
      "out.webm",
    );
    const autoAltRefIndices = args.reduce<number[]>((acc, a, i) => {
      if (a === "-auto-alt-ref") acc.push(i);
      return acc;
    }, []);
    expect(autoAltRefIndices.length).toBe(1);
    expect(args[autoAltRefIndices[0] + 1]).toBe("0");
    expect(args[args.indexOf("-metadata:s:v:0") + 1]).toBe("alpha_mode=1");
    expect(args[args.indexOf("-g") + 1]).toBe("240");
  });

  it("vp9 + lockGopForChunkConcat=true throws on missing gopSize", () => {
    // Mirrors the libx264/libx265 branch: closed-GOP without a GOP size
    // makes no sense — surface the caller error eagerly.
    expect(() =>
      buildEncoderArgs(
        {
          ...baseOptions,
          codec: "vp9",
          preset: "good",
          quality: 23,
          lockGopForChunkConcat: true,
        },
        inputArgs,
        "out.webm",
      ),
    ).toThrow(/lockGopForChunkConcat=true requires a positive integer gopSize/);
  });

  it("true is a no-op on ProRes (intra-only — no GOP forcing needed)", () => {
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "prores",
        preset: "4444",
        quality: 23,
        lockGopForChunkConcat: true,
        gopSize: 240,
      },
      inputArgs,
      "out.mov",
    );
    expect(args).not.toContain("-g");
    expect(args).not.toContain("-keyint_min");
    expect(args).not.toContain("-force_key_frames");
  });

  it("true with missing or invalid gopSize throws", () => {
    for (const bad of [undefined, 0, -10, NaN, Infinity]) {
      expect(() =>
        buildEncoderArgs(
          {
            ...baseOptions,
            codec: "h264",
            preset: "medium",
            quality: 23,
            lockGopForChunkConcat: true,
            gopSize: bad as number | undefined,
          },
          inputArgs,
          "out.mp4",
        ),
      ).toThrow(/lockGopForChunkConcat=true requires a positive integer gopSize/);
    }
  });

  it("HDR + closed-GOP keeps HDR mastering metadata in x265-params", () => {
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "h265",
        preset: "medium",
        quality: 23,
        hdr: { transfer: "pq" },
        lockGopForChunkConcat: true,
        gopSize: 240,
      },
      inputArgs,
      "out.mp4",
    );
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).toContain("colorprim=bt2020");
    expect(args[paramIdx + 1]).toContain("transfer=smpte2084");
    expect(args[paramIdx + 1]).toContain("master-display=");
    expect(args[paramIdx + 1]).toContain("max-cll=");
    expect(args[paramIdx + 1]).toContain("keyint=240");
    expect(args[paramIdx + 1]).toContain("scenecut=0");
  });
});

describe("buildEncoderArgs HDR color space", () => {
  const baseOptions = { fps: { num: 30, den: 1 }, width: 1920, height: 1080 };
  const inputArgs = ["-framerate", "30", "-i", "frames/%04d.png"];

  it("emits BT.2020 + arib-std-b67 tags for HDR HLG (h265 SW)", () => {
    // When options.hdr is set, the caller asserts the input pixels are
    // already in the BT.2020 color space — tag the output truthfully so
    // HDR-aware players apply the right transform.
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23, hdr: { transfer: "hlg" } },
      inputArgs,
      "out.mp4",
    );
    expect(args[args.indexOf("-colorspace:v") + 1]).toBe("bt2020nc");
    expect(args[args.indexOf("-color_primaries:v") + 1]).toBe("bt2020");
    expect(args[args.indexOf("-color_trc:v") + 1]).toBe("arib-std-b67");
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).toContain("colorprim=bt2020");
    expect(args[paramIdx + 1]).toContain("transfer=arib-std-b67");
    expect(args[paramIdx + 1]).toContain("colormatrix=bt2020nc");
  });

  it("emits BT.2020 + smpte2084 tags for HDR PQ (h265 SW)", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23, hdr: { transfer: "pq" } },
      inputArgs,
      "out.mp4",
    );
    expect(args[args.indexOf("-colorspace:v") + 1]).toBe("bt2020nc");
    expect(args[args.indexOf("-color_primaries:v") + 1]).toBe("bt2020");
    expect(args[args.indexOf("-color_trc:v") + 1]).toBe("smpte2084");
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).toContain("colorprim=bt2020");
    expect(args[paramIdx + 1]).toContain("transfer=smpte2084");
    expect(args[paramIdx + 1]).toContain("colormatrix=bt2020nc");
  });

  it("embeds HDR static mastering metadata in x265-params when HDR is set", () => {
    // master-display + max-cll SEI messages are required so HDR-aware
    // players (Apple QuickTime, YouTube, HDR TVs) treat the stream as
    // HDR10 instead of falling back to SDR BT.2020 tone-mapping.
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23, hdr: { transfer: "pq" } },
      inputArgs,
      "out.mp4",
    );
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).toContain("master-display=");
    expect(args[paramIdx + 1]).toContain("max-cll=");
  });

  it("uses bt709 when HDR is not set (SDR Chrome captures)", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23 },
      inputArgs,
      "out.mp4",
    );
    expect(args[args.indexOf("-colorspace:v") + 1]).toBe("bt709");
    expect(args[args.indexOf("-color_trc:v") + 1]).toBe("bt709");
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).toContain("colorprim=bt709");
    expect(args[paramIdx + 1]).not.toContain("master-display");
  });

  it("does not embed HDR mastering metadata when HDR is not set", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23 },
      inputArgs,
      "out.mp4",
    );
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).not.toContain("master-display");
    expect(args[paramIdx + 1]).not.toContain("max-cll");
  });

  it("strips HDR and tags as SDR/BT.709 when codec=h264 (libx264 has no HDR support)", () => {
    // libx264 cannot encode HDR. Rather than emit a "half-HDR" file (BT.2020
    // container tags + BT.709 VUI inside the bitstream — confusing to HDR-aware
    // players), we strip hdr and tag the whole output as SDR/BT.709. The caller
    // gets a warning telling them to use codec=h265 for real HDR output.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23, hdr: { transfer: "pq" } },
      inputArgs,
      "out.mp4",
    );
    const paramIdx = args.indexOf("-x264-params");
    expect(args[paramIdx + 1]).toContain("colorprim=bt709");
    expect(args[paramIdx + 1]).not.toContain("master-display");
    expect(args[args.indexOf("-colorspace:v") + 1]).toBe("bt709");
    expect(args[args.indexOf("-color_primaries:v") + 1]).toBe("bt709");
    expect(args[args.indexOf("-color_trc:v") + 1]).toBe("bt709");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("HDR is not supported with codec=h264"),
    );
    warnSpy.mockRestore();
  });

  it("uses range conversion for HDR CPU encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23, hdr: { transfer: "hlg" } },
      inputArgs,
      "out.mp4",
    );
    const vfIdx = args.indexOf("-vf");
    expect(vfIdx).toBeGreaterThan(-1);
    expect(args[vfIdx + 1]).toContain("scale=in_range=pc:out_range=tv");
  });

  it("uses same range conversion for SDR CPU encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23 },
      inputArgs,
      "out.mp4",
    );
    const vfIdx = args.indexOf("-vf");
    expect(args[vfIdx + 1]).toContain("scale=in_range=pc:out_range=tv");
  });

  it("tags BT.2020 + transfer for HDR GPU H.265 (no mastering metadata via -x265-params)", () => {
    // GPU encoders (nvenc, videotoolbox, amf, qsv, vaapi) still emit the BT.2020
    // color tags via the codec-level -colorspace/-color_primaries/-color_trc
    // flags, but cannot accept x265-params, so HDR static mastering metadata
    // (master-display, max-cll) is not embedded. Acceptable for previews,
    // not for HDR-aware delivery.
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "h265",
        preset: "medium",
        quality: 23,
        useGpu: true,
        hdr: { transfer: "pq" },
      },
      inputArgs,
      "out.mp4",
      "nvenc",
    );
    expect(args[args.indexOf("-colorspace:v") + 1]).toBe("bt2020nc");
    expect(args[args.indexOf("-color_primaries:v") + 1]).toBe("bt2020");
    expect(args[args.indexOf("-color_trc:v") + 1]).toBe("smpte2084");
    expect(args.indexOf("-x265-params")).toBe(-1);
  });
});
