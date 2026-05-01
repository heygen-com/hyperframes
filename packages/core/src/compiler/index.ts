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
export { bundleToSingleHtml, type BundleOptions } from "./htmlBundler";

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
