import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { existsSync, readFileSync } from "node:fs";

export const examples: Example[] = [
  ["Generate speech from text", 'hyperframes tts "Welcome to HyperFrames"'],
  ["Choose a voice", 'hyperframes tts "Hello world" --voice am_adam'],
  ["Save to a specific file", 'hyperframes tts "Intro" --voice bf_emma --output narration.wav'],
  ["Adjust speech speed", 'hyperframes tts "Slow and clear" --speed 0.8'],
  [
    "Generate Spanish speech",
    'hyperframes tts "La reunión empieza a las nueve" --voice ef_dora --output es.wav',
  ],
  [
    "Override phonemizer language",
    'hyperframes tts "Ciao a tutti" --voice af_heart --lang it --output accented.wav',
  ],
  ["Read text from a file", "hyperframes tts script.txt"],
  ["List available voices", "hyperframes tts --list"],
];
import { resolve, extname } from "node:path";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { errorBox } from "../ui/format.js";
import {
  DEFAULT_VOICE,
  BUNDLED_VOICES,
  SUPPORTED_LANGS,
  inferLangFromVoiceId,
  isSupportedLang,
  type SupportedLang,
} from "../tts/manager.js";

const voiceList = BUNDLED_VOICES.map((v) => `${v.id} (${v.label})`).join(", ");
const langList = SUPPORTED_LANGS.join(", ");

export default defineCommand({
  meta: {
    name: "tts",
    description: "Generate speech audio from text using a local AI model (Kokoro-82M)",
  },
  args: {
    input: {
      type: "positional",
      description: "Text to speak, or path to a .txt file",
      required: false,
    },
    output: {
      type: "string",
      description: "Output file path (default: speech.wav in current directory)",
      alias: "o",
    },
    voice: {
      type: "string",
      description: `Voice ID (default: ${DEFAULT_VOICE}). Options: ${voiceList}`,
      alias: "v",
    },
    speed: {
      type: "string",
      description: "Speech speed multiplier (default: 1.0)",
      alias: "s",
    },
    lang: {
      type: "string",
      description: `Phonemizer language (auto-detected from voice prefix when omitted). Options: ${langList}`,
      alias: "l",
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
    // ── List voices mode ──────────────────────────────────────────────
    if (args.list) {
      return listVoices(args.json);
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

    // ── Resolve output path ───────────────────────────────────────────
    const output = resolve(args.output ?? "speech.wav");
    const voice = args.voice ?? DEFAULT_VOICE;
    const speed = args.speed ? parseFloat(args.speed) : 1.0;

    if (isNaN(speed) || speed <= 0 || speed > 3) {
      console.error(c.error("Speed must be a number between 0.1 and 3.0"));
      process.exit(1);
    }

    const inferredLang = inferLangFromVoiceId(voice);
    let lang: SupportedLang = inferredLang;
    if (args.lang != null) {
      const requested = String(args.lang).toLowerCase();
      if (!isSupportedLang(requested)) {
        errorBox("Invalid --lang", `Got "${args.lang}". Must be one of: ${langList}.`);
        process.exit(1);
      }
      lang = requested;
    }

    // Mismatched voice/lang is a valid stylization (English text, French
    // phonemization for accent), so this is a hint, not an error.
    if (!args.json && args.lang != null && lang !== inferredLang) {
      console.log(
        c.dim(
          `  Note: voice "${voice}" is ${inferredLang}, rendering with --lang ${lang} instead.`,
        ),
      );
    }

    // ── Synthesize ────────────────────────────────────────────────────
    const { synthesize } = await import("../tts/synthesize.js");
    const spin = args.json ? null : clack.spinner();
    spin?.start(`Generating speech with ${c.accent(voice)} (${lang})...`);

    try {
      const result = await synthesize(text, output, {
        voice,
        speed,
        lang,
        onProgress: spin ? (msg) => spin.message(msg) : undefined,
      });

      if (args.json) {
        console.log(
          JSON.stringify({
            ok: true,
            voice,
            speed,
            lang,
            langApplied: result.langApplied,
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
              "  Note: installed kokoro-onnx version does not support the --lang kwarg; phonemization used Kokoro's default.",
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
// List voices
// ---------------------------------------------------------------------------

function listVoices(json: boolean): void {
  const rows = BUNDLED_VOICES.map((v) => ({ ...v, defaultLang: inferLangFromVoiceId(v.id) }));

  if (json) {
    console.log(JSON.stringify(rows));
    return;
  }

  console.log(`\n${c.bold("Available voices")} (Kokoro-82M)\n`);
  console.log(
    `  ${c.dim("ID")}                ${c.dim("Name")}         ${c.dim("Language")}   ${c.dim("Lang code")}  ${c.dim("Gender")}`,
  );
  console.log(`  ${c.dim("─".repeat(72))}`);
  for (const row of rows) {
    const id = row.id.padEnd(18);
    const label = row.label.padEnd(13);
    const lang = row.language.padEnd(10);
    const code = row.defaultLang.padEnd(10);
    console.log(`  ${c.accent(id)} ${label} ${lang} ${code} ${row.gender}`);
  }
  console.log(
    `\n  ${c.dim("Use any Kokoro voice ID — see https://github.com/thewh1teagle/kokoro-onnx for all 54 voices")}`,
  );
  console.log(
    `  ${c.dim("Override phonemizer with --lang <" + SUPPORTED_LANGS.join("|") + ">")}\n`,
  );
}
