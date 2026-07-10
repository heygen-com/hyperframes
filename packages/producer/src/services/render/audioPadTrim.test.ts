/**
 * Tests for the `audioPadTrim` helper that backs the distributed
 * `assemble()` step's audio duration correction.
 *
 * The helper is split into:
 *   - `buildPadTrimAudioArgs(...)` — pure function, builds the ffmpeg argv
 *     and labels the operation. Fully unit-testable.
 *   - `padOrTrimAudioToVideoFrameCount(...)` — wrapper that probes the
 *     video for frame count + fps, probes the audio for current duration,
 *     and runs ffmpeg with the args from the pure helper. Tests inject
 *     stubs for the probes and the ffmpeg runner.
 *
 * No real ffmpeg/ffprobe runs in these tests.
 */

import { describe, expect, it, mock } from "bun:test";
import {
  buildPadTrimAudioArgs,
  buildPadTrimAudioPlan,
  padOrTrimAudioToVideoFrameCount,
  type AudioProbeInfo,
  type PadTrimAudioInput,
  type ProbeVideoFrameInfo,
} from "./audioPadTrim.js";

describe("buildPadTrimAudioArgs", () => {
  it("emits a concat-copy pad plan when audio is shorter than target", () => {
    const plan = buildPadTrimAudioPlan("/tmp/in.aac", "/tmp/out.aac", 4.0, 5.0, {
      sampleRate: 48000,
      channels: 2,
    });
    expect(plan.operation).toBe("pad");
    expect(plan.steps).toHaveLength(2);

    const silenceArgs = plan.steps[0]!.args;
    expect(plan.steps[0]!.kind).toBe("pad-silence");
    expect(silenceArgs).not.toContain("/tmp/in.aac");
    expect(silenceArgs[silenceArgs.indexOf("-i") + 1]).toBe(
      "anullsrc=channel_layout=stereo:sample_rate=48000",
    );
    expect(silenceArgs[silenceArgs.indexOf("-t") + 1]).toBe("1.000000");
    expect(silenceArgs[silenceArgs.indexOf("-c:a") + 1]).toBe("aac");

    const concatArgs = plan.steps[1]!.args;
    expect(plan.steps[1]!.kind).toBe("pad-concat");
    expect(concatArgs).toContain("concat");
    // The concat script is passed via a real file (NOT `pipe:0`). Feeding
    // it through stdin makes FFmpeg's URL joiner prepend `pipe:` to bare
    // absolute paths in the script — the demuxer then tries to open e.g.
    // `pipe:/tmp/foo.aac` and fails with "Impossible to open pipe:/…".
    // Materializing to a file matches `assemble.ts`'s concat convention.
    expect(plan.steps[1]!.concatListPath).toBe("/tmp/out.aac.concat-list.txt");
    expect(concatArgs[concatArgs.indexOf("-i") + 1]).toBe("/tmp/out.aac.concat-list.txt");
    expect(concatArgs[concatArgs.indexOf("-c:a") + 1]).toBe("copy");
    expect(concatArgs[concatArgs.length - 1]).toBe("/tmp/out.aac");
    // Concat script MUST use bare paths, NOT `file://` URLs. FFmpeg 8.x
    // on Windows can't open `file:///C:/…` URLs from the concat demuxer
    // (field-signal ts=1784169914 / 1784177061 / 1784177375). Regression
    // pin: the `file://` scheme prefix must never appear in the concat
    // list content.
    expect(plan.steps[1]!.concatListContent).toContain("file '/tmp/in.aac'");
    expect(plan.steps[1]!.concatListContent).toContain("file '/tmp/out.aac.pad-silence.aac'");
    expect(plan.steps[1]!.concatListContent).not.toContain("file://");
    // Cleanup includes BOTH the silence tail and the concat list script.
    expect(plan.cleanupPaths).toEqual([
      "/tmp/out.aac.pad-silence.aac",
      "/tmp/out.aac.concat-list.txt",
    ]);

    const reencodedSourceStep = plan.steps.find(
      (step) =>
        step.args.includes("/tmp/in.aac") && step.args[step.args.indexOf("-c:a") + 1] === "aac",
    );
    expect(reencodedSourceStep).toBeUndefined();
  });

  it("keeps the legacy args helper on the first pad materialization step", () => {
    const { args, operation } = buildPadTrimAudioArgs("/tmp/in.aac", "/tmp/out.aac", 4.0, 5.0);
    expect(operation).toBe("pad");
    expect(args).not.toContain("/tmp/in.aac");
    expect(args[args.indexOf("-t") + 1]).toBe("1.000000");
  });

  it("emits -t when audio is longer than target", () => {
    const { args, operation } = buildPadTrimAudioArgs("/tmp/in.aac", "/tmp/out.aac", 6.123, 5.0);
    expect(operation).toBe("trim");
    const tIdx = args.indexOf("-t");
    expect(tIdx).toBeGreaterThan(-1);
    expect(args[tIdx + 1]).toBe("5.000000");
    // Trim preserves AAC stream copy.
    const codecIdx = args.indexOf("-c:a");
    expect(args[codecIdx + 1]).toBe("copy");
  });

  it("emits a plain copy when source duration matches target within ~1ms", () => {
    const { args, operation } = buildPadTrimAudioArgs("/tmp/in.aac", "/tmp/out.aac", 5.0, 5.0);
    expect(operation).toBe("copy");
    expect(args.indexOf("-af")).toBe(-1);
    expect(args.indexOf("-t")).toBe(-1);
    const codecIdx = args.indexOf("-c:a");
    expect(args[codecIdx + 1]).toBe("copy");
  });

  it("emits 6-decimal-place pad duration (no scientific notation)", () => {
    // 1.23ms — just over the AUDIO_DURATION_TOLERANCE_SECONDS=1ms threshold,
    // so we exercise the pad path with a tiny duration that would round to
    // exponent notation if we used `toString()` instead of `toFixed(6)`.
    const { args, operation } = buildPadTrimAudioArgs("/tmp/in.aac", "/tmp/out.aac", 0.0, 0.00123);
    expect(operation).toBe("pad");
    const tIdx = args.indexOf("-t");
    expect(args[tIdx + 1]).toBe("0.001230");
  });

  it("flags ~1ms drift as a copy (below the tolerance threshold)", () => {
    const close = buildPadTrimAudioArgs("/tmp/a.aac", "/tmp/o.aac", 5.0, 5.0005);
    expect(close.operation).toBe("copy");
  });

  it("flags >1ms drift in either direction as pad/trim", () => {
    const padNeeded = buildPadTrimAudioArgs("/tmp/a.aac", "/tmp/o.aac", 5.0, 5.002);
    expect(padNeeded.operation).toBe("pad");
    const trimNeeded = buildPadTrimAudioArgs("/tmp/a.aac", "/tmp/o.aac", 5.002, 5.0);
    expect(trimNeeded.operation).toBe("trim");
  });

  it("does not emit `file://` URLs in the pad-concat script (FFmpeg 8.x Windows compat)", () => {
    // Regression pin for field-signal reports ts=1784169914 / 1784177061 /
    // ts=1784177375 (win32/x64, CLI 0.7.59, ffmpeg 8.1.1-full_build). The
    // concat demuxer's file open on Windows in FFmpeg 8.x rejects
    // `file:///C:/…` URLs with "Impossible to open …". The concat script
    // MUST use bare paths. Match sibling `assemble.ts` /
    // `chunkEncoder.ts` conventions.
    const winPlan = buildPadTrimAudioPlan(
      "C:\\Users\\alice\\AppData\\Local\\Temp\\hf-render-abc\\audio.aac",
      "C:\\Users\\alice\\AppData\\Local\\Temp\\hf-render-abc\\audio-padded.aac",
      4.0,
      5.0,
    );
    expect(winPlan.operation).toBe("pad");
    const concatStep = winPlan.steps.find((s) => s.kind === "pad-concat");
    expect(concatStep).toBeDefined();
    expect(concatStep!.concatListContent).toBeDefined();
    expect(concatStep!.concatListContent).not.toContain("file://");
    expect(concatStep!.concatListContent).not.toContain("file:\\\\");
    // Bare Windows paths appear as-is in the concat directives.
    expect(concatStep!.concatListContent).toContain(
      "file 'C:\\Users\\alice\\AppData\\Local\\Temp\\hf-render-abc\\audio.aac'",
    );
  });

  it("materializes the pad-concat script to a real file (not `pipe:0`)", () => {
    // Regression pin for the Linux CI failure that surfaced when the
    // fix originally dropped `file://` while still feeding the concat
    // script via `pipe:0`. FFmpeg's URL joiner resolves bare absolute
    // paths against the base `pipe:` URL, producing `pipe:/tmp/foo.aac`
    // which the demuxer then tries to open as a pipe. Materializing to
    // a real file makes the demuxer treat absolute paths as absolute.
    const plan = buildPadTrimAudioPlan("/tmp/in.aac", "/tmp/out.aac", 4.0, 5.0);
    const concatStep = plan.steps.find((s) => s.kind === "pad-concat");
    expect(concatStep).toBeDefined();
    // The concat script must NOT be piped in via stdin.
    expect(concatStep!.args).not.toContain("pipe:0");
    // The `-i` arg points at the materialized concat list file.
    const iIdx = concatStep!.args.indexOf("-i");
    expect(concatStep!.args[iIdx + 1]).toBe(concatStep!.concatListPath);
    // The concat list file is cleaned up alongside the silence tail.
    expect(plan.cleanupPaths).toContain(concatStep!.concatListPath!);
  });
});

describe("padOrTrimAudioToVideoFrameCount", () => {
  // Build a minimal harness that stubs out the three injectables.
  function harness(opts: {
    video: ProbeVideoFrameInfo | "throw";
    audio: AudioProbeInfo | "throw";
    ffmpeg?: (args: string[]) => Promise<{ success: boolean; error?: string }>;
  }): { input: PadTrimAudioInput; captured: { args: string[][] } } {
    const captured = { args: [] as string[][] };
    const input: PadTrimAudioInput = {
      videoPath: "/tmp/v.mp4",
      audioPath: "/tmp/a.aac",
      outputPath: "/tmp/o.aac",
      probeVideoFrameInfo: async () => {
        if (opts.video === "throw") throw new Error("video probe boom");
        return opts.video;
      },
      probeAudioInfo: async () => {
        if (opts.audio === "throw") throw new Error("audio probe boom");
        return opts.audio;
      },
      runFfmpeg:
        opts.ffmpeg ??
        (async (args) => {
          captured.args.push(args);
          return { success: true };
        }),
    };
    return { input, captured };
  }

  it("passes the render abort signal to the audio metadata probe", async () => {
    const controller = new AbortController();
    const probeVideoFrameInfo = mock(async () => ({ frameCount: 30, fpsNum: 30, fpsDen: 1 }));
    const probeAudioInfo = mock(async () => ({ durationSeconds: 1 }));

    await padOrTrimAudioToVideoFrameCount({
      videoPath: "/tmp/v.mp4",
      audioPath: "/tmp/a.aac",
      outputPath: "/tmp/o.aac",
      signal: controller.signal,
      probeVideoFrameInfo,
      probeAudioInfo,
      runFfmpeg: mock(async () => ({ success: true })),
    });

    expect(probeAudioInfo).toHaveBeenCalledWith("/tmp/a.aac", controller.signal);
  });

  it("pads a video of N=180 frames at 30/1 fps with shorter audio", async () => {
    const { input, captured } = harness({
      video: { frameCount: 180, fpsNum: 30, fpsDen: 1 },
      audio: { durationSeconds: 5.5 },
    });
    const result = await padOrTrimAudioToVideoFrameCount(input);
    expect(result.success).toBe(true);
    expect(result.operation).toBe("pad");
    expect(result.targetDurationSeconds).toBe(6);
    expect(result.sourceDurationSeconds).toBe(5.5);
    expect(captured.args).toHaveLength(2);
    const tIdx = captured.args[0]!.indexOf("-t");
    expect(captured.args[0]![tIdx + 1]).toBe("0.500000");
    expect(captured.args[0]).not.toContain("/tmp/a.aac");
    expect(captured.args[1]![captured.args[1]!.indexOf("-c:a") + 1]).toBe("copy");
  });

  it("trims a video of N=120 frames at 30/1 fps with longer audio", async () => {
    const { input, captured } = harness({
      video: { frameCount: 120, fpsNum: 30, fpsDen: 1 },
      audio: { durationSeconds: 4.5 },
    });
    const result = await padOrTrimAudioToVideoFrameCount(input);
    expect(result.success).toBe(true);
    expect(result.operation).toBe("trim");
    expect(result.targetDurationSeconds).toBe(4);
    expect(captured.args).toHaveLength(1);
    const tIdx = captured.args[0]!.indexOf("-t");
    expect(captured.args[0]![tIdx + 1]).toBe("4.000000");
  });

  it("emits a copy when audio duration already equals frameCount/fps", async () => {
    const { input, captured } = harness({
      video: { frameCount: 90, fpsNum: 30, fpsDen: 1 },
      audio: { durationSeconds: 3.0 },
    });
    const result = await padOrTrimAudioToVideoFrameCount(input);
    expect(result.success).toBe(true);
    expect(result.operation).toBe("copy");
    expect(result.targetDurationSeconds).toBe(3);
    expect(captured.args[0]!.includes("-af")).toBe(false);
    expect(captured.args[0]!.includes("-t")).toBe(false);
  });

  it("handles NTSC fps (30000/1001) exactly", async () => {
    // 120 frames at 30000/1001 ≈ 4.004s. Audio 4.0s → pad 0.004s.
    const { input, captured } = harness({
      video: { frameCount: 120, fpsNum: 30000, fpsDen: 1001 },
      audio: { durationSeconds: 4.0 },
    });
    const result = await padOrTrimAudioToVideoFrameCount(input);
    expect(result.success).toBe(true);
    expect(result.operation).toBe("pad");
    expect(result.targetDurationSeconds).toBeCloseTo((120 * 1001) / 30000, 9);
    const tIdx = captured.args[0]!.indexOf("-t");
    expect(captured.args[0]![tIdx + 1]).toMatch(/^0\.004\d+$/);
  });

  it("propagates video probe failure as success=false", async () => {
    const { input } = harness({
      video: "throw",
      audio: { durationSeconds: 4.0 },
    });
    const result = await padOrTrimAudioToVideoFrameCount(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("failed to probe video");
    expect(result.error).toContain("video probe boom");
  });

  it("propagates audio probe failure as success=false", async () => {
    const { input } = harness({
      video: { frameCount: 90, fpsNum: 30, fpsDen: 1 },
      audio: "throw",
    });
    const result = await padOrTrimAudioToVideoFrameCount(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("failed to probe audio");
    expect(result.error).toContain("audio probe boom");
  });

  it("propagates invalid video info (frameCount=0) as success=false", async () => {
    const { input } = harness({
      video: { frameCount: 0, fpsNum: 30, fpsDen: 1 },
      audio: { durationSeconds: 4.0 },
    });
    const result = await padOrTrimAudioToVideoFrameCount(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("invalid video frame info");
  });

  it("propagates invalid video info (fpsDen=0)", async () => {
    const { input } = harness({
      video: { frameCount: 100, fpsNum: 30, fpsDen: 0 },
      audio: { durationSeconds: 4.0 },
    });
    const result = await padOrTrimAudioToVideoFrameCount(input);
    expect(result.success).toBe(false);
    expect(result.error).toContain("invalid video frame info");
  });

  it("propagates ffmpeg failure as success=false with the ffmpeg error preserved", async () => {
    const { input } = harness({
      video: { frameCount: 180, fpsNum: 30, fpsDen: 1 },
      audio: { durationSeconds: 5.0 },
      ffmpeg: async () => ({ success: false, error: "synthetic ffmpeg failure" }),
    });
    const result = await padOrTrimAudioToVideoFrameCount(input);
    expect(result.success).toBe(false);
    expect(result.error).toBe("synthetic ffmpeg failure");
    expect(result.operation).toBe("pad");
    expect(result.targetDurationSeconds).toBe(6);
  });
});
