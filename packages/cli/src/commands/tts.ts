import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { existsSync, readFileSync } from "node:fs";

export const examples: Example[] = [
  ["Generate speech from text", 'hyperframes tts "Welcome to HyperFrames"'],
  ["Choose a voice", 'hyperframes tts "Hello world" --voice am_adam'],
  ["Save to a specific file", 'hyperframes tts "Intro" --voice bf_emma --output narration.wav'],
  ["Adjust speech speed", 'hyperframes tts "Slow and clear" --speed 0.8'],
  [
    "Use the Supertonic engine",
    'hyperframes tts "Lightning-fast on-device speech" --engine supertonic --voice F1',
  ],
  [
    "Supertonic in another language",
    'hyperframes tts "안녕하세요" --engine supertonic --voice F2 --lang ko',
  ],
  [
    "Generate Spanish speech (Kokoro)",
    'hyperframes tts "La reunión empieza a las nueve" --voice ef_dora --output es.wav',
  ],
  [
    "Override phonemizer language",
    'hyperframes tts "Ciao a tutti" --voice af_heart --lang it --output accented.wav',
  ],
  ["Read text from a file", "hyperframes tts script.txt"],
  ["List available voices", "hyperframes tts --list"],
  ["List Supertonic voices", "hyperframes tts --list --engine supertonic"],
];
import { resolve, extname } from "node:path";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { errorBox } from "../ui/format.js";
import {
  DEFAULT_ENGINE,
  ENGINE_IDS,
  getEngine,
  isEngineId,
  type EngineId,
  type TtsEngine,
} from "../tts/engine.js";

const engineList = ENGINE_IDS.join(", ");

export default defineCommand({
  meta: {
    name: "tts",
    description:
      "Generate speech audio from text using a local AI model (Kokoro-82M or Supertonic 3)",
  },
  args: {
    input: {
      type: "positional",
      description: "Text to speak, or path to a .txt file",
      required: false,
    },
    engine: {
      type: "string",
      description: `TTS engine (default: ${DEFAULT_ENGINE}). Options: ${engineList}`,
      alias: "e",
    },
    output: {
      type: "string",
      description: "Output file path (default: speech.wav in current directory)",
      alias: "o",
    },
    voice: {
      type: "string",
      description: "Voice ID (engine-specific; see --list)",
      alias: "v",
    },
    speed: {
      type: "string",
      description: "Speech speed multiplier (default: 1.0)",
      alias: "s",
    },
    lang: {
      type: "string",
      description: "Synthesis language (engine-specific; see --list)",
      alias: "l",
    },
    steps: {
      type: "string",
      description: "Supertonic only: flow-matching denoise steps (default: 8, higher = slower)",
    },
    list: {
      type: "boolean",
      description: "List available voices and exit",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
      default: false,
    },
  },
  async run({ args }) {
    // ── Resolve engine ────────────────────────────────────────────────
    const engineId: EngineId = resolveEngine(args.engine, args.json);
    const engine = await getEngine(engineId);

    // ── List voices mode ──────────────────────────────────────────────
    if (args.list) {
      return listVoices(engine, args.json);
    }

    // ── Resolve input text ────────────────────────────────────────────
    if (!args.input) {
      console.error(c.error("Provide text to speak, or use --list to see available voices."));
      process.exit(1);
    }

    let text: string;
    const maybeFile = resolve(args.input);

    if (existsSync(maybeFile) && extname(maybeFile).toLowerCase() === ".txt") {
      text = readFileSync(maybeFile, "utf-8").trim();
      if (!text) {
        console.error(c.error("File is empty."));
        process.exit(1);
      }
    } else {
      text = args.input;
    }

    if (!text.trim()) {
      console.error(c.error("No text provided."));
      process.exit(1);
    }

    // ── Resolve output path & params ──────────────────────────────────
    const output = resolve(args.output ?? "speech.wav");
    const voice = args.voice ?? engine.defaultVoice;
    const speed = args.speed ? parseFloat(args.speed) : undefined;

    if (speed !== undefined && (isNaN(speed) || speed <= 0 || speed > 3)) {
      console.error(c.error("Speed must be a number between 0.1 and 3.0"));
      process.exit(1);
    }

    let steps: number | undefined;
    if (args.steps != null) {
      steps = parseInt(args.steps, 10);
      if (isNaN(steps) || steps < 1 || steps > 64) {
        console.error(c.error("Steps must be an integer between 1 and 64"));
        process.exit(1);
      }
    }

    // ── Resolve language (engine validates its own codes) ─────────────
    let lang: string;
    try {
      lang = engine.resolveLang(voice, args.lang ?? undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errorBox("Invalid --lang", message);
      process.exit(1);
    }

    // ── Synthesize ────────────────────────────────────────────────────
    const spin = args.json ? null : clack.spinner();
    spin?.start(`Generating speech with ${engine.label} · ${c.accent(voice)} (${lang})...`);

    try {
      const result = await engine.synthesize(text, output, {
        voice,
        speed,
        lang,
        steps,
        onProgress: spin ? (msg) => spin.message(msg) : undefined,
      });

      if (args.json) {
        console.log(
          JSON.stringify({
            ok: true,
            engine: engine.id,
            voice,
            speed: speed ?? null,
            lang,
            langApplied: result.langApplied,
            sampleRate: result.sampleRate,
            durationSeconds: result.durationSeconds,
            outputPath: result.outputPath,
          }),
        );
      } else {
        spin?.stop(
          c.success(
            `Generated ${c.accent(result.durationSeconds.toFixed(1) + "s")} of speech → ${c.accent(result.outputPath)}`,
          ),
        );
        if (args.lang != null && !result.langApplied) {
          console.log(
            c.dim(
              "  Note: installed engine version does not support the --lang option; default phonemization was used.",
            ),
          );
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: message }));
      } else {
        spin?.stop(c.error(`Speech synthesis failed: ${message}`));
      }
      process.exit(1);
    }
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveEngine(value: string | undefined, json: boolean): EngineId {
  if (value == null) return DEFAULT_ENGINE;
  const normalized = String(value).toLowerCase();
  if (!isEngineId(normalized)) {
    const message = `Got "${value}". Must be one of: ${engineList}.`;
    if (json) console.log(JSON.stringify({ ok: false, error: `Invalid --engine. ${message}` }));
    else errorBox("Invalid --engine", message);
    process.exit(1);
  }
  return normalized;
}

function listVoices(engine: TtsEngine, json: boolean): void {
  const voices = engine.listVoices();
  const rows = voices.map((v) => ({ ...v, defaultLang: engine.resolveLang(v.id) }));

  if (json) {
    console.log(JSON.stringify({ engine: engine.id, voices: rows }));
    return;
  }

  console.log(`\n${c.bold("Available voices")} (${engine.label})\n`);
  console.log(
    `  ${c.dim("ID")}                ${c.dim("Name")}         ${c.dim("Language")}      ${c.dim("Lang code")}  ${c.dim("Gender")}`,
  );
  console.log(`  ${c.dim("─".repeat(76))}`);
  for (const row of rows) {
    const id = row.id.padEnd(18);
    const label = row.label.padEnd(13);
    const lang = row.language.padEnd(13);
    const code = row.defaultLang.padEnd(10);
    console.log(`  ${c.accent(id)} ${label} ${lang} ${code} ${row.gender}`);
  }
  console.log(`\n  ${c.dim(`Supported --lang codes: ${engine.supportedLangs.join(", ")}`)}\n`);
}
