// Timing compiler (browser-safe)
export {
  compileTimingAttrs,
  injectDurations,
  extractResolvedMedia,
  clampDurations,
  shouldClampMediaDuration,
  type UnresolvedElement,
  type ResolvedDuration,
  type ResolvedMediaElement,
  type CompilationResult,
} from "./timingCompiler";

// HTML compiler (Node.js — requires fs)
export { compileHtml, type MediaDurationProber } from "./htmlCompiler";

// HTML bundler (Node.js — requires fs, linkedom, esbuild)
export {
  bundleToSingleHtml,
  type BundleOptions,
  prepareFlattenedInnerRoot,
  FLATTENED_INNER_ROOT_STRIP_ATTRS,
} from "./htmlBundler";

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
export { scopeCssToComposition, wrapScopedCompositionScript } from "./compositionScoping";

// Sub-composition inlining (shared between bundler and producer)
export {
  inlineSubCompositions,
  type InlineSubCompositionsOptions,
  type InlineSubCompositionsResult,
} from "./inlineSubCompositions";

// Asset-path primitives (shared across core, producer, CLI)
export { CSS_URL_RE, PATH_ATTRS, isNonRelativeUrl, isPathInside } from "./assetPaths";
