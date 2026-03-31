import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { ensureWhisper, ensureModel, hasFFmpeg, DEFAULT_MODEL } from "./manager.js";

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

  // 4. Run whisper
  options?.onProgress?.("Transcribing...");
  const outputBase = join(outputDir, "transcript");
  mkdirSync(outputDir, { recursive: true });

  const whisperArgs = [
    "--model",
    modelPath,
    "--output-json-full",
    "--output-file",
    outputBase,
    "--dtw",
    model,
    "--suppress-nst",
  ];
  if (options?.language) {
    whisperArgs.push("--language", options.language);
  }
  whisperArgs.push(wavPath);

  execFileSync(whisper.executablePath, whisperArgs, { stdio: "ignore", timeout: 300_000 });

  // 5. Read and validate output
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
  };
}

export { isAudioFile, isVideoFile };
