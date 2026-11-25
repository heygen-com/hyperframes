import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { describe, expect, it } from "vitest";

const executablePath =
  process.env.HF_BEGINFRAME_SHELL ||
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  process.env.HYPERFRAMES_BROWSER_PATH;

describe.runIf(executablePath)("Swiss Grid A-roll in Chromium", () => {
  it("starts the video wrapper at the canvas origin before timeline translations", async () => {
    const html = readFileSync(
      new URL("../../../../registry/examples/swiss-grid/index.html", import.meta.url),
      "utf8",
    );
    const browser = await puppeteer.launch({ executablePath, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setJavaScriptEnabled(false);
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      const origin = await page.$eval("#short_mag_cut_frame", (wrapper) => {
        const { x, y } = wrapper.getBoundingClientRect();
        return { x, y };
      });
      expect(origin).toEqual({ x: 0, y: 0 });
    } finally {
      await browser.close();
    }
  });
});
