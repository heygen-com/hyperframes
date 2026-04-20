import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import {
  ensureModel,
  ensureVoices,
  DEFAULT_VOICE,
  inferLangFromVoiceId,
  type SupportedLang,
} from "./manager.js";

// ---------------------------------------------------------------------------
// Python runtime detection
// ---------------------------------------------------------------------------

function findPython(): string | undefined {
  for (const name of ["python3", "python"]) {
    try {
      const cmd = process.platform === "win32" ? "where" : "which";
      const output = execFileSync(cmd, [name], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5000,
      });
      const first = output
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean);
      if (!first) continue;

      // Verify it's Python 3
      const version = execFileSync(first, ["--version"], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5000,
      }).trim();

      if (version.includes("Python 3")) return first;
    } catch {
      // not found or not Python 3
    }
  }
  return undefined;
}

function hasPythonPackage(python: string, pkg: string): boolean {
  try {
    execFileSync(python, ["-c", `import ${pkg}`], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Inline Python script for Kokoro synthesis
// ---------------------------------------------------------------------------

// Kokoro-onnx added the `lang=` kwarg to `Kokoro.create()` in a later release.
// We pass it conditionally so older installs that only accept `voice=`/`speed=`
// continue to work (falling back to Kokoro's default phonemization).
const SYNTH_SCRIPT = `
import sys, json, inspect

model_path = sys.argv[1]
voices_path = sys.argv[2]
text = sys.argv[3]
voice = sys.argv[4]
speed = float(sys.argv[5])
output_path = sys.argv[6]
lang = sys.argv[7] if len(sys.argv) > 7 else ""

import kokoro_onnx
import soundfile as sf

model = kokoro_onnx.Kokoro(model_path, voices_path)

kwargs = {"voice": voice, "speed": speed}
supports_lang = "lang" in inspect.signature(model.create).parameters
if lang and supports_lang:
    kwargs["lang"] = lang

samples, sample_rate = model.create(text, **kwargs)
sf.write(output_path, samples, sample_rate)

duration = len(samples) / sample_rate
print(json.dumps({
    "outputPath": output_path,
    "sampleRate": sample_rate,
    "durationSeconds": round(duration, 3),
    "langApplied": bool(lang and supports_lang),
}))
`;

// Cache the script to avoid rewriting it on every invocation.
// The filename carries a version suffix so older installs automatically
// upgrade when the script body changes (e.g., adding the `lang` kwarg).
const SCRIPT_DIR = join(homedir(), ".cache", "hyperframes", "tts");
const SCRIPT_PATH = join(SCRIPT_DIR, "synth-v2.py");

function ensureSynthScript(): string {
  if (!existsSync(SCRIPT_PATH)) {
    mkdirSync(SCRIPT_DIR, { recursive: true });
    writeFileSync(SCRIPT_PATH, SYNTH_SCRIPT);
    // Best-effort: delete older versioned scripts left behind by previous
    // CLI releases so users don't accumulate stale files in ~/.cache.
    const currentName = basename(SCRIPT_PATH);
    try {
      for (const entry of readdirSync(SCRIPT_DIR)) {
        if (entry !== currentName && /^synth(-v\d+)?\.py$/.test(entry)) {
          try {
            unlinkSync(join(SCRIPT_DIR, entry));
          } catch {
            // Ignore — orphan cleanup is best-effort.
          }
        }
      }
    } catch {
      // Ignore — directory read is best-effort.
    }
  }
  return SCRIPT_PATH;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SynthesizeOptions {
  model?: string;
  voice?: string;
  speed?: number;
  /**
   * Phonemizer locale. When omitted, inferred from the voice ID prefix
   * (e.g., `ef_dora` → `es`). Pass explicitly to override — for example,
   * reading English text with a French voice as a stylization.
   */
  lang?: SupportedLang;
  onProgress?: (message: string) => void;
}

export interface SynthesizeResult {
  outputPath: string;
  sampleRate: number;
  durationSeconds: number;
  /** False when the installed kokoro-onnx version does not support the `lang` kwarg. */
  langApplied: boolean;
}

/**
 * Synthesize text to speech using Kokoro-82M via kokoro-onnx.
 */
export async function synthesize(
  text: string,
  outputPath: string,
  options?: SynthesizeOptions,
): Promise<SynthesizeResult> {
  const voice = options?.voice ?? DEFAULT_VOICE;
  const speed = options?.speed ?? 1.0;
  const lang: SupportedLang = options?.lang ?? inferLangFromVoiceId(voice);

  // 1. Ensure Python 3 is available with kokoro-onnx
  options?.onProgress?.("Checking Python runtime...");
  const python = findPython();
  if (!python) {
    throw new Error(
      "Python 3 is required for text-to-speech. Install Python 3.8+ and run: pip install kokoro-onnx soundfile",
    );
  }

  if (!hasPythonPackage(python, "kokoro_onnx")) {
    throw new Error(
      "The kokoro-onnx package is not installed. Run: pip install kokoro-onnx soundfile",
    );
  }

  if (!hasPythonPackage(python, "soundfile")) {
    throw new Error("The soundfile package is not installed. Run: pip install soundfile");
  }

  // 2. Ensure model and voices are downloaded (parallel on first run)
  const [modelPath, voicesPath] = await Promise.all([
    ensureModel(options?.model, { onProgress: options?.onProgress }),
    ensureVoices({ onProgress: options?.onProgress }),
  ]);

  // 3. Ensure synthesis script is cached
  const scriptPath = ensureSynthScript();

  // 4. Ensure output directory exists
  mkdirSync(dirname(outputPath), { recursive: true });

  // 5. Run synthesis
  options?.onProgress?.(`Generating speech with voice ${voice} (${lang})...`);
  try {
    const stdout = execFileSync(
      python,
      [scriptPath, modelPath, voicesPath, text, voice, String(speed), outputPath, lang],
      {
        encoding: "utf-8",
        timeout: 300_000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    if (!existsSync(outputPath)) {
      throw new Error("Synthesis completed but no output file was created");
    }

    // Parse the last line of stdout as JSON (in case Python printed warnings before it)
    const lines = stdout.trim().split("\n");
    const jsonLine = lines[lines.length - 1] ?? "";
    const result: {
      outputPath: string;
      sampleRate: number;
      durationSeconds: number;
      langApplied: boolean;
    } = JSON.parse(jsonLine);

    return {
      outputPath: result.outputPath,
      sampleRate: result.sampleRate,
      durationSeconds: result.durationSeconds,
      langApplied: result.langApplied,
    };
  } catch (err: unknown) {
    // If the error is our own JSON parse failure but the file was created,
    // re-throw with a clearer message rather than returning fabricated data
    if (err instanceof SyntaxError && existsSync(outputPath)) {
      throw new Error(
        "Speech was generated but metadata could not be read. Check the output file manually.",
      );
    }

    let detail = "";
    if (err && typeof err === "object" && "stderr" in err) {
      const stderr = String(err.stderr).trim();
      if (stderr) detail = `\n${stderr.slice(-500)}`;
    }
    throw new Error(`Speech synthesis failed${detail}`);
  }
}
