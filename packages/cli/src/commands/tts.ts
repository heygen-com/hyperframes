import { defineCommand } from "citty";
import { existsSync, readFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { DEFAULT_VOICE, BUNDLED_VOICES } from "../tts/manager.js";

const voiceList = BUNDLED_VOICES.map((v) => `${v.id} (${v.label})`).join(", ");

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

    // ── Synthesize ────────────────────────────────────────────────────
    const { synthesize } = await import("../tts/synthesize.js");
    const spin = args.json ? null : clack.spinner();
    spin?.start(`Generating speech with ${c.accent(voice)}...`);

    try {
      const result = await synthesize(text, output, {
        voice,
        speed,
        onProgress: spin ? (msg) => spin.message(msg) : undefined,
      });

      if (args.json) {
        console.log(
          JSON.stringify({
            ok: true,
            voice,
            speed,
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
  if (json) {
    console.log(JSON.stringify(BUNDLED_VOICES));
    return;
  }

  console.log(`\n${c.bold("Available voices")} (Kokoro-82M)\n`);
  console.log(
    `  ${c.dim("ID")}                ${c.dim("Name")}         ${c.dim("Language")}   ${c.dim("Gender")}`,
  );
  console.log(`  ${c.dim("─".repeat(60))}`);
  for (const v of BUNDLED_VOICES) {
    const id = v.id.padEnd(18);
    const label = v.label.padEnd(13);
    const lang = v.language.padEnd(10);
    console.log(`  ${c.accent(id)} ${label} ${lang} ${v.gender}`);
  }
  console.log(
    `\n  ${c.dim("Use any Kokoro voice ID — see https://github.com/thewh1teagle/kokoro-onnx for all 54 voices")}\n`,
  );
}
