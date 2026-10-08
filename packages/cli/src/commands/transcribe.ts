import { createProgressWriter } from "../whisper/progress.js";
import { requestedLanguage } from "../whisper/language.js";
import { failCommand, setCommandExitCode } from "../utils/commandResult.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
// fallow-ignore-file code-duplication
import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import {
  findParakeet,
  PARAKEET_LANGUAGES,
  parakeetSpeaks,
  transcribeWithParakeet,
} from "../whisper/parakeet.js";

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

// Minimum accepted value for `--timeout` / `HYPERFRAMES_TRANSCRIBE_TIMEOUT_MS`.
// Kept out of `whisper/transcribe.ts` (avoids a top-level import into this
// command module) so the CLI test file can hoist its
// `vi.mock("../whisper/transcribe.js")` factory without the mocked module
// entering the sync-import graph. Below this floor the whisper spawn has no
// realistic chance of completing even on the fastest hardware for the shortest clip.
const CLI_TIMEOUT_MIN_MS = 5000;
import { trackTranscribeUnavailable } from "../telemetry/events.js";

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
      description: `Whisper model (default: ${DEFAULT_MODEL}). Options: tiny, base, small, medium (add .en for English only), large-v3`,
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
    const inputPath = resolve(args.input);
    if (!existsSync(inputPath)) {
      const message = `File not found: ${args.input}`;
      console.error(c.error(message));
      failCommand(1, message);
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

    // ── Transcribe mode: run the ASR engine ──────────────────────────────
    const timeoutMs = parseTimeoutMs(args.timeout, args.json);

    return transcribeAudio(inputPath, dir, {
      engine: args.engine,
      model: args.model,
      language: args.language,
      json: args.json,
      optional: args.optional,
      installRuntime: args["runtime-install"],
      timeoutMs,
    });
  },
});

/**
 * Resolve the whisper timeout override from `--timeout <ms>` or the
 * `HYPERFRAMES_TRANSCRIBE_TIMEOUT_MS` env var. The flag wins over env; both
 * paths share the same integer + minimum-5000ms validation so a bad value
 * fails loud instead of silently reverting to the auto-scaled default.
 * Returns `undefined` when neither source is set — the transcribe layer then
 * derives the timeout from audio duration and model factor.
 */
function parseTimeoutMs(raw: string | undefined, json: boolean): number | undefined {
  const source = raw ?? process.env["HYPERFRAMES_TRANSCRIBE_TIMEOUT_MS"];
  if (source == null || source === "") return undefined;

  const parsed = Number.parseInt(source, 10);
  if (!Number.isFinite(parsed) || parsed < CLI_TIMEOUT_MIN_MS) {
    const origin = raw != null ? "--timeout" : "HYPERFRAMES_TRANSCRIBE_TIMEOUT_MS";
    failWith(
      `Invalid ${origin}: "${source}". Must be an integer >= ${CLI_TIMEOUT_MIN_MS} (ms).`,
      json,
    );
  }
  return parsed;
}

function failWith(message: string, json: boolean): never {
  if (json) {
    console.log(JSON.stringify({ ok: false, error: message }));
  } else {
    console.error(c.error(message));
  }
  failCommand(1, message);
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

type Runner = "sherpa" | "parakeet-mlx" | "whisper";

const PARAKEET_INSTALL_COMMAND = "hyperframes models install parakeet";

/** auto and parakeet prefer sherpa-onnx, then parakeet-mlx, then whisper, in Parakeet's languages. */
function pickRunner(engine: string, sherpaUsable: () => boolean, language?: string): Runner {
  if (engine === "whisper" || !parakeetSpeaks(language)) return "whisper";
  if (sherpaUsable()) return "sherpa";
  return findParakeet() ? "parakeet-mlx" : "whisper";
}

/** When Parakeet fails, only auto falls back; an explicit --engine parakeet fails with the error. */
const parakeetFallsBack = (engine: string) => engine === "auto";

// fallow-ignore-next-line complexity
async function transcribeAudio(
  inputPath: string,
  dir: string,
  opts: {
    engine?: string;
    model?: string;
    language?: string;
    json?: boolean;
    optional?: boolean;
    installRuntime?: boolean;
    timeoutMs?: number;
  },
): Promise<void> {
  const { transcribe } = await import("../whisper/transcribe.js");
  const { loadTranscript, patchCaptionHtml } = await import("../whisper/normalize.js");

  const {
    DecodeCancelled,
    prepareSherpaWav,
    sherpaParakeetInstalled,
    sherpaUnsupportedReason,
    transcribeWithSherpa,
  } = await import("../whisper/sherpa.js");
  const { createRenderCancellationScope, stoppedByCancelSignal } =
    await import("../utils/renderCancellation.js");

  const routingLanguage = requestedLanguage(opts.language);
  const engine = (opts.engine ?? "auto").toLowerCase();
  if (engine !== "auto" && engine !== "parakeet" && engine !== "whisper") {
    failWith(`Unknown --engine: ${opts.engine}. Use auto, parakeet, or whisper.`, !!opts.json);
  }
  const unsupported = sherpaUnsupportedReason();
  const sherpaUsable = () => !unsupported && sherpaParakeetInstalled();
  let runner = pickRunner(engine, sherpaUsable, routingLanguage);
  if (engine === "parakeet" && runner === "whisper") {
    failWith(
      !parakeetSpeaks(routingLanguage)
        ? `Parakeet does not transcribe --language ${opts.language}; it covers ${PARAKEET_LANGUAGES.split(" ").join(", ")}. Use --engine whisper.`
        : (unsupported ??
            `Parakeet is not installed. Install it with: ${PARAKEET_INSTALL_COMMAND} (or use --engine whisper)`),
      !!opts.json,
    );
  }

  const model = opts.model ?? DEFAULT_MODEL;
  // --model selects the whisper model only; Parakeet uses its own fixed model.
  if (runner !== "whisper" && opts.model && !opts.json) {
    console.error(
      c.dim(`  Note: --model applies to the whisper engine only; ignored under Parakeet.`),
    );
  }
  const label = (r: Runner) => c.accent(r === "whisper" ? model : "Parakeet");
  const spin = opts.json ? null : clack.spinner();
  spin?.start(`Transcribing with ${label(runner)}...`);
  const onProgress = spin ? (msg: string) => spin.message(msg) : undefined;
  const onEvent = opts.json ? createProgressWriter(process.stderr) : undefined;
  let wavPath = inputPath;
  // Before audio prep: under --json no spinner listens for SIGINT, so Ctrl-C would kill Node.
  let cancellation = runner === "sherpa" ? createRenderCancellationScope() : null;
  const run = (r: Runner) => {
    switch (r) {
      case "sherpa":
        return transcribeWithSherpa(wavPath, dir, {
          onProgress,
          onEvent,
          signal: cancellation!.signal,
        });
      case "parakeet-mlx":
        return transcribeWithParakeet(wavPath, dir, {
          onProgress,
          onEvent,
        });
      case "whisper":
        return transcribe(wavPath, dir, {
          model,
          language: opts.language,
          onProgress,
          onEvent,
          timeoutMs: opts.timeoutMs,
          installRuntime: opts.installRuntime,
          startCancellation: () => (cancellation ??= createRenderCancellationScope()).signal,
        });
      default: {
        const unreachable: never = r;
        throw new Error(`Unknown transcription runner: ${unreachable}`);
      }
    }
  };

  try {
    // Outside the fallback: an unreadable input is not a Parakeet failure. The fallback reuses it.
    if (runner === "sherpa") wavPath = prepareSherpaWav(inputPath, onProgress);
    let result: Awaited<ReturnType<typeof run>>;
    try {
      result = await run(runner);
    } catch (err) {
      if (runner !== "sherpa" || err instanceof DecodeCancelled) throw err;
      const reason = normalizeErrorMessage(err).replace(/\.+$/, "");
      const parakeetError = `Parakeet failed: ${reason}. To repair it, run: ${PARAKEET_INSTALL_COMMAND}`;
      if (!parakeetFallsBack(engine)) throw new Error(parakeetError);
      runner = pickRunner(engine, () => false, routingLanguage);
      spin?.clear();
      console.error(c.warn(`${parakeetError}. Using ${runner} for this run.`));
      spin?.start(`Transcribing with ${label(runner)}...`);
      try {
        result = await run(runner);
      } catch (fallbackErr) {
        // Ctrl-C reaches whisper too, so it can stop on its own signal before the scope aborts it.
        if (stoppedByCancelSignal(fallbackErr as { signal?: string })) {
          throw new DecodeCancelled("Transcription cancelled");
        }
        const why = normalizeErrorMessage(fallbackErr);
        throw new Error(`${parakeetError}. The ${runner} fallback failed too: ${why}`);
      }
    }

    const { words } = loadTranscript(result.transcriptPath);

    writeFileSync(result.transcriptPath, JSON.stringify(words, null, 2));
    patchCaptionHtml(dir, words);

    if (opts.json) {
      console.log(
        JSON.stringify({
          ok: true,
          engine: runner === "whisper" ? "whisper" : "parakeet",
          model: result.model,
          detectedLanguage: result.detectedLanguage,
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
    if (err instanceof DecodeCancelled || cancellation?.signal.aborted) {
      const message = "Transcription cancelled";
      if (opts.json) console.log(JSON.stringify({ ok: false, error: message }));
      else spin?.stop(c.warn(message));
      setCommandExitCode(130);
      return;
    }
    // Surface the last few lines of the ASR subprocess's stderr, which
    // execFileSync captures but otherwise drops on the floor — that's where
    // parakeet-mlx / whisper report the actual failure cause.
    const base = err instanceof Error ? err.message : String(err);
    const stderr =
      err && typeof err === "object" && "stderr" in err && err.stderr
        ? String(err.stderr)
            .trim()
            .split("\n")
            .slice(-3)
            .filter((line) => !base.includes(line))
            .join("\n")
        : "";
    const message = stderr ? `${base}\n${stderr}` : base;

    // whisper-cpp is an optional prerequisite, not part of the CLI. When it is
    // simply unavailable (no binary, no toolchain to build one), that is a setup
    // condition, not a command crash — report it on its own metric so it does
    // not inflate the cli_error budget, and let `--optional` callers continue.
    if (isWhisperUnavailable(err)) {
      trackTranscribeUnavailable({ optional: opts.optional === true });
      const install =
        engine === "auto" && parakeetSpeaks(routingLanguage) && !unsupported
          ? PARAKEET_INSTALL_COMMAND
          : undefined;
      if (opts.json) {
        console.log(
          JSON.stringify({ ok: false, skipped: true, reason: "whisper_unavailable", install }),
        );
      } else {
        const orParakeet = install ? `\nOr transcribe with Parakeet after: ${install}` : "";
        spin?.stop(c.warn(`Captions skipped — ${message}${orParakeet}`));
      }
      // Optional callers (pipelines) treat a missing prerequisite as a clean
      // skip; explicit runs still surface non-zero. Set the status and return
      // rather than guarding a process.exit() on the flag.
      setCommandExitCode(opts.optional ? 0 : 1);
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: message }));
    } else {
      spin?.stop(c.error(`Transcription failed: ${message}`));
    }
    failCommand(1, err);
  } finally {
    cancellation?.dispose();
    if (wavPath !== inputPath) rmSync(wavPath, { force: true });
  }
}
