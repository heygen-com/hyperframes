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

type ContentCheck = {
  textLength: number;
  title: string;
  hasChallengeElement: boolean;
  bodyChildCount: number;
};

type NavigationContext = PhaseContext & {
  url: string;
  timeout: number;
  settleTime: number;
  budgetMs: number;
  warnings: string[];
  progress: (stage: string, detail?: string) => void;
  remainingMs: () => number;
  pageContentCheck: ContentCheck;
  contentCheckTimedOut: boolean;
  postNavigationDeadline?: number;
  outputDir: string;
  phase: (name: any, status: any, reason?: any) => void;
  httpStatus: number | null;
};

async function navigatePage(context: NavigationContext) {
  let navigation;
  try {
    navigation = await navigateForCapture(context.page1, context.url, context.timeout);
  } catch (err) {
    if (isNavigationTimeoutError(err)) throw new NavigationDeadlineError(err);
    throw err;
  }
  if (navigation.fellBackFromNetworkIdle) {
    context.warnings.push(
      `networkidle2 timed out after ${navigation.networkIdleTimeoutMs}ms; continued with domcontentloaded`,
    );
    context.progress(
      "warn",
      `networkidle2 timed out after ${navigation.networkIdleTimeoutMs}ms; continuing with domcontentloaded`,
    );
  }
  context.postNavigationDeadline = Date.now() + context.budgetMs;
  await new Promise((resolve) => setTimeout(resolve, context.settleTime));
  return navigation;
}

async function checkPageContent(context: NavigationContext): Promise<ContentCheck> {
  try {
    return (await withRemainingBudget(
      context.page1.evaluate(`(() => {
  var text = (document.body && document.body.innerText || "").trim();
  var title = document.title || "";
  var hasCfTurnstile = !!document.querySelector('.cf-turnstile, [data-sitekey], iframe[src*="challenges.cloudflare.com"], #challenge-running, #challenge-form');
  var bodyChildCount = document.body ? document.body.children.length : 0;
  return { textLength: text.length, title: title, hasChallengeElement: hasCfTurnstile, bodyChildCount: bodyChildCount };
})()`),
      Math.min(5_000, context.remainingMs()),
      "content-check",
    )) as ContentCheck;
  } catch (err) {
    if (!isDegradableEvaluateTimeoutError(err)) throw err;
    context.contentCheckTimedOut = true;
    const message =
      "post-navigation content check timed out; continuing with HTTP-status blocked-page detection only";
    context.warnings.push(message);
    context.progress("warn", message);
    return context.pageContentCheck;
  }
}

function persistNavigationResult(
  context: NavigationContext,
  navigationResponse: unknown,
  pageContentCheck: ContentCheck,
): void {
  context.httpStatus = navigationResponse
    ? (navigationResponse as { status: () => number }).status()
    : null;
  writeResponseRecord(join(context.outputDir, "extracted"), { status: context.httpStatus });
  const blockedReason = detectBlockedPage({
    httpStatus: context.httpStatus,
    ...(context.contentCheckTimedOut
      ? { title: "", textLength: 0, bodyChildCount: 0, hasChallengeElement: false }
      : pageContentCheck),
  });
  if (blockedReason) {
    context.phase("navigation", "degraded", "blocked");
    throw new Error(blockedReason);
  }
}

export async function runNavigationChecks(
  context: NavigationContext,
): Promise<Record<string, unknown>> {
  const navigation = await navigatePage(context);
  const pageContentCheck = await checkPageContent(context);
  persistNavigationResult(context, navigation.response, pageContentCheck);
  context.phase("navigation", "completed");
  context.phase("core-extraction", "started");
  return {
    pageContentCheck,
    contentCheckTimedOut: context.contentCheckTimedOut,
    httpStatus: context.httpStatus,
    postNavigationDeadline: context.postNavigationDeadline,
  };
}
