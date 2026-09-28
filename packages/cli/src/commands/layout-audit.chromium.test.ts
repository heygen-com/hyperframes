import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import puppeteer, { type Browser } from "puppeteer-core";

declare global {
  interface Window {
    __hyperframesLayoutAudit(options: { time: number; tolerance: number }): { code: string }[];
  }
}

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
const script = readFileSync(new URL("./layout-audit.browser.js", import.meta.url), "utf8");

describe.runIf(executablePath)("layout audit in Chromium", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath, args: ["--no-sandbox"] });
  });
  afterAll(async () => {
    await browser?.close();
  });

  it.each([
    { name: "line-height 1", css: "height:120px", textStyle: "", error: false },
    { name: "line-height .9", css: "height:108px;line-height:.9", textStyle: "", error: false },
    { name: "line-height .98", css: "height:117.6px;line-height:.98", textStyle: "", error: false },
    {
      name: "parked flush below",
      css: "height:120px",
      textStyle: "transform:translateY(120px)",
      error: false,
    },
    {
      name: "parked flush above",
      css: "height:120px",
      textStyle: "transform:translateY(-120px)",
      error: false,
    },
    {
      name: "parked with empty leading inside the window",
      css: "height:120px",
      textStyle: "transform:translateY(114px)",
      error: false,
    },
    { name: "partial cut", css: "height:60px", textStyle: "", error: true },
    {
      name: "scaled partial cut",
      css: "height:60px;transform:scale(.5);transform-origin:top left",
      textStyle: "",
      error: true,
    },
    {
      name: "RTL left cut",
      css: "height:120px;direction:rtl",
      textStyle: "transform:translateX(-100px)",
      error: true,
    },
    {
      name: "vertical cut",
      css: "height:60px;writing-mode:vertical-rl",
      textStyle: "",
      error: true,
    },
  ])("handles $name", async ({ css, textStyle, error }) => {
    const page = await browser.newPage();
    try {
      await page.setContent(`<body style="margin:0">
        <div data-composition-id="main" data-width="1000" data-height="800" style="width:1000px;height:800px">
          <div style="position:absolute;left:100px;top:100px;width:400px;overflow:hidden;font:120px/1 Arial;${css}">
            <div style="${textStyle}">HELLO</div>
          </div>
        </div></body>`);
      await page.addScriptTag({ content: script });
      const issues = await page.evaluate(() =>
        window.__hyperframesLayoutAudit({ time: 1, tolerance: 2 }),
      );
      expect(issues.some((issue) => issue.code === "text_box_overflow")).toBe(error);
    } finally {
      await page.close();
    }
  });
});
