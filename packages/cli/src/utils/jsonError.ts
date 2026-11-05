import { format, stripVTControlCharacters } from "node:util";
import {
  CliRuntimeError,
  CliUsageError,
  failCommand,
  failUsage,
  type CommandResult,
} from "./commandResult.js";

export interface CliErrorBody {
  code: string;
  message: string;
  hint?: string;
}

export interface JsonFailure {
  ok: false;
  error: CliErrorBody;
}

/** The `--json` failure shape every command shares; spread it to add command-specific fields. */
export function jsonFailure(code: string, message: string, hint?: string): JsonFailure {
  return { ok: false, error: hint ? { code, message, hint } : { code, message } };
}

/** Reports a caught failure as the --json envelope or one stderr line; exit 2 if usage, else 1. */
export function failCaught(
  error: unknown,
  json: boolean,
  line: (message: string) => string,
  print: (payload: object) => void = (payload) => console.log(JSON.stringify(payload)),
): never {
  const message = failureMessage(error);
  const usage = error instanceof CliUsageError;
  if (json) print(jsonFailure(usage ? error.code : "runtime_error", message));
  else console.error(line(message));
  if (usage) failUsage();
  failCommand();
}

export function writeJsonFailure(body: CliErrorBody): void {
  process.stdout.write(`${JSON.stringify({ ok: false, error: body })}\n`);
}

/**
 * Records whether anything reached stdout and keeps what went to stderr, so a failed `--json`
 * run that printed nothing can still answer with an envelope that says why. Bun's console
 * writes past process.stdout.write, so the console methods are watched too.
 */
let reported: { message: string; hint?: string } | undefined;
let noticeDepth = 0;

/** The failure a command reported to the person (errorBox); the envelope's message when it has none. */
export function recordFailure(message: string, hint?: string): void {
  reported = { message, hint };
}

/** Writes a notice (telemetry disclosure, deprecation, progress) that is never an error message. */
export function asNotice(write: () => void): void {
  noticeDepth++;
  try {
    write();
  } finally {
    noticeDepth--;
  }
}

// What failCommand() and failUsage() throw once the command has already told the person why.
const GENERIC_MESSAGES = new Set(["Command failed", "Invalid command usage"]);

/** What went wrong: an error's own message, or for a generic one its cause or reported failure. */
export function failureMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (!GENERIC_MESSAGES.has(error.message)) return error.message;
  if (error.cause instanceof Error) return failureMessage(error.cause);
  return reported?.message ?? error.message;
}

export function watchOutput(): { wroteStdout: () => boolean; stderrText: () => string } {
  let wrote = false;
  let stderr = "";
  let inConsole = false;
  const keep = (text: string) => {
    if (noticeDepth === 0) stderr = (stderr + text).slice(-4000);
  };
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((...args: Parameters<typeof stdoutWrite>) => {
    wrote = true;
    return stdoutWrite(...args);
  }) as typeof process.stdout.write;
  process.stderr.write = ((...args: Parameters<typeof stderrWrite>) => {
    if (!inConsole)
      keep(args[0] instanceof Uint8Array ? Buffer.from(args[0]).toString() : String(args[0]));
    return stderrWrite(...args);
  }) as typeof process.stderr.write;
  for (const name of ["log", "info", "debug", "dir", "table"] as const) {
    const original = console[name].bind(console);
    console[name] = (...args: unknown[]) => {
      wrote = true;
      original(...args);
    };
  }
  for (const name of ["error", "warn"] as const) {
    const original = console[name].bind(console);
    console[name] = (...args: unknown[]) => {
      keep(`${format(...args)}\n`);
      inConsole = true;
      try {
        original(...args);
      } finally {
        inConsole = false;
      }
    };
  }
  return {
    wroteStdout: () => wrote,
    stderrText: () =>
      stripVTControlCharacters(stderr)
        .split("\n")
        .map((line) => line.replace(/^[\s✗│◇◆]+/u, "").trim())
        .filter(Boolean)
        .join(" ")
        .slice(-1000),
  };
}

function withHint(body: CliErrorBody, hint: string | undefined): CliErrorBody {
  return hint ? { ...body, hint: stripVTControlCharacters(hint) } : body;
}

function errorCode(error: unknown, result: CommandResult): string {
  if (error instanceof CliUsageError) return error.code;
  return result.kind === "usage_error" ? "usage_error" : "runtime_error";
}

/** The error's own words, unless they are the generic text a presented failure carries. */
function ownMessage(error: unknown): string | undefined {
  if (!(error instanceof Error) || GENERIC_MESSAGES.has(error.message)) return undefined;
  const typed = error instanceof CliUsageError || error instanceof CliRuntimeError;
  return typed || !("result" in error) ? stripVTControlCharacters(error.message) : undefined;
}

/** The envelope for a failed run: the error's own words, else what the command reported or printed. */
export function jsonErrorBody(
  error: unknown,
  result: CommandResult,
  stderrText: string,
): CliErrorBody {
  const code = errorCode(error, result);
  const own = ownMessage(error);
  if (own)
    return withHint(
      { code, message: own },
      error instanceof CliUsageError ? error.hint : undefined,
    );
  if (error instanceof Error && error.cause instanceof Error) {
    return { code, message: failureMessage(error.cause) };
  }
  if (reported)
    return withHint({ code, message: stripVTControlCharacters(reported.message) }, reported.hint);
  return { code, message: stderrText || "Command failed" };
}
