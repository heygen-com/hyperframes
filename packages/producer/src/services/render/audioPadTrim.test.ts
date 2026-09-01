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
  it("emits a decode/filter/re-encode pad plan when audio is shorter than target", () => {
    const plan = buildPadTrimAudioPlan("/tmp/in.aac", "/tmp/out.aac", 4.0, 5.0);
    expect(plan.operation).toBe("pad");
    expect(plan.steps).toHaveLength(1);
    const args = plan.steps[0]!.args;
    expect(args[args.indexOf("-i") + 1]).toBe("/tmp/in.aac");
    expect(args[args.indexOf("-af") + 1]).toBe("apad,atrim=0:5.000000");
    expect(args.join(" ")).not.toContain("whole_dur");
    expect(args[args.indexOf("-t") + 1]).toBe("5.000000");
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac");
    // The single-step filter plan has no intermediate artifacts to clean up.
    expect(plan.cleanupPaths).toEqual([]);
  });

  it("keeps the legacy args helper on the first pad materialization step", () => {
    const { args, operation } = buildPadTrimAudioArgs("/tmp/in.aac", "/tmp/out.aac", 4.0, 5.0);
    expect(operation).toBe("pad");
    expect(args).toContain("/tmp/in.aac");
    expect(args[args.indexOf("-t") + 1]).toBe("5.000000");
  });

  it("filter-trims and re-encodes AAC packet padding beyond the target", () => {
    const { args, operation } = buildPadTrimAudioArgs(
      "/tmp/in.aac",
      "/tmp/out.m4a",
      15.018667,
      15.0,
    );
    expect(operation).toBe("trim");
    const filterIdx = args.indexOf("-af");
    expect(args[filterIdx + 1]).toBe("atrim=duration=15.000000,asetpts=PTS-STARTPTS");
    expect(args[args.indexOf("-t") + 1]).toBe("15.000000");
    const codecIdx = args.indexOf("-c:a");
    expect(args[codecIdx + 1]).toBe("aac");
    expect(args[args.indexOf("-b:a") + 1]).toBe("192k");
    expect(args.at(-1)).toBe("/tmp/out.m4a");
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

  it("uses the portable apad/atrim filter for Windows duration normalization", () => {
    // Bundled Windows FFmpeg builds reject `apad=whole_dur`. Match the
    // portable finite-padding shape used by the main audio mixer.
    const winPlan = buildPadTrimAudioPlan(
      "C:\\Users\\alice\\AppData\\Local\\Temp\\hf-render-abc\\audio.m4a",
      "C:\\Users\\alice\\AppData\\Local\\Temp\\hf-render-abc\\audio-padded.m4a",
      4.0,
      5.0,
    );
    expect(winPlan.operation).toBe("pad");
    const args = winPlan.steps[0]!.args;
    expect(args).toContain("-af");
    expect(args[args.indexOf("-af") + 1]).toBe("apad,atrim=0:5.000000");
    expect(args.join(" ")).not.toContain("whole_dur");
  });
});

describe("padOrTrimAudioToVideoFrameCount", () => {
  // Build a minimal harness that stubs out the three injectables.
  function harness(opts: {
    video: ProbeVideoFrameInfo | "throw";
    audio: AudioProbeInfo | "throw";
    ffmpeg?: (args: string[]) => Promise<{
      success: boolean;
      error?: string;
      failureReason?: "external_interruption";
    }>;
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
    expect(captured.args).toHaveLength(1);
    const tIdx = captured.args[0]!.indexOf("-t");
    expect(captured.args[0]![tIdx + 1]).toBe("6.000000");
    expect(captured.args[0]![captured.args[0]!.indexOf("-c:a") + 1]).toBe("aac");
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
    const filterIdx = captured.args[0]!.indexOf("-af");
    expect(captured.args[0]![filterIdx + 1]).toBe("atrim=duration=4.000000,asetpts=PTS-STARTPTS");
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
    expect(captured.args[0]![tIdx + 1]).toBe("4.004000");
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

  it("preserves an external interruption from the audio pad/trim ffmpeg pass", async () => {
    const { input } = harness({
      video: { frameCount: 180, fpsNum: 30, fpsDen: 1 },
      audio: { durationSeconds: 5.0 },
      ffmpeg: async () => ({
        success: false,
        error: "synthetic interruption diagnostics",
        failureReason: "external_interruption",
      }),
    });

    const result = await padOrTrimAudioToVideoFrameCount(input);

    expect(result).toMatchObject({
      success: false,
      failureReason: "external_interruption",
    });
  });
});

// ── Public-path path redaction ────────────────────────────────────────────
//
// The redaction helpers have their own unit tests, but those pass whether or
// not this module actually CALLS them: deleting the wiring in
// padOrTrimAudioToVideoFrameCount left every one of them green. These drive
// the public entry point and assert on the public `PadTrimAudioResult.error`,
// which is what reaches logs, telemetry, and the caller.
describe("PadTrimAudioResult.error never carries the input path", () => {
  const cases: Array<{ name: string; videoPath: string; secret: string }> = [
    {
      name: "a dash-prefixed relative path",
      videoPath: "./assets/-customer-secret-intro.mp4",
      secret: "customer-secret-intro",
    },
    {
      name: "a non-allowlisted absolute root",
      videoPath: "/data/acme-secret/video.mp4",
      secret: "acme-secret",
    },
    {
      name: "a bare relative path",
      videoPath: "customer/acme-secret/video.mp4",
      secret: "acme-secret",
    },
  ];

  for (const { name, videoPath, secret } of cases) {
    it(`redacts ${name} raised by the video probe`, async () => {
      const result = await padOrTrimAudioToVideoFrameCount({
        videoPath,
        audioPath: "/tmp/audio.m4a",
        outputPath: "/tmp/out.aac",
        // Reproduces the real thrower: defaultProbeVideoFrameInfo raises
        // `ffprobe found no video stream in ${videoPath}` with the raw path.
        probeVideoFrameInfo: () =>
          Promise.reject(new Error(`ffprobe found no video stream in ${videoPath}`)),
        probeAudioInfo: () => Promise.resolve({ durationSeconds: 1 }),
        runFfmpeg: () => Promise.resolve({ success: true }),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error ?? "").not.toContain(secret);
      expect(result.error ?? "").not.toContain(videoPath);
      // Still diagnosable — the failure mode survives redaction.
      expect(result.error ?? "").toContain("failed to probe video");
    });
  }

  it("redacts raw ffprobe stderr surfaced through the audio probe", async () => {
    const result = await padOrTrimAudioToVideoFrameCount({
      videoPath: "/tmp/v.mp4",
      audioPath: "/data/acme-secret/audio.m4a",
      outputPath: "/tmp/out.aac",
      probeVideoFrameInfo: () => Promise.resolve({ frameCount: 30, fpsNum: 30, fpsDen: 1 }),
      probeAudioInfo: () =>
        Promise.reject(
          new Error("/data/acme-secret/audio.m4a: Invalid data found when processing input"),
        ),
      runFfmpeg: () => Promise.resolve({ success: true }),
    });

    expect(result.success).toBe(false);
    expect(result.error ?? "").not.toContain("acme-secret");
    expect(result.error ?? "").toContain("failed to probe audio");
  });

  // An injected probe can reject with anything. Casting the reason to Error and
  // reading `.message` yielded undefined, which threw inside the redactor and
  // turned a returned failure result into a rejected promise.
  describe("a probe that rejects with a non-Error value", () => {
    const nonErrors: Array<[string, unknown]> = [
      ["a string", "probe failed"],
      ["undefined", undefined],
      ["null", null],
      ["a number", 42],
      ["a plain object", { code: "ENOENT" }],
    ];

    for (const [label, reason] of nonErrors) {
      it(`still returns a failed result when the video probe rejects with ${label}`, async () => {
        const result = await padOrTrimAudioToVideoFrameCount({
          videoPath: "/data/acme-secret/video.mp4",
          audioPath: "/tmp/audio.m4a",
          outputPath: "/tmp/out.aac",
          probeVideoFrameInfo: () => Promise.reject(reason),
          probeAudioInfo: () => Promise.resolve({ durationSeconds: 1 }),
          runFfmpeg: () => Promise.resolve({ success: true }),
        });
        expect(result.success).toBe(false);
        expect(result.error ?? "").toContain("failed to probe video");
      });

      it(`still returns a failed result when the audio probe rejects with ${label}`, async () => {
        const result = await padOrTrimAudioToVideoFrameCount({
          videoPath: "/tmp/v.mp4",
          audioPath: "/data/acme-secret/audio.m4a",
          outputPath: "/tmp/out.aac",
          probeVideoFrameInfo: () => Promise.resolve({ frameCount: 30, fpsNum: 30, fpsDen: 1 }),
          probeAudioInfo: () => Promise.reject(reason),
          runFfmpeg: () => Promise.resolve({ success: true }),
        });
        expect(result.success).toBe(false);
        expect(result.error ?? "").toContain("failed to probe audio");
      });
    }
  });
});
