// Kokoro-82M engine — a thin adapter over the existing kokoro-onnx Python
// pipeline (../synthesize.ts, ../manager.ts). Behavior is unchanged; this just
// exposes it through the shared TtsEngine interface.

import type {
  EngineId,
  EngineSynthesizeOptions,
  SynthesizeResult,
  TtsEngine,
  TtsVoice,
} from "../engine.js";
import { synthesize } from "../synthesize.js";
import {
  BUNDLED_VOICES,
  DEFAULT_VOICE,
  SUPPORTED_LANGS,
  inferLangFromVoiceId,
  isSupportedLang,
  type SupportedLang,
} from "../manager.js";

export class KokoroEngine implements TtsEngine {
  readonly id: EngineId = "kokoro";
  readonly label = "Kokoro-82M";
  readonly defaultVoice = DEFAULT_VOICE;
  readonly supportedLangs = SUPPORTED_LANGS;

  listVoices(): TtsVoice[] {
    return BUNDLED_VOICES.map((v) => ({
      id: v.id,
      label: v.label,
      language: v.language,
      gender: v.gender,
    }));
  }

  resolveLang(voice: string, requested?: string): string {
    const inferred = inferLangFromVoiceId(voice);
    if (requested == null) return inferred;
    const normalized = requested.toLowerCase();
    if (!isSupportedLang(normalized)) {
      throw new Error(
        `Invalid --lang "${requested}". Must be one of: ${SUPPORTED_LANGS.join(", ")}.`,
      );
    }
    return normalized;
  }

  synthesize(
    text: string,
    outputPath: string,
    options?: EngineSynthesizeOptions,
  ): Promise<SynthesizeResult> {
    return synthesize(text, outputPath, {
      voice: options?.voice,
      speed: options?.speed,
      lang: options?.lang as SupportedLang | undefined,
      onProgress: options?.onProgress,
    });
  }
}
