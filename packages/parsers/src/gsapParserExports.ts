/** Browser-safe GSAP entry: shared helpers and the Acorn reader.
 * Legacy AST mutations remain available through the gsap-parser-recast subpath. */
export type {
  GsapAnimation,
  GsapMethod,
  GsapKeyframesData,
  GsapPercentageKeyframe,
  SourcedGsapPercentageKeyframe,
  ParsedGsap,
  ArcPathConfig,
  ArcPathSegment,
  GsapProvenanceKind,
  GsapProvenance,
  KeyframeEditability,
} from "./gsapSerialize.js";
export {
  isStudioHoldSet,
  serializeGsapAnimations,
  getAnimationsForElementId,
  validateCompositionGsap,
  keyframesToGsapAnimations,
  gsapAnimationsToKeyframes,
  editabilityForProvenance,
  SUPPORTED_PROPS,
  SUPPORTED_EASES,
} from "./gsapSerialize.js";
export type { PropertyGroupName } from "./gsapConstants.js";
export {
  GSAP_PROPERTY_DEFAULTS,
  PROPERTY_GROUPS,
  classifyPropertyGroup,
  classifyTweenPropertyGroup,
} from "./gsapConstants.js";
export { generateSpringEaseData, SPRING_PRESETS } from "./springEase.js";
export type { SpringPreset } from "./springEase.js";
export { parseGsapScriptAcorn as parseGsapScript } from "./gsapParserAcorn.js";
export type { SplitAnimationsOptions, SplitAnimationsResult } from "./gsapSerialize.js";
