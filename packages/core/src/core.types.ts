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

export interface Asset {
  id: string;
  url: string;
  type: string;
  is_reference?: boolean;
  /** Duration in seconds for video/audio assets */
  duration?: number;
}

// ── Timeline types ──────────────────────────────────────────────────────────

export type TimelineElementType = "video" | "image" | "text" | "audio" | "composition";
export type MediaElementType = "video" | "image" | "audio";

export const CANVAS_DIMENSIONS = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
  "landscape-4k": { width: 3840, height: 2160 },
  "portrait-4k": { width: 2160, height: 3840 },
  square: { width: 1080, height: 1080 },
  "square-4k": { width: 2160, height: 2160 },
} as const;

// Single source of truth: derive the type from the table so adding a preset
// extends the union automatically. Avoids the prior `as readonly CanvasResolution[]`
// cast on `VALID_CANVAS_RESOLUTIONS` quietly drifting if the table grew but
// the union didn't.
export type CanvasResolution = keyof typeof CANVAS_DIMENSIONS;

// `Object.keys` ordering matches insertion order in `CANVAS_DIMENSIONS` on
// every supported JS engine; tests pin the order in `index.test.ts`. Reorder
// the table above with care.
export const VALID_CANVAS_RESOLUTIONS = Object.keys(
  CANVAS_DIMENSIONS,
) as readonly CanvasResolution[];

const RESOLUTION_ALIASES: Record<string, CanvasResolution> = {
  "1080p": "landscape",
  hd: "landscape",
  "1080p-portrait": "portrait",
  "portrait-1080p": "portrait",
  "4k": "landscape-4k",
  uhd: "landscape-4k",
  "4k-portrait": "portrait-4k",
  "1080p-square": "square",
  "square-1080p": "square",
  "4k-square": "square-4k",
};

/**
 * Map a user-facing resolution string (canonical name or alias) to a
 * `CanvasResolution`. Returns undefined for unknown values so callers
 * can produce their own "invalid" UX (CLI exit, route validation, etc.).
 */
export function normalizeResolutionFlag(input: string | undefined): CanvasResolution | undefined {
  if (!input) return undefined;
  const lowered = input.toLowerCase();
  if ((VALID_CANVAS_RESOLUTIONS as readonly string[]).includes(lowered)) {
    return lowered as CanvasResolution;
  }
  return RESOLUTION_ALIASES[lowered];
}

export interface TimelineElementBase {
  id: string;
  type: TimelineElementType;
  name: string;
  startTime: number;
  duration: number;
  zIndex: number;
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
}

export interface TimelineMediaElement extends TimelineElementBase {
  type: MediaElementType;
  src: string;
  mediaStartTime?: number;
  sourceDuration?: number;
  isAroll?: boolean;
  sourceWidth?: number;
  sourceHeight?: number;
  volume?: number; // 0-1 (0% to 100%), default 1.0
  hasAudio?: boolean; // For videos - indicates if video has audio track
}

export interface WaveformData {
  peaks: number[];
  duration: number;
  sampleRate?: number;
}

export interface TimelineTextElement extends TimelineElementBase {
  type: "text";
  content: string;
  color?: string;
  fontSize?: number;
  textShadow?: boolean;
  fontFamily?: string;
  fontWeight?: number;
  textOutline?: boolean;
  textOutlineColor?: string;
  textOutlineWidth?: number;
  textHighlight?: boolean;
  textHighlightColor?: string;
  textHighlightPadding?: number;
  textHighlightRadius?: number;
}

export interface TimelineCompositionElement extends TimelineElementBase {
  type: "composition";
  src: string;
  compositionId: string;
  scale?: number;
  sourceDuration?: number;
  variableValues?: Record<string, string | number | boolean>;
  sourceWidth?: number;
  sourceHeight?: number;
}

// Composition Variable Types
export type CompositionVariableType = "string" | "number" | "color" | "boolean" | "enum";

/**
 * Runtime list of every valid `CompositionVariableType`. Use this anywhere
 * a Set/array of valid type strings is needed (lint rules, validators).
 * The `satisfies` guard turns adding a new variant to the union without
 * also adding it here into a compile error.
 */
export const COMPOSITION_VARIABLE_TYPES = [
  "string",
  "number",
  "color",
  "boolean",
  "enum",
] as const satisfies readonly CompositionVariableType[];

export interface CompositionVariableBase {
  id: string;
  type: CompositionVariableType;
  label: string;
  description?: string;
}

export interface StringVariable extends CompositionVariableBase {
  type: "string";
  default: string;
  placeholder?: string;
  maxLength?: number;
}

export interface NumberVariable extends CompositionVariableBase {
  type: "number";
  default: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export interface ColorVariable extends CompositionVariableBase {
  type: "color";
  default: string;
}

export interface BooleanVariable extends CompositionVariableBase {
  type: "boolean";
  default: boolean;
}

export interface EnumVariable extends CompositionVariableBase {
  type: "enum";
  default: string;
  options: { value: string; label: string }[];
}

export type CompositionVariable =
  | StringVariable
  | NumberVariable
  | ColorVariable
  | BooleanVariable
  | EnumVariable;

export interface CompositionSpec {
  id: string;
  duration: number;
  variables: CompositionVariable[];
}

export type TimelineElement =
  | TimelineMediaElement
  | TimelineTextElement
  | TimelineCompositionElement;

export function isTextElement(el: TimelineElement): el is TimelineTextElement {
  return el.type === "text";
}

export function isMediaElement(el: TimelineElement): el is TimelineMediaElement {
  return el.type === "video" || el.type === "image" || el.type === "audio";
}

export function isCompositionElement(el: TimelineElement): el is TimelineCompositionElement {
  return el.type === "composition";
}

export interface MediaFile {
  id: string;
  name: string;
  type: TimelineElementType;
  src: string;
  file?: File;
  duration?: number;
  compositionId?: string;
  sourceWidth?: number; // Intrinsic width for compositions
  sourceHeight?: number; // Intrinsic height for compositions
}

export const TIMELINE_COLORS: Record<TimelineElementType, string> = {
  video: "#ec4899",
  image: "#3b82f6",
  text: "#06b6d4",
  audio: "#10b981",
  composition: "#f97316",
};

export const DEFAULT_DURATIONS: Record<TimelineElementType, number> = {
  video: 5,
  image: 5,
  text: 2,
  audio: 5,
  composition: 5,
};

export interface CompositionAPI {
  id: string;
  duration: number;
  seek(time: number): void;
  getTime(): number;
  getDuration(): number;
}

// ── Player API types (used by runtime) ────────────────────────────────────

export interface PlayerAPI {
  play(): void;
  pause(): void;
  seek(time: number, options?: { keepPlaying?: boolean }): void;
  getTime(): number;
  getDuration(): number;
  isPlaying(): boolean;
  getMainTimeline(): unknown;
  getElementBounds(elementId: string): void;
  getElementsAtPoint(x: number, y: number): void;
  setElementPosition(elementId: string, x: number, y: number): void;
  previewElementPosition(elementId: string, x: number, y: number): void;
  setElementKeyframes(
    elementId: string,
    keyframes: Array<{
      id: string;
      time: number;
      properties: { x?: number; y?: number };
    }> | null,
  ): void;
  setElementScale(elementId: string, scale: number): void;
  setElementFontSize(elementId: string, fontSize: number): void;
  setElementTextContent(elementId: string, content: string): void;
  setElementTextColor(elementId: string, color: string): void;
  setElementTextShadow(elementId: string, enabled: boolean): void;
  setElementTextFontWeight(elementId: string, weight: number): void;
  setElementTextFontFamily(elementId: string, fontFamily: string): void;
  setElementTextOutline(elementId: string, enabled: boolean, color?: string, width?: number): void;
  setElementTextHighlight(
    elementId: string,
    enabled: boolean,
    color?: string,
    padding?: number,
    radius?: number,
  ): void;
  setElementVolume(elementId: string, volume: number): void;
  setStageZoom(scale: number, focusX: number, focusY: number): void;
  getStageZoom(): { scale: number; focusX: number; focusY: number };
  setStageZoomKeyframes(
    keyframes: Array<{
      id: string;
      time: number;
      zoom: { scale: number; focusX: number; focusY: number };
      ease?: string;
    }> | null,
  ): void;
  getStageZoomKeyframes(): Array<{
    id: string;
    time: number;
    zoom: { scale: number; focusX: number; focusY: number };
    ease?: string;
  }>;
  addElement(data: AddElementData): boolean;
  removeElement(elementId: string): boolean;
  updateElementTiming(elementId: string, start?: number, end?: number): boolean;
  setElementTiming(
    elementId: string,
    startTime: number,
    duration: number,
    mediaStartTime?: number,
  ): void;
  updateElementSrc(elementId: string, src: string): boolean;
  updateElementLayer(elementId: string, zIndex: number): boolean;
  updateElementBasePosition(elementId: string, x?: number, y?: number, scale?: number): boolean;
  markTimelineDirty(): void;
  isTimelineDirty(): boolean;
  rebuildTimeline(): void;
  ensureTimeline(): void;
  enableRenderMode(): void;
  disableRenderMode(): void;
  renderSeek(time: number): void;
  getElementVisibility(elementId: string): { visible: boolean; opacity?: number };
  getVisibleElements(): Array<{ id: string; tagName: string; start: number; end: number }>;
  getRenderState(): {
    time: number;
    duration: number;
    isPlaying: boolean;
    renderMode: boolean;
    timelineDirty: boolean;
  };
}

export interface AddElementData {
  id: string;
  type: "video" | "image" | "text" | "audio" | "composition";
  name?: string;
  src?: string;
  content?: string;
  start: number;
  end: number;
  zIndex?: number;
  x?: number;
  y?: number;
  scale?: number;
  fontSize?: number;
  color?: string;
  textShadow?: boolean;
  fontWeight?: number;
  textOutline?: boolean;
  textOutlineColor?: string;
  textOutlineWidth?: number;
  textHighlight?: boolean;
  textHighlightColor?: string;
  textHighlightPadding?: number;
  textHighlightRadius?: number;
  compositionId?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  isAroll?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CompositionAsset {
  id: string;
  name: string;
  type: "composition";
  src: string;
  duration: number;
  compositionId: string;
  thumbnail?: string;
}

export interface Keyframe {
  id: string;
  time: number;
  properties: Partial<KeyframeProperties>;
  ease?: string;
}

export interface KeyframeProperties {
  x: number;
  y: number;
  opacity: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  width: number;
  height: number;
}

export interface ElementKeyframes {
  elementId: string;
  keyframes: Keyframe[];
}

export interface StageZoom {
  scale: number;
  focusX: number;
  focusY: number;
}

export interface StageZoomKeyframe {
  id: string;
  time: number;
  zoom: StageZoom;
  ease?: string;
}

export function getDefaultStageZoom(resolution: CanvasResolution): StageZoom {
  const { width, height } = CANVAS_DIMENSIONS[resolution];
  return {
    scale: 1,
    focusX: width / 2,
    focusY: height / 2,
  };
}
