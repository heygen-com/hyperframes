import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { existsSync, readFileSync } from "node:fs";

export const examples: Example[] = [
  ["Generate speech from text", 'hyperframes tts "Welcome to HyperFrames"'],
  ["Choose a voice", 'hyperframes tts "Hello world" --voice am_adam'],
  ["Save to a specific file", 'hyperframes tts "Intro" --voice bf_emma --output narration.wav'],
  ["Adjust speech speed", 'hyperframes tts "Slow and clear" --speed 0.8'],
  ["Read text from a file", "hyperframes tts script.txt"],
  ["List available voices", "hyperframes tts --list"],
  [
    "Use MiniMax cloud TTS (requires MINIMAX_API_KEY)",
    'hyperframes tts "Hello world" --provider minimax',
  ],
  [
    "MiniMax with a specific voice",
    'hyperframes tts "Hello world" --provider minimax --voice English_Persuasive_Man',
  ],
];
import { resolve, extname } from "node:path";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { DEFAULT_VOICE, BUNDLED_VOICES } from "../tts/manager.js";
import { MINIMAX_VOICES, MINIMAX_DEFAULT_VOICE } from "../tts/minimax.js";

export default defineCommand({
  meta: {
    name: "tts",
    description: "Generate speech audio from text (local Kokoro model or MiniMax cloud API)",
  },
  args: {
    input: {
      type: "positional",
      description: "Text to speak, or path to a .txt file",
      required: false,
    },
    output: {
      type: "string",
      description: "Output file path (default: speech.wav for kokoro, speech.mp3 for minimax)",
      alias: "o",
    },
    provider: {
      type: "string",
      description:
        'TTS provider: "kokoro" (local, default) or "minimax" (cloud, requires MINIMAX_API_KEY)',
      alias: "p",
      default: "kokoro",
    },
    voice: {
      type: "string",
      description: `Voice ID. Kokoro default: ${DEFAULT_VOICE}; MiniMax default: ${MINIMAX_DEFAULT_VOICE}`,
      alias: "v",
    },
    speed: {
      type: "string",
      description: "Speech speed multiplier (default: 1.0)",
      alias: "s",
    },
    list: {
      type: "boolean",
      description: "List available voices for the selected provider and exit",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
      default: false,
    },
  },
  async run({ args }) {
    const provider = args.provider ?? "kokoro";

    if (provider !== "kokoro" && provider !== "minimax") {
      console.error(
        c.error(`Unknown provider "${provider}". Choose "kokoro" (default) or "minimax".`),
      );
      process.exit(1);
    }

    // ── List voices mode ──────────────────────────────────────────────
    if (args.list) {
      return listVoices(args.json, provider);
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
    const defaultOutput = provider === "minimax" ? "speech.mp3" : "speech.wav";
    const output = resolve(args.output ?? defaultOutput);
    const speed = args.speed ? parseFloat(args.speed) : 1.0;

    if (isNaN(speed) || speed <= 0 || speed > 3) {
      console.error(c.error("Speed must be a number between 0.1 and 3.0"));
      process.exit(1);
    }

    // ── Synthesize ────────────────────────────────────────────────────
    const spin = args.json ? null : clack.spinner();

    if (provider === "minimax") {
      const voice = args.voice ?? MINIMAX_DEFAULT_VOICE;
      spin?.start(`Generating speech with MiniMax voice ${c.accent(voice)}...`);
      try {
        const { synthesizeWithMiniMax } = await import("../tts/minimax.js");
        const result = await synthesizeWithMiniMax(text, output, {
          voice,
          speed,
          onProgress: spin ? (msg) => spin.message(msg) : undefined,
        });
        if (args.json) {
          console.log(
            JSON.stringify({
              ok: true,
              provider: "minimax",
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
    } else {
      // kokoro (default)
      const voice = args.voice ?? DEFAULT_VOICE;
      spin?.start(`Generating speech with ${c.accent(voice)}...`);
      try {
        const { synthesize } = await import("../tts/synthesize.js");
        const result = await synthesize(text, output, {
          voice,
          speed,
          onProgress: spin ? (msg) => spin.message(msg) : undefined,
        });
        if (args.json) {
          console.log(
            JSON.stringify({
              ok: true,
              provider: "kokoro",
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
    }
  },
});

// ---------------------------------------------------------------------------
// List voices
// ---------------------------------------------------------------------------

function listVoices(json: boolean, provider: string): void {
  if (provider === "minimax") {
    if (json) {
      console.log(JSON.stringify(MINIMAX_VOICES));
      return;
    }
    console.log(`\n${c.bold("Available voices")} (MiniMax TTS)\n`);
    console.log(
      `  ${c.dim("ID")}                           ${c.dim("Name")}                ${c.dim("Language")}   ${c.dim("Gender")}`,
    );
    console.log(`  ${c.dim("─".repeat(70))}`);
    for (const v of MINIMAX_VOICES) {
      const id = v.id.padEnd(30);
      const label = v.label.padEnd(20);
      const lang = v.language.padEnd(10);
      console.log(`  ${c.accent(id)} ${label} ${lang} ${v.gender}`);
    }
    console.log(
      `\n  ${c.dim("Requires MINIMAX_API_KEY. See https://platform.minimax.io/docs/api-reference/speech-t2a-http")}\n`,
    );
    return;
  }

  // kokoro
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
