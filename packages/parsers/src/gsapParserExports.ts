/**
 * @hyperframes/core/gsap-parser subpath entry.
 *
 * Re-exports all public types and helpers that external packages (studio, sdk,
 * registry) import via the `@hyperframes/core/gsap-parser` subpath.
 *
 * The recast-based AST parser (gsapParser.ts) was retired in WS-3.F. The read
 * path now uses `parseGsapScriptAcorn` from gsapParserAcorn; the write path
 * uses gsapWriterAcorn. This file remains the stable public surface for types
 * and serialize helpers.
 */
export type {
  GsapAnimation,
  GsapMethod,
  GsapKeyframesData,
  GsapPercentageKeyframe,
  ParsedGsap,
  ArcPathConfig,
  ArcPathSegment,
  GsapProvenanceKind,
  GsapProvenance,
  KeyframeEditability,
} from "./gsapSerialize.js";
export {
  serializeGsapAnimations,
  getAnimationsForElementId,
  validateCompositionGsap,
  keyframesToGsapAnimations,
  gsapAnimationsToKeyframes,
  editabilityForProvenance,
  SUPPORTED_PROPS,
  SUPPORTED_EASES,
} from "./gsapSerialize.js";
// Studio position-hold predicate (`tl.set(...,{data:"hf-hold"})`). A pure
// GsapAnimation helper — re-exported here so studio can filter holds via the
// public entry even though gsapParser.ts is otherwise an internal module.
export { isStudioHoldSet } from "./gsapParser.js";
export type { PropertyGroupName } from "./gsapConstants.js";
export {
  PROPERTY_GROUPS,
  classifyPropertyGroup,
  classifyTweenPropertyGroup,
} from "./gsapConstants.js";
export { generateSpringEaseData, SPRING_PRESETS } from "./springEase.js";
export type { SpringPreset } from "./springEase.js";
export { parseGsapScriptAcorn as parseGsapScript } from "./gsapParserAcorn.js";
export type { SplitAnimationsOptions, SplitAnimationsResult } from "./gsapSerialize.js";
