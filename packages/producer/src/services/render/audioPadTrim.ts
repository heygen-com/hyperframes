// fallow-ignore-file complexity
/**
 * audioPadTrim — pad-or-trim the mixed-audio file so its exact duration
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
 * assemble time. Both branches decode/filter and re-encode AAC. Concatenating
 * ADTS packets with `-c:a copy` is unsafe because concat timestamp estimation
 * can stretch the terminal packet in the final MP4.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_CONFIG,
  describeFfmpegFailure,
  encodeAac,
  extractAudioMetadata,
  getFfprobeBinary,
  ManagedChildProcess,
  renameWithRetry,
  runFfmpeg,
  trackChildProcess,
  type AudioMetadata,
  type RunFfmpegResult,
} from "@hyperframes/engine";
import { redactKnownPaths, redactTelemetryString } from "@hyperframes/core";
import { measureTruePeakDbfs } from "./audioTruePeak.js";

/**
 * Tolerance used to decide whether an audio file is already short enough to
 * skip the pad/trim operation entirely. ~1ms is well below the perceptual
 * threshold and well below any frame interval at 24/30/60fps.
 */
const AUDIO_DURATION_TOLERANCE_SECONDS = 0.001;

/** Delivery headroom applied after every AAC encode in this stage. */
export const AAC_DELIVERY_TRUE_PEAK_DBFS = -1;
const AAC_TRUE_PEAK_CORRECTION_HEADROOM_DB = 0.5;
const MAX_TRUE_PEAK_CORRECTION_PASSES = 3;

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
  /** Path to the pre-mixed audio (typically `<planDir>/audio.m4a`). */
  audioPath: string;
  /** Path the helper writes the duration-corrected audio to. */
  outputPath: string;
  signal?: AbortSignal;
  /** Deadline for each ffmpeg process; defaults to the engine's `ffmpegProcessTimeout`. */
  timeoutMs?: number;
  /**
   * Optional injectables. Tests stub them; the distributed assembler supplies
   * the frame probe because its video is still separate chunks.
   */
  probeVideoFrameInfo?: (videoPath: string) => Promise<ProbeVideoFrameInfo>;
  probeAudioInfo?: (audioPath: string, signal?: AbortSignal) => Promise<AudioProbeInfo>;
  probeAudioTruePeakDbfs?: (audioPath: string, signal?: AbortSignal) => Promise<number>;
  runFfmpeg?: (args: string[]) => Promise<StepResult>;
  encodeAac?: AacEncoder;
}

interface StepResult {
  success: boolean;
  error?: string;
  failureReason?: "external_interruption";
}

/** Encodes `filter` applied to `inputPath` as AAC of exactly `durationSeconds`. */
type AacEncoder = (
  inputPath: string,
  outputPath: string,
  durationSeconds: number,
  filter: string,
) => Promise<StepResult>;

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
  /** Stable machine-readable cause for failures safe to retry on a fresh host. */
  failureReason?: "external_interruption";
  /** dB the true-peak limiter lowered the whole mix by; absent when it did not engage. */
  audioLoweredDb?: number;
}

export type PadTrimAudioStep =
  | { kind: "copy"; args: string[] }
  | { kind: "trim" | "normalize"; filter: string };

export interface PadTrimAudioPlan {
  operation: PadTrimOperation;
  steps: PadTrimAudioStep[];
  cleanupPaths: string[];
}

function aacTruePeakCorrectionFilter(targetDurationSeconds: number, attenuationDb: number) {
  return `volume=${attenuationDb.toFixed(3)}dB,apad,atrim=0:${formatSeconds(targetDurationSeconds)}`;
}

/**
 * Pure helper: decide the pad/trim operation and the steps that
 * materialize it. Exported separately so unit tests can pin
 * every branch without spawning ffmpeg.
 *
 *   - `sourceDuration < targetDuration` → pad with `apad` to the exact target
 *     and re-encode AAC. This decodes and re-encodes the already mixed audio;
 *     an earlier concat-copy shape avoided that but could not produce a
 *     portable result on the bundled Windows FFmpeg builds.
 *   - `sourceDuration > targetDuration` → filter to the exact target and
 *     re-encode AAC so packet padding cannot outlast the video.
 *   - `|Δ| < AUDIO_DURATION_TOLERANCE_SECONDS` → no-op `copy`, but we still
 *     run ffmpeg with `-c:a copy` to materialize the output path.
 */
export function buildPadTrimAudioPlan(
  audioPath: string,
  outputPath: string,
  sourceDurationSeconds: number,
  targetDurationSeconds: number,
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
    return {
      operation: "pad",
      steps: [{ kind: "normalize", filter: `apad,atrim=0:${targetSec}` }],
      cleanupPaths: [],
    };
  }
  // Packet-copy trimming snaps to AAC frame boundaries (typically 1024
  // samples), which can leave ~20ms beyond the target. Decode/filter/re-encode
  // into M4A so ffmpeg records the exact presentation duration.
  return {
    operation: "trim",
    steps: [{ kind: "trim", filter: `atrim=duration=${targetSec},asetpts=PTS-STARTPTS` }],
    cleanupPaths: [],
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
 * Every probe failure message, sanitized once, at the one place they all pass
 * through on their way into the public `PadTrimAudioResult.error`.
 *
 * `runFfprobeJson` already scrubs the stderr it raises, but it is not the only
 * thrower: `defaultProbeVideoFrameInfo` raises
 * `ffprobe found no video stream in ${videoPath}` with the raw path, and a
 * caller-supplied `probeVideoFrameInfo` / `probeAudioInfo` can raise anything
 * at all. Sanitizing per-thrower is a list that will drift; sanitizing at the
 * boundary cannot be bypassed by adding a new throw upstream.
 *
 * Known paths first (this function has them in hand, so no pattern has to
 * recognise them), then the generic shape-based scrub for anything the message
 * picked up elsewhere.
 */
function sanitizeProbeFailure(reason: unknown, paths: readonly string[]): string {
  // Normalized here, not at the call sites. A caller-supplied probe can reject
  // with anything — `Promise.reject("probe failed")` has no `.message`, so
  // casting to Error yielded `undefined` and threw inside the redactor. That
  // turned a returned failure result into a rejected promise, which is a
  // behaviour regression the cast introduced.
  const message = reason instanceof Error ? reason.message : String(reason);
  const keepFfmpegsLastLineUncapped = Number.POSITIVE_INFINITY;
  return redactTelemetryString(redactKnownPaths(message, paths), keepFfmpegsLastLineUncapped);
}

/**
 * Pad or trim the mixed audio so its exact duration matches `frameCount / fps`
 * for the assembled video.
 */
export async function padOrTrimAudioToVideoFrameCount(
  input: PadTrimAudioInput,
): Promise<PadTrimAudioResult> {
  const probeVideo =
    input.probeVideoFrameInfo ??
    ((videoPath: string) => defaultProbeVideoFrameInfo(videoPath, input.signal));
  const probeAudio = input.probeAudioInfo ?? defaultProbeAudioInfo;
  const timeoutMs = input.timeoutMs ?? DEFAULT_CONFIG.ffmpegProcessTimeout;
  const runner =
    input.runFfmpeg ?? ((args: string[]) => defaultRunFfmpeg(args, timeoutMs, input.signal));
  const encode = input.encodeAac ?? defaultAacEncoder(timeoutMs, input.signal);
  // Injected runners usually do not materialize media. Tests that exercise
  // peak correction opt in with a matching probe; production always uses the
  // real post-codec measurement.
  const probeTruePeak =
    input.probeAudioTruePeakDbfs ??
    (input.runFfmpeg || input.encodeAac
      ? undefined
      : (audioPath: string, signal?: AbortSignal) =>
          measureTruePeakDbfs(audioPath, { timeoutMs, signal }));

  // Probe video and audio in parallel — the two ffprobe invocations are
  // independent and account for most of this function's wall-clock time.
  const [videoResult, audioResult] = await Promise.allSettled([
    probeVideo(input.videoPath),
    probeAudio(input.audioPath, input.signal),
  ]);

  const probePaths = [input.videoPath, input.audioPath, input.outputPath];
  if (videoResult.status === "rejected") {
    return failResult(
      input.outputPath,
      0,
      audioResult.status === "fulfilled" ? audioResult.value.durationSeconds : 0,
      `audioPadTrim: failed to probe video: ${sanitizeProbeFailure(
        videoResult.reason,
        probePaths,
      )}`,
    );
  }
  if (audioResult.status === "rejected") {
    return failResult(
      input.outputPath,
      0,
      0,
      `audioPadTrim: failed to probe audio: ${sanitizeProbeFailure(
        audioResult.reason,
        probePaths,
      )}`,
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
  );

  try {
    for (const step of plan.steps) {
      const ffmpegResult =
        step.kind === "copy"
          ? await runner(step.args)
          : await encode(input.audioPath, input.outputPath, targetDurationSeconds, step.filter);
      if (!ffmpegResult.success) {
        return {
          success: false,
          outputPath: input.outputPath,
          targetDurationSeconds,
          sourceDurationSeconds: audioInfo.durationSeconds,
          operation: plan.operation,
          error: ffmpegResult.error,
          failureReason: ffmpegResult.failureReason,
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

  let loweredDb = 0;
  if (probeTruePeak) {
    const correction = await enforceAacTruePeak({
      audioPath: input.outputPath,
      targetDurationSeconds,
      signal: input.signal,
      probeTruePeak,
      encode,
    });
    if (!correction.success) {
      return {
        success: false,
        outputPath: input.outputPath,
        targetDurationSeconds,
        sourceDurationSeconds: audioInfo.durationSeconds,
        operation: plan.operation,
        error: correction.error,
        failureReason: correction.failureReason,
      };
    }
    loweredDb = correction.loweredDb ?? 0;
  }
  return {
    success: true,
    outputPath: input.outputPath,
    targetDurationSeconds,
    sourceDurationSeconds: audioInfo.durationSeconds,
    operation: plan.operation,
    ...(loweredDb > 0 ? { audioLoweredDb: loweredDb } : {}),
  };
}

/**
 * The true-peak half of {@link padOrTrimAudioToVideoFrameCount}, for AAC already encoded at its
 * exact length: measures once and re-encodes only when the peak is over the ceiling.
 */
export async function constrainAacTruePeak(input: {
  audioPath: string;
  /** The PCM `audioPath` was encoded from: a correction re-encodes it instead of decoding the AAC. */
  sourcePath?: string;
  targetDurationSeconds: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{
  success: boolean;
  error?: string;
  failureReason?: "external_interruption";
  loweredDb?: number;
}> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_CONFIG.ffmpegProcessTimeout;
  return enforceAacTruePeak({
    audioPath: input.audioPath,
    targetDurationSeconds: input.targetDurationSeconds,
    signal: input.signal,
    probeTruePeak: (audioPath, signal) => measureTruePeakDbfs(audioPath, { timeoutMs, signal }),
    encode: defaultAacEncoder(timeoutMs, input.signal, input.sourcePath),
  });
}

interface EnforceAacTruePeakInput {
  audioPath: string;
  targetDurationSeconds: number;
  signal?: AbortSignal;
  probeTruePeak: (audioPath: string, signal?: AbortSignal) => Promise<number>;
  encode: AacEncoder;
}

async function enforceAacTruePeak(input: EnforceAacTruePeakInput): Promise<{
  success: boolean;
  error?: string;
  failureReason?: "external_interruption";
  loweredDb?: number;
}> {
  let scratchDir: string | undefined;
  try {
    scratchDir = mkdtempSync(join(dirname(input.audioPath), ".true-peak-"));
    const correctedPath = join(scratchDir, "audio.m4a");
    const measurements: string[] = [];
    let attenuationDb = 0;
    let measuredPath = input.audioPath;
    for (let pass = 0; pass <= MAX_TRUE_PEAK_CORRECTION_PASSES; pass += 1) {
      const truePeakDbfs = await input.probeTruePeak(measuredPath, input.signal);
      measurements.push(
        `pass ${pass}: ${truePeakDbfs.toFixed(3)} dBFS at ${attenuationDb.toFixed(3)} dB attenuation`,
      );
      if (Number.isNaN(truePeakDbfs) || truePeakDbfs === Number.POSITIVE_INFINITY) {
        return { success: false, error: "audioPadTrim: FFmpeg reported an invalid true peak" };
      }
      if (truePeakDbfs <= AAC_DELIVERY_TRUE_PEAK_DBFS) {
        if (measuredPath !== correctedPath) return { success: true };
        renameWithRetry(correctedPath, input.audioPath);
        return { success: true, loweredDb: Number((-attenuationDb).toFixed(2)) };
      }
      if (pass === MAX_TRUE_PEAK_CORRECTION_PASSES) break;

      // Aim below the ceiling, twice as far each pass: the correction is another lossy AAC encode,
      // whose peak can stall or rise over a few dB of attenuation instead of falling dB for dB.
      const headroomDb = AAC_TRUE_PEAK_CORRECTION_HEADROOM_DB * 2 ** pass;
      attenuationDb += AAC_DELIVERY_TRUE_PEAK_DBFS - headroomDb - truePeakDbfs;
      const result = await input.encode(
        input.audioPath,
        correctedPath,
        input.targetDurationSeconds,
        aacTruePeakCorrectionFilter(input.targetDurationSeconds, attenuationDb),
      );
      if (!result.success) {
        return {
          success: false,
          error: sanitizeProbeFailure(
            result.error ?? "audioPadTrim: failed to constrain AAC true peak",
            [input.audioPath, correctedPath],
          ),
          failureReason: result.failureReason,
        };
      }
      measuredPath = correctedPath;
    }
    return {
      success: false,
      error: `audioPadTrim: AAC true peak remained above ${AAC_DELIVERY_TRUE_PEAK_DBFS} dBFS after ${MAX_TRUE_PEAK_CORRECTION_PASSES} correction passes; ${measurements.join("; ")}`,
    };
  } catch (err) {
    return {
      success: false,
      error: `audioPadTrim: failed to validate AAC true peak: ${sanitizeProbeFailure(
        err,
        scratchDir ? [input.audioPath, scratchDir] : [input.audioPath],
      )}`,
    };
  } finally {
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
  }
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

export async function defaultProbeVideoFrameInfo(
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
      "--",
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
      "--",
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
  // The shared ffprobe wrapper corrects for a lying container duration so
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
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<StepResult> {
  return toStepResult(await runFfmpeg(args, { signal, timeout: timeoutMs }), timeoutMs);
}

function defaultAacEncoder(
  timeoutMs: number,
  signal?: AbortSignal,
  pcmSourcePath?: string,
): AacEncoder {
  return async (inputPath, outputPath, durationSeconds, filter) => {
    // Each segment decodes its input from the start: cheap from PCM, a second lossy pass from AAC.
    const options = pcmSourcePath
      ? { signal, timeout: timeoutMs, filter }
      : { signal, timeout: timeoutMs, filter, segments: 1 };
    return toStepResult(
      await encodeAac(pcmSourcePath ?? inputPath, outputPath, durationSeconds, options),
      timeoutMs,
    );
  };
}

function toStepResult(result: RunFfmpegResult, timeoutMs: number): StepResult {
  if (result.success) return { success: true };
  return {
    success: false,
    error: `[audioPadTrim] ${describeFfmpegFailure(result, timeoutMs)}`,
    failureReason: result.failureReason,
  };
}

// ── ffprobe JSON runner (shared between fast/slow video probe paths) ─────

export async function runFfprobeJson<T>(args: string[], signal?: AbortSignal): Promise<T> {
  // Callers bake the input path into `args` (terminated with "--"), so this
  // helper cannot add the terminator itself — assert they did rather than
  // let a dash-prefixed path silently reach ffprobe as an option.
  if (!args.includes("--")) {
    throw new Error('[audioPadTrim] ffprobe args must terminate options with "--".');
  }
  const proc = spawn(getFfprobeBinary(), args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
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
    // Redacted twice, deliberately. The shape-based scrub is a net with
    // holes — it cannot know that `customer/acme-secret/video.mp4` is a path
    // and `48000/1001` is not — but THIS caller knows the exact path it put
    // in the argv, so it names it literally first. The message reaches logs,
    // telemetry, and `PadTrimAudioResult.error`.
    const probed = args[args.length - 1];
    const scrubbed = redactKnownPaths(outcome.stderr, probed === undefined ? [] : [probed]);
    throw new Error(`ffprobe ${outcome.reason}: ${redactTelemetryString(scrubbed, 2000)}`);
  }
  try {
    return JSON.parse(stdout) as T;
  } catch (err) {
    throw new Error(`Failed to parse ffprobe output: ${(err as Error).message}`);
  }
}
