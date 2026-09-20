import { LottieDiscovery } from "./lottieDiscovery.js";
import { createCaptureDownloadBudget } from "./readBoundedResponse.js";
/**
 * Website capture orchestrator.
 *
 * Two-pass capture approach:
 * Pass 1: Full page load (all JS) → catalog animations + snapshot canvases
 * Pass 2: Framework scripts blocked → extract stable HTML/CSS
 *
 * This ensures we get both:
 * - Rich animation metadata for Claude Code to recreate
 * - Stable, renderable HTML that won't crash in Puppeteer
 */

import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { noDrops } from "./assetDownloader.js";
import type { IconCandidate } from "./faviconRanker.js";
import { CAPTURE_USER_AGENT } from "./userAgent.js";
import { setupAnimationCapture, startCdpAnimationCapture } from "./animationCataloger.js";
import type { DiscoveredLottie } from "./mediaCapture.js";
import { detectLibraries } from "./contentExtractor.js";
import { loadEnvFile, generateProjectScaffold } from "./scaffolding.js";
import { captureProtocolTimeoutMs } from "./captureTimeout.js";
import type {
  CaptureOptions,
  CapturePhase,
  CapturePhaseProgress,
  CaptureResult,
  DesignTokens,
  ExtractedHtml,
} from "./types.js";
import { createCaptureWatchdog } from "./captureWatchdog.js";
import { captureBrowserArgs } from "./browserLaunchArgs.js";
import { createPartialCaptureState } from "./partialCapture.js";
import { runNavigationChecks } from "./navigationPhase.js";
import { runCoreExtraction } from "./coreExtractionPhase.js";
import { runPostExtraction } from "./postExtractionPhase.js";

const DEFAULT_POST_NAVIGATION_BUDGET_MS = 120_000;

export async function captureWebsiteAttempt(
  opts: CaptureOptions,
  onProgress?: (stage: string, detail?: string) => void,
  disableWebgl = false,
  watchdog = createCaptureWatchdog(undefined),
  state = createPartialCaptureState(opts),
): Promise<CaptureResult> {
  const {
    url,
    outputDir,
    viewportWidth = 1920,
    viewportHeight = 1080,
    timeout = 120000,
    settleTime = 3000,
    maxScreenshots: _maxScreenshots = 24,
    skipAssets = false,
    skipVision = false,
    postNavigationBudgetMs = DEFAULT_POST_NAVIGATION_BUDGET_MS,
    onPhase,
  } = opts;

  const downloadByteBudget = createCaptureDownloadBudget();
  const warnings: string[] = [...state.warnings];
  state.warnings = warnings;
  const progress = (stage: string, detail?: string) => {
    onProgress?.(stage, detail);
  };
  const budgetMs =
    Number.isFinite(postNavigationBudgetMs) && postNavigationBudgetMs > 0
      ? postNavigationBudgetMs
      : DEFAULT_POST_NAVIGATION_BUDGET_MS;
  let postNavigationDeadline: number | undefined;
  const remainingMs = (): number =>
    postNavigationDeadline === undefined
      ? budgetMs
      : Math.max(0, postNavigationDeadline - Date.now());
  let lastPhase: CapturePhaseProgress = {
    schema: "hyperframes.capture.phase.v1",
    phase: "browser",
    status: "started",
    remainingMs: null,
  };
  const phase = (
    name: CapturePhase,
    status: CapturePhaseProgress["status"],
    reason?: CapturePhaseProgress["reason"],
  ): void => {
    if (watchdog.expired()) return;
    const remaining = postNavigationDeadline === undefined ? null : remainingMs();
    lastPhase = reason
      ? {
          schema: "hyperframes.capture.phase.v1",
          phase: name,
          status,
          remainingMs: remaining,
          reason,
        }
      : { schema: "hyperframes.capture.phase.v1", phase: name, status, remainingMs: remaining };
    onPhase?.(lastPhase);
  };

  phase("browser", "started");

  // Load .env file from repo root if it exists (for GEMINI_API_KEY, etc.)
  loadEnvFile(outputDir);

  // Create output directories
  mkdirSync(join(outputDir, "extracted"), { recursive: true });
  mkdirSync(join(outputDir, "screenshots"), { recursive: true });
  mkdirSync(join(outputDir, "assets"), { recursive: true });

  // Launch browser
  progress("browser", "Launching headless Chrome...");
  const { ensureBrowser } = await import("../browser/manager.js");
  const browser = await ensureBrowser();
  const puppeteer = await import("puppeteer-core");
  const chromeBrowser = await puppeteer.default.launch({
    headless: true,
    executablePath: browser.executablePath,
    protocolTimeout: captureProtocolTimeoutMs(timeout, budgetMs),
    args: captureBrowserArgs(disableWebgl, viewportWidth, viewportHeight),
  });
  watchdog.registerBrowser(chromeBrowser);

  let animationCatalog: CaptureResult["animationCatalog"];
  let tokens: DesignTokens = state.tokens;
  let extracted: ExtractedHtml = state.extracted;
  let screenshots: string[] = [];
  let catalogedAssets: import("./assetCataloger.js").CatalogedAsset[] = [];
  let capturedShaders: Array<{ type: string; source: string }> | undefined;
  let visibleTextContent = "";
  let faviconLinks: IconCandidate[] = [];
  let detectedLibraries: Awaited<ReturnType<typeof detectLibraries>> = [];
  let assets: CaptureResult["assets"] = [];
  let dropped = noDrops();
  let fontDrops = noDrops();
  let httpStatus: number | null = null;
  let pageContentCheck = {
    textLength: 0,
    title: "",
    hasChallengeElement: false,
    bodyChildCount: Number.POSITIVE_INFINITY,
  };
  let contentCheckTimedOut = false;

  try {
    // ═══════════════════════════════════════════════════════════════
    // PASS 1: Full page load — all JS runs
    // Goal: Catalog animations + take screenshots (with JS rendering)
    // ═══════════════════════════════════════════════════════════════

    phase("browser", "completed");
    phase("navigation", "started");
    progress("animations", "Cataloging animations (full JS)...");

    const page1 = await chromeBrowser.newPage();
    await page1.setViewport({ width: viewportWidth, height: viewportHeight });
    await page1.setUserAgent(CAPTURE_USER_AGENT);

    // Set up hooks BEFORE navigation
    await setupAnimationCapture(page1);
    const { cdp, animations: cdpAnims } = await startCdpAnimationCapture(page1);

    // Hook WebGL to capture shader source code (GLSL)
    // Captured shaders inform Claude Code about the site's visual effects
    // and enable reliable library detection (Three.js/PixiJS/Babylon.js uniforms survive bundling)
    await page1.evaluateOnNewDocument(`
      var origGetContext = HTMLCanvasElement.prototype.getContext;
      window.__capturedShaders = [];
      HTMLCanvasElement.prototype.getContext = function(type, attrs) {
        var ctx = origGetContext.call(this, type, attrs);
        if (ctx && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) {
          window.__hfWebglSeen = true;
          if (ctx.shaderSource && !ctx.__hfHooked) {
            var origShaderSource = ctx.shaderSource.bind(ctx);
            ctx.shaderSource = function(shader, source) {
              try {
                var shaderType = ctx.getShaderParameter(shader, ctx.SHADER_TYPE);
                window.__capturedShaders.push({
                  type: shaderType === ctx.VERTEX_SHADER ? 'vertex' : 'fragment',
                  source: source.slice(0, 5000)
                });
              } catch(e) {}
              return origShaderSource(shader, source);
            };
            ctx.__hfHooked = true;
          }
        }
        return ctx;
      };
    `);

    // Intercept network responses to detect Lottie JSON files
    const discoveredLotties: DiscoveredLottie[] = [];
    const lottieDiscovery = new LottieDiscovery();
    // Layer 1 (passive video discovery): every direct-video URL the page fetches
    // over the whole session (load / scroll / carousel rotation), independent of
    // whether a <video> for it exists at snapshot time. captureVideoManifest
    // downloads these (guarded) and merges them into the manifest.
    const discoveredVideoUrls = new Set<string>();
    page1.on("response", (response) => {
      try {
        const responseUrl = response.url();
        if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(responseUrl)) {
          discoveredVideoUrls.add(responseUrl);
        }
        lottieDiscovery.collect(response);
      } catch {
        /* not JSON or parse error — skip */
      }
    });

    const navigationResult = await runNavigationChecks({
      page1,
      url,
      timeout,
      settleTime,
      budgetMs,
      warnings,
      progress,
      remainingMs,
      pageContentCheck,
      contentCheckTimedOut,
      postNavigationDeadline,
      outputDir,
      phase,
      httpStatus,
      canWrite: () => !watchdog.expired(),
    });
    ({ pageContentCheck, contentCheckTimedOut, httpStatus, postNavigationDeadline } =
      navigationResult);

    const coreResult = await runCoreExtraction({
      page1,
      chromeBrowser,
      cdp,
      cdpAnims,
      state,
      outputDir,
      warnings,
      progress,
      remainingMs,
      pageContentCheck,
      contentCheckTimedOut,
      discoveredLotties,
      lottieDiscovery,
      discoveredVideoUrls,
      animationCatalog,
      capturedShaders,
      catalogedAssets,
      detectedLibraries,
      visibleTextContent,
      faviconLinks,
      tokens,
      extracted,
      screenshots,
      downloadByteBudget,
      canWrite: () => !watchdog.expired(),
    });
    ({
      animationCatalog,
      capturedShaders,
      catalogedAssets,
      detectedLibraries,
      visibleTextContent,
      faviconLinks,
      tokens,
      extracted,
      screenshots,
    } = coreResult);

    phase("core-extraction", "completed");
    const postResult = await runPostExtraction({
      state,
      outputDir,
      warnings,
      progress,
      remainingMs,
      phase,
      animationCatalog,
      catalogedAssets,
      visibleTextContent,
      faviconLinks,
      tokens,
      extracted,
      skipAssets,
      skipVision,
      downloadByteBudget,
      assets,
      dropped,
      fontDrops,
      canWrite: () => !watchdog.expired(),
    });
    ({ assets, dropped, fontDrops, extracted, tokens, animationCatalog } = postResult);

    // Generate project scaffold (index.html, meta.json, CLAUDE.md)
    phase("scaffold", "started");
    if (!watchdog.expired()) {
      await generateProjectScaffold(
        outputDir,
        url,
        tokens,
        animationCatalog,
        screenshots.length > 0,
        discoveredLotties.length > 0,
        existsSync(join(outputDir, "extracted", "shaders.json")),
        catalogedAssets,
        progress,
        warnings,
        detectedLibraries,
      );
    }
    phase("scaffold", "completed");

    progress("done", "Capture complete");
    phase("complete", "completed");

    return {
      ok: true,
      projectDir: outputDir,
      url,
      httpStatus,
      title: tokens.title,
      extracted,
      screenshots,
      tokens,
      assets,
      dropped,
      animationCatalog,
      warnings,
      lastPhase,
    };
  } finally {
    watchdog.unregisterBrowser(chromeBrowser);
    await chromeBrowser.close();
  }
}
