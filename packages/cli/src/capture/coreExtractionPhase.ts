/* oxlint-disable no-unused-vars */
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

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extractHtml } from "./htmlExtractor.js";
// captureScreenshots removed — full-page screenshot replaces per-section shots
import { extractTokens } from "./tokenExtractor.js";
import { extractDesignStyles } from "./designStyleExtractor.js";
import {
  downloadAssets,
  downloadAndRewriteFonts,
  mergeDrops,
  noDrops,
  totalDrops,
} from "./assetDownloader.js";
import type { IconCandidate } from "./faviconRanker.js";
import { CAPTURE_USER_AGENT } from "./userAgent.js";
import { extractFontMetadata } from "./fontMetadataExtractor.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { diag } from "../ui/diagnostics.js";
// briefGenerator.ts, visual-style, capture-summary removed — DESIGN.md replaces them
import {
  setupAnimationCapture,
  startCdpAnimationCapture,
  collectAnimationCatalog,
} from "./animationCataloger.js";
import {
  saveLottieAnimations,
  renderLottiePreviews,
  captureVideoManifest,
} from "./mediaCapture.js";
import type { DiscoveredLottie } from "./mediaCapture.js";
import {
  detectLibraries,
  extractVisibleText,
  captionImagesWithGemini,
  generateAssetDescriptions,
  resolveVisionPhaseCompletion,
} from "./contentExtractor.js";
import type { VisionCaptionOutcome } from "./contentExtractor.js";
import { loadEnvFile, generateProjectScaffold } from "./scaffolding.js";
import { detectBlockedPage } from "./pageBlockDetection.js";
import { writeResponseRecord } from "./responseRecord.js";
import { navigateForCapture } from "./navigateForCapture.js";
import {
  captureProtocolTimeoutMs,
  isDegradableEvaluateTimeoutError,
  isNavigationTimeoutError,
  withRemainingBudget,
} from "./captureTimeout.js";
import { lazyScrollForCapture } from "./lazyScrollForCapture.js";
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
import { filterExtractedScripts } from "./filterExtractedScripts.js";

/* Extracted capture phase. The phase receives one immutable input object and returns its changed values. */
import type { Page, Browser } from "puppeteer-core";

export interface PhaseContext {
  page1: Page;
  chromeBrowser: Browser;
  [key: string]: unknown;
}

export async function runCoreExtraction(context: PhaseContext): Promise<Record<string, unknown>> {
  let {
    page1,
    chromeBrowser,
    cdp,
    cdpAnims,
    state,
    url,
    outputDir,
    timeout,
    settleTime,
    warnings,
    progress,
    budgetMs,
    remainingMs,
    pageContentCheck,
    contentCheckTimedOut,
    postNavigationDeadline,
    httpStatus,
    phase,
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
    skipAssets,
    skipVision,
    downloadByteBudget,
    assets,
    dropped,
    fontDrops,
  } = context as any;
  const runLazyAndLottie = async (): Promise<void> => {
    if (!contentCheckTimedOut && pageContentCheck.textLength < 100) {
      const reason =
        "Page has very little text content (" +
        pageContentCheck.textLength +
        " chars) — may be blocked or a client-rendered SPA that needs more time";
      warnings.push(reason);
      progress("warn", reason);
    }

    const lazyLoadBudgetMs = Math.min(15_000, remainingMs());
    const lazyScroll = await lazyScrollForCapture(page1, lazyLoadBudgetMs, {
      onWarning: (message) => {
        warnings.push(message);
        progress("warn", message);
      },
    });
    if (lazyScroll.timedOut && !lazyScroll.degraded) {
      const message = `lazy-scroll stopped after ${lazyScroll.steps} steps (budget ${lazyLoadBudgetMs}ms)`;
      warnings.push(message);
      progress("warn", message);
    }
    await new Promise((r) => setTimeout(r, 300));
  };
  await runLazyAndLottie();

  const runAnimationDiscovery = async (): Promise<void> => {
    const scanDomLotties = async (): Promise<void> => {
      // Save discovered Lottie animations
      // Also scan DOM for Lottie web components not caught by network interception
      try {
        const domLotties = await page1.evaluate(`(() => {
    var urls = [];
    document.querySelectorAll('dotlottie-wc, lottie-player, dotlottie-player').forEach(function(el) {
      var src = el.getAttribute('src');
      if (src) urls.push(src);
    });
    // Also check lottie-web registered animations
    if (window.lottie && window.lottie.getRegisteredAnimations) {
      window.lottie.getRegisteredAnimations().forEach(function(anim) {
        if (anim.path) urls.push(anim.path);
      });
    }
    return urls;
  })()`);
        if (Array.isArray(domLotties)) {
          for (const lottieUrl of domLotties) {
            if (
              typeof lottieUrl === "string" &&
              !discoveredLotties.some((l: { url: string }) => l.url === lottieUrl)
            ) {
              discoveredLotties.push({ url: lottieUrl });
            }
          }
        }
      } catch {
        /* DOM scan failed — non-critical */
      }
    };
    await scanDomLotties();

    const collectNetworkLotties = async (): Promise<void> => {
      for (const found of await lottieDiscovery.run(downloadByteBudget, remainingMs)) {
        const existing = discoveredLotties.findIndex(
          (item: { url: string }) => item.url === found.url,
        );
        if (existing < 0) discoveredLotties.push(found);
        else discoveredLotties[existing] = found;
      }
    };
    await collectNetworkLotties();

    const saveDiscoveredLotties = async (): Promise<void> => {
      if (discoveredLotties.length > 0 && remainingMs() > 0) {
        const lottieDir = join(outputDir, "assets", "lottie");
        mkdirSync(lottieDir, { recursive: true });
        const lottieBudget = { remainingMs, byteBudget: downloadByteBudget };
        const savedCount = await saveLottieAnimations(discoveredLotties, lottieDir, lottieBudget);
        // Generate manifest + preview thumbnails so the agent can SEE what each animation is
        if (savedCount > 0 && remainingMs() > 0) {
          await renderLottiePreviews(chromeBrowser, lottieDir, outputDir, lottieBudget);
          progress("lottie", `${savedCount} Lottie animation(s) saved`);
        }
      }
    };
    await saveDiscoveredLotties();
  };
  await runAnimationDiscovery();

  // Save captured WebGL shaders (useful context for shader transitions + library detection)
  const runShaderCapture = async (): Promise<void> => {
    try {
      const shaders = await page1.evaluate(`window.__capturedShaders || []`);
      if (Array.isArray(shaders) && shaders.length > 0) {
        const seen = new Set<string>();
        const unique = (shaders as Array<{ type: string; source: string }>).filter((s) => {
          if (seen.has(s.source)) return false;
          seen.add(s.source);
          return true;
        });
        capturedShaders = unique;
        writeFileSync(
          join(outputDir, "extracted", "shaders.json"),
          JSON.stringify(unique, null, 2),
          "utf-8",
        );
        progress("shaders", `${unique.length} WebGL shader(s) captured`);
      }
    } catch {
      /* shader extraction failed — non-critical */
    }
  };
  await runShaderCapture();

  const runTokenExtraction = async (): Promise<void> => {
    // Extract DOM data before extractHtml mutates image URLs and removes scripts.

    // Extract design tokens
    progress("tokens", "Extracting design tokens...");
    tokens = await extractTokens(page1);
    state.tokens = tokens;
    // Save tokens.json without SVG outerHTML (kept in memory for asset downloader)
    const tokensForDisk = {
      ...tokens,
      svgs: tokens.svgs.map(
        ({ outerHTML: _, ...rest }: { outerHTML?: string; [key: string]: unknown }) => rest,
      ),
    };
    writeFileSync(
      join(outputDir, "extracted", "tokens.json"),
      JSON.stringify(tokensForDisk, null, 2),
      "utf-8",
    );

    // Extract computed design styles (typography, buttons, cards, spacing, shadows)
    progress("style", "Extracting design styles...");
    try {
      const designStyles = await extractDesignStyles(page1);
      state.designStyles = designStyles;
      writeFileSync(
        join(outputDir, "extracted", "design-styles.json"),
        JSON.stringify(designStyles, null, 2),
        "utf-8",
      );
      progress(
        "tokens",
        `${designStyles.typography.length} typography roles, ${designStyles.buttons.length} button styles, ${designStyles.shadows.length} shadow values extracted`,
      );
    } catch (err) {
      const errMsg =
        err instanceof Error ? `${err.message}\n${err.stack}` : normalizeErrorMessage(err);
      console.error(`  ⚠ Design style extraction failed: ${errMsg}`);
      warnings.push(`Design style extraction failed: ${errMsg}`);
    }
  };
  await runTokenExtraction();

  const runAnimationCapture = async (): Promise<void> => {
    progress("animations", "Cataloging animations...");
    try {
      const animationOutcome = await collectAnimationCatalog(page1, cdpAnims, cdp, {
        scrollBudgetMs: Math.min(8_000, remainingMs()),
        evaluateBudgetMs: Math.min(15_000, remainingMs()),
      });
      animationCatalog = animationOutcome.catalog;
      if (animationOutcome.timedOut) {
        const message =
          "animation catalog evaluate timed out; continuing without animation catalog";
        warnings.push(message);
        progress("warn", message);
      }
    } catch (err) {
      if (!isDegradableEvaluateTimeoutError(err)) {
        throw err;
      }
      const message = "animation catalog evaluate timed out; continuing without animation catalog";
      warnings.push(message);
      progress("warn", message);
      try {
        await cdp.send("Animation.disable");
      } catch {
        /* ignore */
      }
    }

    progress("screenshots", "Capturing scroll screenshots...");
    const { captureScrollScreenshots } = await import("./screenshotCapture.js");
    try {
      screenshots = await captureScrollScreenshots(page1, outputDir, { remainingMs });
      state.screenshots = screenshots;
      progress("screenshots", `${screenshots.length} scroll screenshots captured`);
    } catch (err) {
      if (!isDegradableEvaluateTimeoutError(err)) {
        throw err;
      }
      const message = "scroll screenshots timed out; continuing without screenshots";
      warnings.push(message);
      progress("warn", message);
    }
  };
  await runAnimationCapture();

  const runHtmlExtraction = async (): Promise<void> => {
    // Catalog all assets (must run before extractHtml which converts img src to data URLs)
    progress("design", "Cataloging assets...");
    try {
      const { catalogAssets } = await import("./assetCataloger.js");
      catalogedAssets = await catalogAssets(page1);
      progress("design", `${catalogedAssets.length} assets cataloged`);
      if (catalogedAssets.length === 0) {
        warnings.push(
          "Asset catalog is empty — no images will be downloaded. The page may use non-standard image loading.",
        );
      }
    } catch (err) {
      warnings.push(`Asset cataloging failed (no images will be downloaded): ${err}`);
    }

    // ── MUTATION phase: extractHtml modifies the live DOM (converts images to data URLs) ──
    progress("extract", "Extracting HTML & CSS...");
    extracted = await extractHtml(page1, { settleTime: 1000 });
    state.extracted = extracted;

    // Strip framework scripts from the extracted body — keep visual library scripts
    // IMPORTANT: Use non-greedy matching within individual script tags only
    extracted.bodyHtml = extracted.bodyHtml
      // Remove React hydration markers
      .replace(/\s*data-reactroot="[^"]*"/g, "")
      .replace(/\s*data-reactroot/g, "");

    const filteredScripts = filterExtractedScripts(extracted.bodyHtml, extracted.headHtml);
    extracted.bodyHtml = filteredScripts.bodyHtml;
    extracted.headHtml = filteredScripts.headHtml;

    // Generate video manifest — screenshot each <video> element + extract surrounding context
    // so Claude Code can SEE what each video shows and WHERE it was used on the page.
    try {
      const videoBudgetMs = remainingMs();
      if (videoBudgetMs > 0) {
        await captureVideoManifest(page1, outputDir, progress, {
          networkVideoUrls: discoveredVideoUrls, // Layer 1 (live Set, read after sampling)
          sampleMs: Math.min(12000, videoBudgetMs), // Layer 2: poll DOM within the shared budget
          downloadBudgetMs: videoBudgetMs,
          remainingMs,
        });
      }
    } catch {
      /* non-blocking — video manifest is best-effort */
    }

    // Detect JS libraries via globals, DOM fingerprints, script URLs, and shaders
    detectedLibraries = await detectLibraries(page1, capturedShaders);

    // Extract all visible text in DOM order
    visibleTextContent = await extractVisibleText(page1);

    // Extract favicon links before closing page (removed from tokens to reduce noise)
    // `sizes` and `type` are the only evidence of icon quality: page.html on disk does not
    // keep the <link> tags, and the bytes are only fetched for the candidate that wins, so
    // dropping these attributes here makes the choice unrecoverable downstream.
    faviconLinks = (await page1.evaluate(`(() => {
  var iconEls = Array.from(document.querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"]'));
  return iconEls.map(function(l) {
    return {
      rel: l.rel,
      href: l.href,
      sizes: l.getAttribute('sizes'),
      type: l.getAttribute('type'),
    };
  });
})()`)) as IconCandidate[];

    await page1.close();
  };
  await runHtmlExtraction();

  return {
    animationCatalog,
    capturedShaders,
    catalogedAssets,
    detectedLibraries,
    visibleTextContent,
    faviconLinks,
    tokens,
    extracted,
    screenshots,
  };
}
