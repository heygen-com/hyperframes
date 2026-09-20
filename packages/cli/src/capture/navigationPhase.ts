/* oxlint-disable no-unused-vars */
import { NavigationDeadlineError } from "./captureAttempt.js";
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

export async function runNavigationChecks(context: PhaseContext): Promise<Record<string, unknown>> {
  let { page1, chromeBrowser, cdp, cdpAnims, state, url, outputDir, timeout, settleTime, warnings, progress, budgetMs, remainingMs, pageContentCheck, contentCheckTimedOut, postNavigationDeadline, httpStatus, phase, discoveredLotties, lottieDiscovery, discoveredVideoUrls, animationCatalog, capturedShaders, catalogedAssets, detectedLibraries, visibleTextContent, faviconLinks, tokens, extracted, screenshots, skipAssets, skipVision, downloadByteBudget, assets, dropped, fontDrops } = context as any;
  let navigation;
  try {
    navigation = await navigateForCapture(page1, url, timeout);
  } catch (err) {
    if (isNavigationTimeoutError(err)) throw new NavigationDeadlineError(err);
    throw err;
  }
  const navigationResponse = navigation.response;
  if (navigation.fellBackFromNetworkIdle) {
    warnings.push(
      `networkidle2 timed out after ${navigation.networkIdleTimeoutMs}ms; continued with domcontentloaded`,
    );
    progress(
      "warn",
      `networkidle2 timed out after ${navigation.networkIdleTimeoutMs}ms; continuing with domcontentloaded`,
    );
  }
  postNavigationDeadline = Date.now() + budgetMs;
  await new Promise((r) => setTimeout(r, settleTime));

  try {
    pageContentCheck = (await withRemainingBudget(
      page1.evaluate(`(() => {
  var text = (document.body && document.body.innerText || "").trim();
  var title = document.title || "";
  var hasCfTurnstile = !!document.querySelector('.cf-turnstile, [data-sitekey], iframe[src*="challenges.cloudflare.com"], #challenge-running, #challenge-form');
  var bodyChildCount = document.body ? document.body.children.length : 0;
  return { textLength: text.length, title: title, hasChallengeElement: hasCfTurnstile, bodyChildCount: bodyChildCount };
})()`),
      Math.min(5_000, remainingMs()),
      "content-check",
    )) as typeof pageContentCheck;
  } catch (err) {
    if (!isDegradableEvaluateTimeoutError(err)) {
      throw err;
    }
    contentCheckTimedOut = true;
    const message =
      "post-navigation content check timed out; continuing with HTTP-status blocked-page detection only";
    warnings.push(message);
    progress("warn", message);
  }

  // Persisted before the blocked-page check, so a capture that reaches navigation always leaves
  // a record of what the server said. That makes the file's ABSENCE mean "capture never got a
  // response", which is a third state distinct from a status of 404 and from a status of null.
  httpStatus = navigationResponse ? (navigationResponse as { status: () => number }).status() : null;
  writeResponseRecord(join(outputDir, "extracted"), { status: httpStatus });

  const blockedReason = detectBlockedPage({
    httpStatus,
    ...(contentCheckTimedOut
      ? {
          title: "",
          textLength: 0,
          bodyChildCount: 0,
          hasChallengeElement: false,
        }
      : pageContentCheck),
  });
  if (blockedReason) {
    phase("navigation", "degraded", "blocked");
    throw new Error(blockedReason);
  }

  phase("navigation", "completed");
  phase("core-extraction", "started");

  return { pageContentCheck, contentCheckTimedOut, httpStatus, postNavigationDeadline };
}
