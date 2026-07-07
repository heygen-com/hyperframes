/**
 * Pure parsers for `hyperframes render` argv that aren't already shared
 * (fps, quality, format, variables live elsewhere). Lives separately so
 * the validation branches are unit-testable without `process.exit` — the
 * side-effecting wrappers (`resolve*`) own the `errorBox + exit(1)` UI.
 *
 * Issue #1199 motivated the extraction: the original inline validators
 * in `render.ts` were untestable and re-introduced the EISDIR / silent
 * `timeout: 0` footguns at the rate of "one per missing branch".
 */

import { readFileSync, type Stats } from "node:fs";
import { resolve, sep } from "node:path";
import { parseFps } from "@hyperframes/core";
import { errorBox } from "../ui/format.js";
import { readCompositionFps } from "./compositionFps.js";

// ── --browser-timeout ──────────────────────────────────────────────────

/**
 * Lower bound on `pageNavigationTimeout` after the seconds→ms multiply.
 * Puppeteer treats `page.goto({ timeout: 0 })` as "no timeout / wait
 * forever", so a positive-looking input like `--browser-timeout 0.0004`
 * (rounds to 0 ms) must NOT silently flip the semantics. 1 ms is the
 * smallest value that survives `Math.round` without becoming the
 * disabled sentinel.
 */
const MIN_PAGE_NAVIGATION_TIMEOUT_MS = 1;

/**
 * Upper bound on `--browser-timeout` in seconds. Above ~24 days Node's
 * `setTimeout` overflows TIMEOUT_MAX (`2^31 - 1` ms ≈ 24.8 days) and
 * fires immediately, which is the opposite of "long timeout." Cap at
 * 24h so a typo (`1e10` for `1e1`) errors out instead of silently
 * disabling the budget.
 */
export const MAX_PAGE_NAVIGATION_TIMEOUT_SECONDS = 86_400;

export type BrowserTimeoutParseError =
  | { kind: "not-a-number"; raw: string }
  | { kind: "not-positive"; raw: string }
  | { kind: "too-small"; raw: string }
  | { kind: "too-large"; raw: string };

export type BrowserTimeoutParseResult =
  | { ok: true; value: number | undefined }
  | { ok: false; error: BrowserTimeoutParseError };

/**
 * Parse and validate `--browser-timeout <seconds>` into milliseconds.
 * Returns `{ ok: true, value: undefined }` when the flag is absent so
 * callers can spread the result without clobbering the engine default.
 */
export function parseBrowserTimeoutMsArg(raw: string | undefined): BrowserTimeoutParseResult {
  if (raw == null) return { ok: true, value: undefined };
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: { kind: "not-a-number", raw } };
  }
  if (parsed <= 0) {
    return { ok: false, error: { kind: "not-positive", raw } };
  }
  if (parsed > MAX_PAGE_NAVIGATION_TIMEOUT_SECONDS) {
    return { ok: false, error: { kind: "too-large", raw } };
  }
  const ms = Math.round(parsed * 1000);
  if (ms < MIN_PAGE_NAVIGATION_TIMEOUT_MS) {
    // Sub-millisecond inputs (e.g. 0.0004 s) round to 0 ms, which
    // Puppeteer treats as "no timeout" — the opposite of the user's
    // intent. Reject explicitly.
    return { ok: false, error: { kind: "too-small", raw } };
  }
  return { ok: true, value: ms };
}

function browserTimeoutErrorMessage(error: BrowserTimeoutParseError): {
  title: string;
  message: string;
  hint?: string;
} {
  const title = "Invalid browser-timeout";
  switch (error.kind) {
    case "not-a-number":
      return {
        title,
        message: `Got "${error.raw}", which is not a number. Pass a positive number of seconds (e.g. 180).`,
      };
    case "not-positive":
      return {
        title,
        message: `Got "${error.raw}" seconds, which is not positive. Pass a positive number of seconds (e.g. 180).`,
      };
    case "too-small":
      return {
        title,
        message: `Got "${error.raw}" seconds, which rounds to 0 ms. Puppeteer treats 0 as 'no timeout' — pass a value that rounds to at least 1 ms.`,
      };
    case "too-large":
      return {
        title,
        message: `Got "${error.raw}" seconds, which exceeds the ${MAX_PAGE_NAVIGATION_TIMEOUT_SECONDS}s (24h) cap. Node's setTimeout overflows for larger values.`,
      };
  }
}

/**
 * Side-effecting wrapper around `parseBrowserTimeoutMsArg`. Exits the
 * process with a friendly error box on validation failure.
 */
export function resolveBrowserTimeoutMsArg(raw: string | undefined): number | undefined {
  const result = parseBrowserTimeoutMsArg(raw);
  if (!result.ok) {
    const { title, message, hint } = browserTimeoutErrorMessage(result.error);
    errorBox(title, message, hint);
    process.exit(1);
  }
  return result.value;
}

// ── --composition ──────────────────────────────────────────────────────

export type CompositionEntryParseError =
  | { kind: "outside-project"; entryFile: string }
  | { kind: "not-found"; entryFile: string }
  | { kind: "not-a-file"; entryFile: string };

export type CompositionEntryParseResult =
  | { ok: true; value: string | undefined }
  | { ok: false; error: CompositionEntryParseError };

/**
 * Parse and validate `--composition <path>` into a project-relative
 * entry file (or `undefined` for the index.html default).
 *
 *   - `undefined` / `""` / `"."` / `"./"` → undefined (defaults to
 *     index.html). Issue #1199: the prior code threaded `.` straight
 *     through and the producer's `readFileSync` blew up with
 *     `EISDIR: illegal operation on a directory, read`.
 *   - Other strings are resolved against `projectDir`, checked for
 *     containment, existence, and isFile() via the injected `stat`
 *     adapter. The adapter shape lets unit tests inject fixtures
 *     without touching the filesystem.
 */
export function parseCompositionEntryArg(
  raw: string | undefined,
  projectDir: string,
  stat: (path: string) => Stats,
): CompositionEntryParseResult {
  const trimmed = raw?.trim().replace(/^\.\//, "") || undefined;
  // Normalize the project-root shorthands to "no entry override" so the
  // producer falls back to index.html instead of statSync-ing the dir
  // and later blowing up with EISDIR inside readFileSync().
  if (!trimmed || trimmed === ".") return { ok: true, value: undefined };

  const absProjectDir = resolve(projectDir);
  const entryPath = resolve(absProjectDir, trimmed);
  // Trailing-separator guard: `startsWith` alone treats `/proj` as a
  // prefix of `/proj-evil`, letting a sibling-directory escape through.
  // Allow the resolved path to BE the project dir (already covered by
  // the trimmed === "." branch above) or to live beneath it with a
  // path separator.
  if (entryPath !== absProjectDir && !entryPath.startsWith(absProjectDir + sep)) {
    return { ok: false, error: { kind: "outside-project", entryFile: trimmed } };
  }

  let entryStat: Stats;
  try {
    entryStat = stat(entryPath);
  } catch {
    return { ok: false, error: { kind: "not-found", entryFile: trimmed } };
  }
  if (!entryStat.isFile()) {
    // Directory paths slip past existsSync downstream and explode with
    // `EISDIR: illegal operation on a directory, read` inside the
    // producer's readFileSync. Reject here with an actionable message.
    return { ok: false, error: { kind: "not-a-file", entryFile: trimmed } };
  }
  return { ok: true, value: trimmed };
}

function compositionEntryErrorMessage(error: CompositionEntryParseError): {
  title: string;
  message: string;
  hint?: string;
} {
  switch (error.kind) {
    case "outside-project":
      return {
        title: "Invalid composition path",
        message: `Entry file must stay inside the project directory: ${error.entryFile}`,
      };
    case "not-found":
      return {
        title: "Composition not found",
        message: `"${error.entryFile}" does not exist in the project directory.`,
        hint: "Pass a path to a .html file relative to the project root (e.g. compositions/intro.html).",
      };
    case "not-a-file":
      return {
        title: "Invalid composition path",
        message: `"${error.entryFile}" is a directory, not an .html file.`,
        hint: "Pass a path to a .html file (e.g. compositions/intro.html), or omit --composition to render index.html.",
      };
  }
}

/**
 * Side-effecting wrapper around `parseCompositionEntryArg`. Exits the
 * process with a friendly error box on validation failure.
 */
export function resolveCompositionEntryArg(
  raw: string | undefined,
  projectDir: string,
  stat: (path: string) => Stats,
): string | undefined {
  const result = parseCompositionEntryArg(raw, projectDir, stat);
  if (!result.ok) {
    const { title, message, hint } = compositionEntryErrorMessage(result.error);
    errorBox(title, message, hint);
    process.exit(1);
  }
  return result.value;
}

// ── default fps ────────────────────────────────────────────────────────

/**
 * Resolve the fps argument that local `render` should parse: explicit --fps,
 * else the actual composition entry file's root data-fps when valid, else
 * undefined so the caller can apply its final "30" default.
 */
export function resolveDefaultFpsArg(
  explicitFps: string | undefined,
  projectDir: string,
  indexPath: string,
  entryFile: string | undefined,
): string | undefined {
  if (explicitFps != null) return explicitFps;
  try {
    const fpsSourcePath = entryFile ? resolve(projectDir, entryFile) : indexPath;
    const declared = readCompositionFps(readFileSync(fpsSourcePath, "utf8"));
    if (declared != null && parseFps(declared).ok) {
      return declared;
    }
  } catch {
    // Unreadable composition file — fall back to the default fps in render.ts.
  }
  return undefined;
}

export type GifLoopParseResult =
  | { ok: true; value: number | undefined }
  | { ok: false; message: string };

/**
 * Parse and validate `--gif-loop <count>` (GIF Netscape loop count).
 * Returns `{ ok: true, value: undefined }` when the flag is absent so the
 * caller can apply the format-dependent default (0 = infinite for gif).
 */
export function parseGifLoopArg(raw: string | undefined): GifLoopParseResult {
  if (raw === undefined) return { ok: true, value: undefined };
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "GIF loop count must not be empty." };
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    return {
      ok: false,
      message: `Got "${raw}". GIF loop count must be an integer between 0 and 65535.`,
    };
  }
  return { ok: true, value: parsed };
}
