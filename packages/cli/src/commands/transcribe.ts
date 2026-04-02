import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { existsSync, writeFileSync } from "node:fs";

export const examples: Example[] = [
  ["Transcribe an audio file", "hyperframes transcribe audio.mp3"],
  ["Transcribe a video file", "hyperframes transcribe video.mp4"],
  ["Use a larger model for better accuracy", "hyperframes transcribe audio.mp3 --model medium.en"],
  ["Set language to filter non-target speech", "hyperframes transcribe audio.mp3 --language en"],
  ["Import an existing SRT file", "hyperframes transcribe subtitles.srt"],
  ["Import an OpenAI Whisper JSON response", "hyperframes transcribe response.json"],
];
import { resolve, join, extname } from "node:path";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { DEFAULT_MODEL } from "../whisper/manager.js";

export default defineCommand({
  meta: {
    name: "transcribe",
    description:
      "Transcribe audio/video to word-level timestamps, or import an existing transcript",
  },
  args: {
    input: {
      type: "positional",
      description:
        "Audio/video file to transcribe, or transcript file to import (.json, .srt, .vtt)",
      required: true,
    },
    dir: {
      type: "string",
      description: "Project directory (default: current directory)",
      alias: "d",
    },
    model: {
      type: "string",
      description: `Whisper model (default: ${DEFAULT_MODEL}). Options: tiny.en, base.en, small.en, medium.en, large-v3`,
      alias: "m",
    },
    language: {
      type: "string",
      description: "Language code (e.g. en, es, ja). Filters out non-target language speech.",
      alias: "l",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
      default: false,
    },
  },
  async run({ args }) {
    const inputPath = resolve(args.input);
    if (!existsSync(inputPath)) {
      console.error(c.error(`File not found: ${args.input}`));
      process.exit(1);
    }

    const dir = resolve(args.dir ?? ".");
    const ext = extname(inputPath).toLowerCase();

    // ── Import mode: convert existing transcript ──────────────────────────
    const isImport = ext === ".json" || ext === ".srt" || ext === ".vtt";

    if (isImport) {
      return importTranscript(inputPath, dir, args.json);
    }

    // ── Transcribe mode: run whisper ─────────────────────────────────────
    return transcribeAudio(inputPath, dir, {
      model: args.model,
      language: args.language,
      json: args.json,
    });
  },
});

// ---------------------------------------------------------------------------
// Import existing transcript
// ---------------------------------------------------------------------------

async function importTranscript(inputPath: string, dir: string, json: boolean): Promise<void> {
  const { loadTranscript, patchCaptionHtml } = await import("../whisper/normalize.js");
  const { words, format } = loadTranscript(inputPath);

  if (words.length === 0) {
    console.error(c.error("No words found in transcript."));
    process.exit(1);
  }

  const outPath = join(dir, "transcript.json");
  writeFileSync(outPath, JSON.stringify(words, null, 2));
  patchCaptionHtml(dir, words);

  if (json) {
    console.log(
      JSON.stringify({ ok: true, format, wordCount: words.length, transcriptPath: outPath }),
    );
  } else {
    console.log(
      `${c.success("◇")}  Imported ${c.accent(String(words.length))} words from ${c.accent(format)} format → ${c.accent("transcript.json")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Transcribe audio/video with whisper
// ---------------------------------------------------------------------------

async function transcribeAudio(
  inputPath: string,
  dir: string,
  opts: { model?: string; language?: string; json?: boolean },
): Promise<void> {
  const { transcribe } = await import("../whisper/transcribe.js");
  const { loadTranscript, patchCaptionHtml, stripBeforeOnset } =
    await import("../whisper/normalize.js");

  const model = opts.model ?? DEFAULT_MODEL;
  const spin = opts.json ? null : clack.spinner();
  spin?.start(`Transcribing with ${c.accent(model)}...`);

  try {
    const result = await transcribe(inputPath, dir, {
      model,
      language: opts.language,
      onProgress: spin ? (msg) => spin.message(msg) : undefined,
    });

    let { words } = loadTranscript(result.transcriptPath);

    if (result.speechOnsetSeconds != null) {
      const before = words.length;
      words = stripBeforeOnset(words, result.speechOnsetSeconds);
      const stripped = before - words.length;
      if (stripped > 0 && !opts.json) {
        spin?.message(
          `Stripped ${stripped} words before speech onset at ${result.speechOnsetSeconds.toFixed(1)}s`,
        );
      }
    }

    writeFileSync(result.transcriptPath, JSON.stringify(words, null, 2));
    patchCaptionHtml(dir, words);

    if (opts.json) {
      console.log(
        JSON.stringify({
          ok: true,
          model,
          wordCount: words.length,
          durationSeconds: result.durationSeconds,
          speechOnsetSeconds: result.speechOnsetSeconds,
          transcriptPath: result.transcriptPath,
        }),
      );
    } else {
      const onsetNote =
        result.speechOnsetSeconds != null
          ? ` — speech detected at ${result.speechOnsetSeconds.toFixed(1)}s`
          : "";
      spin?.stop(
        c.success(
          `Transcribed ${c.accent(String(words.length))} words (${result.durationSeconds.toFixed(1)}s${onsetNote})`,
        ),
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: message }));
    } else {
      spin?.stop(c.error(`Transcription failed: ${message}`));
    }
    process.exit(1);
  }
}
