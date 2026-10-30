import { DEFAULT_CONFIG, resolvePageNavigationTimeout } from "@hyperframes/engine";
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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

/** The page-load budget render uses, raised to a command's own longer `--timeout`. */
export function pageNavigationTimeoutMs(minimumTimeoutMs = 0): number {
  const configured = resolvePageNavigationTimeout();
  return Math.max(
    configured > 0 ? configured : DEFAULT_CONFIG.pageNavigationTimeout,
    minimumTimeoutMs,
  );
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
