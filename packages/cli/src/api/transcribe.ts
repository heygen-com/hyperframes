import { existsSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import {
  createRenderCancellationScope,
  stoppedByCancelSignal,
} from "../utils/renderCancellation.js";
import { DEFAULT_MODEL, findWhisper, isWhisperUnavailable } from "../whisper/manager.js";
import { initialModelForLanguage } from "../whisper/modelForLanguage.js";
import {
  formatSrt,
  formatVtt,
  loadTranscript,
  patchCaptionHtml,
  type TranscriptFormat,
  type Word,
} from "../whisper/normalize.js";
import {
  PARAKEET_INSTALL_COMMAND,
  PARAKEET_LANGUAGES,
  parakeetSpeaks,
  transcribeWithParakeet,
} from "../whisper/parakeet.js";
import { parakeetRunner, type ParakeetRunner } from "../whisper/parakeetRunner.js";
import {
  DecodeCancelled,
  prepareSherpaWav,
  sherpaUnsupportedReason,
  transcribeWithSherpa,
} from "../whisper/sherpa.js";
import { TRANSCRIPT_FILE } from "../whisper/transcriptFile.js";
import {
  transcribe as transcribeWithWhisper,
  type TranscribeProgress,
} from "../whisper/transcribe.js";

// Smallest accepted whisper timeout. Below it the whisper spawn has no realistic chance of
// finishing even on the fastest hardware for the shortest clip.
export const MIN_TIMEOUT_MS = 5000;

export type TranscribeEngine = "auto" | "parakeet" | "whisper";
export type CaptionFormat = "srt" | "vtt";
/** The program that does the work: Parakeet runs on sherpa-onnx or parakeet-mlx. */
export type TranscribeRunner = ParakeetRunner | "whisper";
export type TranscribeProgressEvent = TranscribeProgress;
export type { TranscriptFormat };

export interface TranscribeCaptionsOptions {
  format: CaptionFormat;
  /** Default: `transcript.<format>` in `dir`. */
  outputPath?: string;
  /** Keep each transcript entry as its own cue instead of regrouping words. */
  preserveCues?: boolean;
}

export interface TranscribeEngineEvent {
  runner: TranscribeRunner;
  engine: "parakeet" | "whisper";
  /** The model whisper runs, after `language` picks the multilingual twin; whisper engine only. */
  model: string;
  /** Set when auto mode gave up on Parakeet and this runner takes over. */
  fallbackReason?: string;
  /** One line on why this runner was chosen over the one asked for. */
  notice?: string;
}

export interface TranscribeOptions {
  /** Audio or video to transcribe, or a transcript (.json, .srt, .vtt) to import or export. */
  input: string;
  /** Where transcript.json goes; caption scripts in this folder's .html files are patched. Default: the input's folder. */
  dir?: string;
  /** Default "auto": Parakeet when installed and it covers `language`, else whisper. */
  engine?: TranscribeEngine;
  /** Whisper model. Parakeet has its own fixed model. */
  model?: string;
  language?: string;
  /** Allow installing the whisper runtime. Model downloads are always allowed. */
  installRuntime?: boolean;
  /** Whisper spawn timeout, at least MIN_TIMEOUT_MS. Default: scaled to audio length and model. */
  timeoutMs?: number;
  /** Also write a caption file. With a transcript input, this is the only thing written. */
  captions?: TranscribeCaptionsOptions;
  /**
   * Aborting it stops the run with a "cancelled" TranscribeError, ending any install, download,
   * audio preparation or transcription at once. A tool lookup already running finishes first; each
   * is capped at 10 seconds.
   */
  signal?: AbortSignal;
  /** Downloads, transcription start and end, and words heard so far. */
  onProgress?: (event: TranscribeProgressEvent) => void;
  /** One-line status text, such as "Preparing audio...". */
  onStatus?: (message: string) => void;
  /** Called when a runner starts: once, and again if auto mode falls back from Parakeet. */
  onEngine?: (event: TranscribeEngineEvent) => void;
}

export type TranscribeResult =
  | {
      kind: "transcribed";
      engine: "parakeet" | "whisper";
      model: string;
      detectedLanguage: string | null;
      wordCount: number;
      durationSeconds: number;
      speechOnsetSeconds: number | null;
      transcriptPath: string;
      captions?: { format: CaptionFormat; outputPath: string };
    }
  | { kind: "imported"; format: TranscriptFormat; wordCount: number; transcriptPath: string }
  | { kind: "exported"; format: CaptionFormat; wordCount: number; outputPath: string };

export type TranscribeErrorCode =
  | "input_not_found"
  | "invalid_option"
  | "invalid_timeout"
  | "invalid_transcript"
  | "no_words"
  | "parakeet_unavailable"
  | "whisper_unavailable"
  | "caption_write_failed"
  | "cancelled"
  | "failed";

export class TranscribeError extends Error {
  readonly code: TranscribeErrorCode;
  /** whisper_unavailable: the command that installs Parakeet, when Parakeet would cover this run. */
  readonly install?: string;
  /** caption_write_failed after transcribing: the transcript, which was saved. */
  readonly transcriptPath?: string;

  constructor(
    code: TranscribeErrorCode,
    message: string,
    options: { cause?: unknown; install?: string; transcriptPath?: string } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TranscribeError";
    this.code = code;
    if (options.install !== undefined) this.install = options.install;
    if (options.transcriptPath !== undefined) this.transcriptPath = options.transcriptPath;
  }
}

/**
 * The CLI's form of TranscribeOptions: flag values arrive unchecked, and Ctrl-C stops the run
 * through process signal handlers instead of an AbortSignal.
 */
export type TranscribeRequest = Omit<TranscribeOptions, "engine" | "captions"> & {
  engine?: string;
  captions?: Omit<TranscribeCaptionsOptions, "format"> & { format?: string };
  stopOnProcessSignals?: boolean;
};

interface CaptionSidecar {
  to: CaptionFormat;
  outPath: string;
  preserveCues: boolean;
  /** Files the caption write must never replace: the input and the transcript. */
  keep: string[];
}

interface CancellationScope {
  signal: AbortSignal;
  dispose: () => void;
}

export async function runTranscribe(options: TranscribeRequest): Promise<TranscribeResult> {
  if (options.signal?.aborted) {
    throw new TranscribeError("cancelled", "Transcription cancelled", {
      cause: options.signal.reason,
    });
  }
  const inputPath = resolve(options.input);
  if (!existsSync(inputPath)) {
    throw new TranscribeError("input_not_found", `File not found: ${options.input}`);
  }

  // Default to the directory containing the input file so transcript.json
  // lands next to narration.wav regardless of where the command is run from.
  const dir = resolve(options.dir ?? dirname(inputPath));
  const ext = extname(inputPath).toLowerCase();
  const isImport = ext === ".json" || ext === ".srt" || ext === ".vtt";
  const sidecar = parseSidecar(options.captions, inputPath, dir);

  if (sidecar && isImport) return exportTranscript(inputPath, sidecar);
  if (isImport) return importTranscript(inputPath, dir);

  const { timeoutMs } = options;
  if (timeoutMs !== undefined && !(Number.isInteger(timeoutMs) && timeoutMs >= MIN_TIMEOUT_MS)) {
    throw new TranscribeError(
      "invalid_timeout",
      `Invalid timeoutMs: ${timeoutMs}. Must be an integer >= ${MIN_TIMEOUT_MS} (ms).`,
    );
  }
  return transcribeAudio(inputPath, dir, sidecar, options);
}

function parseExportFormat(value: string | undefined): CaptionFormat | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "srt" || normalized === "vtt") return normalized;
  throw new TranscribeError(
    "invalid_option",
    `Unsupported caption export format: ${value}. Use srt or vtt.`,
  );
}

function parseSidecar(
  captions: TranscribeRequest["captions"],
  inputPath: string,
  dir: string,
): CaptionSidecar | undefined {
  const to = parseExportFormat(captions?.format);
  if (!to) return undefined;
  const output = captions?.outputPath;
  const outPath = resolve(output ?? join(dir, `transcript.${to}`));
  const keep = [inputPath, join(dir, TRANSCRIPT_FILE)];
  const problem =
    (output !== undefined && outputProblem(output, outPath, to)) || overwriteProblem(outPath, keep);
  if (problem) throw new TranscribeError("invalid_option", problem);
  return { to, outPath, preserveCues: captions?.preserveCues === true, keep };
}

/** Why an explicit --output cannot be used, checked before any transcription work. */
function outputProblem(output: string, outPath: string, to: CaptionFormat): string | undefined {
  if (!output) return "--output needs a file path";
  const folder = dirname(outPath);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    return `Output folder not found: ${folder}`;
  }
  if (/[\\/]$/.test(output) || (existsSync(outPath) && statSync(outPath).isDirectory())) {
    return `--output is a folder; give a file path such as ${join(outPath, `transcript.${to}`)}`;
  }
  return undefined;
}

/** Early refusal before the engine runs; the same check at write time is the owner. */
function overwriteProblem(outPath: string, keep: string[]): string | undefined {
  const hit = keep.find((file) => sameFile(outPath, file));
  return hit && `The caption file would overwrite ${hit}; choose another file with --output`;
}

function sameFile(out: string, file: string): boolean {
  if (existsSync(out) && existsSync(file)) {
    const [a, b] = [statSync(out, { bigint: true }), statSync(file, { bigint: true })];
    if (a.ino !== 0n && b.ino !== 0n) return a.dev === b.dev && a.ino === b.ino;
    // Some network shares report inode 0, which proves nothing; let the OS resolve the paths.
    return realpathSync.native(out) === realpathSync.native(file);
  }
  // Letter case is ignored so a case-insensitive disk cannot alias.
  const realDir = (p: string) =>
    existsSync(dirname(p)) ? realpathSync.native(dirname(p)) : dirname(p);
  return (
    realDir(out) === realDir(file) && basename(out).toLowerCase() === basename(file).toLowerCase()
  );
}

// ---------------------------------------------------------------------------
// Import and export existing transcripts
// ---------------------------------------------------------------------------

function readTranscript(inputPath: string): { words: Word[]; format: TranscriptFormat } {
  let transcript: { words: Word[]; format: TranscriptFormat };
  try {
    transcript = loadTranscript(inputPath);
  } catch (err) {
    throw new TranscribeError("invalid_transcript", normalizeErrorMessage(err), { cause: err });
  }
  if (transcript.words.length === 0) {
    throw new TranscribeError("no_words", "No words found in transcript.");
  }
  return transcript;
}

function importTranscript(inputPath: string, dir: string): TranscribeResult {
  const { words, format } = readTranscript(inputPath);

  const transcriptPath = join(dir, TRANSCRIPT_FILE);
  writeFileSync(transcriptPath, JSON.stringify(words, null, 2));
  patchCaptionHtml(dir, words);
  return { kind: "imported", format, wordCount: words.length, transcriptPath };
}

function exportTranscript(inputPath: string, sidecar: CaptionSidecar): TranscribeResult {
  const { words, format } = readTranscript(inputPath);
  try {
    writeCaptionSidecar(words, sidecar, format === "srt" || format === "vtt" || undefined);
  } catch (err) {
    throw new TranscribeError(
      "caption_write_failed",
      `The caption file ${sidecar.outPath} could not be written: ${normalizeErrorMessage(err)}`,
      { cause: err },
    );
  }
  return {
    kind: "exported",
    format: sidecar.to,
    wordCount: words.length,
    outputPath: sidecar.outPath,
  };
}

function writeCaptionSidecar(
  words: Word[],
  { to, outPath, preserveCues, keep }: CaptionSidecar,
  phraseLevelSource: boolean | undefined,
): void {
  // Checked at write time, when the transcript exists, so the OS resolves every link and alias.
  const hit = keep.find((file) => sameFile(outPath, file));
  if (hit) throw new Error(`it is the same file as ${hit}`);
  // A .srt/.vtt source is already phrase-level; keep its cue boundaries 1:1.
  // preserveCues forces the same for an already-cued transcript.json whose
  // entries have no internal whitespace (single-word or CJK captions), which
  // the automatic whitespace heuristic in wordsToCues can't detect.
  const preGrouped = preserveCues || phraseLevelSource;
  const content =
    to === "srt" ? formatSrt(words, { preGrouped }) : formatVtt(words, { preGrouped });
  writeFileSync(outPath, content);
}

// ---------------------------------------------------------------------------
// Transcribe audio/video
// ---------------------------------------------------------------------------

/** auto and parakeet prefer sherpa-onnx, then parakeet-mlx, then whisper, in Parakeet's languages. */
function pickRunner(
  engine: string,
  parakeet: () => ParakeetRunner | null,
  language?: string,
  whisperForLanguage = false,
): TranscribeRunner {
  if (engine === "whisper" || whisperForLanguage || !parakeetSpeaks(language)) return "whisper";
  return parakeet() ?? "whisper";
}

/** Parakeet picks its own language, so a non-English --language goes to an installed whisper. */
function needsWhisperForLanguage(engine: string, language?: string): boolean {
  const base = language?.trim().toLowerCase().split(/[-_]/, 1)[0];
  if (engine === "whisper" || !base || base === "en" || !parakeetSpeaks(language)) return false;
  return findWhisper() !== undefined;
}

/** When Parakeet fails, only auto falls back; an explicit parakeet engine fails with the error. */
const parakeetFallsBack = (engine: string) => engine === "auto";

/** `.replace(/\.+$/, "")` in linear time; that regex is quadratic on a long run of dots. */
function withoutTrailingDots(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === ".") end--;
  return text.slice(0, end);
}

const engineOf = (runner: TranscribeRunner) => (runner === "whisper" ? "whisper" : "parakeet");

/** The ASR subprocess's last stderr lines, which execFileSync captures but otherwise drops. */
function failureMessage(err: unknown): string {
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
  return stderr ? `${base}\n${stderr}` : base;
}

// fallow-ignore-next-line complexity
async function transcribeAudio(
  inputPath: string,
  dir: string,
  sidecar: CaptionSidecar | undefined,
  options: TranscribeRequest,
): Promise<TranscribeResult> {
  const engine = (options.engine ?? "auto").toLowerCase();
  if (engine !== "auto" && engine !== "parakeet" && engine !== "whisper") {
    throw new TranscribeError(
      "invalid_option",
      `Unknown --engine: ${options.engine}. Use auto, parakeet, or whisper.`,
    );
  }
  const unsupported = sherpaUnsupportedReason();
  const whisperForLanguage = needsWhisperForLanguage(engine, options.language);
  let runner = pickRunner(
    engine,
    () => parakeetRunner({ unsupported }),
    options.language,
    whisperForLanguage,
  );
  if (engine === "parakeet" && runner === "whisper" && !whisperForLanguage) {
    throw new TranscribeError(
      "parakeet_unavailable",
      !parakeetSpeaks(options.language)
        ? `Parakeet does not transcribe --language ${options.language}; it covers ${PARAKEET_LANGUAGES.split(" ").join(", ")}. Use --engine whisper.`
        : (unsupported ??
            `Parakeet is not installed. Install it with: ${PARAKEET_INSTALL_COMMAND} (or use --engine whisper)`),
    );
  }

  const model = options.model ?? DEFAULT_MODEL;
  const whisperModel = initialModelForLanguage(model, options.language);
  options.onEngine?.({
    runner,
    engine: engineOf(runner),
    model: whisperModel,
    ...(whisperForLanguage && {
      notice: `Parakeet chooses its own language, so whisper transcribes --language ${options.language}.`,
    }),
  });
  const { onStatus, onProgress } = options;
  const startScope = (): CancellationScope =>
    options.stopOnProcessSignals
      ? createRenderCancellationScope()
      : { signal: options.signal ?? new AbortController().signal, dispose: () => {} };
  let wavPath = inputPath;
  // Before audio prep: under --json no spinner listens for SIGINT, so Ctrl-C would kill Node.
  // A caller's own signal is live from the start, whichever runner it ends up stopping.
  let cancellation = runner === "sherpa" || !options.stopOnProcessSignals ? startScope() : null;
  // The CLI's own handlers stop it; its setup, audio prep and parakeet-mlx stay synchronous.
  const librarySignal = options.stopOnProcessSignals ? undefined : cancellation?.signal;
  const run = (r: TranscribeRunner) => {
    switch (r) {
      case "sherpa":
        return transcribeWithSherpa(wavPath, dir, {
          onProgress: onStatus,
          onEvent: onProgress,
          signal: cancellation!.signal,
        });
      case "parakeet-mlx":
        return transcribeWithParakeet(wavPath, dir, {
          onProgress: onStatus,
          onEvent: onProgress,
          signal: librarySignal,
        });
      case "whisper":
        return transcribeWithWhisper(wavPath, dir, {
          model,
          language: options.language,
          onProgress: onStatus,
          onEvent: onProgress,
          timeoutMs: options.timeoutMs,
          installRuntime: options.installRuntime,
          signal: librarySignal,
          startCancellation: () => (cancellation ??= startScope()).signal,
        });
      default: {
        const unreachable: never = r;
        throw new Error(`Unknown transcription runner: ${unreachable}`);
      }
    }
  };

  try {
    // Outside the fallback: an unreadable input is not a Parakeet failure. The fallback reuses it.
    if (runner === "sherpa") {
      wavPath = await prepareSherpaWav(inputPath, onStatus, librarySignal);
    }
    let result: Awaited<ReturnType<typeof run>>;
    try {
      result = await run(runner);
    } catch (err) {
      if (runner !== "sherpa" || err instanceof DecodeCancelled) throw err;
      const reason = withoutTrailingDots(normalizeErrorMessage(err));
      const parakeetError = `Parakeet failed: ${reason}. To repair it, run: ${PARAKEET_INSTALL_COMMAND}`;
      if (!parakeetFallsBack(engine)) throw new Error(parakeetError);
      runner = pickRunner(
        engine,
        () => parakeetRunner({ unsupported, skipSherpa: true }),
        options.language,
      );
      options.onEngine?.({
        runner,
        engine: engineOf(runner),
        model: whisperModel,
        fallbackReason: parakeetError,
      });
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
    if (sidecar) {
      try {
        writeCaptionSidecar(words, sidecar, false);
      } catch (err) {
        throw new TranscribeError(
          "caption_write_failed",
          `Transcript saved to ${result.transcriptPath}, but the caption file ${sidecar.outPath} could not be written: ${normalizeErrorMessage(err)}`,
          { cause: err, transcriptPath: result.transcriptPath },
        );
      }
    }

    return {
      kind: "transcribed",
      engine: engineOf(runner),
      model: result.model,
      detectedLanguage: result.detectedLanguage,
      wordCount: words.length,
      durationSeconds: result.durationSeconds,
      speechOnsetSeconds: result.speechOnsetSeconds,
      transcriptPath: result.transcriptPath,
      ...(sidecar && { captions: { format: sidecar.to, outputPath: sidecar.outPath } }),
    };
  } catch (err) {
    if (err instanceof TranscribeError) throw err;
    if (err instanceof DecodeCancelled || cancellation?.signal.aborted) {
      throw new TranscribeError("cancelled", "Transcription cancelled", { cause: err });
    }
    const message = failureMessage(err);
    // whisper-cpp is an optional prerequisite, not part of the CLI. When it is simply
    // unavailable (no binary, no toolchain to build one), that is a setup condition.
    if (isWhisperUnavailable(err)) {
      const install =
        engine === "auto" && parakeetSpeaks(options.language) && !unsupported
          ? PARAKEET_INSTALL_COMMAND
          : undefined;
      throw new TranscribeError("whisper_unavailable", message, { cause: err, install });
    }
    throw new TranscribeError("failed", message, { cause: err });
  } finally {
    cancellation?.dispose();
    if (wavPath !== inputPath) rmSync(wavPath, { force: true });
  }
}
