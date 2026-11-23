// Exact rational, so NTSC rates reach FFmpeg as `30000/1001` with no decimal round trip.
export interface Fps {
  num: number;
  den: number;
}

export type FpsInput = number | Fps;

export function toFps(input: FpsInput): Fps {
  if (typeof input === "number") {
    return { num: input, den: 1 };
  }
  return input;
}

export function fpsToNumber(fps: Fps): number {
  return fps.num / fps.den;
}

export function fpsToFfmpegArg(fps: Fps): string {
  return fps.den === 1 ? String(fps.num) : `${fps.num}/${fps.den}`;
}

export type FpsParseResult =
  | { ok: true; value: Fps }
  | {
      ok: false;
      reason:
        | "empty"
        | "not-a-number"
        | "non-positive"
        | "out-of-range"
        | "invalid-fraction"
        | "ambiguous-decimal";
    };

type FpsFailure = Extract<FpsParseResult, { ok: false }>["reason"];
const fail = (reason: FpsFailure): FpsParseResult => ({ ok: false, reason });

function rangedFps(num: number, den: number): FpsParseResult {
  if (num <= 0) return fail("non-positive");
  const decimal = num / den;
  if (decimal < 1 || decimal > 240) return fail("out-of-range");
  return { ok: true, value: { num, den } };
}

function numericFps(input: number): FpsParseResult {
  if (!Number.isFinite(input)) return fail("not-a-number");
  if (!Number.isInteger(input)) return fail("ambiguous-decimal");
  return rangedFps(input, 1);
}

function fractionFps(raw: string): FpsParseResult {
  const parts = raw.split("/");
  if (parts.length !== 2) return fail("invalid-fraction");
  const num = Number(parts[0]);
  const den = Number(parts[1]);
  if (!Number.isFinite(num) || !Number.isFinite(den)) return fail("not-a-number");
  if (!Number.isInteger(num) || !Number.isInteger(den) || den <= 0) return fail("invalid-fraction");
  return rangedFps(num, den);
}

// Decimals like "29.97" are rejected: FFmpeg reads them as a different rate than 30000/1001.
export function parseFps(input: string | number): FpsParseResult {
  if (typeof input === "number") return numericFps(input);
  const raw = input.trim();
  if (raw === "") return fail("empty");
  if (raw.includes("/")) return fractionFps(raw);
  if (/^-?\d+$/.test(raw)) return rangedFps(Number(raw), 1);
  return fail(/^-?\d*\.\d+$/.test(raw) ? "ambiguous-decimal" : "not-a-number");
}

export function parseFpsWithDefault(input: string | number | undefined): FpsParseResult {
  if (input === undefined || input === "") return { ok: true, value: { num: 30, den: 1 } };
  return parseFps(input);
}
