// Supertonic 3 asset manager — downloads the ONNX models, config, and preset
// voice styles from Hugging Face on first use and caches them under
// ~/.cache/hyperframes/tts/supertonic/. Mirrors the Kokoro manager's
// download-on-demand pattern (../../manager.ts).

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { downloadFile } from "../../../utils/download.js";

const CACHE_DIR = join(homedir(), ".cache", "hyperframes", "tts", "supertonic");
const ONNX_DIR = join(CACHE_DIR, "onnx");
const VOICES_DIR = join(CACHE_DIR, "voice_styles");

// Repo layout: https://huggingface.co/Supertone/supertonic-3 cloned into the
// `assets/` dir the upstream examples expect, so `onnx/` and `voice_styles/`
// are top-level there. `resolve/main/<path>` serves the raw (LFS) bytes.
const HF_BASE = "https://huggingface.co/Supertone/supertonic-3/resolve/main";

// Files the inference pipeline loads from the onnx dir (see runtime.ts).
const ONNX_FILES = [
  "duration_predictor.onnx",
  "text_encoder.onnx",
  "vector_estimator.onnx",
  "vocoder.onnx",
  "tts.json",
  "unicode_indexer.json",
] as const;

// Preset speaker embeddings. Small JSON files (~KB each).
const VOICE_FILES = ["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"] as const;

export type SupertonicVoiceId = (typeof VOICE_FILES)[number];

export const DEFAULT_VOICE: SupertonicVoiceId = "F1";

/**
 * Ensure all ONNX models + config are present. Returns the directory path to
 * pass to `loadTextToSpeech`. Downloads any missing files (the .onnx models
 * total a few hundred MB; downloaded once, then cached).
 */
export async function ensureModels(options?: {
  onProgress?: (message: string) => void;
}): Promise<string> {
  mkdirSync(ONNX_DIR, { recursive: true });

  const missing = ONNX_FILES.filter((f) => !existsSync(join(ONNX_DIR, f)));
  if (missing.length === 0) return ONNX_DIR;

  options?.onProgress?.(
    `Downloading Supertonic models (${missing.length} file${missing.length === 1 ? "" : "s"}, ~300 MB on first run)...`,
  );

  // Sequential to keep progress legible and avoid hammering the CDN.
  for (const file of missing) {
    const dest = join(ONNX_DIR, file);
    options?.onProgress?.(`Downloading ${file}...`);
    await downloadFile(`${HF_BASE}/onnx/${file}`, dest);
    if (!existsSync(dest)) {
      throw new Error(`Supertonic model download failed: ${file}`);
    }
  }

  return ONNX_DIR;
}

/**
 * Ensure a single preset voice-style JSON is present and return its path.
 */
export async function ensureVoice(
  voice: SupertonicVoiceId,
  options?: { onProgress?: (message: string) => void },
): Promise<string> {
  mkdirSync(VOICES_DIR, { recursive: true });
  const dest = join(VOICES_DIR, `${voice}.json`);
  if (existsSync(dest)) return dest;

  options?.onProgress?.(`Downloading voice ${voice}...`);
  await downloadFile(`${HF_BASE}/voice_styles/${voice}.json`, dest);
  if (!existsSync(dest)) {
    throw new Error(`Supertonic voice download failed: ${voice}`);
  }
  return dest;
}

export function isSupertonicVoice(value: string): value is SupertonicVoiceId {
  return (VOICE_FILES as readonly string[]).includes(value);
}
