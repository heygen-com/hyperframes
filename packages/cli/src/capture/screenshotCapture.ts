/**
 * Screenshot capture for the website capture pipeline.
 *
 * All page.evaluate() calls use string expressions to avoid
 * tsx/esbuild __name injection (see esbuild issue #1031).
 */

import type { Page } from "puppeteer-core";
import { isDegradableEvaluateTimeoutError } from "./captureTimeout.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Capture viewport screenshots covering the entire page height.
 *
 * Scrolls down the page in viewport-sized steps (with slight overlap),
 * taking a 1920x1080 screenshot at each position. The number of screenshots
 * depends on the page height — short pages get fewer, long pages get more.
 * Capped at 20 to avoid excessive output on extremely long pages.
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
 * Returns the relative path, or null when the page is too tall to capture in one piece.
 */
export async function captureFullPagePlate(
  page: Page,
  screenshotsDir: string,
  budget: { remainingMs?: () => number } = {},
): Promise<string | null> {
  // Record the inline value before overwriting so the page is handed back unchanged — the
  // caller keeps using it (asset extraction, DOM reads) after this returns.
  await page.evaluate(
    `document.querySelectorAll('*').forEach((el) => {
      const p = getComputedStyle(el).position;
      if (p === 'fixed' || p === 'sticky') {
        el.setAttribute('data-hf-plate-position', el.style.position || '');
        el.style.position = 'static';
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
    if (docHeight > MAX_PLATE_HEIGHT_PX) return null;
    if ((budget.remainingMs?.() ?? 1) <= 0) return null;

    const buffer = await page.screenshot({ type: "png", fullPage: true });
    // Confirm what Chrome produced instead of trusting the measurement: the capture itself can
    // trigger another round of lazy loading. A clipped plate is undetectable downstream — the
    // skill only teaches the tile fallback when the file is *absent* — so emit nothing rather
    // than something silently wrong.
    const produced = pngHeight(buffer);
    if (produced != null && produced > MAX_PLATE_HEIGHT_PX) return null;
    writeFileSync(join(screenshotsDir, "full-page.png"), buffer);
    return "screenshots/full-page.png";
  } finally {
    // A page that broke mid-capture will fail this too; letting that escape would replace the
    // real error with a cleanup one. Nothing to restore if the page is already gone.
    try {
      await page.evaluate(
        `document.querySelectorAll('[data-hf-plate-position]').forEach((el) => {
          el.style.position = el.getAttribute('data-hf-plate-position');
          el.removeAttribute('data-hf-plate-position');
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
  budget: { remainingMs?: () => number } = {},
): Promise<string[]> {
  const screenshotsDir = join(outputDir, "screenshots");
  mkdirSync(screenshotsDir, { recursive: true });

  const MAX_SCREENSHOTS = 20;
  const filePaths: string[] = [];

  if ((budget.remainingMs?.() ?? 1) <= 0) return filePaths;

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

    // Calculate scroll positions: step by 70% of viewport (30% overlap between shots)
    const step = Math.floor(viewportHeight * 0.7);
    const positions: number[] = [0];
    for (let y = step; y < scrollHeight - viewportHeight; y += step) {
      positions.push(y);
    }
    // Always include the bottom of the page
    const lastPos = Math.max(0, scrollHeight - viewportHeight);
    if (positions[positions.length - 1] !== lastPos) {
      positions.push(lastPos);
    }

    // Downsample if too many positions
    let finalPositions = positions;
    if (positions.length > MAX_SCREENSHOTS) {
      finalPositions = [positions[0]!];
      const stride = (positions.length - 1) / (MAX_SCREENSHOTS - 1);
      for (let i = 1; i < MAX_SCREENSHOTS - 1; i++) {
        finalPositions.push(positions[Math.round(i * stride)]!);
      }
      finalPositions.push(positions[positions.length - 1]!);
    }

    for (let i = 0; i < finalPositions.length; i++) {
      if ((budget.remainingMs?.() ?? 1) <= 0) break;
      await page.evaluate(`window.scrollTo(0, ${finalPositions[i]})`);
      await new Promise((r) => setTimeout(r, 400));

      const pct = Math.round(
        (finalPositions[i]! / Math.max(1, scrollHeight - viewportHeight)) * 100,
      );
      const filename = `scroll-${String(Math.min(pct, 100)).padStart(3, "0")}.png`;
      const filePath = join(screenshotsDir, filename);
      if ((budget.remainingMs?.() ?? 1) <= 0) break;
      const buffer = await page.screenshot({ type: "png" });
      writeFileSync(filePath, buffer);
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
    if ((budget.remainingMs?.() ?? 1) > 0) {
      const plate = await captureFullPagePlate(page, screenshotsDir, budget);
      if (plate) filePaths.push(plate);
    }
  } catch (err) {
    if (isDegradableEvaluateTimeoutError(err)) {
      throw err;
    }
    /* scroll screenshots are non-critical */
  }

  return filePaths;
}
