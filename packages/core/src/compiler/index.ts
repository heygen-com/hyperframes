// Timing resolver — shared pure resolver for word-anchored elastic timing (WS-C).
// Consumed by both preview (sdk) and render (timingCompiler) paths.
export {
  resolveTimings,
  type WordTiming,
  type ElementAnchor,
  type AuthoredTiming,
  type ResolvedTiming,
  type ResolveTimingsInput,
  type ResolveTimingsResult,
} from "./timingResolver";

// Timing compiler (browser-safe)
export {
  compileTimingAttrs,
  injectDurations,
  extractResolvedMedia,
  clampDurations,
  shouldClampMediaDuration,
  shouldClampResolvedMediaDuration,
  type UnresolvedElement,
  type ResolvedDuration,
  type ResolvedMediaElement,
  type CompilationResult,
} from "./timingCompiler";

// HTML compiler (Node.js — requires fs)
export { compileHtml, type MediaDurationProber } from "./htmlCompiler";

// HTML bundler (Node.js — requires fs, linkedom, esbuild)
export {
  assignBundledRuntimeCompositionIds,
  type BundledHostCompositionIdentity,
  bundleToSingleHtml,
  type BundleOptions,
  prepareFlattenedInnerRoot,
  FLATTENED_INNER_ROOT_STRIP_ATTRS,
  emitRootCompositionVariableStyles,
} from "./htmlBundler";
export { readDeclaredDefaults, parseHostVariableValues } from "../runtime/getVariables";

export {
  RUNTIME_BOOTSTRAP_ATTR,
  injectScriptsAtHeadStart,
  injectScriptsIntoHtml,
  parseHTMLContent,
  stripEmbeddedRuntimeScripts,
} from "./htmlDocument";

// Static guard
export {
  validateHyperframeHtmlContract,
  type HyperframeStaticFailureReason,
  type HyperframeStaticGuardResult,
} from "./staticGuard";

// Composition isolation helpers
export {
  buildVariablesByCompScript,
  scopeCssToComposition,
  wrapScopedCompositionScript,
} from "./compositionScoping";

// Sub-composition inlining (shared between bundler and producer)
export {
  inlineSubCompositions,
  type InlineSubCompositionsOptions,
  type InlineSubCompositionsResult,
} from "./inlineSubCompositions";

// Sub-composition usability check (shared between the inliner, lint, and the
// render pre-flight abort) — single source of truth for "is this
// data-composition-src file usable?"
export {
  checkSubCompositionUsability,
  type ParsableDocumentLike,
  type SubCompositionValidity,
  type SubCompositionValidityReason,
} from "./subCompositionValidity";

// Asset-path primitives (shared across core, producer, CLI)
export { CSS_URL_RE, PATH_ATTRS, isNonRelativeUrl, isPathInside } from "./assetPaths";
