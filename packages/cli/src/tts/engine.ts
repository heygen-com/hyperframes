// ---------------------------------------------------------------------------
// TTS engine abstraction
//
// HyperFrames ships more than one text-to-speech backend. Kokoro-82M runs
// through a Python subprocess (kokoro-onnx); Supertonic 3 runs fully
// in-process via onnxruntime-node. Both implement the `TtsEngine` interface
// below so `hyperframes tts` can switch between them with `--engine` without
// the command knowing anything engine-specific.
// ---------------------------------------------------------------------------

export interface SynthesizeResult {
  outputPath: string;
  sampleRate: number;
  durationSeconds: number;
  /**
   * Whether the requested phonemizer/language was actually applied. Kokoro
   * may ignore `lang` on older installs; Supertonic always honors it.
   */
  langApplied: boolean;
}

export interface TtsVoice {
  id: string;
  label: string;
  /** Human-readable language or locale label, e.g. "en-US" or "Multilingual". */
  language: string;
  gender: "female" | "male";
}

export interface EngineSynthesizeOptions {
  voice?: string;
  /** Speech speed multiplier (engine-specific sane range; ~0.1–3.0). */
  speed?: number;
  /** Phonemizer/synthesis language code in the engine's own vocabulary. */
  lang?: string;
  /**
   * Flow-matching denoise steps (Supertonic only, ~4–12). Ignored by engines
   * that don't expose iterative sampling.
   */
  steps?: number;
  onProgress?: (message: string) => void;
}

export interface TtsEngine {
  /** Stable identifier used by the `--engine` flag. */
  readonly id: EngineId;
  /** Display name shown in help and voice listings. */
  readonly label: string;
  /** Voice ID used when the caller doesn't pass one. */
  readonly defaultVoice: string;
  /** Voices this engine exposes for `tts --list`. */
  listVoices(): TtsVoice[];
  /**
   * Resolve the language code for a given voice + optional explicit `--lang`.
   * Returns the code to pass to `synthesize`. Throws if `requested` is not a
   * valid code for this engine.
   */
  resolveLang(voice: string, requested?: string): string;
  /** Supported language codes, for help text and validation messages. */
  readonly supportedLangs: readonly string[];
  synthesize(
    text: string,
    outputPath: string,
    options?: EngineSynthesizeOptions,
  ): Promise<SynthesizeResult>;
}

export type EngineId = "kokoro" | "supertonic";

export const ENGINE_IDS = ["kokoro", "supertonic"] as const;

export const DEFAULT_ENGINE: EngineId = "kokoro";

export function isEngineId(value: string): value is EngineId {
  return (ENGINE_IDS as readonly string[]).includes(value);
}

/**
 * Lazily construct a TTS engine by id. Engines are imported on demand so the
 * CLI doesn't load onnxruntime-node (or probe for Python) until TTS is used.
 */
export async function getEngine(id: EngineId): Promise<TtsEngine> {
  switch (id) {
    case "kokoro": {
      const { KokoroEngine } = await import("./engines/kokoro.js");
      return new KokoroEngine();
    }
    case "supertonic": {
      const { SupertonicEngine } = await import("./engines/supertonic/index.js");
      return new SupertonicEngine();
    }
  }
}
