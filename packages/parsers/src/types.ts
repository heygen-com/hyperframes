// ── Composition data types ───────────────────────────────────────────────────
// Moved from @hyperframes/core/core.types in the parsers extraction refactor.
// These are the types produced and consumed by the parser pipeline.

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
 * Aliases that name a resolution *tier* (1080p / 4K) without also nailing an
 * orientation. Historically they all normalize to the `landscape` preset
 * (`normalizeResolutionFlag("1080p") === "landscape"`), which then rejects
 * portrait / square compositions with a cryptic "aspect ratio does not match"
 * error deep inside the render pipeline. Consumers that know the composition's
 * dimensions can consult this set to decide whether to auto-adapt the preset's
 * orientation instead — see `adaptAspectAgnosticResolution` in the compile
 * stage (`@hyperframes/producer`) and `suggestMatchingPreset` here.
 *
 * Orientation-suffixed aliases (`1080p-portrait`, `4k-square`, …) are absent
 * on purpose: the user *did* pick an orientation, and honoring it is important
 * for the "you asked for landscape but composed portrait" error to still fire.
 */
const ASPECT_AGNOSTIC_RESOLUTION_ALIASES: ReadonlySet<string> = new Set([
  "1080p",
  "hd",
  "4k",
  "uhd",
]);

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

/**
 * True when `input` names a resolution *tier* without nailing an orientation
 * (`1080p`, `hd`, `4k`, `uhd`). Case-insensitive.
 *
 * The `--resolution` CLI flag treats these as "target this size; keep the
 * composition's orientation" — a portrait 1080×1920 comp with `--resolution
 * 1080p` should land at 1080×1920, not blow up on aspect mismatch. Explicit
 * canonical presets (`landscape`, `portrait`, …) and orientation-suffixed
 * aliases (`1080p-portrait`) stay strict — the user picked an orientation.
 *
 * Consumers pair this signal with the composition's dimensions (in a
 * follow-up pass after HTML parse) to pick the right preset via
 * `suggestMatchingPreset` — see `adaptAspectAgnosticResolution` in the
 * compile stage (`@hyperframes/producer`) for the canonical remap.
 */
export function isAspectAgnosticResolutionAlias(input: string | undefined): boolean {
  if (!input) return false;
  return ASPECT_AGNOSTIC_RESOLUTION_ALIASES.has(input.toLowerCase());
}

/**
 * Public-boundary helper: given a raw `--resolution` / `--output-resolution`
 * flag value, return the pair every distributed render entrypoint needs to
 * forward end-to-end so the compile stage can adapt aspect-agnostic aliases
 * to the composition's orientation:
 *
 *   - `outputResolution`: normalized {@link CanvasResolution} (or `undefined`
 *     for unknown values — callers own their invalid-input UX).
 *   - `outputResolutionAspectAgnostic`: `true` when the raw input was a
 *     tier-only alias (`1080p` / `hd` / `4k` / `uhd`). Passes through to
 *     `DistributedRenderConfig.outputResolutionAspectAgnostic` so the compile
 *     stage remaps `landscape` → `portrait` / `square` when the composition
 *     dimensions demand it.
 *
 * Exported to centralize the two-step pattern (`normalizeResolutionFlag` +
 * `isAspectAgnosticResolutionAlias`) that would otherwise be duplicated at
 * every entrypoint that emits a `DistributedRenderConfig` (`hyperframes
 * cloudrun render`, `hyperframes lambda render` / `render-batch`, the local
 * CLI). Divergence between those callers is what shipped the portrait-1080p
 * regression this helper prevents from recurring.
 */
export interface ResolvedResolutionFlag {
  outputResolution: CanvasResolution | undefined;
  outputResolutionAspectAgnostic: boolean;
}

export function resolveResolutionFlagPair(input: string | undefined): ResolvedResolutionFlag {
  return {
    outputResolution: normalizeResolutionFlag(input),
    outputResolutionAspectAgnostic: isAspectAgnosticResolutionAlias(input),
  };
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
export type CompositionVariableType =
  | "string"
  | "number"
  | "color"
  | "boolean"
  | "enum"
  | "font"
  | "image";

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
  "font",
  "image",
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
  /** Brand role identifier, e.g. "color:primary". */
  brandRole?: string;
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

/**
 * Font variable — value is a `{name, source}` object (object-valued; LOCKED §7).
 * `default` is the fallback font-family name string.
 * `source` is the font stylesheet URL (e.g. Google Fonts CSS).
 * `default_name` / `default_source` are the CSS-level fallbacks when the
 * brand font is absent.
 */
export interface FontVariable extends CompositionVariableBase {
  type: "font";
  /** Fallback font-family name, e.g. "Inter". */
  default: string;
  /** Font stylesheet URL (e.g. Google Fonts CSS link). */
  source?: string;
  /** CSS font-family name to use when source is unavailable, e.g. "sans-serif". */
  default_name?: string;
  /** Fallback font stylesheet URL (empty string = system font). */
  default_source?: string;
}

/**
 * Image variable — value is a `{url, …}` object (object-valued; LOCKED §7).
 * `default` is the fallback image URL string.
 * `brandRole` is an optional semantic label, e.g. "logo:primary".
 */
export interface ImageVariable extends CompositionVariableBase {
  type: "image";
  /** Fallback image URL. */
  default: string;
  /** Brand role identifier, e.g. "logo:primary". */
  brandRole?: string;
}

export type CompositionVariable =
  | StringVariable
  | NumberVariable
  | ColorVariable
  | BooleanVariable
  | EnumVariable
  | FontVariable
  | ImageVariable;

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
  renderSeek(time: number, options?: { suppressEvents?: boolean }): void;
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
