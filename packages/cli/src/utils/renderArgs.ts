import { failUsage } from "./commandResult.js";
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
    failUsage();
  }
  return result.value;
}

/**
 * Navigation budget shared by snapshot/check/inspect browser diagnostics.
 *
 * The environment variable remains the historical global override. Callers
 * with their own timeout knob can supply a minimum without shortening that
 * override or the existing 10-second default.
 */
export function resolveDiagnosticNavigationTimeoutMs(
  env: Record<string, string | undefined> = process.env,
  minimumTimeoutMs = 0,
): number {
  const parsed = Number(env.PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS);
  const configured = Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
  return Math.max(configured, minimumTimeoutMs);
}

// ── --composition ──────────────────────────────────────────────────────

export type CompositionEntryParseError =
  | { kind: "outside-project"; entryFile: string }
  | { kind: "not-found"; entryFile: string }
  | { kind: "not-a-file"; entryFile: string };

export type CompositionEntryParseResult =
  | { ok: true; value: string | undefined }
  | { ok: false; error: CompositionEntryParseError };

function normalizeCompositionEntryArg(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim().replace(/^\.\//, "") || undefined;
  return !trimmed || trimmed === "." ? undefined : trimmed;
}

export function hasExplicitCompositionArg(raw: string | undefined): boolean {
  return normalizeCompositionEntryArg(raw) !== undefined;
}

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
  const trimmed = normalizeCompositionEntryArg(raw);
  // Normalize the project-root shorthands to "no entry override" so the
  // producer falls back to index.html instead of statSync-ing the dir
  // and later blowing up with EISDIR inside readFileSync().
  if (!trimmed) return { ok: true, value: undefined };

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
    failUsage();
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

export type HlsSegmentSecondsParseResult =
  | { ok: true; value: number | undefined }
  | { ok: false; message: string };

const MAX_HLS_SEGMENT_SECONDS = 60;

/**
 * Parse and validate `--hls-segment-seconds <n>` (HLS target segment length).
 * Whole seconds only: the value becomes ffmpeg's `-hls_time`, which writes an
 * integer `#EXT-X-TARGETDURATION`. Returns `{ ok: true, value: undefined }`
 * when the flag is absent so the caller can apply the format-dependent default.
 */
export function parseHlsSegmentSecondsArg(raw: string | undefined): HlsSegmentSecondsParseResult {
  if (raw === undefined) return { ok: true, value: undefined };
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "HLS segment length must not be empty." };
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_HLS_SEGMENT_SECONDS) {
    return {
      ok: false,
      message: `Got "${raw}". HLS segment length must be a whole number of seconds between 1 and ${MAX_HLS_SEGMENT_SECONDS}.`,
    };
  }
  return { ok: true, value: parsed };
}

// ── --motion-blur ──────────────────────────────────────────────────────

/**
 * Value accepted by `--motion-blur`: `angle`, `angle:phase`, or
 * `angle:phase:samples`. The flag may also be given bare (or as `=`), which
 * asks for the engine's own defaults.
 *
 * The micro-syntax mirrors the engine's own `MotionBlurOptions` field names in
 * the order it declares them, so `180:-90:16` reads as shutter angle, shutter
 * phase, samples per frame with nothing to look up. A bare value is the whole
 * point of the flag: `--motion-blur` on a comp whose export already carries AE's
 * shutter must not require the caller to restate 180:-90.
 */
export interface MotionBlurArgOptions {
  shutterAngle?: number;
  shutterPhase?: number;
  samplesPerFrame?: number;
  /** Working space for the average; the engine reads anything but "linear" as sRGB. */
  blend?: "srgb" | "linear";
}

export type MotionBlurArgParseResult =
  | { ok: true; value: MotionBlurArgOptions | undefined }
  | { ok: false; message: string };

/**
 * The documented spelling: positional, in the order the fields are declared in
 * `MotionBlurOptions`. Only the Docker hop uses the named form below.
 */
const MOTION_BLUR_USAGE = "angle[:phase[:samples]] (e.g. 180:-90:16, or bare --motion-blur)";

/** Named fields the `key=value` form accepts, mapped to their `MotionBlurOptions` keys. */
const MOTION_BLUR_NAMED_FIELDS = {
  angle: "shutterAngle",
  phase: "shutterPhase",
  samples: "samplesPerFrame",
  blend: "blend",
} as const;

/** The three numeric fields, i.e. every named field except `blend`. */
type MotionBlurNumberField = Exclude<
  (typeof MOTION_BLUR_NAMED_FIELDS)[keyof typeof MOTION_BLUR_NAMED_FIELDS],
  "blend"
>;

/** Human label per numeric field, for the value's error text. */
const MOTION_BLUR_FIELD_LABELS: Record<MotionBlurNumberField, string> = {
  shutterAngle: "angle",
  shutterPhase: "phase",
  samplesPerFrame: "samples",
};

/** `samplesPerFrame` is clamped to 1..64 by the engine; reject earlier so a typo is a usage error. */
const MIN_MOTION_BLUR_SAMPLES = 1;
const MAX_MOTION_BLUR_SAMPLES = 64;

function parseMotionBlurNumber(
  raw: string,
  field: string,
): { ok: true; value: number } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, message: `shutter ${field} is empty.` };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { ok: false, message: `shutter ${field} must be a number, got "${raw}".` };
  }
  return { ok: true, value: parsed };
}

/** The samples window, in the engine's own 1..64 clamp. */
function samplesOutOfRange(value: number): boolean {
  return (
    !Number.isInteger(value) || value < MIN_MOTION_BLUR_SAMPLES || value > MAX_MOTION_BLUR_SAMPLES
  );
}

/** Assign one numeric field onto `options`, or return the error its value earned. */
function assignMotionBlurNumber(
  options: MotionBlurArgOptions,
  field: MotionBlurNumberField,
  raw: string,
  whole: string,
): MotionBlurArgParseResult | undefined {
  const parsed = parseMotionBlurNumber(raw, MOTION_BLUR_FIELD_LABELS[field]);
  if (!parsed.ok) return parsed;
  if (field === "samplesPerFrame" && samplesOutOfRange(parsed.value)) {
    return {
      ok: false,
      message: `Got "${whole}". Samples per frame must be a whole number between ${MIN_MOTION_BLUR_SAMPLES} and ${MAX_MOTION_BLUR_SAMPLES}.`,
    };
  }
  options[field] = parsed.value;
  return undefined;
}

/**
 * Parse one `angle:phase:samples` positional value. The three slots are
 * positional, so a gap is not representable; this is the form a user types.
 */
function parseMotionBlurPositional(raw: string): MotionBlurArgParseResult {
  const parts = raw.split(":");
  if (parts.length > 3) {
    return { ok: false, message: `Got "${raw}". Expected ${MOTION_BLUR_USAGE}.` };
  }

  const options: MotionBlurArgOptions = {};
  const fields: ReadonlyArray<[MotionBlurNumberField, string | undefined]> = [
    ["shutterAngle", parts[0]],
    ["shutterPhase", parts[1]],
    ["samplesPerFrame", parts[2]],
  ];
  for (const [field, value] of fields) {
    if (value === undefined) continue;
    const error = assignMotionBlurNumber(options, field, value, raw);
    if (error) return error;
  }
  return { ok: true, value: options };
}

/**
 * Parse the named form: comma-separated `key=value` pairs (`angle=180,samples=16`).
 *
 * This is the transport spelling, not the user spelling. The positional form
 * cannot carry a gap — `{ samplesPerFrame: 16 }` alone would serialize to `16`
 * and re-parse as a 16-degree shutter — so the Docker hop (`formatMotionBlurArg`)
 * writes each present field by name and reads it back here. Keys are the short
 * names on `MOTION_BLUR_NAMED_FIELDS`, mapped onto the engine's own field names.
 */
function parseMotionBlurNamed(raw: string): MotionBlurArgParseResult {
  const options: MotionBlurArgOptions = {};
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq < 1) {
      return { ok: false, message: `Got "${raw}". Expected ${MOTION_BLUR_USAGE}.` };
    }
    const key = pair.slice(0, eq).trim() as keyof typeof MOTION_BLUR_NAMED_FIELDS;
    const value = pair.slice(eq + 1).trim();
    const field = MOTION_BLUR_NAMED_FIELDS[key];
    if (field === undefined) {
      return { ok: false, message: `Got "${raw}". Unknown motion-blur field "${key}".` };
    }
    if (field === "blend") {
      if (value !== "srgb" && value !== "linear") {
        return { ok: false, message: `Got "${raw}". blend must be srgb or linear.` };
      }
      options.blend = value;
      continue;
    }
    const error = assignMotionBlurNumber(options, field, value, raw);
    if (error) return error;
  }
  return { ok: true, value: options };
}

/**
 * Parse `--motion-blur[=angle[:phase[:samples]]]`.
 *
 * Returns `{ ok: true, value: undefined }` when the flag is absent, so the
 * caller can fall through to `hyperframes.json` without the absent case looking
 * like an explicit engine-default request. `false` is the `--no-motion-blur`
 * spelling and is reported as a present-but-empty value with `off: true` by the
 * caller's `args` shape, not here — this parser only sees the string form citty
 * yields.
 *
 * Two spellings are accepted: the positional one a user types
 * (`180:-90:16`) and the named one `formatMotionBlurArg` writes for the Docker
 * hop (`angle=180,samples=16`). The named form exists because the positional
 * form has no way to express a gap between fields — dropping `shutterAngle`
 * would shift `samples` into the angle slot — so a Docker render carrying only
 * some fields has to name them.
 *
 * Validation is strict on purpose: citty hands an optional-value string flag the
 * NEXT argv token, so `--motion-blur ./my-video` arrives here as the literal
 * "./my-video". Accepting anything parseable-as-numbers would leave that case to
 * fail somewhere downstream (or worse, not fail), so an unrecognized value is
 * rejected with the accepted spelling instead.
 */
export function parseMotionBlurArg(raw: string | undefined): MotionBlurArgParseResult {
  if (raw === undefined) return { ok: true, value: undefined };
  const trimmed = raw.trim();
  // Bare `--motion-blur` (and `--motion-blur=`) → engine defaults.
  if (trimmed === "") return { ok: true, value: {} };

  // `key=value` is the named transport form; the positional form never holds "=".
  if (trimmed.includes("=")) return parseMotionBlurNamed(trimmed);
  return parseMotionBlurPositional(trimmed);
}

/**
 * Side-effecting wrapper around {@link parseMotionBlurArg}. Exits with a
 * friendly error box on a malformed value.
 */
export function resolveMotionBlurArg(raw: string | undefined): MotionBlurArgOptions | undefined {
  const result = parseMotionBlurArg(raw);
  if (!result.ok) {
    errorBox(
      "Invalid motion-blur",
      result.message,
      `Use --motion-blur=<${MOTION_BLUR_USAGE}> (with '=') so the value is not read from the next argument.`,
    );
    failUsage();
  }
  return result.value;
}
