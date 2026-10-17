/**
 * Screenshot capture for the website capture pipeline.
 *
 * All page.evaluate() calls use string expressions to avoid
 * tsx/esbuild __name injection (see esbuild issue #1031).
 */

import { DEFAULT_MAX_SCREENSHOTS } from "./types.js";
import { CaptureDirRefusedError } from "./captureErrors.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import type { Page } from "puppeteer-core";
import { isDegradableEvaluateTimeoutError } from "./captureTimeout.js";
import { join } from "node:path";
import { ensureCaptureDirSync, writeCaptureFileSync } from "./captureFile.js";

/**
 * Capture viewport screenshots covering the entire page height.
 *
 * Scrolls down the page in viewport-sized steps (with slight overlap),
 * taking a 1920x1080 screenshot at each position. The number of screenshots
 * depends on the page height — short pages get fewer, long pages get more.
 * The limit includes the full-page plate.
 *
 * Unlike the old section-tiling approach, this does NOT disable sticky/fixed
 * elements — screenshots show the page in its natural browsing state with
 * scroll-triggered animations fired.
 */
/**
 * Chrome caps a screenshot at 16384px per side (Skia's max texture dimension); past that the
 * capture comes back clipped or fails outright. Long marketing pages do reach this.
 */
export const MAX_PLATE_HEIGHT_PX = 16384;

export type PlateCaptureResult =
  | { kind: "captured"; file: string }
  | { kind: "omitted"; reason: "height-limit" | "budget-exhausted" };

export interface ScreenshotInterruption {
  reason: "budget-exhausted" | "request-timeout" | "internal-error";
  message: string;
}

export interface ScreenshotCaptureResult {
  files: string[];
  interruption: ScreenshotInterruption | null;
}

/**
 * Pixel height Chrome actually produced, read from the PNG's IHDR chunk: 8-byte signature,
 * then 4 length + 4 type + 4 width + 4 height. Null when the buffer isn't a PNG.
 */
export function pngHeight(buf: Uint8Array): number | null {
  // Byte math rather than Buffer helpers: page.screenshot() resolves to a Uint8Array.
  if (buf.length < 24) return null;
  if (buf[12] !== 0x49 || buf[13] !== 0x48 || buf[14] !== 0x44 || buf[15] !== 0x52) return null; // "IHDR"
  return ((buf[20]! << 24) | (buf[21]! << 16) | (buf[22]! << 8) | buf[23]!) >>> 0;
}

/**
 * One tall image of the whole document — the plate a scroll shot slides its viewport over.
 *
 * This is deliberately 1x. A 2x plate is what you'd want for pushing in without softening
 * text, but doubling a long marketing page blows past `MAX_PLATE_HEIGHT_PX` exactly on the
 * pages that most want a scroll shot; a frame that needs 2x should capture its own region
 * instead. At 1x a 1920-wide plate is pixel-exact for a 1920x1080 viewport travelling down it.
 *
 * Two things have to be true for the plate to be usable, and both are why the earlier
 * `full-page.png` was worth removing rather than keeping as-is:
 *  · It must be taken AFTER the scroll traversal, so lazy images have loaded and
 *    scroll-triggered reveals have fired. A plate shot on arrival is full of blank bands.
 *  · Sticky/fixed chrome has to be neutralised first. `fullPage` bakes a fixed header in at
 *    one position, so a nav ends up frozen across the middle of the plate. The viewport
 *    shots keep sticky on purpose (natural browsing state); the plate cannot.
 *
 * Returns the captured path or the cause for omitting the plate.
 */
export async function captureFullPagePlate(
  page: Pick<Page, "evaluate" | "screenshot">,
  screenshotsDir: string,
  budget: { remainingMs?: () => number; files?: string[] } = {},
): Promise<PlateCaptureResult> {
  // Preserve the inline value and priority: asset and DOM extraction reuse this page afterward.
  await page.evaluate(
    `document.querySelectorAll('*').forEach((el) => {
      const p = getComputedStyle(el).position;
      if (p === 'fixed' || p === 'sticky') {
        el.setAttribute('data-hf-plate-position', el.style.position || '');
        el.setAttribute('data-hf-plate-position-priority', el.style.getPropertyPriority('position'));
        el.style.setProperty('position', 'static', 'important');
      }
    })`,
  );
  try {
    // Measured here — after the caller's scroll traversal AND after neutralisation — never
    // taken from the caller. Both steps grow the document: lazy content loads as the page is
    // scrolled, and forcing fixed/sticky elements to `static` drops them back into flow. A
    // height read before either one is low on exactly the long pages this guard exists for,
    // which would pass the check and let a clipped plate through.
    const docHeight = (await page.evaluate(
      `Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)`,
    )) as number;
    if (docHeight > MAX_PLATE_HEIGHT_PX) return { kind: "omitted", reason: "height-limit" };
    if ((budget.remainingMs?.() ?? 1) <= 0) return { kind: "omitted", reason: "budget-exhausted" };

    const buffer = await page.screenshot({ type: "png", fullPage: true });
    // Confirm what Chrome produced instead of trusting the measurement: the capture itself can
    // trigger another round of lazy loading. A clipped plate is undetectable downstream — the
    // skill only teaches the tile fallback when the file is *absent* — so emit nothing rather
    // than something silently wrong.
    const produced = pngHeight(buffer);
    if (produced != null && produced > MAX_PLATE_HEIGHT_PX)
      return { kind: "omitted", reason: "height-limit" };
    writeCaptureFileSync(join(screenshotsDir, "full-page.png"), buffer);
    budget.files?.push("screenshots/full-page.png");
    return { kind: "captured", file: "screenshots/full-page.png" };
  } finally {
    // A page that broke mid-capture will fail this too; letting that escape would replace the
    // real error with a cleanup one. Nothing to restore if the page is already gone.
    try {
      await page.evaluate(
        `document.querySelectorAll('[data-hf-plate-position]').forEach((el) => {
          el.style.setProperty('position', el.getAttribute('data-hf-plate-position') || '',
            el.getAttribute('data-hf-plate-position-priority') || '');
          el.removeAttribute('data-hf-plate-position');
          el.removeAttribute('data-hf-plate-position-priority');
        })`,
      );
    } catch {
      /* page unusable — the restore is moot */
    }
  }
}

// fallow-ignore-next-line complexity
export async function captureScrollScreenshots(
  page: Page,
  outputDir: string,
  budget: {
    remainingMs?: () => number;
    maxScreenshots?: number;
    /** Shared output preserves written paths when a watchdog ends the pending capture. */
    files?: string[];
  } = {},
): Promise<ScreenshotCaptureResult> {
  const screenshotsDir = join(outputDir, "screenshots");
  ensureCaptureDirSync(outputDir, screenshotsDir);

  const maxScreenshots = budget.maxScreenshots ?? DEFAULT_MAX_SCREENSHOTS;
  const viewportLimit = Math.max(1, maxScreenshots - 1);
  const filePaths: string[] = budget.files ?? [];
  filePaths.length = 0;
  const filenames = new Set<string>();

  const result: ScreenshotCaptureResult = { files: filePaths, interruption: null };
  const budgetSpent = (): boolean => {
    if ((budget.remainingMs?.() ?? 1) > 0) return false;
    result.interruption = {
      reason: "budget-exhausted",
      message: "post-navigation budget exhausted during screenshots",
    };
    return true;
  };
  if (budgetSpent()) return result;

  try {
    // Dismiss marketing banners, cookie consents, and popups before scrolling.
    // These overlay content and contaminate screenshots with UI that doesn't
    // belong in video compositions (cookie popups, newsletter modals, etc.)
    await page
      .evaluate(() => {
        // Click common dismiss/accept buttons
        const selectors = [
          // Cookie consent
          '[id*="cookie"] button[class*="accept"]',
          '[id*="cookie"] button[class*="agree"]',
          '[id*="cookie"] button[class*="allow"]',
          '[class*="cookie"] button[class*="accept"]',
          '[class*="consent"] button',
          // Generic close buttons on overlays/modals
          '[class*="banner"] [class*="close"]',
          '[class*="banner"] [class*="dismiss"]',
          '[class*="popup"] [class*="close"]',
          '[class*="modal"] [class*="close"]',
          '[class*="overlay"] [class*="close"]',
          // Common GDPR patterns — scoped under a cookie/consent/gdpr ancestor
          // so we don't click "Accept invitation" / "Accept terms" / etc. on
          // unrelated buttons elsewhere on the page.
          '[id*="cookie" i] button[id*="accept" i]',
          '[id*="consent" i] button[id*="accept" i]',
          '[id*="gdpr" i] button[id*="accept" i]',
          '[class*="cookie" i] button[class*="accept-all" i]',
          '[class*="cookie" i] button[class*="acceptAll" i]',
          '[class*="consent" i] button[class*="accept-all" i]',
          // Notification prompts
          'button[class*="decline"]',
          'button[class*="not-now"]',
          'button[class*="no-thanks"]',
        ];
        for (const sel of selectors) {
          try {
            const el = document.querySelector<HTMLElement>(sel);
            if (el) el.click();
          } catch {
            /* ignore */
          }
        }
        // Hide fixed/sticky overlays that aren't the main nav. Scanning every
        // element with querySelectorAll('*') + getComputedStyle is O(n) DOM
        // calls and can dominate evaluate() time on large pages. Narrow the
        // candidate set with a TreeWalker that early-exits on viewport-sized
        // rect checks (cheap) before reaching the expensive getComputedStyle.
        const SCAN_CAP = 5000;
        const minWidth = window.innerWidth * 0.3;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let visited = 0;
        let node = walker.nextNode();
        while (node && visited < SCAN_CAP) {
          visited++;
          const el = node as HTMLElement;
          const rect = el.getBoundingClientRect();
          // Cheap viewport-size filter first — eliminates the vast majority of
          // tiny / hidden / off-screen elements without touching getComputedStyle.
          if (rect.height > 80 && rect.width > minWidth) {
            const tag = el.tagName;
            if (tag !== "HEADER" && tag !== "NAV" && !el.closest("header") && !el.closest("nav")) {
              const style = window.getComputedStyle(el);
              if (
                (style.position === "fixed" || style.position === "sticky") &&
                style.zIndex !== "auto" &&
                parseInt(style.zIndex) > 100
              ) {
                el.style.display = "none";
              }
            }
          }
          node = walker.nextNode();
        }
      })
      .catch((err: unknown) => {
        if (isDegradableEvaluateTimeoutError(err)) {
          throw err;
        }
      });
    await new Promise((r) => setTimeout(r, 400));

    const scrollHeight = (await page.evaluate(
      `Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)`,
    )) as number;
    const viewportHeight = (await page.evaluate(`window.innerHeight`)) as number;

    const step = Math.max(1, Math.floor(viewportHeight * 0.7));
    const lastPos = Math.max(0, scrollHeight - viewportHeight);
    const positionCount = Math.ceil(lastPos / step) + 1;
    const count = Math.min(viewportLimit, positionCount);
    const finalPositions: number[] = [];
    for (let i = 0; i < count; i++) {
      const positionIndex = count === 1 ? 0 : Math.round((i * (positionCount - 1)) / (count - 1));
      finalPositions.push(Math.min(positionIndex * step, lastPos));
    }

    for (let i = 0; i < finalPositions.length; i++) {
      if (budgetSpent()) break;
      await page.evaluate(`window.scrollTo(0, ${finalPositions[i]})`);
      await new Promise((r) => setTimeout(r, 400));

      const pct = Math.round(
        (finalPositions[i]! / Math.max(1, scrollHeight - viewportHeight)) * 100,
      );
      const stem = `scroll-${String(Math.min(pct, 100)).padStart(3, "0")}`;
      let filename = `${stem}.png`;
      if (filenames.has(filename)) filename = `${stem}-${i}.png`;
      filenames.add(filename);
      const filePath = join(screenshotsDir, filename);
      if (budgetSpent()) break;
      const buffer = await page.screenshot({ type: "png" });
      writeCaptureFileSync(filePath, buffer);
      filePaths.push(`screenshots/${filename}`);
    }

    // Reset scroll
    await page.evaluate(`window.scrollTo(0, 0)`);
    await new Promise((r) => setTimeout(r, 200));

    // The scroll plate, last: everything above has loaded the page and fired its reveals, which
    // is the only state a full-page shot is worth taking in. (An earlier full-page.png was
    // dropped because 1/8 agents read it and the contact sheet covered the same ground — that
    // was about it as a *comprehension* artifact. The scroll shot is a different consumer: it
    // needs one continuous plate, which no set of viewport tiles can substitute for.)
    if (filePaths.length < maxScreenshots && !budgetSpent()) {
      const plate = await captureFullPagePlate(page, screenshotsDir, {
        ...budget,
        files: filePaths,
      });
      if (plate.kind === "omitted" && plate.reason === "budget-exhausted") budgetSpent();
    }
  } catch (err) {
    if (err instanceof CaptureDirRefusedError) throw err;
    result.interruption = {
      reason: isDegradableEvaluateTimeoutError(err) ? "request-timeout" : "internal-error",
      message: normalizeErrorMessage(err),
    };
  }

  return result;
}
