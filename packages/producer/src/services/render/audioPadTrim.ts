// fallow-ignore-file complexity
/**
 * audioPadTrim — pad-or-trim an `audio.aac` file so its exact duration
 * matches the assembled video's frame count divided by fps.
 *
 * Distributed render assemble step needs this because:
 *   - The plan's audio is mixed once against the composition's *declared*
 *     duration.
 *   - The actual video produced by concatenating per-chunk encodes is the
 *     sum of per-chunk frame counts. With closed-GOP concat-copy this is
 *     deterministic and equals the planned frame count, BUT downstream
 *     muxers (ffmpeg `-shortest` plus Apple's mov demuxer in particular)
 *     are sensitive to ±1ms audio/video duration drift and produce silent
 *     "audio cuts off early" or "video shows a frozen final frame" bugs.
 *
 * The fix: post-pad/trim audio to *exactly* `frameCount / fps` seconds at
 * assemble time. Pad by concat-copying a generated silence tail, trim with
 * `-t`, and avoid re-encoding the already mixed source AAC in either case.
 */

import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import {
  extractAudioMetadata,
  formatFfmpegError,
  getFfprobeBinary,
  ManagedChildProcess,
  runFfmpeg,
  trackChildProcess,
  type AudioMetadata,
} from "@hyperframes/engine";

/**
 * Tolerance used to decide whether an audio file is already short enough to
 * skip the pad/trim operation entirely. ~1ms is well below the perceptual
 * threshold and well below any frame interval at 24/30/60fps.
 */
const AUDIO_DURATION_TOLERANCE_SECONDS = 0.001;

export interface ProbeVideoFrameInfo {
  /** Number of video frames in the stream. */
  frameCount: number;
  /** Numerator of the frame rate fraction (e.g. 30 or 30000). */
  fpsNum: number;
  /** Denominator of the frame rate fraction (e.g. 1 or 1001). */
  fpsDen: number;
}

export interface AudioProbeInfo {
  /** Decoded duration in seconds. */
  durationSeconds: number;
  /** Audio sample rate in Hz. Used when generating pad silence. */
  sampleRate?: number;
  /** Audio channel count. Used when generating pad silence. */
  channels?: number;
  /** Codec name reported by ffprobe. */
  audioCodec?: string;
}

export interface PadTrimAudioInput {
  /** Path to the assembled video. Used to derive `frameCount / fps`. */
  videoPath: string;
  /** Path to the pre-mixed audio (typically `<planDir>/audio.aac`). */
  audioPath: string;
  /** Path the helper writes the duration-corrected audio to. */
  outputPath: string;
  signal?: AbortSignal;
  /**
   * Optional injectables for unit tests. Production callers omit them and
   * get the real `ffprobe`/`ffmpeg`-backed implementations.
   */
  probeVideoFrameInfo?: (videoPath: string) => Promise<ProbeVideoFrameInfo>;
  probeAudioInfo?: (audioPath: string, signal?: AbortSignal) => Promise<AudioProbeInfo>;
  runFfmpeg?: (args: string[]) => Promise<{ success: boolean; error?: string }>;
}

export type PadTrimOperation = "pad" | "trim" | "copy";

export interface PadTrimAudioResult {
  success: boolean;
  outputPath: string;
  /** `frameCount / fps` to ~nanosecond precision. */
  targetDurationSeconds: number;
  /** Probed duration of the input audio. */
  sourceDurationSeconds: number;
  /** How the duration was corrected. */
  operation: PadTrimOperation;
  /** Populated only when `success === false`. */
  error?: string;
}

export type PadTrimAudioStepKind = "copy" | "trim" | "pad-silence" | "pad-concat";

export interface PadTrimAudioStep {
  kind: PadTrimAudioStepKind;
  args: string[];
  /**
   * Concat-demuxer script materialization. When both fields are set, the
   * runner writes `concatListContent` to `concatListPath` synchronously
   * before spawning ffmpeg, and the step's `args` reference that path via
   * `-i concatListPath`. Feeding the concat script through a real file
   * (instead of `pipe:0`) is what makes bare-path directives work on both
   * Linux and Windows — see `concatFileLine` for the platform history.
   */
  concatListPath?: string;
  concatListContent?: string;
}

export interface PadTrimAudioPlan {
  operation: PadTrimOperation;
  steps: PadTrimAudioStep[];
  cleanupPaths: string[];
}

/**
 * Pure helper: decide the pad/trim operation and build the ffmpeg argv
 * sequence that materializes it. Exported separately so unit tests can pin
 * every branch without spawning ffmpeg.
 *
 *   - `sourceDuration < targetDuration` → generate only the missing silence
 *     tail, then concat-copy the source AAC plus that tail. This avoids
 *     re-encoding the already mixed `audio.aac`; the pad branch remains the
 *     inverse of trim instead of becoming a second full-source AAC encode.
 *   - `sourceDuration > targetDuration` → trim with `-t target`. `-c:a copy`
 *     is preserved when the input is already AAC.
 *   - `|Δ| < AUDIO_DURATION_TOLERANCE_SECONDS` → no-op `copy`, but we still
 *     run ffmpeg with `-c:a copy` to materialize the output path.
 */
export function buildPadTrimAudioPlan(
  audioPath: string,
  outputPath: string,
  sourceDurationSeconds: number,
  targetDurationSeconds: number,
  audioInfo: Pick<AudioProbeInfo, "sampleRate" | "channels"> = {},
): PadTrimAudioPlan {
  const delta = targetDurationSeconds - sourceDurationSeconds;
  const targetSec = formatSeconds(targetDurationSeconds);
  if (Math.abs(delta) < AUDIO_DURATION_TOLERANCE_SECONDS) {
    return {
      operation: "copy",
      steps: [{ kind: "copy", args: ["-i", audioPath, "-c:a", "copy", "-y", outputPath] }],
      cleanupPaths: [],
    };
  }
  if (delta > 0) {
    const padDur = formatSeconds(delta);
    const silencePath = `${outputPath}.pad-silence.aac`;
    const concatListPath = `${outputPath}.concat-list.txt`;
    return {
      operation: "pad",
      steps: [
        {
          kind: "pad-silence",
          args: [
            "-f",
            "lavfi",
            "-i",
            `anullsrc=channel_layout=${channelLayoutForChannels(audioInfo.channels)}:sample_rate=${sampleRateForFilter(audioInfo.sampleRate)}`,
            "-t",
            padDur,
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-y",
            silencePath,
          ],
        },
        {
          kind: "pad-concat",
          args: [
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concatListPath,
            "-c:a",
            "copy",
            "-y",
            outputPath,
          ],
          concatListPath,
          concatListContent: `${concatFileLine(audioPath)}\n${concatFileLine(silencePath)}\n`,
        },
      ],
      cleanupPaths: [silencePath, concatListPath],
    };
  }
  // Trim. `-t` truncates AAC without re-encoding because AAC frames are
  // independently decodable; ffmpeg snaps the cut point to the nearest
  // packet boundary, fine for the ±1ms tolerance we care about here.
  return {
    operation: "trim",
    steps: [
      { kind: "trim", args: ["-i", audioPath, "-t", targetSec, "-c:a", "copy", "-y", outputPath] },
    ],
    cleanupPaths: [],
  };
}

export function buildPadTrimAudioArgs(
  audioPath: string,
  outputPath: string,
  sourceDurationSeconds: number,
  targetDurationSeconds: number,
): { args: string[]; operation: PadTrimOperation } {
  const plan = buildPadTrimAudioPlan(
    audioPath,
    outputPath,
    sourceDurationSeconds,
    targetDurationSeconds,
  );
  return { operation: plan.operation, args: plan.steps[0]?.args ?? [] };
}

/**
 * Format a duration as a fixed-precision decimal string. ffmpeg parses
 * scientific notation inconsistently across versions (some treat `1e-3` as
 * a literal time arg, some don't), so we explicitly avoid it.
 */
function formatSeconds(sec: number): string {
  // 6 decimal places = ~microseconds, well under one AAC frame at 48 kHz.
  return sec.toFixed(6);
}

function sampleRateForFilter(sampleRate: number | undefined): number {
  return sampleRate !== undefined && Number.isFinite(sampleRate) && sampleRate > 0
    ? Math.round(sampleRate)
    : 48000;
}

function channelLayoutForChannels(channels: number | undefined): string {
  if (channels === 1) return "mono";
  if (channels === 6) return "5.1";
  if (channels === 8) return "7.1";
  return "stereo";
}

function concatFileLine(path: string): string {
  // Bare paths in concat directives — NOT `file://` URLs. Two failure
  // modes on the round trip to a working shape:
  //   1. `file:///C:/…` — FFmpeg 8.x on Windows fails to open URL-form
  //      paths from the concat demuxer with "Impossible to open
  //      file:///C:/…" (its `file:` protocol strips the scheme leaving
  //      `///C:/…`, which Windows path parsing then rejects). Field-
  //      signal reports ts=1784169914 / 1784177061 / 1784177375 (all
  //      win32/x64 CLI 0.7.59; the last isolated the module's arg shape
  //      vs a working manual `apad=whole_dur` command).
  //   2. Bare `/tmp/…` when the concat script was fed via `pipe:0` —
  //      FFmpeg's URL joiner resolves absolute POSIX paths against the
  //      base `pipe:` URL, producing `pipe:/tmp/…` which the demuxer
  //      then tries to open as a pipe. Broke Linux CI (regression shard
  //      + producer integration) once the `file://` prefix was dropped.
  // Fix: emit bare paths AND materialize the concat script into a real
  // file (see `concatListPath`/`concatListContent` on the pad-concat
  // step), matching sibling `assemble.ts`'s concat convention. A real
  // file's directory becomes the base URL, and absolute paths in the
  // script resolve as-is on both platforms. The single-quote escaping
  // (`'\''`) is the concat demuxer's own escape rule.
  return `file '${path.replace(/'/g, "'\\''")}'`;
}

/**
 * Pad or trim `audio.aac` so its exact duration matches `frameCount / fps`
 * for the assembled video.
 */
export async function padOrTrimAudioToVideoFrameCount(
  input: PadTrimAudioInput,
): Promise<PadTrimAudioResult> {
  const probeVideo =
    input.probeVideoFrameInfo ??
    ((videoPath: string) => defaultProbeVideoFrameInfo(videoPath, input.signal));
  const probeAudio = input.probeAudioInfo ?? defaultProbeAudioInfo;
  const runner = input.runFfmpeg ?? ((args: string[]) => defaultRunFfmpeg(args, input.signal));

  // Probe video and audio in parallel — the two ffprobe invocations are
  // independent and account for most of this function's wall-clock time.
  const [videoResult, audioResult] = await Promise.allSettled([
    probeVideo(input.videoPath),
    probeAudio(input.audioPath, input.signal),
  ]);

  if (videoResult.status === "rejected") {
    return failResult(
      input.outputPath,
      0,
      audioResult.status === "fulfilled" ? audioResult.value.durationSeconds : 0,
      `audioPadTrim: failed to probe video: ${(videoResult.reason as Error).message}`,
    );
  }
  if (audioResult.status === "rejected") {
    return failResult(
      input.outputPath,
      0,
      0,
      `audioPadTrim: failed to probe audio: ${(audioResult.reason as Error).message}`,
    );
  }

  const videoInfo = videoResult.value;
  const audioInfo = audioResult.value;

  if (
    !Number.isFinite(videoInfo.frameCount) ||
    videoInfo.frameCount <= 0 ||
    !Number.isFinite(videoInfo.fpsNum) ||
    videoInfo.fpsNum <= 0 ||
    !Number.isFinite(videoInfo.fpsDen) ||
    videoInfo.fpsDen <= 0
  ) {
    return failResult(
      input.outputPath,
      0,
      audioInfo.durationSeconds,
      `audioPadTrim: invalid video frame info: ${JSON.stringify(videoInfo)}`,
    );
  }

  const targetDurationSeconds = (videoInfo.frameCount * videoInfo.fpsDen) / videoInfo.fpsNum;
  const plan = buildPadTrimAudioPlan(
    input.audioPath,
    input.outputPath,
    audioInfo.durationSeconds,
    targetDurationSeconds,
    audioInfo,
  );

  try {
    for (const step of plan.steps) {
      // Materialize the concat-demuxer script to a real file when the step
      // needs one. Doing this here (instead of piping via `pipe:0` in the
      // runner) is what makes the demuxer's URL resolution treat
      // absolute paths as absolute — see `concatFileLine` for context.
      if (step.concatListPath !== undefined && step.concatListContent !== undefined) {
        writeFileSync(step.concatListPath, step.concatListContent, "utf-8");
      }
      const ffmpegResult = await runner(step.args);
      if (!ffmpegResult.success) {
        return {
          success: false,
          outputPath: input.outputPath,
          targetDurationSeconds,
          sourceDurationSeconds: audioInfo.durationSeconds,
          operation: plan.operation,
          error: ffmpegResult.error,
        };
      }
    }
  } catch (err) {
    return {
      success: false,
      outputPath: input.outputPath,
      targetDurationSeconds,
      sourceDurationSeconds: audioInfo.durationSeconds,
      operation: plan.operation,
      error: `audioPadTrim: failed to materialize ${plan.operation}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  } finally {
    for (const path of plan.cleanupPaths) rmSync(path, { force: true });
  }
  return {
    success: true,
    outputPath: input.outputPath,
    targetDurationSeconds,
    sourceDurationSeconds: audioInfo.durationSeconds,
    operation: plan.operation,
  };
}

function failResult(
  outputPath: string,
  target: number,
  source: number,
  error: string,
): PadTrimAudioResult {
  return {
    success: false,
    outputPath,
    targetDurationSeconds: target,
    sourceDurationSeconds: source,
    operation: "copy",
    error,
  };
}

// ── default probe/run implementations ─────────────────────────────────────

interface FfprobeStreamInfo {
  nb_read_packets?: string;
  nb_frames?: string;
  r_frame_rate?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStreamInfo[];
}

async function defaultProbeVideoFrameInfo(
  videoPath: string,
  signal?: AbortSignal,
): Promise<ProbeVideoFrameInfo> {
  // Try the container header (`nb_frames`) first — single moov atom read,
  // no decode. Closed-GOP, B-frame-free streams (the only ones we'll ever
  // ask to pad/trim) reliably set it. Fall back to `-count_packets` which
  // walks the packet stream when the header doesn't carry the count.
  const fastInfo = await runFfprobeJson<FfprobeOutput>(
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=nb_frames,r_frame_rate",
      "-of",
      "json",
      videoPath,
    ],
    signal,
  );
  let stream = fastInfo.streams?.[0];
  const fastCount = Number(stream?.nb_frames);
  if (stream && Number.isFinite(fastCount) && fastCount > 0) {
    return { frameCount: fastCount, ...parseFrameRate(stream.r_frame_rate ?? "") };
  }
  const slowInfo = await runFfprobeJson<FfprobeOutput>(
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_packets",
      "-show_entries",
      "stream=nb_read_packets,r_frame_rate",
      "-of",
      "json",
      videoPath,
    ],
    signal,
  );
  stream = slowInfo.streams?.[0];
  if (!stream) throw new Error(`ffprobe found no video stream in ${videoPath}`);
  const slowCount = Number(stream.nb_read_packets);
  if (!Number.isFinite(slowCount) || slowCount <= 0) {
    throw new Error(`ffprobe returned no frame count: ${JSON.stringify(stream)}`);
  }
  return { frameCount: slowCount, ...parseFrameRate(stream.r_frame_rate ?? "") };
}

function parseFrameRate(rate: string): { fpsNum: number; fpsDen: number } {
  const [n, d] = rate.split("/");
  const fpsNum = Number(n);
  const fpsDen = d === undefined ? 1 : Number(d);
  if (!Number.isFinite(fpsNum) || !Number.isFinite(fpsDen) || fpsNum <= 0 || fpsDen <= 0) {
    throw new Error(`Invalid r_frame_rate: ${JSON.stringify(rate)}`);
  }
  return { fpsNum, fpsDen };
}

async function defaultProbeAudioInfo(
  audioPath: string,
  signal?: AbortSignal,
): Promise<AudioProbeInfo> {
  // The shared ffprobe wrapper derives AAC-LC duration from packet count so
  // every consumer sees the same VBR-safe metadata while preserving cancellation.
  const metadata: AudioMetadata = await extractAudioMetadata(audioPath, { signal });
  return {
    durationSeconds: metadata.durationSeconds,
    sampleRate: metadata.sampleRate,
    channels: metadata.channels,
    audioCodec: metadata.audioCodec,
  };
}

async function defaultRunFfmpeg(
  args: string[],
  signal?: AbortSignal,
): Promise<{ success: boolean; error?: string }> {
  const result = await runFfmpeg(args, { signal });
  if (result.success) return { success: true };
  return {
    success: false,
    error: `[audioPadTrim] ${formatFfmpegError(result.exitCode, result.stderr)}`,
  };
}

// ── ffprobe JSON runner (shared between fast/slow video probe paths) ─────

async function runFfprobeJson<T>(args: string[], signal?: AbortSignal): Promise<T> {
  const proc = spawn(getFfprobeBinary(), args);
  trackChildProcess(proc);
  let stdout = "";
  proc.stdout.on("data", (data: Buffer) => {
    stdout += data.toString();
  });
  const managed = new ManagedChildProcess(proc, {
    signal,
    deadlineAtMs: Date.now() + 30_000,
  });
  const outcome = await managed.wait();
  if (outcome.reason === "spawn_error") {
    if ((outcome.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      throw new Error("[audioPadTrim] ffprobe not found. Please install FFmpeg.");
    }
    throw outcome.error ?? new Error(outcome.stderr);
  }
  if (outcome.reason !== "exit" || outcome.exitCode !== 0) {
    throw new Error(`ffprobe ${outcome.reason}: ${outcome.stderr}`);
  }
  try {
    return JSON.parse(stdout) as T;
  } catch (err) {
    throw new Error(`Failed to parse ffprobe output: ${(err as Error).message}`);
  }
}
