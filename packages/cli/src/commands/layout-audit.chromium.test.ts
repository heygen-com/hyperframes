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

const heading = (top: number, text: string, style = "") =>
  `<h1 style="position:absolute;left:100px;top:${top}px;margin:0;font:120px/1 Arial;${style}">${text}</h1>`;
const WORDS_08 =
  '<h1 style="position:absolute;left:120px;top:200px;width:900px;margin:0;font:700 140px/0.8 Arial"><span style="display:inline-block;margin-right:.25em">Launch</span><span style="display:inline-block;margin-right:.25em">faster</span><span style="display:inline-block;margin-right:.25em">ship</span><span style="display:inline-block;margin-right:.25em">sooner</span></h1>';
const WORDS_04 =
  '<h1 style="position:absolute;left:120px;top:200px;width:900px;margin:0;font:700 140px/0.4 Arial"><span style="display:inline-block;margin-right:.25em">Launch</span><span style="display:inline-block;margin-right:.25em">faster</span><span style="display:inline-block;margin-right:.25em">ship</span><span style="display:inline-block;margin-right:.25em">sooner</span></h1>';

describe.runIf(executablePath)("layout audit in Chromium", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath, args: ["--no-sandbox"] });
  });
  afterAll(async () => {
    await browser?.close();
  });

  async function auditCodes(body: string): Promise<string[]> {
    const page = await browser.newPage();
    try {
      await page.setContent(`<body style="margin:0">${body}</body>`);
      await page.addScriptTag({ content: script });
      const issues = await page.evaluate(() =>
        window.__hyperframesLayoutAudit({ time: 1, tolerance: 2 }),
      );
      return issues.map((issue) => issue.code);
    } finally {
      await page.close();
    }
  }

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
    const codes = await auditCodes(`
        <div data-composition-id="main" data-width="1000" data-height="800" style="width:1000px;height:800px">
          <div style="position:absolute;left:100px;top:100px;width:400px;overflow:hidden;font:120px/1 Arial;${css}">
            <div style="${textStyle}">HELLO</div>
          </div>
        </div>`);
    expect(codes.includes("text_box_overflow")).toBe(error);
  });
  it.each([
    { name: "inline-block words wrapping at line-height .8", html: WORDS_08, overlap: false },
    {
      name: "the same words at line-height .4, where the glyphs collide",
      html: WORDS_04,
      overlap: true,
    },
    {
      name: "two headings 60px apart whose letters collide",
      html: heading(100, "HELLO") + heading(160, "WORLD"),
      overlap: true,
    },
    {
      name: "capitalized words 60px apart whose capitals collide",
      html:
        heading(100, "ace", "text-transform:capitalize") +
        heading(160, "ace", "text-transform:capitalize"),
      overlap: true,
    },
    {
      name: "two headings placed on the same spot",
      html: '<h1 style="position:absolute;left:100px;top:100px;margin:0;font:120px/1 Arial">HELLO</h1><h1 style="position:absolute;left:110px;top:110px;margin:0;font:120px/1 Arial">WORLD</h1>',
      overlap: true,
    },
  ])("judges text overlap on the glyphs: $name", async ({ html, overlap }) => {
    const codes = await auditCodes(`
        <div data-composition-id="main" data-width="1920" data-height="1080" style="position:relative;width:1920px;height:1080px">${html}</div>`);
    expect(codes.includes("content_overlap")).toBe(overlap);
  });
});
