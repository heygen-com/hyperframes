// ── Shared cross-package types ──────────────────────────────────────────────

export type ExecutionMode = "planning" | "design" | "execution" | null;

// ── Frame rate ──────────────────────────────────────────────────────────────

/**
 * Frame rate as an exact rational. Carrying `{num, den}` end-to-end (rather
 * than collapsing to `29.97`) lets us pass NTSC / drop-frame rates straight
 * through to FFmpeg via `-r 30000/1001` without any decimal round-trip.
 *
 * Integer fps is represented with `den: 1` (e.g. `{ num: 30, den: 1 }`).
 *
 * Use {@link fpsToNumber} when arithmetic forces a decimal (e.g. `setTimeout`
 * intervals) and {@link fpsToFfmpegArg} when emitting FFmpeg `-r` /
 * `-framerate` strings.
 */
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

/**
 * Decimal value of an {@link Fps} rational. Used at sites that need a
 * `number` for arithmetic (frame-index → time, frame intervals, telemetry
 * payloads) where the small precision loss of the decimal is acceptable.
 */
export function fpsToNumber(fps: Fps): number {
  return fps.num / fps.den;
}

/**
 * FFmpeg-style fps argument. Returns `"30"` for integer fps and `"30000/1001"`
 * for rationals — both forms are accepted verbatim by FFmpeg's `-r` and
 * `-framerate` flags. We keep integer fps as a bare integer so existing
 * snapshot tests / log output don't churn for the common case.
 */
export function fpsToFfmpegArg(fps: Fps): string {
  return fps.den === 1 ? String(fps.num) : `${fps.num}/${fps.den}`;
}

/**
 * Discriminated parse result for {@link parseFps}. Lets the CLI / route
 * validation own its own error UX without losing the structured failure
 * reason.
 */
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

/**
 * Parse a user-supplied fps spec into an {@link Fps} rational.
 *
 * Accepted forms:
 * - integer string `"30"` → `{ num: 30, den: 1 }`
 * - integer number `30` → `{ num: 30, den: 1 }`
 * - rational string `"30000/1001"` → `{ num: 30000, den: 1001 }` (exact NTSC)
 *
 * Rejected:
 * - empty / non-numeric input
 * - decimals like `"29.97"` — callers must spell rationals with `/` so the
 *   exact denominator is unambiguous (FFmpeg treats `29.97` as a slightly
 *   different framerate than `30000/1001`).
 * - division by zero, negative or zero numerator
 * - decimal value outside `[1, 240]` — defensive bounds for "human" fps
 *   ranges (24, 25, 30, 50, 60, 120, 240, plus the NTSC trio).
 */
export function parseFps(input: string | number): FpsParseResult {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return { ok: false, reason: "not-a-number" };
    if (!Number.isInteger(input)) return { ok: false, reason: "ambiguous-decimal" };
    if (input <= 0) return { ok: false, reason: "non-positive" };
    if (input > 240) return { ok: false, reason: "out-of-range" };
    return { ok: true, value: { num: input, den: 1 } };
  }
  const raw = input.trim();
  if (raw === "") return { ok: false, reason: "empty" };

  if (raw.includes("/")) {
    const parts = raw.split("/");
    if (parts.length !== 2) return { ok: false, reason: "invalid-fraction" };
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (!Number.isFinite(num) || !Number.isFinite(den)) {
      return { ok: false, reason: "not-a-number" };
    }
    if (!Number.isInteger(num) || !Number.isInteger(den)) {
      return { ok: false, reason: "invalid-fraction" };
    }
    if (den <= 0) return { ok: false, reason: "invalid-fraction" };
    if (num <= 0) return { ok: false, reason: "non-positive" };
    const decimal = num / den;
    if (decimal < 1 || decimal > 240) return { ok: false, reason: "out-of-range" };
    return { ok: true, value: { num, den } };
  }

  // Integer-only path — reject `"29.97"` so users are explicit about the
  // exact rational they want.
  if (!/^-?\d+$/.test(raw)) {
    // Allow caller to differentiate "29.97" from "abc" if they want; both
    // are user errors but the message can be friendlier for decimals.
    if (/^-?\d*\.\d+$/.test(raw)) return { ok: false, reason: "ambiguous-decimal" };
    return { ok: false, reason: "not-a-number" };
  }
  const n = Number(raw);
  if (n <= 0) return { ok: false, reason: "non-positive" };
  if (n > 240) return { ok: false, reason: "out-of-range" };
  return { ok: true, value: { num: n, den: 1 } };
}

/**
 * Convenience wrapper around {@link parseFps} for callsites that want the
 * default-30-fps fallback when input is `undefined`. Does NOT swallow parse
 * errors — those still surface via the discriminated result.
 */
export function parseFpsWithDefault(input: string | number | undefined): FpsParseResult {
  if (input === undefined || input === "") return { ok: true, value: { num: 30, den: 1 } };
  return parseFps(input);
}

/** Video orientation / aspect ratio. */
export type Orientation = "16:9" | "9:16";

// ── Re-exports from @hyperframes/parsers (moved in refactor) ─────────────────
// @deprecated — import from @hyperframes/parsers directly

export type {
  Asset,
  TimelineElementType,
  MediaElementType,
  TimelineElementBase,
  TimelineMediaElement,
  WaveformData,
  TimelineTextElement,
  TimelineCompositionElement,
  CompositionVariableType,
  CompositionVariableBase,
  StringVariable,
  NumberVariable,
  ColorVariable,
  BooleanVariable,
  EnumVariable,
  CompositionVariable,
  CompositionSpec,
  TimelineElement,
  MediaFile,
  CanvasResolution,
  CompositionAPI,
  PlayerAPI,
  AddElementData,
  ValidationResult,
  CompositionAsset,
  Keyframe,
  KeyframeProperties,
  ElementKeyframes,
  StageZoom,
  StageZoomKeyframe,
} from "@hyperframes/parsers";

export {
  CANVAS_DIMENSIONS,
  VALID_CANVAS_RESOLUTIONS,
  normalizeResolutionFlag,
  COMPOSITION_VARIABLE_TYPES,
  TIMELINE_COLORS,
  DEFAULT_DURATIONS,
  getDefaultStageZoom,
  isTextElement,
  isMediaElement,
  isCompositionElement,
} from "@hyperframes/parsers";
