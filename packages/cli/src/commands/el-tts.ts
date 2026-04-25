import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, extname, dirname } from "node:path";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { errorBox } from "../ui/format.js";
import {
  loadElevenLabsKey,
  listVoices,
  synthesize,
  fileExtensionForFormat,
  ELEVENLABS_KEY_NAME,
  ElevenLabsError,
  type SynthesizeOptions,
} from "@hyperframes/core/elevenlabs";

export const examples: Example[] = [
  ["Generate speech", 'hyperframes el-tts "Welcome to HyperFrames" --voice 21m00Tcm4TlvDq8ikWAM'],
  ["Read text from a file", "hyperframes el-tts script.txt --voice <id>"],
  ["Save to a specific file", 'hyperframes el-tts "Intro" --voice <id> --output narration.mp3'],
  [
    "Tweak voice settings",
    'hyperframes el-tts "Calm tone" --voice <id> --stability 0.7 --similarity-boost 0.85',
  ],
  [
    "Use a different model",
    'hyperframes el-tts "Hello" --voice <id> --model eleven_multilingual_v2',
  ],
  ["List available voices", "hyperframes el-tts --list"],
];

const VALID_FORMATS: ReadonlyArray<NonNullable<SynthesizeOptions["outputFormat"]>> = [
  "mp3_44100_128",
  "mp3_44100_192",
  "pcm_16000",
  "pcm_22050",
  "pcm_44100",
];

function isValidFormat(value: string): value is NonNullable<SynthesizeOptions["outputFormat"]> {
  return (VALID_FORMATS as readonly string[]).includes(value);
}

export default defineCommand({
  meta: {
    name: "el-tts",
    description:
      "Generate speech audio with ElevenLabs (cloud, multi-voice). Reads ELEVENLABS_API_KEY from .env",
  },
  args: {
    input: {
      type: "positional",
      description: "Text to speak, or path to a .txt file",
      required: false,
    },
    output: {
      type: "string",
      description: "Output file path (default: speech.<ext> in current directory)",
      alias: "o",
    },
    voice: {
      type: "string",
      description: "ElevenLabs voice_id (use --list to browse). Required unless --list",
      alias: "v",
    },
    model: {
      type: "string",
      description: "Model ID (default: eleven_turbo_v2_5)",
    },
    stability: {
      type: "string",
      description: "Voice stability 0-1 (default: 0.5)",
    },
    "similarity-boost": {
      type: "string",
      description: "Voice similarity boost 0-1 (default: 0.75)",
    },
    style: {
      type: "string",
      description: "Style exaggeration 0-1 (default: 0)",
    },
    format: {
      type: "string",
      description: `Output format. One of: ${VALID_FORMATS.join(", ")} (default: mp3_44100_128)`,
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
    const apiKey = loadElevenLabsKey(process.cwd());
    if (!apiKey) {
      errorBox(
        "ElevenLabs API key not found",
        `Set ${ELEVENLABS_KEY_NAME} in one of:\n  - <project>/.env\n  - ~/.hyperframes/.env\n  - process environment`,
      );
      process.exit(1);
    }

    if (args.list) {
      return runListVoices(apiKey, Boolean(args.json));
    }

    if (!args.voice) {
      console.error(c.error("--voice <id> is required. Run with --list to browse voices."));
      process.exit(1);
    }
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

    const stability = parseOptionalNumber(args.stability, "--stability", 0, 1);
    const similarityBoost = parseOptionalNumber(
      args["similarity-boost"],
      "--similarity-boost",
      0,
      1,
    );
    const style = parseOptionalNumber(args.style, "--style", 0, 1);

    let format: NonNullable<SynthesizeOptions["outputFormat"]> = "mp3_44100_128";
    if (args.format) {
      if (!isValidFormat(args.format)) {
        errorBox(
          "Invalid --format",
          `Got "${args.format}". Must be one of: ${VALID_FORMATS.join(", ")}`,
        );
        process.exit(1);
      }
      format = args.format;
    }

    const ext = fileExtensionForFormat(format);
    const output = resolve(args.output ?? `speech.${ext}`);

    const spin = args.json ? null : clack.spinner();
    spin?.start(
      `Generating speech with ${c.accent(args.voice)} (${args.model ?? "eleven_turbo_v2_5"})...`,
    );

    try {
      const { bytes } = await synthesize(apiKey, text, args.voice, {
        modelId: args.model,
        stability,
        similarityBoost,
        style,
        outputFormat: format,
      });

      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, bytes);

      if (args.json) {
        console.log(
          JSON.stringify({
            ok: true,
            voice: args.voice,
            model: args.model ?? "eleven_turbo_v2_5",
            format,
            bytes: bytes.byteLength,
            outputPath: output,
          }),
        );
      } else {
        spin?.stop(
          c.success(`Generated ${c.accent(formatBytes(bytes.byteLength))} → ${c.accent(output)}`),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = err instanceof ElevenLabsError ? err.status : undefined;
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: message, status }));
      } else {
        spin?.stop(c.error(`ElevenLabs synthesis failed: ${message}`));
      }
      process.exit(1);
    }
  },
});

function parseOptionalNumber(
  raw: string | undefined,
  label: string,
  min: number,
  max: number,
): number | undefined {
  if (raw == null) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    errorBox(`Invalid ${label}`, `Must be a number between ${min} and ${max}. Got "${raw}".`);
    process.exit(1);
  }
  return value;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function runListVoices(apiKey: string, json: boolean): Promise<void> {
  const spin = json ? null : clack.spinner();
  spin?.start("Fetching voices…");
  try {
    const voices = await listVoices(apiKey);
    spin?.stop();

    if (json) {
      console.log(JSON.stringify(voices));
      return;
    }

    if (voices.length === 0) {
      console.log(c.dim("No voices available on this account."));
      return;
    }

    console.log(`\n${c.bold("ElevenLabs voices")} (${voices.length})\n`);
    console.log(
      `  ${c.dim("voice_id")}                            ${c.dim("Name")}                 ${c.dim("Category")}     ${c.dim("Labels")}`,
    );
    console.log(`  ${c.dim("─".repeat(100))}`);
    for (const v of voices) {
      const id = v.voice_id.padEnd(34);
      const name = (v.name ?? "").padEnd(20);
      const category = (v.category ?? "").padEnd(12);
      const labels = v.labels
        ? Object.entries(v.labels)
            .map(([k, val]) => `${k}=${val}`)
            .join(" ")
        : "";
      console.log(`  ${c.accent(id)} ${name} ${category} ${c.dim(labels)}`);
    }
    console.log();
  } catch (err) {
    spin?.stop(c.error("Failed to fetch voices"));
    const message = err instanceof Error ? err.message : String(err);
    if (json) {
      console.log(JSON.stringify({ ok: false, error: message }));
    } else {
      console.error(c.dim(message));
    }
    process.exit(1);
  }
}
