import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { downloadFile } from "../utils/download.js";

const CACHE_DIR = join(homedir(), ".cache", "hyperframes", "tts");
const MODELS_DIR = join(CACHE_DIR, "models");
const VOICES_DIR = join(CACHE_DIR, "voices");

const DEFAULT_MODEL = "kokoro-v1.0";

const MODEL_URLS: Record<string, string> = {
  "kokoro-v1.0":
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
};

const VOICES_URL =
  "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin";

// ---------------------------------------------------------------------------
// Voices — Kokoro ships 54 voices across 8 languages. We expose a curated
// default set and allow users to specify any valid Kokoro voice ID.
// ---------------------------------------------------------------------------

export interface VoiceInfo {
  id: string;
  label: string;
  language: string;
  gender: "female" | "male";
}

export const BUNDLED_VOICES: VoiceInfo[] = [
  { id: "af_heart", label: "Heart", language: "en-US", gender: "female" },
  { id: "af_nova", label: "Nova", language: "en-US", gender: "female" },
  { id: "af_sky", label: "Sky", language: "en-US", gender: "female" },
  { id: "am_adam", label: "Adam", language: "en-US", gender: "male" },
  { id: "am_michael", label: "Michael", language: "en-US", gender: "male" },
  { id: "bf_emma", label: "Emma", language: "en-GB", gender: "female" },
  { id: "bf_isabella", label: "Isabella", language: "en-GB", gender: "female" },
  { id: "bm_george", label: "George", language: "en-GB", gender: "male" },
];

export const DEFAULT_VOICE = "af_heart";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure the Kokoro ONNX model is downloaded and cached.
 * Returns the path to the .onnx model file.
 */
export async function ensureModel(
  model: string = DEFAULT_MODEL,
  options?: { onProgress?: (message: string) => void },
): Promise<string> {
  const modelPath = join(MODELS_DIR, `${model}.onnx`);
  if (existsSync(modelPath)) return modelPath;

  const url = MODEL_URLS[model];
  if (!url) {
    throw new Error(
      `Unknown TTS model: ${model}. Available: ${Object.keys(MODEL_URLS).join(", ")}`,
    );
  }

  mkdirSync(MODELS_DIR, { recursive: true });
  options?.onProgress?.(`Downloading TTS model ${model} (~311 MB)...`);
  await downloadFile(url, modelPath);

  if (!existsSync(modelPath)) {
    throw new Error(`Model download failed: ${model}`);
  }

  return modelPath;
}

/**
 * Ensure the Kokoro voices bundle is downloaded and cached.
 * Returns the path to the voices .bin file.
 */
export async function ensureVoices(options?: {
  onProgress?: (message: string) => void;
}): Promise<string> {
  const voicesPath = join(VOICES_DIR, "voices-v1.0.bin");
  if (existsSync(voicesPath)) return voicesPath;

  mkdirSync(VOICES_DIR, { recursive: true });
  options?.onProgress?.("Downloading voice data (~27 MB)...");
  await downloadFile(VOICES_URL, voicesPath);

  if (!existsSync(voicesPath)) {
    throw new Error("Voice data download failed");
  }

  return voicesPath;
}

export { MODELS_DIR, VOICES_DIR, DEFAULT_MODEL };
