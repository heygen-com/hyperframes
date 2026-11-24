// ── Shared cross-package types ──────────────────────────────────────────────

export type ExecutionMode = "planning" | "design" | "execution" | null;

export type { Fps, FpsInput, FpsParseResult } from "./fps";
export { toFps, fpsToNumber, fpsToFfmpegArg, parseFps, parseFpsWithDefault } from "./fps";

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
  isAspectAgnosticResolutionAlias,
  resolveResolutionFlagPair,
  checkOutputResolutionCompatibility,
  outputResolutionForSize,
  suggestMatchingPreset,
  COMPOSITION_VARIABLE_TYPES,
  TIMELINE_COLORS,
  DEFAULT_DURATIONS,
  getDefaultStageZoom,
  isTextElement,
  isMediaElement,
  isCompositionElement,
} from "@hyperframes/parsers";
export type {
  OutputResolutionCompatibility,
  OutputResolutionIssueKind,
} from "@hyperframes/parsers";
