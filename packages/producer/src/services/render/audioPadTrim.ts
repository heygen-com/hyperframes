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
 * assemble time. Pad with `apad=pad_dur=…` (silence fill), trim with `-t`.
 */

import { spawn } from "node:child_process";
import {
  extractAudioMetadata,
  formatFfmpegError,
  getFfprobeBinary,
  runFfmpeg,
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
}

export interface PadTrimAudioInput {
  /** Path to the assembled video. Used to derive `frameCount / fps`. */
  videoPath: string;
  /** Path to the pre-mixed audio (typically `<planDir>/audio.aac`). */
  audioPath: string;
  /** Path the helper writes the duration-corrected audio to. */
  outputPath: string;
  /**
   * Optional injectables for unit tests. Production callers omit them and
   * get the real `ffprobe`/`ffmpeg`-backed implementations.
   */
  probeVideoFrameInfo?: (videoPath: string) => Promise<ProbeVideoFrameInfo>;
  probeAudioInfo?: (audioPath: string) => Promise<AudioProbeInfo>;
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

/**
 * Pure helper: decide the pad/trim operation and build the ffmpeg argv list
 * that materializes it. Exported separately so unit tests can pin both
 * branches without spawning ffmpeg.
 *
 *   - `sourceDuration < targetDuration` → pad with `apad=pad_dur=Δ`.
 *     Re-encode is required: `apad` is a filter and filters can't combine
 *     with `-c:a copy`.
 *   - `sourceDuration > targetDuration` → trim with `-t target`. `-c:a copy`
 *     is preserved when the input is already AAC.
 *   - `|Δ| < AUDIO_DURATION_TOLERANCE_SECONDS` → no-op `copy`, but we still
 *     run ffmpeg with `-c:a copy` to materialize the output path.
 */
export function buildPadTrimAudioArgs(
  audioPath: string,
  outputPath: string,
  sourceDurationSeconds: number,
  targetDurationSeconds: number,
): { args: string[]; operation: PadTrimOperation } {
  const delta = targetDurationSeconds - sourceDurationSeconds;
  const targetSec = formatSeconds(targetDurationSeconds);
  if (Math.abs(delta) < AUDIO_DURATION_TOLERANCE_SECONDS) {
    return {
      operation: "copy",
      args: ["-i", audioPath, "-c:a", "copy", "-y", outputPath],
    };
  }
  if (delta > 0) {
    const padDur = formatSeconds(delta);
    return {
      operation: "pad",
      args: [
        "-i",
        audioPath,
        "-af",
        `apad=pad_dur=${padDur}`,
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-y",
        outputPath,
      ],
    };
  }
  // Trim. `-t` truncates AAC without re-encoding because AAC frames are
  // independently decodable; ffmpeg snaps the cut point to the nearest
  // packet boundary, fine for the ±1ms tolerance we care about here.
  return {
    operation: "trim",
    args: ["-i", audioPath, "-t", targetSec, "-c:a", "copy", "-y", outputPath],
  };
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

/**
 * Pad or trim `audio.aac` so its exact duration matches `frameCount / fps`
 * for the assembled video.
 */
export async function padOrTrimAudioToVideoFrameCount(
  input: PadTrimAudioInput,
): Promise<PadTrimAudioResult> {
  const probeVideo = input.probeVideoFrameInfo ?? defaultProbeVideoFrameInfo;
  const probeAudio = input.probeAudioInfo ?? defaultProbeAudioInfo;
  const runner = input.runFfmpeg ?? defaultRunFfmpeg;

  // Probe video and audio in parallel — the two ffprobe invocations are
  // independent and account for most of this function's wall-clock time.
  const [videoResult, audioResult] = await Promise.allSettled([
    probeVideo(input.videoPath),
    probeAudio(input.audioPath),
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
  const { args, operation } = buildPadTrimAudioArgs(
    input.audioPath,
    input.outputPath,
    audioInfo.durationSeconds,
    targetDurationSeconds,
  );

  const ffmpegResult = await runner(args);
  if (!ffmpegResult.success) {
    return {
      success: false,
      outputPath: input.outputPath,
      targetDurationSeconds,
      sourceDurationSeconds: audioInfo.durationSeconds,
      operation,
      error: ffmpegResult.error,
    };
  }
  return {
    success: true,
    outputPath: input.outputPath,
    targetDurationSeconds,
    sourceDurationSeconds: audioInfo.durationSeconds,
    operation,
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

async function defaultProbeVideoFrameInfo(videoPath: string): Promise<ProbeVideoFrameInfo> {
  // Try the container header (`nb_frames`) first — single moov atom read,
  // no decode. Closed-GOP, B-frame-free streams (the only ones we'll ever
  // ask to pad/trim) reliably set it. Fall back to `-count_packets` which
  // walks the packet stream when the header doesn't carry the count.
  const fastInfo = await runFfprobeJson<FfprobeOutput>([
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=nb_frames,r_frame_rate",
    "-of",
    "json",
    videoPath,
  ]);
  let stream = fastInfo.streams?.[0];
  const fastCount = Number(stream?.nb_frames);
  if (stream && Number.isFinite(fastCount) && fastCount > 0) {
    return { frameCount: fastCount, ...parseFrameRate(stream.r_frame_rate ?? "") };
  }
  const slowInfo = await runFfprobeJson<FfprobeOutput>([
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
  ]);
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

async function defaultProbeAudioInfo(audioPath: string): Promise<AudioProbeInfo> {
  // extractAudioMetadata is the shared ffprobe wrapper (caches results).
  const metadata: AudioMetadata = await extractAudioMetadata(audioPath);
  return { durationSeconds: metadata.durationSeconds };
}

async function defaultRunFfmpeg(args: string[]): Promise<{ success: boolean; error?: string }> {
  const result = await runFfmpeg(args);
  if (result.success) return { success: true };
  return {
    success: false,
    error: `[audioPadTrim] ${formatFfmpegError(result.exitCode, result.stderr)}`,
  };
}

// ── ffprobe JSON runner (shared between fast/slow video probe paths) ─────

function runFfprobeJson<T>(args: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const proc = spawn(getFfprobeBinary(), args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("[audioPadTrim] ffprobe not found. Please install FFmpeg."));
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch (err) {
        reject(new Error(`Failed to parse ffprobe output: ${(err as Error).message}`));
      }
    });
  });
}
