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
} from "./core.types";

export {
  CANVAS_DIMENSIONS,
  VALID_CANVAS_RESOLUTIONS,
  normalizeResolutionFlag,
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
  isStringVariable,
  isNumberVariable,
  isColorVariable,
  isBooleanVariable,
  isEnumVariable,
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

// Parsers — recast-free GSAP helpers only. The AST parser (parseGsapScript and
// the script-mutation helpers) depends on recast/@babel/parser, which break in
// browser/SSR bundles; it is reachable only via the Node-only
// `@hyperframes/core/gsap-parser` subpath.
export type { GsapAnimation, GsapMethod, ParsedGsap } from "./parsers/gsapSerialize";

export {
  serializeGsapAnimations,
  getAnimationsForElementId,
  validateCompositionGsap,
  keyframesToGsapAnimations,
  gsapAnimationsToKeyframes,
} from "./parsers/gsapSerialize";

export type { ParsedHtml, CompositionMetadata } from "./parsers/htmlParser";

export {
  parseHtml,
  updateElementInHtml,
  addElementToHtml,
  removeElementFromHtml,
  validateCompositionHtml,
  extractCompositionMetadata,
} from "./parsers/htmlParser";

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

export {
  compileTimingAttrs,
  injectDurations,
  extractResolvedMedia,
  clampDurations,
  shouldClampMediaDuration,
} from "./compiler/timingCompiler";

// Lint
export type {
  HyperframeLintSeverity,
  HyperframeLintFinding,
  HyperframeLintResult,
  HyperframeLinterOptions,
} from "./lint/types";
export { lintHyperframeHtml } from "./lint/hyperframeLinter";
export {
  rewriteAssetPaths,
  rewriteAssetPath,
  rewriteCssAssetUrls,
} from "./compiler/rewriteSubCompPaths";
export { CSS_URL_RE, isNonRelativeUrl, isPathInside } from "./compiler/assetPaths";
export { decodeUrlPathVariants } from "./utils/urlPath";

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
