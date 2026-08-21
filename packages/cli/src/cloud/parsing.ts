import { failUsage } from "../utils/commandResult.js";
/**
 * Strict numeric parsers for CLI flags.
 *
 * `Number.parseInt`/`Number.parseFloat` silently truncate trailing
 * garbage ("10abc" → 10), which we don't want for user-facing flags
 * like `--limit`, `--fps`, `--poll-interval`. These wrappers reject
 * anything that isn't a complete numeric literal.
 */

import { errorBox } from "../ui/format.js";

const INTEGER_RE = /^-?\d+$/;
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

export interface IntFlagOptions {
  flag: string;
  min?: number;
  max?: number;
}

/**
 * Parse an integer flag, exit(1) with an errorBox on any non-integer
 * input (including trailing garbage like "10abc" and decimals like
 * "10.5"). Returns `undefined` when `raw === undefined` so callers can
 * supply their own defaults.
 */
export function parseIntFlag(raw: string | undefined, opts: IntFlagOptions): number | undefined {
  if (raw === undefined) return undefined;
  if (!INTEGER_RE.test(raw)) {
    errorBox(`Invalid ${opts.flag}`, `Got "${raw}". Must be an integer${rangeSuffix(opts)}.`);
    failUsage();
  }
  const n = Number.parseInt(raw, 10);
  enforceRange(opts.flag, raw, n, opts);
  return n;
}

export interface FloatFlagOptions {
  flag: string;
  min?: number;
  max?: number;
}

/**
 * Parse a non-NaN finite numeric flag, exit(1) on any non-numeric
 * input. Accepts integers and decimals.
 */
export function parseNumericFlag(
  raw: string | undefined,
  opts: FloatFlagOptions,
): number | undefined {
  if (raw === undefined) return undefined;
  if (!NUMERIC_RE.test(raw)) {
    errorBox(`Invalid ${opts.flag}`, `Got "${raw}". Must be a number${rangeSuffix(opts)}.`);
    failUsage();
  }
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) {
    errorBox(`Invalid ${opts.flag}`, `Got "${raw}". Must be a finite number.`);
    failUsage();
  }
  enforceRange(opts.flag, raw, n, opts);
  return n;
}

function enforceRange(
  flag: string,
  raw: string,
  value: number,
  bounds: { min?: number; max?: number },
): void {
  if (bounds.min !== undefined && value < bounds.min) {
    errorBox(`Invalid ${flag}`, `Got "${raw}". Minimum is ${bounds.min}.`);
    failUsage();
  }
  if (bounds.max !== undefined && value > bounds.max) {
    errorBox(`Invalid ${flag}`, `Got "${raw}". Maximum is ${bounds.max}.`);
    failUsage();
  }
}

/** Parse an enum-typed flag against a closed set of allowed values. */
export function parseEnumFlag<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  opts: { flag: string },
): T | undefined {
  if (raw === undefined) return undefined;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  errorBox(`Invalid ${opts.flag}`, `Got "${raw}". Must be one of: ${allowed.join(", ")}.`);
  failUsage();
}

function rangeSuffix(opts: { min?: number; max?: number }): string {
  if (opts.min !== undefined && opts.max !== undefined) return ` (${opts.min}-${opts.max})`;
  if (opts.min !== undefined) return ` (>= ${opts.min})`;
  if (opts.max !== undefined) return ` (<= ${opts.max})`;
  return "";
}
