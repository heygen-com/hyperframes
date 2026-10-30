import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import puppeteer, { type Browser } from "puppeteer-core";

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
const componentHtml = readFileSync(
  new URL(
    "../../../../registry/components/caption-highlight/caption-highlight.html",
    import.meta.url,
  ),
  "utf8",
);
const gsapScript = readFileSync(
  createRequire(new URL("../../../core/package.json", import.meta.url)).resolve(
    "gsap/dist/gsap.min.js",
  ),
  "utf8",
);

/** Scaled demo words: the last group opens before the old 7.95 s cap and its last word ends after it. */
const STRETCH = 1.15;
const LAST_WORD_START_S = 7.3 * STRETCH;
const LAST_WORD_END_S = 7.7 * STRETCH;

function stretchedComponent(): string {
  const wordsStart = componentHtml.indexOf("var WORDS = [");
  const wordsEnd = componentHtml.indexOf("];", wordsStart);
  const words = componentHtml
    .slice(wordsStart, wordsEnd)
    .replace(/(start|end): ([\d.]+)/g, (_, key, value) => `${key}: ${Number(value) * STRETCH}`);
  return (componentHtml.slice(0, wordsStart) + words + componentHtml.slice(wordsEnd)).replace(
    /<script src="https:[^"]*gsap[^"]*"><\/script>/,
    `<script>${gsapScript}</script>`,
  );
}

describe.runIf(executablePath)("caption-highlight last group in Chromium", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath, args: ["--no-sandbox"] });
  });

  afterAll(async () => {
    await browser?.close();
  });

  async function lastGroupVisibleAt(time: number): Promise<boolean> {
    const page = await browser.newPage();
    try {
      await page.setContent(stretchedComponent());
      return await page.evaluate((t) => {
        const timeline = (
          window as unknown as { __timelines: Record<string, { seek(t: number): void }> }
        ).__timelines["caption-highlight"];
        timeline!.seek(t);
        const groups = document.querySelectorAll(".hl-group");
        const style = getComputedStyle(groups[groups.length - 1]!);
        return style.visibility !== "hidden" && Number(style.opacity) > 0;
      }, time);
    } finally {
      await page.close();
    }
  }

  it("shows the last phrase from its first word to just before its last word ends", async () => {
    expect(await lastGroupVisibleAt(LAST_WORD_START_S)).toBe(true);
    expect(await lastGroupVisibleAt(LAST_WORD_END_S - 0.05)).toBe(true);
  });
});
