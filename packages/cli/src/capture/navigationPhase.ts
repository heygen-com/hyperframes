import { NavigationDeadlineError } from "./captureErrors.js";
import { detectBlockedPage } from "./pageBlockDetection.js";
import { navigateForCapture } from "./navigateForCapture.js";
import {
  isDegradableEvaluateTimeoutError,
  isNavigationTimeoutError,
  withRemainingBudget,
} from "./captureTimeout.js";
import { writeResponseRecord } from "./responseRecord.js";
import { join } from "node:path";
import type { CapturePhase, CapturePhaseProgress } from "./types.js";
import type { Page } from "puppeteer-core";

type ContentCheck = {
  textLength: number;
  title: string;
  hasChallengeElement: boolean;
  bodyChildCount: number;
};

export interface NavigationPhaseInput {
  page1: Page;
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
  phase: (
    name: CapturePhase,
    status: CapturePhaseProgress["status"],
    reason?: CapturePhaseProgress["reason"],
  ) => void;
  httpStatus: number | null;
  canWrite: () => boolean;
}

async function navigatePage(context: NavigationPhaseInput) {
  let navigation;
  try {
    navigation = await navigateForCapture(context.page1, context.url, context.timeout);
  } catch (err) {
    if (isNavigationTimeoutError(err)) {
      let webglObserved = false;
      try {
        webglObserved = Boolean(await context.page1.evaluate("Boolean(window.__hfWebglSeen)"));
      } catch {
        /* the browser may already be closing */
      }
      throw new NavigationDeadlineError(err, webglObserved);
    }
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

async function checkPageContent(context: NavigationPhaseInput): Promise<ContentCheck> {
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
  context: NavigationPhaseInput,
  navigationResponse: unknown,
  pageContentCheck: ContentCheck,
): void {
  context.httpStatus = navigationResponse
    ? (navigationResponse as { status: () => number }).status()
    : null;
  if (context.canWrite()) {
    writeResponseRecord(join(context.outputDir, "extracted"), { status: context.httpStatus });
  }
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

export interface NavigationPhaseResult {
  pageContentCheck: ContentCheck;
  contentCheckTimedOut: boolean;
  httpStatus: number | null;
  postNavigationDeadline?: number;
}

export async function runNavigationChecks(
  context: NavigationPhaseInput,
): Promise<NavigationPhaseResult> {
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
