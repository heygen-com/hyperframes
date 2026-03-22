// Timing compiler (browser-safe)
export {
  compileTimingAttrs,
  injectDurations,
  extractResolvedMedia,
  clampDurations,
  type UnresolvedElement,
  type ResolvedDuration,
  type ResolvedMediaElement,
  type CompilationResult,
} from "./timingCompiler";

// HTML compiler (Node.js — requires fs)
export { compileHtml, type MediaDurationProber } from "./htmlCompiler";

// HTML bundler (Node.js — requires fs, cheerio, esbuild)
export { bundleToSingleHtml, type BundleOptions } from "./htmlBundler";

// Static guard
export {
  validateHyperframeHtmlContract,
  type HyperframeStaticFailureReason,
  type HyperframeStaticGuardResult,
} from "./staticGuard";
