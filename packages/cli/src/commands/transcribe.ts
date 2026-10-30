import { createProgressWriter } from "../whisper/progress.js";
import { failCommand, setCommandExitCode } from "../utils/commandResult.js";
import { defineCommand } from "../utils/defineCommand.js";
import type { Example } from "./_examples.js";
import * as clack from "../ui/prompts.js";
import { c } from "../ui/colors.js";
import { DEFAULT_MODEL } from "../whisper/manager.js";
import { trackTranscribeUnavailable } from "../telemetry/events.js";
import {
  MIN_TIMEOUT_MS,
  TranscribeError,
  runTranscribe,
  type CaptionFormat,
  type TranscribeEngineEvent,
  type TranscribeResult,
} from "../api/transcribe.js";
import { jsonFailure } from "../utils/jsonError.js";

export const examples: Example[] = [
  ["Transcribe an audio file", "hyperframes transcribe audio.mp3"],
  ["Transcribe a video file", "hyperframes transcribe video.mp4"],
  ["Use a larger model for better accuracy", "hyperframes transcribe audio.mp3 --model medium.en"],
  ["Set language to filter non-target speech", "hyperframes transcribe audio.mp3 --language en"],
  ["Import an existing SRT file", "hyperframes transcribe subtitles.srt"],
  ["Import an OpenAI Whisper JSON response", "hyperframes transcribe response.json"],
  ["Export captions to SRT", "hyperframes transcribe transcript.json --to srt"],
  ["Transcribe a video straight to VTT captions", "hyperframes transcribe video.mp4 --to vtt"],
  [
    "Export single-word/CJK captions without re-grouping",
    "hyperframes transcribe transcript.json --to vtt --preserve-cues",
  ],
];

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
    engine: {
      type: "string",
      description:
        "ASR engine: auto (Parakeet if installed and it covers --language, else whisper), parakeet, or whisper. Default: auto. Parakeet is more accurate and faster; install it with `hyperframes models install parakeet`.",
      alias: "e",
    },
    model: {
      type: "string",
      description: `Whisper model (default: ${DEFAULT_MODEL}). Options: tiny.en, base.en, small.en, medium.en, small, medium, large-v3`,
      alias: "m",
    },
    language: {
      type: "string",
      description:
        "Language code (e.g. en, es, ja). Whisper transcribes as this language; Parakeet, used when it covers it, detects the language itself.",
      alias: "l",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON; progress JSON lines go to stderr",
      default: false,
    },
    to: {
      type: "string",
      description:
        "Write an srt or vtt caption sidecar: exported from a transcript file, or written after transcribing audio/video",
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
    "runtime-install": {
      type: "boolean",
      default: true,
      description:
        "Allow installing the Whisper runtime. Use --no-runtime-install to require an existing runtime; model downloads remain allowed.",
    },
    optional: {
      type: "boolean",
      description:
        "Treat captions as optional: if whisper-cpp is unavailable, skip and exit 0 instead of failing. For pipelines that continue without captions.",
      default: false,
    },
    timeout: {
      type: "string",
      description:
        "Whisper spawn timeout in ms. Overrides the duration+model auto-scaled " +
        "default. Increase on slow CPUs (e.g. emulated arm64/x64, low-power " +
        "laptops) where whisper.cpp takes many seconds per audio second on " +
        "medium/large models. Applies to the whisper engine only; Parakeet has " +
        "a separate fixed timeout. Minimum 5000 (5 s). " +
        "Env: HYPERFRAMES_TRANSCRIBE_TIMEOUT_MS.",
    },
  },
  async run({ args }) {
    const { json } = args;
    const ui: { spin: Spinner | null } = { spin: null };
    let result: TranscribeResult;
    try {
      result = await runTranscribe({
        input: args.input,
        dir: args.dir,
        engine: args.engine,
        model: args.model,
        language: args.language,
        installRuntime: args["runtime-install"],
        timeoutMs: readTimeout(args.timeout)?.ms,
        captions: { format: args.to, outputPath: args.output, preserveCues: args["preserve-cues"] },
        stopOnProcessSignals: true,
        onStatus: json ? undefined : (message) => ui.spin?.message(message),
        onProgress: json ? createProgressWriter(process.stderr) : undefined,
        onEngine: (event) => {
          if (event.notice && !json) console.error(c.dim(`  Note: ${event.notice}`));
          ui.spin = showEngine(event, ui.spin, { json, model: args.model });
        },
      });
    } catch (err) {
      if (!(err instanceof TranscribeError)) throw err;
      if (isRunFailure(err)) {
        reportRunFailure(err, ui.spin, { json, optional: args.optional === true });
      } else {
        reportSetupFailure(err, json, args.timeout);
      }
      return;
    }
    reportResult(result, json, ui.spin);
  },
});

type Spinner = ReturnType<typeof clack.spinner>;

/**
 * The whisper timeout override from `--timeout <ms>` or the
 * `HYPERFRAMES_TRANSCRIBE_TIMEOUT_MS` env var. The flag wins over env. The
 * transcribe layer rejects a value that is not an integer >= MIN_TIMEOUT_MS, at
 * the point it would use it, so a bad value fails loud instead of silently
 * reverting to the auto-scaled default. Undefined when neither source is set:
 * the timeout then comes from audio duration and model factor.
 */
function readTimeout(
  raw: string | undefined,
): { ms: number; source: string; origin: string } | undefined {
  const source = raw ?? process.env["HYPERFRAMES_TRANSCRIBE_TIMEOUT_MS"];
  if (source == null || source === "") return undefined;
  const origin = raw != null ? "--timeout" : "HYPERFRAMES_TRANSCRIBE_TIMEOUT_MS";
  return { ms: Number.parseInt(source, 10), source, origin };
}

/** Starts the spinner for a runner, or, after a Parakeet failure, says which runner takes over. */
function showEngine(
  event: TranscribeEngineEvent,
  spin: Spinner | null,
  opts: { json: boolean; model?: string },
): Spinner | null {
  // The requested model, as the spinner has always shown it; event.model is the one whisper runs.
  const label = c.accent(event.runner === "whisper" ? (opts.model ?? DEFAULT_MODEL) : "Parakeet");
  if (event.fallbackReason !== undefined) {
    spin?.clear();
    console.error(c.warn(`${event.fallbackReason}. Using ${event.runner} for this run.`));
    spin?.start(`Transcribing with ${label}...`);
    return spin;
  }
  // --model selects the whisper model only; Parakeet uses its own fixed model.
  if (event.runner !== "whisper" && opts.model && !opts.json) {
    console.error(
      c.dim(`  Note: --model applies to the whisper engine only; ignored under Parakeet.`),
    );
  }
  const started = opts.json ? null : clack.spinner();
  started?.start(`Transcribing with ${label}...`);
  return started;
}

function failWith(message: string, json: boolean): never {
  if (json) {
    console.log(JSON.stringify(jsonFailure("runtime_error", message)));
  } else {
    console.error(c.error(message));
  }
  failCommand(1, message);
}

/** Failures once a runner has started, reported through its spinner. */
function isRunFailure(err: TranscribeError): boolean {
  if (err.code === "caption_write_failed") return err.transcriptPath !== undefined;
  return err.code === "cancelled" || err.code === "whisper_unavailable" || err.code === "failed";
}

function reportSetupFailure(err: TranscribeError, json: boolean, timeoutFlag?: string): never {
  if (err.code === "input_not_found") {
    console.error(c.error(err.message));
    failCommand(1, err.message);
  }
  // An unreadable transcript file keeps failing the way it always has: with the parser's own error.
  if (err.code === "invalid_transcript") throw err.cause;
  const timeout = err.code === "invalid_timeout" ? readTimeout(timeoutFlag) : undefined;
  if (timeout) {
    failWith(
      `Invalid ${timeout.origin}: "${timeout.source}". Must be an integer >= ${MIN_TIMEOUT_MS} (ms).`,
      json,
    );
  }
  failWith(err.message, json);
}

function reportRunFailure(
  err: TranscribeError,
  spin: Spinner | null,
  opts: { json: boolean; optional: boolean },
): void {
  if (err.code === "whisper_unavailable") return reportWhisperUnavailable(err, spin, opts);
  if (err.code === "cancelled" || err.code === "caption_write_failed") {
    if (opts.json) console.log(JSON.stringify(jsonFailure("runtime_error", err.message)));
    else spin?.stop(err.code === "cancelled" ? c.warn(err.message) : c.error(err.message));
    setCommandExitCode(err.code === "cancelled" ? 130 : 1);
    return;
  }
  if (opts.json) {
    console.log(JSON.stringify(jsonFailure("runtime_error", err.message)));
  } else {
    spin?.stop(c.error(`Transcription failed: ${err.message}`));
  }
  failCommand(1, err.cause);
}

// whisper-cpp is an optional prerequisite, not part of the CLI. When it is
// simply unavailable (no binary, no toolchain to build one), that is a setup
// condition, not a command crash — report it on its own metric so it does
// not inflate the cli_error budget, and let `--optional` callers continue.
function reportWhisperUnavailable(
  err: TranscribeError,
  spin: Spinner | null,
  opts: { json: boolean; optional: boolean },
): void {
  trackTranscribeUnavailable({ optional: opts.optional });
  const { install } = err;
  if (opts.json) {
    console.log(
      JSON.stringify({ ok: false, skipped: true, reason: "whisper_unavailable", install }),
    );
  } else {
    const orParakeet = install ? `\nOr transcribe with Parakeet after: ${install}` : "";
    spin?.stop(c.warn(`Captions skipped — ${err.message}${orParakeet}`));
  }
  // Optional callers (pipelines) treat a missing prerequisite as a clean
  // skip; explicit runs still surface non-zero. Set the status and return
  // rather than guarding a process.exit() on the flag.
  setCommandExitCode(opts.optional ? 0 : 1);
}

function reportSidecar(to: CaptionFormat, wordCount: number, outPath: string): void {
  console.log(
    `${c.success("◇")}  Exported ${c.accent(String(wordCount))} words to ${c.accent(to.toUpperCase())} → ${c.accent(outPath)}`,
  );
}

function reportResult(result: TranscribeResult, json: boolean, spin: Spinner | null): void {
  if (result.kind === "imported") {
    const { format, wordCount, transcriptPath } = result;
    if (json) {
      console.log(JSON.stringify({ ok: true, format, wordCount, transcriptPath }));
    } else {
      console.log(
        `${c.success("◇")}  Imported ${c.accent(String(wordCount))} words from ${c.accent(format)} format → ${c.accent("transcript.json")}`,
      );
    }
    return;
  }

  if (result.kind === "exported") {
    const { format, wordCount, outputPath } = result;
    if (json) console.log(JSON.stringify({ ok: true, format, wordCount, outputPath }));
    else reportSidecar(format, wordCount, outputPath);
    return;
  }

  const { captions } = result;
  if (json) {
    console.log(
      JSON.stringify({
        ok: true,
        engine: result.engine,
        model: result.model,
        detectedLanguage: result.detectedLanguage,
        wordCount: result.wordCount,
        durationSeconds: result.durationSeconds,
        speechOnsetSeconds: result.speechOnsetSeconds,
        transcriptPath: result.transcriptPath,
        ...captions,
      }),
    );
    return;
  }
  const onsetNote =
    result.speechOnsetSeconds != null
      ? ` — speech detected at ${result.speechOnsetSeconds.toFixed(1)}s`
      : "";
  spin?.stop(
    c.success(
      `Transcribed ${c.accent(String(result.wordCount))} words (${result.durationSeconds.toFixed(1)}s${onsetNote})`,
    ),
  );
  if (captions) reportSidecar(captions.format, result.wordCount, captions.outputPath);
}
