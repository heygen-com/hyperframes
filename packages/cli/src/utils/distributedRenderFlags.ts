/**
 * Shared CLI flag helpers for the distributed render backends
 * (`hyperframes lambda` / `hyperframes cloudrun`). Both commands parse the
 * same shapes of flags — integers, positive integers, closed string-union
 * enums — and both implement the same `sites create <projectDir>`
 * validation guard, `--width`/`--height` requirement, and
 * `--output-resolution` normalization. Kept in one place so the two
 * backends' argument handling can't drift apart.
 */

import { readAllowedCompositionFpsFromDir } from "./compositionFps.js";

function parseIntFlag(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse a flag that must be a positive integer (>= 1) when supplied.
 * Negative values or non-integers fail loudly instead of flowing into
 * the SDK and producing opaque AWS/GCP validation errors mid-render.
 */
export function parsePositiveInt(
  raw: unknown,
  flagName: string,
  toolName: string,
): number | undefined {
  const n = parseIntFlag(raw);
  if (n === undefined) return undefined;
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`[${toolName}] ${flagName} must be a positive integer; got ${n}`);
  }
  return n;
}

/**
 * Parse a string-union flag against a closed set of allowed values.
 * Returns `defaultValue` (which may be `undefined`) when the input is
 * empty; throws with a flag-specific message when the value is set
 * but unrecognised.
 */
// fallow-ignore-next-line complexity
export function parseEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  errorPrefix: string,
  defaultValue: T | undefined,
): T | undefined {
  if (raw === undefined || raw === null || raw === "") return defaultValue;
  const s = String(raw);
  if ((allowed as readonly string[]).includes(s)) return s as T;
  throw new Error(`${errorPrefix} must be ${allowed.join("|")}; got ${s}`);
}

/**
 * Shared guard for `<tool> sites create <projectDir>`: only the `create`
 * verb is supported, and it requires a project dir positional. Returns the
 * validated `projectDir` on success; prints a usage error to stderr and
 * exits(1) otherwise (never returns in that case).
 */
export function requireSitesCreateProjectDir(
  args: Record<string, unknown>,
  toolName: string,
): string {
  if (args.target !== "create") {
    console.error(
      `[${toolName} sites] unknown verb "${String(args.target)}". Only "create" is supported.`,
    );
    process.exit(1);
  }
  const projectDir = args.extra as string | undefined;
  if (!projectDir) {
    console.error(
      `[${toolName} sites create] usage: hyperframes ${toolName} sites create <projectDir>`,
    );
    process.exit(1);
  }
  return projectDir;
}

/**
 * Shared guard for the `--width`/`--height` pair every render/render-batch
 * entrypoint requires. Returns the validated, non-undefined pair on success;
 * prints a usage error to stderr and exits(1) otherwise (never returns in
 * that case).
 */
export function requireRenderDimensions(
  args: Record<string, unknown>,
  toolName: string,
  usageContext: string,
): { width: number; height: number } {
  const width = parsePositiveInt(args.width, "--width", toolName);
  const height = parsePositiveInt(args.height, "--height", toolName);
  if (width === undefined || height === undefined) {
    console.error(`${usageContext} --width and --height are required.`);
    process.exit(1);
  }
  return { width, height };
}

/**
 * Resolves `--fps`, falling back to the composition's own allowed rate (from
 * disk) and then a hard default of 30 — and validates the result against the
 * three rates every distributed render backend supports. Prints a usage
 * error to stderr and exits(1) on an unsupported rate (never returns in that
 * case).
 */
export function resolveValidatedFps(
  args: Record<string, unknown>,
  projectDir: string,
  usageContext: string,
): 24 | 30 | 60 {
  const fps =
    parseIntFlag(args.fps) ?? readAllowedCompositionFpsFromDir(projectDir, [24, 30, 60]) ?? 30;
  if (fps !== 24 && fps !== 30 && fps !== 60) {
    console.error(`${usageContext} --fps must be 24, 30, or 60; got ${fps}.`);
    process.exit(1);
  }
  return fps;
}
