// Pure, browser-safe composition primitives (data types, font aliases, URL
// helper). Recast/linkedom-free, so browser consumers (e.g. the lint rule
// engine via @hyperframes/lint/browser) can import these without pulling the
// GSAP/HTML parser machinery from the main entry.
export * from "./types.js";
export {
  FONT_ALIAS_MAP,
  FONT_ALIAS_KEYS,
  CANONICAL_FONT_DISPLAY_NAMES,
  resolveAliasDisplayName,
} from "./fontAliases.js";
export { decodeUrlPathVariants } from "./utils/urlPath.js";
export {
  parseCompositionVariables,
  isCompositionVariable,
  isScalarVariableValue,
} from "./compositionVariables.js";
export { scanVariableUsage, type VariableUsageScan } from "./variableUsage.js";
export * from "./compositionContract.js";
