/**
 * Screenshot capture for the website capture pipeline.
 *
 * All page.evaluate() calls use string expressions to avoid
 * tsx/esbuild __name injection (see esbuild issue #1031).
 */

import type { Page } from "puppeteer-core";
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
export async function captureScrollScreenshots(page: Page, outputDir: string): Promise<string[]> {
  const screenshotsDir = join(outputDir, "screenshots");
  mkdirSync(screenshotsDir, { recursive: true });

  const MAX_SCREENSHOTS = 20;
  const filePaths: string[] = [];

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
      .catch(() => {});
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
      await page.evaluate(`window.scrollTo(0, ${finalPositions[i]})`);
      await new Promise((r) => setTimeout(r, 400));

      const pct = Math.round(
        (finalPositions[i]! / Math.max(1, scrollHeight - viewportHeight)) * 100,
      );
      const filename = `scroll-${String(Math.min(pct, 100)).padStart(3, "0")}.png`;
      const filePath = join(screenshotsDir, filename);
      const buffer = await page.screenshot({ type: "png" });
      writeFileSync(filePath, buffer);
      filePaths.push(`screenshots/${filename}`);
    }

    // Reset scroll
    await page.evaluate(`window.scrollTo(0, 0)`);
    await new Promise((r) => setTimeout(r, 200));

    // full-page.png removed — 1/8 agents read it, contact sheet covers the same content
  } catch {
    /* scroll screenshots are non-critical */
  }

  return filePaths;
}
