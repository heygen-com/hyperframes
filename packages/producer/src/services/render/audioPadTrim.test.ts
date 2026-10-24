/**
 * Tests for the `audioPadTrim` helper that backs the distributed
 * `assemble()` step's audio duration correction.
 *
 * The helper is split into:
 *   - `buildPadTrimAudioPlan(...)` — pure function, builds the steps
 *     and labels the operation. Fully unit-testable.
 *   - `padOrTrimAudioToVideoFrameCount(...)` — wrapper that probes the
 *     video for frame count + fps, probes the audio for current duration,
 *     and runs the plan's steps. Tests inject stubs for the probes, the
 *     ffmpeg runner and the AAC encoder.
 *
 * No real ffmpeg/ffprobe runs in these tests.
 */

import { describe, expect, it, mock, spyOn } from "bun:test";
import * as fs from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPadTrimAudioPlan,
  padOrTrimAudioToVideoFrameCount,
  type AudioProbeInfo,
  type PadTrimAudioInput,
  type ProbeVideoFrameInfo,
} from "./audioPadTrim.js";

describe("buildPadTrimAudioPlan", () => {
  const filterOf = (plan: ReturnType<typeof buildPadTrimAudioPlan>) => {
    const step = plan.steps[0]!;
    return step.kind === "copy" ? undefined : step.filter;
  };

  it("pads to the exact target when audio is shorter", () => {
    const plan = buildPadTrimAudioPlan("/tmp/in.aac", "/tmp/out.aac", 4.0, 5.0);
    expect(plan.operation).toBe("pad");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.kind).toBe("normalize");
    expect(filterOf(plan)).toBe("apad,atrim=0:5.000000");
    expect(filterOf(plan)).not.toContain("whole_dur");
    // The single-step filter plan has no intermediate artifacts to clean up.
    expect(plan.cleanupPaths).toEqual([]);
  });

  it("filter-trims AAC packet padding beyond the target", () => {
    const plan = buildPadTrimAudioPlan("/tmp/in.aac", "/tmp/out.m4a", 15.018667, 15.0);
    expect(plan.operation).toBe("trim");
    expect(filterOf(plan)).toBe("atrim=duration=15.000000,asetpts=PTS-STARTPTS");
  });

  it("emits a plain copy when source duration matches target within ~1ms", () => {
    const plan = buildPadTrimAudioPlan("/tmp/in.aac", "/tmp/out.aac", 5.0, 5.0);
    expect(plan.operation).toBe("copy");
    expect(plan.steps).toEqual([
      { kind: "copy", args: ["-i", "/tmp/in.aac", "-c:a", "copy", "-y", "/tmp/out.aac"] },
    ]);
  });

  it("emits 6-decimal-place pad duration (no scientific notation)", () => {
    // 1.23ms — just over the AUDIO_DURATION_TOLERANCE_SECONDS=1ms threshold,
    // so we exercise the pad path with a tiny duration that would round to
    // exponent notation if we used `toString()` instead of `toFixed(6)`.
    const plan = buildPadTrimAudioPlan("/tmp/in.aac", "/tmp/out.aac", 0.0, 0.00123);
    expect(plan.operation).toBe("pad");
    expect(filterOf(plan)).toBe("apad,atrim=0:0.001230");
  });

  it("flags ~1ms drift as a copy (below the tolerance threshold)", () => {
    const close = buildPadTrimAudioPlan("/tmp/a.aac", "/tmp/o.aac", 5.0, 5.0005);
    expect(close.operation).toBe("copy");
  });

  it("flags >1ms drift in either direction as pad/trim", () => {
    const padNeeded = buildPadTrimAudioPlan("/tmp/a.aac", "/tmp/o.aac", 5.0, 5.002);
    expect(padNeeded.operation).toBe("pad");
    const trimNeeded = buildPadTrimAudioPlan("/tmp/a.aac", "/tmp/o.aac", 5.002, 5.0);
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
    expect(filterOf(winPlan)).toBe("apad,atrim=0:5.000000");
  });
});

describe("padOrTrimAudioToVideoFrameCount", () => {
  type StepResult = { success: boolean; error?: string; failureReason?: "external_interruption" };
  type Encode = { durationSeconds: number; filter: string };
  // Build a minimal harness that stubs out the duration probes, the ffmpeg runner and the encoder.
  function harness(opts: {
    video: ProbeVideoFrameInfo | "throw";
    audio: AudioProbeInfo | "throw";
    step?: () => Promise<StepResult>;
  }): { input: PadTrimAudioInput; captured: { args: string[][]; encodes: Encode[] } } {
    const captured = { args: [] as string[][], encodes: [] as Encode[] };
    const step = opts.step ?? (async () => ({ success: true }));
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
      runFfmpeg: async (args) => {
        captured.args.push(args);
        return step();
      },
      encodeAac: async (_input, _output, durationSeconds, filter) => {
        captured.encodes.push({ durationSeconds, filter });
        return step();
      },
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
    expect(captured.encodes).toEqual([{ durationSeconds: 6, filter: "apad,atrim=0:6.000000" }]);
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
    expect(captured.encodes).toEqual([
      { durationSeconds: 4, filter: "atrim=duration=4.000000,asetpts=PTS-STARTPTS" },
    ]);
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
    expect(captured.encodes).toEqual([]);
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
    expect(captured.encodes[0]!.filter).toBe("apad,atrim=0:4.004000");
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
      step: async () => ({ success: false, error: "synthetic ffmpeg failure" }),
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
      step: async () => ({
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

  it("accepts silence as already below the AAC true-peak ceiling", async () => {
    const { input, captured } = harness({
      video: { frameCount: 90, fpsNum: 30, fpsDen: 1 },
      audio: { durationSeconds: 3 },
    });
    input.probeAudioTruePeakDbfs = async () => Number.NEGATIVE_INFINITY;

    const result = await padOrTrimAudioToVideoFrameCount(input);

    expect(result.success).toBe(true);
    expect(captured.args).toHaveLength(1);
    expect(result).not.toHaveProperty("audioLoweredDb");
  });

  it("attenuates the duration-normalized artifact with AAC correction headroom", async () => {
    const calls: { durationSeconds: number; filter: string }[] = [];
    const { input } = harness({
      video: { frameCount: 90, fpsNum: 30, fpsDen: 1 },
      audio: { durationSeconds: 3.029333 },
    });
    input.probeAudioTruePeakDbfs = async () => 1.5;
    input.encodeAac = async (_input, _output, durationSeconds, filter) => {
      calls.push({ durationSeconds, filter });
      return calls.length === 1
        ? { success: true }
        : { success: false, error: "synthetic correction stop" };
    };

    const result = await padOrTrimAudioToVideoFrameCount(input);

    expect(result.success).toBe(false);
    expect(result.error).toBe("synthetic correction stop");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({
      durationSeconds: 3,
      filter: "volume=-3.000dB,apad,atrim=0:3.000000",
    });
  });

  it("rides out a transient Windows file lock when the corrected AAC replaces the audio", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-peak-lock-"));
    const outputPath = join(dir, "o.aac");
    writeFileSync(outputPath, "original");
    const { input } = harness({
      video: { frameCount: 90, fpsNum: 30, fpsDen: 1 },
      audio: { durationSeconds: 3 },
    });
    input.outputPath = outputPath;
    let peaks = [1.5, -3];
    input.probeAudioTruePeakDbfs = async () => peaks.shift()!;
    input.encodeAac = async (_input, output) => {
      writeFileSync(output, "corrected");
      return { success: true };
    };
    const real = fs.renameSync;
    let locked = 2;
    const rename = spyOn(fs, "renameSync").mockImplementation(((from: string, to: string) => {
      if (locked-- > 0) throw Object.assign(new Error("EPERM: rename"), { code: "EPERM" });
      return real(from, to);
    }) as typeof fs.renameSync);
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const result = await padOrTrimAudioToVideoFrameCount(input);
      expect(result.success).toBe(true);
      expect(fs.readFileSync(outputPath, "utf-8")).toBe("corrected");
    } finally {
      Object.defineProperty(process, "platform", platform);
      rename.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the end of a long correction failure, where ffmpeg says what went wrong", async () => {
    const { input } = harness({
      video: { frameCount: 90, fpsNum: 30, fpsDen: 1 },
      audio: { durationSeconds: 3 },
    });
    const banner = Array.from({ length: 12 }, (_, i) => `  metadata line ${i}: value`).join("\n");
    const cause = "Error while filtering: the real ffmpeg cause";
    let runs = 0;
    input.probeAudioTruePeakDbfs = async () => 1.5;
    input.encodeAac = async () =>
      ++runs === 1 ? { success: true } : { success: false, error: `[FFmpeg] ${banner}\n${cause}` };

    const result = await padOrTrimAudioToVideoFrameCount(input);

    expect(result.success).toBe(false);
    expect(result.error!.length).toBeGreaterThan(240);
    expect(result.error).toContain(cause);
  });

  it("uses correction headroom to converge within three AAC passes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-aac-convergence-"));
    const corrections: number[] = [];
    let attenuationDb = 0;
    const { input } = harness({
      video: { frameCount: 90, fpsNum: 30, fpsDen: 1 },
      audio: { durationSeconds: 3 },
    });
    input.videoPath = join(dir, "video.mp4");
    input.audioPath = join(dir, "source.m4a");
    input.outputPath = join(dir, "normalized.m4a");
    input.probeAudioTruePeakDbfs = async () => attenuationDb * 0.4;
    input.encodeAac = async (_input, output, _durationSeconds, filter) => {
      const volume = /^volume=(-?[\d.]+)dB/.exec(filter);
      if (volume) {
        attenuationDb = Number(volume[1]);
        corrections.push(attenuationDb);
      }
      writeFileSync(output, "");
      return { success: true };
    };

    try {
      const result = await padOrTrimAudioToVideoFrameCount(input);

      expect(result.success, result.error).toBe(true);
      expect(corrections).toEqual([-1.5, -2.9]);
      expect(result.audioLoweredDb).toBe(2.9);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports every measured peak and attenuation when correction is exhausted", async () => {
    const peaks = [0, -0.4, -0.6, -0.8];
    let probeIndex = 0;
    const { input } = harness({
      video: { frameCount: 90, fpsNum: 30, fpsDen: 1 },
      audio: { durationSeconds: 3 },
    });
    input.probeAudioTruePeakDbfs = async () => peaks[probeIndex++]!;

    const result = await padOrTrimAudioToVideoFrameCount(input);

    expect(result.success).toBe(false);
    expect(result.error).toContain("pass 0: 0.000 dBFS at 0.000 dB attenuation");
    expect(result.error).toContain("pass 1: -0.400 dBFS at -1.500 dB attenuation");
    expect(result.error).toContain("pass 2: -0.600 dBFS at -3.100 dB attenuation");
    expect(result.error).toContain("pass 3: -0.800 dBFS at -5.500 dB attenuation");
  });

  it("gets under the ceiling when the AAC peak stalls as attenuation grows", async () => {
    // A failed render's measured peaks (pass 0..3), then the peak falling dB for dB again.
    const stalled: [number, number][] = [
      [0, 1.9],
      [-3.4, -0.5],
      [-4.4, -0.6],
      [-5.3, -0.6],
    ];
    const peakAt = (db: number) => {
      const i = stalled.findIndex(([at]) => at <= db);
      if (i === -1) return -0.6 + (db + 5.3);
      if (i === 0) return stalled[0]![1];
      const [[a, pa], [b, pb]] = [stalled[i - 1]!, stalled[i]!];
      return pa + ((pb - pa) * (db - a)) / (b - a);
    };
    const dir = mkdtempSync(join(tmpdir(), "hf-aac-stall-"));
    const corrections: number[] = [];
    let attenuationDb = 0;
    const { input } = harness({
      video: { frameCount: 90, fpsNum: 30, fpsDen: 1 },
      audio: { durationSeconds: 3 },
    });
    input.videoPath = join(dir, "video.mp4");
    input.audioPath = join(dir, "source.m4a");
    input.outputPath = join(dir, "normalized.m4a");
    input.probeAudioTruePeakDbfs = async () => peakAt(attenuationDb);
    input.encodeAac = async (_input, output, _durationSeconds, filter) => {
      const volume = /^volume=(-?[\d.]+)dB/.exec(filter);
      if (volume) {
        attenuationDb = Number(volume[1]);
        corrections.push(attenuationDb);
      }
      writeFileSync(output, "");
      return { success: true };
    };

    try {
      const result = await padOrTrimAudioToVideoFrameCount(input);

      expect(result.success, result.error).toBe(true);
      expect(corrections).toEqual([-3.4, -4.9, -7.3]);
      expect(result.audioLoweredDb).toBe(7.3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
