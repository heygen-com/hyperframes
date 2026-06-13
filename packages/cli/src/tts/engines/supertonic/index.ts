// Supertonic 3 engine — on-device multilingual TTS via onnxruntime-node.
// Unlike the Kokoro engine, this runs the full pipeline in-process (no Python).

import { dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import type {
  EngineId,
  EngineSynthesizeOptions,
  SynthesizeResult,
  TtsEngine,
  TtsVoice,
} from "../../engine.js";
import {
  DEFAULT_VOICE,
  ensureModels,
  ensureVoice,
  isSupertonicVoice,
  type SupertonicVoiceId,
} from "./manager.js";
import { SUPPORTED_LANGS, isSupertonicLang } from "./runtime.js";

const DEFAULT_LANG = "en";
const DEFAULT_STEPS = 8;

// Preset voices shipped on Hugging Face. Supertonic styles are multilingual —
// the speaker identity is independent of the synthesis language (passed via
// --lang), so language is labelled "Multilingual".
const VOICES: TtsVoice[] = [
  { id: "F1", label: "Female 1", language: "Multilingual", gender: "female" },
  { id: "F2", label: "Female 2", language: "Multilingual", gender: "female" },
  { id: "F3", label: "Female 3", language: "Multilingual", gender: "female" },
  { id: "F4", label: "Female 4", language: "Multilingual", gender: "female" },
  { id: "F5", label: "Female 5", language: "Multilingual", gender: "female" },
  { id: "M1", label: "Male 1", language: "Multilingual", gender: "male" },
  { id: "M2", label: "Male 2", language: "Multilingual", gender: "male" },
  { id: "M3", label: "Male 3", language: "Multilingual", gender: "male" },
  { id: "M4", label: "Male 4", language: "Multilingual", gender: "male" },
  { id: "M5", label: "Male 5", language: "Multilingual", gender: "male" },
];

export class SupertonicEngine implements TtsEngine {
  readonly id: EngineId = "supertonic";
  readonly label = "Supertonic 3";
  readonly defaultVoice = DEFAULT_VOICE;
  readonly supportedLangs = SUPPORTED_LANGS;

  listVoices(): TtsVoice[] {
    return VOICES;
  }

  resolveLang(_voice: string, requested?: string): string {
    if (requested == null) return DEFAULT_LANG;
    const normalized = requested.toLowerCase();
    if (!isSupertonicLang(normalized)) {
      throw new Error(
        `Invalid --lang "${requested}". Must be one of: ${SUPPORTED_LANGS.join(", ")}.`,
      );
    }
    return normalized;
  }

  async synthesize(
    text: string,
    outputPath: string,
    options?: EngineSynthesizeOptions,
  ): Promise<SynthesizeResult> {
    const voiceId = options?.voice ?? DEFAULT_VOICE;
    if (!isSupertonicVoice(voiceId)) {
      throw new Error(
        `Unknown Supertonic voice "${voiceId}". Options: ${VOICES.map((v) => v.id).join(", ")}.`,
      );
    }
    const voice: SupertonicVoiceId = voiceId;

    const speed = options?.speed ?? 1.05;
    const lang = options?.lang ?? DEFAULT_LANG;
    const steps = options?.steps ?? DEFAULT_STEPS;
    if (!isSupertonicLang(lang)) {
      throw new Error(`Invalid language "${lang}". Must be one of: ${SUPPORTED_LANGS.join(", ")}.`);
    }

    // 1. Ensure assets are downloaded (models once, voice once).
    const [onnxDir, voicePath] = await Promise.all([
      ensureModels({ onProgress: options?.onProgress }),
      ensureVoice(voice, { onProgress: options?.onProgress }),
    ]);

    // 2. Load the ONNX pipeline and the selected voice style.
    options?.onProgress?.("Loading Supertonic models...");
    const { loadTextToSpeech, loadVoiceStyle, writeWavFile } = await import("./runtime.js");
    const tts = await loadTextToSpeech(onnxDir);
    const style = loadVoiceStyle([voicePath]);

    // 3. Synthesize.
    options?.onProgress?.(`Generating speech with voice ${voice} (${lang})...`);
    const { wav, duration } = await tts.call(text, lang, style, steps, speed);

    // Trim trailing padding to the predicted duration, matching the upstream
    // example's per-item slice.
    const durationSeconds = duration[0] ?? 0;
    const sampleCount = Math.floor(tts.sampleRate * durationSeconds);
    const samples = sampleCount > 0 ? wav.slice(0, sampleCount) : wav;

    mkdirSync(dirname(outputPath), { recursive: true });
    writeWavFile(outputPath, samples, tts.sampleRate);

    if (!existsSync(outputPath)) {
      throw new Error("Synthesis completed but no output file was created");
    }

    return {
      outputPath,
      sampleRate: tts.sampleRate,
      durationSeconds: Math.round(durationSeconds * 1000) / 1000,
      langApplied: true,
    };
  }
}
