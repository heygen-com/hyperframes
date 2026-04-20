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
// Languages — Kokoro's phonemizer supports these locale codes. The second
// letter of a voice ID is gender; the first letter is language. This list
// mirrors what misaki (English) and espeak-ng (everything else) accept.
// ---------------------------------------------------------------------------

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

const DEFAULT_LANG: SupportedLang = "en-us";

// First letter of a Kokoro voice ID → phonemizer locale.
// See https://github.com/hexgrad/kokoro for the full voice catalog.
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
 *
 * Kokoro voice IDs are `<lang><gender>_<name>` where `<lang>` is a single
 * letter: a=American, b=British, e=Spanish, f=French, h=Hindi, i=Italian,
 * j=Japanese, p=Brazilian Portuguese, z=Mandarin. Unknown prefixes fall
 * back to `en-us` — the safe default for Kokoro's English-trained text
 * frontend.
 */
export function inferLangFromVoiceId(voiceId: string): SupportedLang {
  const first = voiceId.charAt(0).toLowerCase();
  return VOICE_PREFIX_LANG[first] ?? DEFAULT_LANG;
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
  /** Phonemizer locale for this voice. Derived from the ID prefix. */
  defaultLang: SupportedLang;
}

function makeVoice(
  id: string,
  label: string,
  language: string,
  gender: "female" | "male",
): VoiceInfo {
  return { id, label, language, gender, defaultLang: inferLangFromVoiceId(id) };
}

export const BUNDLED_VOICES: VoiceInfo[] = [
  makeVoice("af_heart", "Heart", "en-US", "female"),
  makeVoice("af_nova", "Nova", "en-US", "female"),
  makeVoice("af_sky", "Sky", "en-US", "female"),
  makeVoice("am_adam", "Adam", "en-US", "male"),
  makeVoice("am_michael", "Michael", "en-US", "male"),
  makeVoice("bf_emma", "Emma", "en-GB", "female"),
  makeVoice("bf_isabella", "Isabella", "en-GB", "female"),
  makeVoice("bm_george", "George", "en-GB", "male"),
  makeVoice("ef_dora", "Dora", "es", "female"),
  makeVoice("ff_siwis", "Siwis", "fr-FR", "female"),
  makeVoice("jf_alpha", "Alpha", "ja", "female"),
  makeVoice("zf_xiaobei", "Xiaobei", "zh", "female"),
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
