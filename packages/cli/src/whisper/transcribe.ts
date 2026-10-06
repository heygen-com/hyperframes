// fallow-ignore-file complexity
import { execFile, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { existsSync, readFileSync, mkdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { findFFmpeg, findFFprobe, getFFmpegInstallHint } from "../browser/ffmpeg.js";
import { stoppedByCancelSignal } from "../utils/renderCancellation.js";
import { ensureWhisper, ensureModel, hasFFmpeg, DEFAULT_MODEL } from "./manager.js";
import type { Word } from "./normalize.js";
import { emitWords } from "./progress.js";

function findWavDataChunk(buf: Buffer): { offset: number; size: number } | null {
  if (buf.length < 12) return null;
  let pos = 12; // skip RIFF header
  while (pos + 8 < buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "data") return { offset: pos + 8, size: Math.min(size, buf.length - pos - 8) };
    pos += 8 + size;
    if (size % 2 !== 0) pos++; // RIFF chunks are word-aligned
  }
  return null;
}

const WHISPER_TIMEOUT_FLOOR_MS = 300_000;
const WHISPER_TIMEOUT_PER_AUDIO_SECOND_MS = 10_000;
const WHISPER_TIMEOUT_CAP_MS = 43_200_000;
const AUDIO_PREPARATION_TIMEOUT_FLOOR_MS = 120_000;
const AUDIO_PREPARATION_TIMEOUT_PER_MEDIA_SECOND_MS = 500;
const AUDIO_PREPARATION_TIMEOUT_CAP_MS = 21_600_000;

/**
 * Model-specific slowdown factors relative to the `small.en` default. whisper.cpp's
 * per-token inference cost scales with model size — `medium` runs ~2x slower than
 * `small`, and the `large` family ~4x slower — so the 10x-realtime baseline that
 * comfortably covers `small.en` can still time out on `medium.en`/`large-v3` when
 * the CPU itself is slow. Applying the factor keeps the historical safety window
 * for the default model while giving heavier models the headroom they need on
 * emulated arm64/x64 hardware (field-signal ts=1784165471: Snapdragon emulating
 * x64 saw ~13x realtime on medium.en for a 63s clip).
 *
 * Values are conservative bounds, not tight upper bounds — the auto-scaled
 * timeout is still capped at 12h and gated by an explicit `--timeout` override.
 */
const WHISPER_MODEL_SLOWDOWN_FACTORS: Readonly<Record<string, number>> = {
  tiny: 0.5,
  "tiny.en": 0.5,
  base: 0.7,
  "base.en": 0.7,
  small: 1,
  "small.en": 1,
  medium: 2,
  "medium.en": 2,
  "large-v1": 4,
  "large-v2": 4,
  "large-v3": 4,
  "large-v3-turbo": 2,
};

// Unknown model names fall back to the `small.en` baseline so the returned
// timeout never dips below the historical safe window for a novel/custom model.
const DEFAULT_MODEL_SLOWDOWN_FACTOR = 1;

/**
 * Look up the auto-scale slowdown factor for a whisper model name. Case-
 * insensitive. Unknown names fall back to the `small.en` baseline (factor 1)
 * rather than a smaller factor so unknown models never accidentally shorten
 * the safety window.
 */
export function whisperModelSlowdownFactor(model: string): number {
  return WHISPER_MODEL_SLOWDOWN_FACTORS[model.toLowerCase()] ?? DEFAULT_MODEL_SLOWDOWN_FACTOR;
}

export interface ResolveWhisperTimeoutOptions {
  /** Whisper model name (e.g. `small.en`, `medium.en`, `large-v3`). Selects the slowdown factor. */
  model?: string;
  /**
   * Explicit override in milliseconds. Bypasses duration+model auto-scaling.
   * Still clamped to the 12h cap so a runaway value can't hang the process
   * indefinitely; validation of the lower bound is the caller's responsibility.
   */
  overrideMs?: number;
}

/**
 * Give long recordings enough time to transcribe while retaining a bounded
 * failure window. Short recordings keep the historical five-minute floor.
 *
 * Formula: `clamp(FLOOR, duration * PER_SECOND * modelFactor, CAP)`.
 * An explicit `overrideMs` bypasses the formula entirely (still capped at 12h).
 */
export function resolveWhisperTimeoutMs(
  durationSeconds: number | null,
  options?: ResolveWhisperTimeoutOptions,
): number {
  // Explicit override wins — respect the caller's exact value (still capped at
  // the 12h ceiling so a runaway value can't leave the process hung forever).
  // We do NOT re-apply the floor here: a user who deliberately passed
  // `--timeout 30000` on a 3s clip meant 30 seconds, not five minutes.
  if (
    options?.overrideMs != null &&
    Number.isFinite(options.overrideMs) &&
    options.overrideMs > 0
  ) {
    return Math.min(WHISPER_TIMEOUT_CAP_MS, options.overrideMs);
  }

  const factor = options?.model ? whisperModelSlowdownFactor(options.model) : 1;

  if (durationSeconds === null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    // Duration unknown: keep the historical five-minute floor for the default
    // model, but scale it up for heavier models so `medium`/`large` still get
    // a proportionate window when ffprobe can't read the WAV header.
    return Math.min(WHISPER_TIMEOUT_CAP_MS, Math.ceil(WHISPER_TIMEOUT_FLOOR_MS * factor));
  }

  return Math.min(
    WHISPER_TIMEOUT_CAP_MS,
    Math.max(
      WHISPER_TIMEOUT_FLOOR_MS,
      Math.ceil(durationSeconds * WHISPER_TIMEOUT_PER_AUDIO_SECOND_MS * factor),
    ),
  );
}

/**
 * Bound FFmpeg audio preparation while allowing long recordings to scale past
 * the historical two-minute timeout. The half-realtime allowance is generous
 * for audio-only extraction without inheriting Whisper's much larger window.
 */
export function resolveAudioPreparationTimeoutMs(durationSeconds: number | null): number {
  if (durationSeconds === null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return AUDIO_PREPARATION_TIMEOUT_FLOOR_MS;
  }

  return Math.min(
    AUDIO_PREPARATION_TIMEOUT_CAP_MS,
    Math.max(
      AUDIO_PREPARATION_TIMEOUT_FLOOR_MS,
      Math.ceil(durationSeconds * AUDIO_PREPARATION_TIMEOUT_PER_MEDIA_SECOND_MS),
    ),
  );
}

export function getMediaDurationSeconds(filePath: string): number | null {
  try {
    const ffprobePath = findFFprobe();
    if (!ffprobePath) return null;
    const raw = execFileSync(
      ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        "--",
        filePath,
      ],
      { encoding: "utf-8", timeout: 10_000 },
    );
    const durationSeconds = Number.parseFloat(raw.trim());
    return Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null;
  } catch {
    return null;
  }
}

/** A prepared WAV is 16 kHz mono s16, so its size gives the length (the header adds a few ms). */
export function getPreparedWavDurationSeconds(wavPath: string): number | null {
  try {
    return statSync(wavPath).size / (16_000 * 2);
  } catch {
    return null;
  }
}

/**
 * Detect when speech begins in a 16kHz mono WAV by finding the first
 * sustained energy jump above the track's median RMS. Returns onset time in
 * seconds, or null if the track has consistent energy throughout.
 */
// fallow-ignore-next-line complexity
export function detectSpeechOnset(wavPath: string): number | null {
  const SAMPLE_RATE = 16000;
  const WINDOW_SECONDS = 0.5;
  const WINDOW_SAMPLES = SAMPLE_RATE * WINDOW_SECONDS;
  const SUSTAINED_WINDOWS = 3; // 1.5s above threshold to count as onset
  const SILENCE_THRESHOLD_RATIO = 0.6;
  const MIN_INTRO_SECONDS = 3; // don't strip if onset is very early

  try {
    const buf = readFileSync(wavPath);
    const dataChunk = findWavDataChunk(buf);
    if (!dataChunk) return null;
    const pcm = new Int16Array(buf.buffer, buf.byteOffset + dataChunk.offset, dataChunk.size / 2);
    const totalWindows = Math.floor(pcm.length / WINDOW_SAMPLES);
    if (totalWindows < 10) return null;

    const rmsValues: number[] = [];
    for (let i = 0; i < totalWindows; i++) {
      const start = i * WINDOW_SAMPLES;
      let sumSq = 0;
      for (let j = start; j < start + WINDOW_SAMPLES; j++) {
        const sample = pcm[j] ?? 0;
        sumSq += sample * sample;
      }
      rmsValues.push(Math.sqrt(sumSq / WINDOW_SAMPLES));
    }

    const sorted = [...rmsValues].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const threshold = median * SILENCE_THRESHOLD_RATIO;

    // Check if energy is fairly consistent (no clear intro) — ratio of
    // first 10s average to median. If it's already close, no onset to detect.
    const introAvg =
      rmsValues.slice(0, Math.min(20, rmsValues.length)).reduce((a, b) => a + b, 0) /
      Math.min(20, rmsValues.length);
    if (introAvg >= threshold) return null;

    let consecutive = 0;
    for (let i = 0; i < rmsValues.length; i++) {
      if ((rmsValues[i] ?? 0) >= threshold) {
        consecutive++;
        if (consecutive >= SUSTAINED_WINDOWS) {
          const onsetSeconds = (i - SUSTAINED_WINDOWS + 1) * WINDOW_SECONDS;
          return onsetSeconds >= MIN_INTRO_SECONDS ? onsetSeconds : null;
        }
      } else {
        consecutive = 0;
      }
    }
  } catch {
    // Can't read WAV — skip onset detection
  }
  return null;
}

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv", ".avi"]);

export type TranscribeProgress =
  | {
      type: "progress";
      phase: "download";
      model: string;
      receivedBytes: number;
      totalBytes: number | null;
    }
  | {
      type: "progress";
      phase: "transcription";
      model: string;
      status: "started" | "completed";
      durationSeconds?: number | null;
    }
  /** Words heard so far, before the final transcript replaces them; `through` is audio seconds done. */
  | { type: "words"; model: string; words: Word[]; through: number };

export interface TranscribeOptions {
  installRuntime?: boolean;
  model?: string;
  language?: string;
  onProgress?: (message: string) => void;
  onEvent?: (event: TranscribeProgress) => void;
  /** Called as whisper starts, so a stop during install or download still ends the CLI at once. */
  startCancellation?: () => AbortSignal;
  /**
   * Explicit whisper spawn timeout in ms. Overrides the duration+model auto-
   * scaled default. Callers that leave this undefined get the auto-scaled
   * default derived from prepared WAV duration and the selected model.
   */
  timeoutMs?: number;
}

export interface TranscribeResult {
  model: string;
  detectedLanguage: string | null;
  transcriptPath: string;
  wordCount: number;
  durationSeconds: number;
  speechOnsetSeconds: number | null;
}

function isAudioFile(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function isVideoFile(filePath: string): boolean {
  return VIDEO_EXTENSIONS.has(extname(filePath).toLowerCase());
}

/**
 * Unique path for the temporary 16kHz mono WAV fed to whisper.
 *
 * MUST be unique per call AND per process: callers run many `transcribe`
 * invocations in parallel (e.g. the product-launch-video audio pipeline spawns
 * one `hyperframes transcribe` per scene at once). A `Date.now()`-based name
 * collides when two conversions land in the same millisecond — they clobber
 * each other's WAV in the shared tmpdir, so whisper transcribes the wrong
 * scene's audio and every colliding scene gets identical word timings.
 */
function tempWavPath(): string {
  return join(tmpdir(), `hyperframes-audio-${process.pid}-${randomUUID()}.wav`);
}

function runFfmpeg(ffmpegPath: string, args: string[], output: string, timeout: number): void {
  try {
    execFileSync(ffmpegPath, ["-nostats", "-hide_banner", ...args, "-y", output], {
      stdio: ["ignore", "ignore", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
      timeout,
    });
  } catch (err) {
    rmSync(output, { force: true });
    const stop = err as { code?: string; signal?: string; stderr?: Buffer };
    // A code means Node stopped it; ffmpeg traps Ctrl-C and says so (exit 255 is EPERM too on 7+).
    if (stop.code) throw err;
    const said = String(stop.stderr ?? "").trim();
    const cancelled = /Exiting normally, received signal/.test(said) || stoppedByCancelSignal(stop);
    const reason = said.split("\n").at(-1) || (err as Error).message;
    // stderr: the command shows its last lines, where ffmpeg names the cause above its summary line.
    const failure = new Error(`ffmpeg failed: ${reason}`, { cause: err });
    throw Object.assign(failure, { cancelled, stderr: said });
  }
}

/**
 * Extract audio from a video file as 16kHz mono WAV (whisper requirement).
 */
function extractAudio(videoPath: string): string {
  const ffmpegPath = findFFmpeg();
  if (!ffmpegPath) {
    throw new Error(
      `ffmpeg is required to extract audio from video. Install: ${getFFmpegInstallHint()}`,
    );
  }
  const wavPath = tempWavPath();
  runFfmpeg(
    ffmpegPath,
    ["-i", videoPath, "-vn", "-ar", "16000", "-ac", "1", "-f", "wav"],
    wavPath,
    resolveAudioPreparationTimeoutMs(getMediaDurationSeconds(videoPath)),
  );
  return wavPath;
}

interface AudioStream {
  codec_type?: string;
  codec_name?: string;
  sample_rate?: string;
  channels?: number;
}

/** 16-bit PCM only: sherpa-onnx cannot read 24-bit WAV, so anything else goes through ffmpeg. */
export function isPcm16kMono(stream: AudioStream | undefined): boolean {
  return (
    stream?.codec_name === "pcm_s16le" && stream.sample_rate === "16000" && stream.channels === 1
  );
}

/**
 * Check if a WAV file is already 16kHz mono via ffprobe.
 */
function isWav16kMono(filePath: string): boolean {
  try {
    const ffprobePath = findFFprobe();
    if (!ffprobePath) return false;
    const raw = execFileSync(
      ffprobePath,
      ["-v", "quiet", "-print_format", "json", "-show_streams", "--", filePath],
      { encoding: "utf-8", timeout: 10_000 },
    );
    const parsed: { streams?: AudioStream[] } = JSON.parse(raw);
    return isPcm16kMono(parsed.streams?.find((s) => s.codec_type === "audio"));
  } catch {
    return false;
  }
}

/**
 * Convert audio file to 16kHz mono WAV if not already in that format.
 */
function prepareAudio(audioPath: string): string {
  if (extname(audioPath).toLowerCase() === ".wav" && isWav16kMono(audioPath)) {
    return audioPath;
  }

  // Convert to whisper-compatible WAV
  const ffmpegPath = findFFmpeg();
  if (!ffmpegPath) {
    throw new Error(`ffmpeg is required to prepare audio. Install: ${getFFmpegInstallHint()}`);
  }
  const wavPath = tempWavPath();
  runFfmpeg(
    ffmpegPath,
    ["-i", audioPath, "-ar", "16000", "-ac", "1", "-f", "wav"],
    wavPath,
    resolveAudioPreparationTimeoutMs(getMediaDurationSeconds(audioPath)),
  );
  return wavPath;
}

/**
 * Map a ggml model file-stem to whisper.cpp's `--dtw` alignment-heads preset.
 *
 * The two mostly coincide, so the stem was long passed straight to `--dtw` — but
 * they diverge for the large family: the model files are hyphenated
 * (`ggml-large-v3.bin`) while the DTW presets are dotted (`large.v3`,
 * `large.v3.turbo`). `--dtw large-v3` makes whisper-cli abort with
 * "unknown DTW preset 'large-v3'", surfacing as "Transcription failed". The
 * tiny/base/small/medium (+`.en`) families have no hyphen, so `-`→`.` is a no-op
 * for them and correct for the large family.
 */
export function dtwPresetForModel(model: string): string {
  return model.replace(/-/g, ".");
}

export function initialModelForLanguage(model: string, language?: string): string {
  const baseLanguage = language?.trim().toLowerCase().split(/[-_]/, 1)[0];
  if (baseLanguage && baseLanguage !== "en" && model.endsWith(".en")) {
    return model.slice(0, -3);
  }
  return model;
}

export function prepareWav(inputPath: string, onProgress?: (message: string) => void): string {
  if (isAudioFile(inputPath)) {
    onProgress?.("Preparing audio...");
    return prepareAudio(inputPath);
  }
  if (isVideoFile(inputPath)) {
    if (!hasFFmpeg()) {
      throw new Error(
        `ffmpeg is required to extract audio from video. Install: ${getFFmpegInstallHint()}`,
      );
    }
    onProgress?.("Extracting audio from video...");
    return extractAudio(inputPath);
  }
  throw new Error(`Unsupported file type: ${extname(inputPath).toLowerCase()}`);
}

/**
 * Transcribe an audio or video file and save transcript.json to the output directory.
 */
// fallow-ignore-next-line complexity
export async function transcribe(
  inputPath: string,
  outputDir: string,
  options?: TranscribeOptions,
): Promise<TranscribeResult> {
  const model = initialModelForLanguage(options?.model ?? DEFAULT_MODEL, options?.language);

  // 1. Ensure whisper binary
  options?.onProgress?.("Checking whisper...");
  const whisper = await ensureWhisper({
    onProgress: options?.onProgress,
    installRuntime: options?.installRuntime,
  });

  // 2. Ensure model
  options?.onProgress?.("Checking model...");
  const modelPath = await ensureModel(model, {
    onProgress: options?.onProgress,
    onDownloadProgress: options?.onEvent
      ? (receivedBytes, totalBytes) =>
          options.onEvent?.({
            type: "progress",
            phase: "download",
            model,
            receivedBytes,
            totalBytes,
          })
      : undefined,
  });

  // 3. Prepare audio
  const wavPath = prepareWav(inputPath, options?.onProgress);

  const automaticLanguage = options?.language === undefined && !model.endsWith(".en");
  const language = options?.language ?? (automaticLanguage ? "auto" : "en");
  options?.onProgress?.("Transcribing...");
  const wavSeconds = getPreparedWavDurationSeconds(wavPath);
  options?.onEvent?.({
    type: "progress",
    phase: "transcription",
    model,
    status: "started",
    durationSeconds: wavSeconds,
  });
  const outputBase = join(outputDir, "transcript");
  mkdirSync(outputDir, { recursive: true });

  const whisperArgs = [
    "--model",
    modelPath,
    "--output-json-full",
    "--output-file",
    outputBase,
    "--dtw",
    dtwPresetForModel(model),
    "--suppress-nst",
  ];
  whisperArgs.push("--language", language);
  const onEvent = options?.onEvent;
  if (onEvent) whisperArgs.push("--print-progress");
  whisperArgs.push(wavPath);

  const whisperTimeoutMs = resolveWhisperTimeoutMs(wavSeconds, {
    model,
    overrideMs: options?.timeoutMs,
  });
  let through = 0;
  const heard = (words: Word[], at: number) => {
    if (!onEvent || (words.length === 0 && at <= through)) return;
    through = Math.max(through, at);
    emitWords(onEvent, model, words, through);
  };
  try {
    await runWhisper(whisper.executablePath, whisperArgs, {
      timeoutMs: whisperTimeoutMs,
      signal: options?.startCancellation?.(),
      onStdout:
        onEvent &&
        ((line) => {
          const segment = segmentWords(line);
          if (segment) heard(segment.words, segment.end);
        }),
      onStderr:
        onEvent && wavSeconds
          ? (line) => {
              const percent = /progress =\s*(\d+)%/.exec(line)?.[1];
              if (percent) heard([], (Number(percent) / 100) * wavSeconds);
            }
          : undefined,
    });
  } catch (err) {
    // Surface the timeout knob when the child was killed by our own timeout —
    // otherwise the reporter sees a bare ETIMEDOUT / SIGTERM with no hint that
    // `--timeout` even exists. Non-timeout errors flow through unchanged so the
    // existing stderr-tail handling in `transcribeAudio` still applies.
    throw wrapWhisperTimeoutError(err, {
      effectiveTimeoutMs: whisperTimeoutMs,
      model,
      wasOverride: options?.timeoutMs != null,
    });
  }

  // 6. Read and validate output
  const transcriptPath = `${outputBase}.json`;
  if (!existsSync(transcriptPath)) {
    throw new Error("Whisper did not produce output. Check the input file.");
  }

  const transcript = JSON.parse(readFileSync(transcriptPath, "utf-8"));
  const reportedLanguage: unknown = transcript.result?.language;
  const detectedLanguage =
    automaticLanguage && typeof reportedLanguage === "string" && reportedLanguage.length > 0
      ? reportedLanguage
      : null;
  const segments = transcript.transcription ?? [];

  let wordCount = 0;
  let maxEnd = 0;
  for (const seg of segments) {
    for (const token of seg.tokens ?? []) {
      const text = (token.text ?? "").trim();
      if (text && !text.startsWith("[_") && !text.startsWith("[BLANK")) wordCount++;
      if (token.offsets?.to > maxEnd) maxEnd = token.offsets.to;
    }
  }

  // 7. Detect speech onset before cleaning up the WAV
  options?.onProgress?.("Detecting speech onset...");
  const speechOnsetSeconds = detectSpeechOnset(wavPath);

  // Clean up temp WAV if we created one
  if (wavPath !== inputPath) {
    try {
      unlinkSync(wavPath);
    } catch {
      // ignore
    }
  }

  options?.onEvent?.({ type: "progress", phase: "transcription", model, status: "completed" });
  return {
    model,
    detectedLanguage,
    transcriptPath,
    wordCount,
    durationSeconds: maxEnd / 1000,
    speechOnsetSeconds,
  };
}

const SEGMENT_LINE = /^\[(\d+):(\d+):([\d.]+) --> (\d+):(\d+):([\d.]+)\]\s*(.*)$/;
const toSeconds = (h: string, m: string, s: string) =>
  Number(h) * 3600 + Number(m) * 60 + Number(s);
const toMs = (seconds: number) => Math.round(seconds * 1000) / 1000;

/** A segment line whisper-cli prints as it decodes; word times are spread by length until the JSON's. */
function segmentWords(line: string): { words: Word[]; end: number } | null {
  const m = SEGMENT_LINE.exec(line);
  if (!m) return null;
  const start = toSeconds(m[1]!, m[2]!, m[3]!);
  const end = toSeconds(m[4]!, m[5]!, m[6]!);
  const texts = m[7]!
    .split(/\s+/)
    .filter((t) => t && !t.startsWith("[_") && !t.startsWith("[BLANK"));
  const letters = texts.reduce((n, t) => n + t.length, 0);
  let at = start;
  const words = texts.map((text) => {
    const from = at;
    at += ((end - start) * text.length) / letters;
    return { text, start: toMs(from), end: toMs(at) };
  });
  return { words, end };
}

/** Resolves once whisper exits and both its streams are read, so no printed line is lost. */
async function runWhisper(
  executable: string,
  args: string[],
  options: {
    timeoutMs: number;
    signal?: AbortSignal;
    onStdout?: (line: string) => void;
    onStderr?: (line: string) => void;
  },
): Promise<void> {
  let stdout: Readable | null = null;
  let stderr: Readable | null = null;
  const exited = new Promise<void>((resolve, reject) => {
    const child = execFile(
      executable,
      args,
      { timeout: options.timeoutMs, signal: options.signal, maxBuffer: 256 * 1024 * 1024 },
      (err, _out, errText) => {
        if (!err) return resolve();
        // execFileSync named its own timeout ETIMEDOUT; execFile only marks the child killed.
        const timedOut = err.killed && err.signal === "SIGTERM" && !options.signal?.aborted;
        // execFile appends all of stderr to the message; the command shows its last lines instead.
        err.message = err.message.split("\n")[0]!;
        reject(Object.assign(err, { stderr: errText }, timedOut ? { code: "ETIMEDOUT" } : {}));
      },
    );
    stdout = child.stdout;
    stderr = child.stderr;
  });
  const read = (stream: Readable | null, onLine?: (line: string) => void) =>
    stream && onLine ? once(createInterface({ input: stream }).on("line", onLine), "close") : null;
  await Promise.all([exited, read(stdout, options.onStdout), read(stderr, options.onStderr)]);
}

// ---------------------------------------------------------------------------
// Timeout error discoverability
// ---------------------------------------------------------------------------

// execFileSync's own timeout sets code ETIMEDOUT (and SIGTERM); a bare SIGTERM is someone stopping it.
export function isWhisperTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err as { code?: unknown }).code === "ETIMEDOUT";
}

export interface WrapWhisperTimeoutOptions {
  effectiveTimeoutMs: number;
  model: string;
  /** True when the timeout was set via `--timeout`; false when it was auto-scaled. */
  wasOverride: boolean;
}

/**
 * Wrap a whisper spawn error with a discoverability hint when the child was
 * killed by our timeout. Names the effective timeout, the CLI flag, and the
 * env var so slow-CPU users see the knob rather than a bare `ETIMEDOUT`.
 * Non-timeout errors flow through unchanged (as `Error` for well-typed
 * downstream handling).
 */
export function wrapWhisperTimeoutError(err: unknown, options: WrapWhisperTimeoutOptions): Error {
  if (!isWhisperTimeoutError(err)) {
    return err instanceof Error ? err : new Error(String(err));
  }

  const seconds = Math.round(options.effectiveTimeoutMs / 1000);
  const source = options.wasOverride
    ? `explicit --timeout ${options.effectiveTimeoutMs}ms`
    : `auto-scaled default for model ${options.model}`;
  const message =
    `Whisper transcription exceeded ${seconds}s (${source}). ` +
    `Raise --timeout <ms> or set HYPERFRAMES_TRANSCRIBE_TIMEOUT_MS. ` +
    `Slow CPUs (e.g. emulated arm64/x64, low-power laptops) may need many ` +
    `multiples of realtime on heavier models — medium.en can run ~10-15x ` +
    `realtime on constrained hardware.`;
  const wrapped = new Error(message);
  (wrapped as { cause?: unknown }).cause = err;
  return wrapped;
}
