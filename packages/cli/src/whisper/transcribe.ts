// fallow-ignore-file complexity
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { findFFmpeg, findFFprobe, getFFmpegInstallHint } from "../browser/ffmpeg.js";
import { ensureWhisper, ensureModel, hasFFmpeg, DEFAULT_MODEL } from "./manager.js";

/**
 * Detect the language of a WAV file using whisper's built-in language detection.
 * Returns an ISO 639-1 code (e.g. "en", "es", "hi") or null if detection fails.
 */
function detectLanguage(whisperPath: string, modelPath: string, wavPath: string): string | null {
  try {
    const output = execFileSync(whisperPath, ["--model", modelPath, "--detect-language", wavPath], {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const match = output.match(/auto-detected language:\s*(\w+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

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
 * Give long recordings enough time to transcribe while retaining a bounded
 * failure window. Short recordings keep the historical five-minute timeout.
 */
export function resolveWhisperTimeoutMs(durationSeconds: number | null): number {
  if (durationSeconds === null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return WHISPER_TIMEOUT_FLOOR_MS;
  }

  return Math.min(
    WHISPER_TIMEOUT_CAP_MS,
    Math.max(
      WHISPER_TIMEOUT_FLOOR_MS,
      Math.ceil(durationSeconds * WHISPER_TIMEOUT_PER_AUDIO_SECOND_MS),
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

function getMediaDurationSeconds(filePath: string): number | null {
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

function getPreparedWavDurationSeconds(wavPath: string): number | null {
  try {
    const dataChunk = findWavDataChunk(readFileSync(wavPath));
    if (!dataChunk) return null;
    return dataChunk.size / (16_000 * 2);
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

export interface TranscribeOptions {
  model?: string;
  language?: string;
  onProgress?: (message: string) => void;
}

export interface TranscribeResult {
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
  execFileSync(
    ffmpegPath,
    ["-i", videoPath, "-vn", "-ar", "16000", "-ac", "1", "-f", "wav", "-y", wavPath],
    {
      stdio: "ignore",
      timeout: resolveAudioPreparationTimeoutMs(getMediaDurationSeconds(videoPath)),
    },
  );
  return wavPath;
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
      ["-v", "quiet", "-print_format", "json", "-show_streams", filePath],
      { encoding: "utf-8", timeout: 10_000 },
    );
    const parsed: {
      streams?: {
        codec_type?: string;
        sample_rate?: string;
        channels?: number;
      }[];
    } = JSON.parse(raw);
    const audio = parsed.streams?.find((s) => s.codec_type === "audio");
    return audio?.sample_rate === "16000" && audio?.channels === 1;
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
  execFileSync(
    ffmpegPath,
    ["-i", audioPath, "-ar", "16000", "-ac", "1", "-f", "wav", "-y", wavPath],
    {
      stdio: "ignore",
      timeout: resolveAudioPreparationTimeoutMs(getMediaDurationSeconds(audioPath)),
    },
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

/**
 * Transcribe an audio or video file and save transcript.json to the output directory.
 */
// fallow-ignore-next-line complexity
export async function transcribe(
  inputPath: string,
  outputDir: string,
  options?: TranscribeOptions,
): Promise<TranscribeResult> {
  const model = options?.model ?? DEFAULT_MODEL;

  // 1. Ensure whisper binary
  options?.onProgress?.("Checking whisper...");
  const whisper = await ensureWhisper({ onProgress: options?.onProgress });

  // 2. Ensure model
  options?.onProgress?.("Checking model...");
  const modelPath = await ensureModel(model, {
    onProgress: options?.onProgress,
  });

  // 3. Prepare audio
  let wavPath: string;
  const ext = extname(inputPath).toLowerCase();

  if (isAudioFile(inputPath)) {
    options?.onProgress?.("Preparing audio...");
    wavPath = prepareAudio(inputPath);
  } else if (isVideoFile(inputPath)) {
    if (!hasFFmpeg()) {
      throw new Error(
        `ffmpeg is required to extract audio from video. Install: ${getFFmpegInstallHint()}`,
      );
    }
    options?.onProgress?.("Extracting audio from video...");
    wavPath = extractAudio(inputPath);
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }

  // 4. Detect language and ensure correct model
  let effectiveModel = model;
  let effectiveModelPath = modelPath;
  let detectedLanguage = options?.language ?? null;

  // Only auto-detect language when using a multilingual model.
  // .en models always report "en" regardless of actual language, so detection
  // would be a no-op. If the user chose .en, they want English.
  if (!detectedLanguage && !effectiveModel.endsWith(".en")) {
    options?.onProgress?.("Detecting language...");
    detectedLanguage = detectLanguage(whisper.executablePath, effectiveModelPath, wavPath);
  }

  if (detectedLanguage && detectedLanguage !== "en" && effectiveModel.endsWith(".en")) {
    const multilingualModel = effectiveModel.replace(/\.en$/, "");
    options?.onProgress?.(
      `Detected ${detectedLanguage} — switching to ${multilingualModel} model...`,
    );
    effectiveModelPath = await ensureModel(multilingualModel, {
      onProgress: options?.onProgress,
    });
    effectiveModel = multilingualModel;
  }

  // 5. Run whisper
  options?.onProgress?.("Transcribing...");
  const outputBase = join(outputDir, "transcript");
  mkdirSync(outputDir, { recursive: true });

  const whisperArgs = [
    "--model",
    effectiveModelPath,
    "--output-json-full",
    "--output-file",
    outputBase,
    "--dtw",
    dtwPresetForModel(effectiveModel),
    "--suppress-nst",
  ];
  if (detectedLanguage) {
    whisperArgs.push("--language", detectedLanguage);
  }
  whisperArgs.push(wavPath);

  const whisperTimeoutMs = resolveWhisperTimeoutMs(getPreparedWavDurationSeconds(wavPath));
  execFileSync(whisper.executablePath, whisperArgs, {
    stdio: "ignore",
    timeout: whisperTimeoutMs,
  });

  // 6. Read and validate output
  const transcriptPath = `${outputBase}.json`;
  if (!existsSync(transcriptPath)) {
    throw new Error("Whisper did not produce output. Check the input file.");
  }

  const transcript = JSON.parse(readFileSync(transcriptPath, "utf-8"));
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

  return {
    transcriptPath,
    wordCount,
    durationSeconds: maxEnd / 1000,
    speechOnsetSeconds,
  };
}
