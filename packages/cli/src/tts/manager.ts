import { join } from "node:path";
import { ensurePinnedFile } from "../utils/pinnedFile.js";
import type { ModelFile } from "../whisper/modelFile.js";
import { hyperframesCacheDir } from "@hyperframes/core/cache-dir";

const CACHE_DIR = hyperframesCacheDir("tts");
const MODELS_DIR = join(CACHE_DIR, "models");
const VOICES_DIR = join(CACHE_DIR, "voices");

const DEFAULT_MODEL = "kokoro-v1.0";

const MODEL_URLS: Record<string, string> = {
  "kokoro-v1.0":
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
};

const MODEL_PINS: Record<string, ModelFile> = {
  "kokoro-v1.0": {
    name: "kokoro-v1.0.onnx",
    bytes: 325_532_387,
    sha256: "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
  },
};

const VOICES_URL =
  "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin";

const VOICES_PIN: ModelFile = {
  name: "voices-v1.0.bin",
  bytes: 28_214_398,
  sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
};

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
  const known = Object.hasOwn(MODEL_URLS, model) && Object.hasOwn(MODEL_PINS, model);
  const url = known ? MODEL_URLS[model] : undefined;
  const pin = known ? MODEL_PINS[model] : undefined;
  if (!url || !pin) {
    throw new Error(
      `Unknown TTS model: ${model}. Available: ${Object.keys(MODEL_URLS).join(", ")}`,
    );
  }

  return ensurePinnedFile(url, join(MODELS_DIR, `${model}.onnx`), pin, {
    downloading: `Downloading TTS model ${model} (~311 MB)...`,
    onProgress: options?.onProgress,
  });
}

/**
 * Ensure the Kokoro voices bundle is downloaded and cached.
 * Returns the path to the voices .bin file.
 */
export async function ensureVoices(options?: {
  onProgress?: (message: string) => void;
}): Promise<string> {
  return ensurePinnedFile(VOICES_URL, join(VOICES_DIR, VOICES_PIN.name), VOICES_PIN, {
    downloading: "Downloading voice data (~27 MB)...",
    onProgress: options?.onProgress,
  });
}

export { MODELS_DIR, DEFAULT_MODEL };
