import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { existsSync, writeFileSync } from "node:fs";

type CaptionExportFormat = "srt" | "vtt";

export const examples: Example[] = [
  ["Transcribe an audio file", "hyperframes transcribe audio.mp3"],
  ["Transcribe a video file", "hyperframes transcribe video.mp4"],
  ["Use a larger model for better accuracy", "hyperframes transcribe audio.mp3 --model medium.en"],
  ["Set language to filter non-target speech", "hyperframes transcribe audio.mp3 --language en"],
  ["Import an existing SRT file", "hyperframes transcribe subtitles.srt"],
  ["Import an OpenAI Whisper JSON response", "hyperframes transcribe response.json"],
  ["Export captions to SRT", "hyperframes transcribe transcript.json --to srt"],
  [
    "Export single-word/CJK captions without re-grouping",
    "hyperframes transcribe transcript.json --to vtt --preserve-cues",
  ],
];
import { resolve, join, extname, dirname } from "node:path";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { DEFAULT_MODEL, isWhisperUnavailable } from "../whisper/manager.js";
import { trackCommandFailure, trackTranscribeUnavailable } from "../telemetry/events.js";

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
    to: {
      type: "string",
      description: "Export transcript sidecar format: srt or vtt",
    },
    output: {
      type: "string",
      alias: "o",
      description: "Output path for exported SRT/VTT sidecar",
    },
    "preserve-cues": {
      type: "boolean",
      description:
        "Keep each transcript entry as its own caption cue (skip word-level grouping). Use when exporting an already-cued transcript whose entries have no internal spaces, e.g. single-word or CJK captions.",
      default: false,
    },
    optional: {
      type: "boolean",
      description:
        "Treat captions as optional: if whisper-cpp is unavailable, skip and exit 0 instead of failing. For pipelines that continue without captions.",
      default: false,
    },
  },
  async run({ args }) {
    const inputPath = resolve(args.input);
    if (!existsSync(inputPath)) {
      const message = `File not found: ${args.input}`;
      trackCommandFailure("transcribe", message);
      console.error(c.error(message));
      process.exit(1);
    }

    // Default to the directory containing the input file so transcript.json
    // lands next to narration.wav regardless of where the command is run from.
    // Explicit --dir overrides this (e.g. for import mode targeting a project dir).
    const dir = resolve(args.dir ?? dirname(inputPath));
    const ext = extname(inputPath).toLowerCase();

    // ── Import mode: convert existing transcript ──────────────────────────
    const isImport = ext === ".json" || ext === ".srt" || ext === ".vtt";
    const to = parseExportFormat(args.to, args.json);

    if (to) {
      if (!isImport) {
        failWith(
          "--to can only export from transcript files (.json, .srt, .vtt). Run transcribe first.",
          args.json,
        );
      }
      return exportTranscript(inputPath, dir, to, args.output, args.json, args["preserve-cues"]);
    }

    if (isImport) {
      return importTranscript(inputPath, dir, args.json);
    }

    // ── Transcribe mode: run whisper ─────────────────────────────────────
    return transcribeAudio(inputPath, dir, {
      model: args.model,
      language: args.language,
      json: args.json,
      optional: args.optional,
    });
  },
});

function failWith(message: string, json: boolean): never {
  trackCommandFailure("transcribe", message);
  if (json) {
    console.log(JSON.stringify({ ok: false, error: message }));
  } else {
    console.error(c.error(message));
  }
  process.exit(1);
}

function parseExportFormat(
  value: string | undefined,
  json: boolean,
): CaptionExportFormat | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "srt" || normalized === "vtt") return normalized;

  failWith(`Unsupported caption export format: ${value}. Use srt or vtt.`, json);
}

// ---------------------------------------------------------------------------
// Import existing transcript
// ---------------------------------------------------------------------------

function exitNoWords(json: boolean): never {
  failWith("No words found in transcript.", json);
}

async function importTranscript(inputPath: string, dir: string, json: boolean): Promise<void> {
  const { loadTranscript, patchCaptionHtml } = await import("../whisper/normalize.js");
  const { words, format } = loadTranscript(inputPath);

  if (words.length === 0) exitNoWords(json);

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
// Export transcript sidecars
// ---------------------------------------------------------------------------

async function exportTranscript(
  inputPath: string,
  dir: string,
  to: CaptionExportFormat,
  output: string | undefined,
  json: boolean,
  preserveCues: boolean,
): Promise<void> {
  const { loadTranscript, formatSrt, formatVtt } = await import("../whisper/normalize.js");
  const { words, format } = loadTranscript(inputPath);

  if (words.length === 0) exitNoWords(json);

  // A .srt/.vtt source is already phrase-level; keep its cue boundaries 1:1.
  // --preserve-cues forces the same for an already-cued transcript.json whose
  // entries have no internal whitespace (single-word or CJK captions), which
  // the automatic whitespace heuristic in wordsToCues can't detect.
  const preGrouped = preserveCues || format === "srt" || format === "vtt" || undefined;
  const outPath = resolve(output ?? join(dir, `transcript.${to}`));
  const content =
    to === "srt" ? formatSrt(words, { preGrouped }) : formatVtt(words, { preGrouped });
  writeFileSync(outPath, content);

  if (json) {
    console.log(
      JSON.stringify({ ok: true, format: to, wordCount: words.length, outputPath: outPath }),
    );
  } else {
    console.log(
      `${c.success("◇")}  Exported ${c.accent(String(words.length))} words to ${c.accent(to.toUpperCase())} → ${c.accent(outPath)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Transcribe audio/video with whisper
// ---------------------------------------------------------------------------

async function transcribeAudio(
  inputPath: string,
  dir: string,
  opts: { model?: string; language?: string; json?: boolean; optional?: boolean },
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

    // whisper-cpp is an optional prerequisite, not part of the CLI. When it is
    // simply unavailable (no binary, no toolchain to build one), that is a setup
    // condition, not a command crash — report it on its own metric so it does
    // not inflate the cli_error budget, and let `--optional` callers continue.
    if (isWhisperUnavailable(err)) {
      trackTranscribeUnavailable({ optional: opts.optional === true });
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, skipped: true, reason: "whisper_unavailable" }));
      } else {
        spin?.stop(c.warn(`Captions skipped — ${message}`));
      }
      // Optional callers (pipelines) treat a missing prerequisite as a clean
      // skip; explicit runs still surface non-zero. Set the status and return
      // rather than guarding a process.exit() on the flag.
      process.exitCode = opts.optional ? 0 : 1;
      return;
    }

    trackCommandFailure("transcribe", err);
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: message }));
    } else {
      spin?.stop(c.error(`Transcription failed: ${message}`));
    }
    process.exit(1);
  }
}
