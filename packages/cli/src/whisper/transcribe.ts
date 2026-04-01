import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
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

/**
 * Detect when speech begins in a 16kHz mono WAV by finding the first
 * sustained energy jump above the track's median RMS. Returns onset time in
 * seconds, or null if the track has consistent energy throughout.
 */
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
 * Extract audio from a video file as 16kHz mono WAV (whisper requirement).
 */
function extractAudio(videoPath: string): string {
  const wavPath = join(tmpdir(), `hyperframes-audio-${Date.now()}.wav`);
  execFileSync(
    "ffmpeg",
    ["-i", videoPath, "-vn", "-ar", "16000", "-ac", "1", "-f", "wav", "-y", wavPath],
    { stdio: "ignore", timeout: 120_000 },
  );
  return wavPath;
}

/**
 * Check if a WAV file is already 16kHz mono via ffprobe.
 */
function isWav16kMono(filePath: string): boolean {
  try {
    const raw = execFileSync(
      "ffprobe",
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
  const wavPath = join(tmpdir(), `hyperframes-audio-${Date.now()}.wav`);
  execFileSync(
    "ffmpeg",
    ["-i", audioPath, "-ar", "16000", "-ac", "1", "-f", "wav", "-y", wavPath],
    { stdio: "ignore", timeout: 120_000 },
  );
  return wavPath;
}

/**
 * Transcribe an audio or video file and save transcript.json to the output directory.
 */
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
        "ffmpeg is required to extract audio from video. Install: brew install ffmpeg",
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
    effectiveModel,
    "--suppress-nst",
  ];
  if (detectedLanguage) {
    whisperArgs.push("--language", detectedLanguage);
  }
  whisperArgs.push(wavPath);

  execFileSync(whisper.executablePath, whisperArgs, { stdio: "ignore", timeout: 300_000 });

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

export { isAudioFile, isVideoFile };
