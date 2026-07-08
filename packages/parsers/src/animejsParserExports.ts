/**
 * @hyperframes/parsers/animejs-parser subpath entry.
 *
 * Stable public surface for anime.js parser model/types. The concrete read path
 * uses `parseAnimeJsScriptAcorn`; writes live behind the writer acorn subpath.
 */
export type {
  AnimeJsAnimation,
  AnimeJsAnimationForInsert,
  AnimeJsKeyframeEditability,
  AnimeJsMethod,
  AnimeJsPrimitive,
  AnimeJsPropertyKeyframe,
  AnimeJsPropertyValue,
  AnimeJsProvenance,
  AnimeJsProvenanceKind,
  AnimeJsRawValue,
  ParsedAnimeJs,
} from "./animeSerialize.js";
export { editabilityForAnimeJsProvenance } from "./animeSerialize.js";
export {
  parseAnimeJsScriptAcorn as parseAnimeJsScript,
  extractAnimeJsLabels,
} from "./animejsParserAcorn.js";
export type { AnimeJsLabelEntry } from "./animejsParserAcorn.js";
export type { AnimeJsPropertyGroupName } from "./animejsConstants.js";
export {
  ANIMEJS_PROPERTY_GROUPS,
  RECOGNIZED_ANIMEJS_EASE_FAMILIES,
  SUPPORTED_ANIMEJS_EASES,
  SUPPORTED_ANIMEJS_PROPS,
  classifyAnimeJsPropertyGroup,
  classifyAnimeJsTweenPropertyGroup,
} from "./animejsConstants.js";
