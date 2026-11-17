import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { downloadFile } from "../utils/download.js";
import { verifies, type ModelFile } from "../whisper/modelFile.js";
import { hyperframesCacheDir } from "@hyperframes/core/cache-dir";

const CACHE_DIR = hyperframesCacheDir("tts");
const MODELS_DIR = join(CACHE_DIR, "models");
const VOICES_DIR = join(CACHE_DIR, "voices");

const DEFAULT_MODEL = "kokoro-v1.0";

const MODEL_URLS: Record<string, string> = {
  "kokoro-v1.0":
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
};

const VOICES_URL =
  "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin";

/** Size and sha256 of each release asset, so a cut or replaced file is never loaded. */
const MODEL_FILES: Record<string, ModelFile> = {
  "kokoro-v1.0": {
    name: "kokoro-v1.0.onnx",
    bytes: 325_532_387,
    sha256: "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
  },
};

const VOICES_FILE: ModelFile = {
  name: "voices-v1.0.bin",
  bytes: 28_214_398,
  sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
};

/** A cached file of the pinned size; anything else is removed so it is fetched again. */
function cachedAtPinnedSize(path: string, pin: ModelFile): boolean {
  if (statSync(path, { throwIfNoEntry: false })?.size === pin.bytes) return true;
  rmSync(path, { force: true });
  return false;
}

/** Download `url` to `dest`, discarding it unless it matches `pin`. */
function downloadPinned(url: string, dest: string, pin: ModelFile): Promise<void> {
  return downloadFile(url, dest, {
    verify: async (path) => {
      if (!(await verifies(path, pin))) {
        throw new Error(
          `${pin.name} did not match its pinned size and sha256, so it was discarded. Re-run to retry.`,
        );
      }
    },
  });
}

// Locale codes accepted by Kokoro's phonemizer (misaki for English,
// espeak-ng for everything else). Kept as a readonly tuple so the union
// type below stays driven by this single source.
export const SUPPORTED_LANGS = [
  "en-us",
  "en-gb",
  "es",
  "fr-fr",
  "hi",
  "it",
  "pt-br",
  "ja",
  "zh",
] as const;

export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

// Kokoro voice IDs are `<lang><gender>_<name>` — the first letter is
// language, the second is gender. See https://github.com/hexgrad/kokoro.
const VOICE_PREFIX_LANG: Record<string, SupportedLang> = {
  a: "en-us", // American English
  b: "en-gb", // British English
  e: "es", // Spanish
  f: "fr-fr", // French
  h: "hi", // Hindi
  i: "it", // Italian
  j: "ja", // Japanese
  p: "pt-br", // Brazilian Portuguese
  z: "zh", // Mandarin
};

/**
 * Infer the phonemizer language from a Kokoro voice ID prefix.
 * Unknown prefixes fall back to `en-us` — Kokoro's text frontend is
 * English-trained, so that's the safe default.
 */
export function inferLangFromVoiceId(voiceId: string): SupportedLang {
  const first = voiceId.charAt(0).toLowerCase();
  return VOICE_PREFIX_LANG[first] ?? "en-us";
}

export function isSupportedLang(value: string): value is SupportedLang {
  return (SUPPORTED_LANGS as readonly string[]).includes(value);
}

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
  { id: "ef_dora", label: "Dora", language: "es", gender: "female" },
  { id: "ff_siwis", label: "Siwis", language: "fr-FR", gender: "female" },
  { id: "jf_alpha", label: "Alpha", language: "ja", gender: "female" },
  { id: "zf_xiaobei", label: "Xiaobei", language: "zh", gender: "female" },
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
  const url = MODEL_URLS[model];
  const pin = MODEL_FILES[model];
  if (!url || !pin) {
    throw new Error(
      `Unknown TTS model: ${model}. Available: ${Object.keys(MODEL_URLS).join(", ")}`,
    );
  }
  if (cachedAtPinnedSize(modelPath, pin)) return modelPath;

  mkdirSync(MODELS_DIR, { recursive: true });
  options?.onProgress?.(`Downloading TTS model ${model} (~311 MB)...`);
  await downloadPinned(url, modelPath, pin);

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
  const voicesPath = join(VOICES_DIR, VOICES_FILE.name);
  if (cachedAtPinnedSize(voicesPath, VOICES_FILE)) return voicesPath;

  mkdirSync(VOICES_DIR, { recursive: true });
  options?.onProgress?.("Downloading voice data (~27 MB)...");
  await downloadPinned(VOICES_URL, voicesPath, VOICES_FILE);

  if (!existsSync(voicesPath)) {
    throw new Error("Voice data download failed");
  }

  return voicesPath;
}

export { MODELS_DIR, DEFAULT_MODEL };
