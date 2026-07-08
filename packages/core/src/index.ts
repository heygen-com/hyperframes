// Types
export type {
  ExecutionMode,
  Orientation,
  Asset,
  TimelineElement,
  TimelineElementBase,
  TimelineMediaElement,
  TimelineTextElement,
  TimelineCompositionElement,
  TimelineElementType,
  MediaElementType,
  CanvasResolution,
  Fps,
  FpsInput,
  FpsParseResult,
  MediaFile,
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
  CompositionVariableType,
  CompositionVariableBase,
  StringVariable,
  NumberVariable,
  ColorVariable,
  BooleanVariable,
  EnumVariable,
  CompositionVariable,
  CompositionSpec,
  WaveformData,
  OutputResolutionCompatibility,
  OutputResolutionIssueKind,
} from "./core.types";

export type {
  SlideshowManifest,
  SlideRef,
  SlideHotspot,
  SlideSequence,
  ResolvedSlide,
  ResolvedSlideSequence,
  ResolvedSlideshow,
} from "./slideshow/index.js";

export { parseSlideshowManifest, resolveSlideshow } from "./slideshow/index.js";

export {
  CANVAS_DIMENSIONS,
  VALID_CANVAS_RESOLUTIONS,
  normalizeResolutionFlag,
  checkOutputResolutionCompatibility,
  parseFps,
  parseFpsWithDefault,
  toFps,
  fpsToNumber,
  fpsToFfmpegArg,
  TIMELINE_COLORS,
  DEFAULT_DURATIONS,
  COMPOSITION_VARIABLE_TYPES,
  isTextElement,
  isMediaElement,
  isCompositionElement,
  getDefaultStageZoom,
} from "./core.types";

// Templates
export { generateBaseHtml, getStageStyles } from "./templates/base";
export {
  GSAP_CDN,
  BASE_STYLES,
  ELEMENT_BASE_STYLES,
  MEDIA_STYLES,
  TEXT_STYLES,
  ZOOM_CONTAINER_STYLES,
} from "./templates/constants";

// Parsers — GSAP helpers. The AST parser (parseGsapScriptAcorn and write ops)
// is browser-safe; mutation helpers are in gsapWriterAcorn.
export type { GsapAnimation, GsapMethod, ParsedGsap } from "@hyperframes/parsers";

export {
  serializeGsapAnimations,
  getAnimationsForElementId,
  validateCompositionGsap,
  keyframesToGsapAnimations,
  gsapAnimationsToKeyframes,
} from "@hyperframes/parsers";

export type { ParsedHtml, CompositionMetadata } from "@hyperframes/parsers";

export {
  parseHtml,
  updateElementInHtml,
  addElementToHtml,
  removeElementFromHtml,
  validateCompositionHtml,
  extractCompositionMetadata,
} from "@hyperframes/parsers";

// Generators
export type { SerializeOptions } from "./generators/hyperframes";

export {
  generateHyperframesHtml,
  generateGsapTimelineScript,
  generateHyperframesStyles,
} from "./generators/hyperframes";

// Compiler (timing only — browser-safe, no linkedom/esbuild)
export type {
  UnresolvedElement,
  ResolvedDuration,
  ResolvedMediaElement,
  CompilationResult,
} from "./compiler/timingCompiler";

// Timing resolver — shared pure resolver for word-anchored elastic timing (WS-C).
export type {
  WordTiming,
  ElementAnchor,
  AuthoredTiming,
  ResolvedTiming,
  ResolveTimingsInput,
  ResolveTimingsResult,
} from "./compiler/timingResolver";
export { resolveTimings } from "./compiler/timingResolver";

export {
  compileTimingAttrs,
  injectDurations,
  extractResolvedMedia,
  clampDurations,
  shouldClampMediaDuration,
  MEDIA_DURATION_CLAMP_EPSILON_SECONDS,
} from "./compiler/timingCompiler";

// Lint moved to @hyperframes/lint. Import lint APIs from @hyperframes/lint
// directly, or via the back-compat stub at @hyperframes/core/lint. Not
// re-exported here — doing so would cycle core's main entry through the lint
// package (which imports core utilities back).
export {
  rewriteAssetPaths,
  rewriteAssetPath,
  rewriteCssAssetUrls,
  rewriteInlineStyleAssetUrls,
} from "./compiler/rewriteSubCompPaths";
export { CSS_URL_RE, isNonRelativeUrl, isPathInside } from "./compiler/assetPaths";
export {
  checkSubCompositionUsability,
  type ParsableDocumentLike,
  type SubCompositionValidity,
  type SubCompositionValidityReason,
} from "./compiler/subCompositionValidity";
export { queryByAttr } from "./utils/cssSelector";
export { decodeUrlPathVariants } from "./utils/urlPath";
export { parseAnimatedGifMetadata, type AnimatedGifMetadata } from "./media/gif";
export {
  HF_COLOR_GRADING_ATTR,
  HF_COLOR_GRADING_ADJUST_KEYS,
  HF_COLOR_GRADING_CANVAS_ID_PREFIX,
  HF_COLOR_GRADING_COLOR_SPACE,
  HF_COLOR_GRADING_DETAIL_KEYS,
  HF_COLOR_GRADING_EFFECT_KEYS,
  HF_COLOR_GRADING_PRESETS,
  isHfColorGradingActive,
  normalizeHfColorGrading,
  normalizeHfColorGradingWithVariables,
  resolveHfColorGradingVariables,
  serializeHfColorGrading,
  type HfColorGrading,
  type HfColorGradingAdjust,
  type HfColorGradingAdjustKey,
  type HfColorGradingDetailKey,
  type HfColorGradingDetails,
  type HfColorGradingEffectKey,
  type HfColorGradingEffects,
  type HfColorGradingLutRef,
  type HfColorGradingPreset,
  type HfColorGradingPresetId,
  type HfColorGradingTarget,
  type HfColorGradingVariableMap,
  type NormalizedHfColorGrading,
} from "./colorGrading";

// Inline scripts
export {
  HYPERFRAME_RUNTIME_ARTIFACTS,
  HYPERFRAME_RUNTIME_CONTRACT,
  loadHyperframeRuntimeSource,
  type HyperframeRuntimeContract,
} from "./inline-scripts/hyperframe";
export {
  HYPERFRAME_RUNTIME_GLOBALS,
  HYPERFRAME_BRIDGE_SOURCES,
  HYPERFRAME_CONTROL_ACTIONS,
  type HyperframeControlAction,
} from "./inline-scripts/runtimeContract";
export { getHyperframeRuntimeScript } from "./generated/runtime-inline";
export {
  buildHyperframesRuntimeScript,
  type HyperframesRuntimeBuildOptions,
} from "./inline-scripts/hyperframesRuntime.engine";
export {
  MEDIA_VISUAL_STYLE_PROPERTIES,
  copyMediaVisualStyles,
  quantizeTimeToFrame,
  type MediaVisualStyleProperty,
} from "./inline-scripts/parityContract";
export { redactTelemetryString } from "./telemetryRedaction";
export { isSafePath, resolveWithinProject } from "./safePath";
export type {
  HyperframePickerApi,
  HyperframePickerBoundingBox,
  HyperframePickerElementInfo,
} from "./inline-scripts/pickerApi";

// Frame adapters
export type { FrameAdapter, FrameAdapterContext } from "./adapters/types";
export type { GSAPTimelineLike, CreateGSAPFrameAdapterOptions } from "./adapters/gsap";
export { createGSAPFrameAdapter } from "./adapters/gsap";

// Text measurement
export { fitTextFontSize } from "./text/index.js";
export type { FitTextOptions, FitTextResult } from "./text/index.js";

// Runtime helpers (composition-side)
export { getVariables } from "./runtime/getVariables.js";
export {
  parseStartExpression,
  parseNumeric,
  type ReferenceExpression,
} from "./runtime/startExpression.js";

// Variable validation (CLI / tooling-side)
export {
  validateVariables,
  formatVariableValidationIssue,
  type VariableValidationIssue,
} from "./runtime/validateVariables.js";

// Registry
export type {
  ItemType,
  FileType,
  FileTarget,
  RegistryItemDimensions,
  RegistryItemPreview,
  RegistryItem,
  ExampleItem,
  BlockItem,
  ComponentItem,
  RegistryManifestEntry,
  RegistryManifest,
} from "./registry/index.js";

export {
  ITEM_TYPES,
  FILE_TYPES,
  ITEM_TYPE_DIRS,
  isExampleItem,
  isBlockItem,
  isComponentItem,
} from "./registry/index.js";
