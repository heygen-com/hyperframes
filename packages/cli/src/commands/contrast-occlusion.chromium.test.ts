import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import puppeteer, { type Browser } from "puppeteer-core";

declare global {
  interface Window {
    __contrastAuditPrepare(): { selector: string }[];
  }
}

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
const script = readFileSync(new URL("./contrast-audit.browser.js", import.meta.url), "utf8");

describe.runIf(executablePath)("clipped-text contrast candidates in Chromium", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath, args: ["--no-sandbox"] });
  });

  afterAll(async () => {
    await browser?.close();
  });

  async function audit(
    clipPath: string,
    options: { ancestor?: boolean; nested?: boolean; painted?: boolean } = {},
  ) {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 });
      const clip = `clip-path:${clipPath}`;
      const overlay = options.nested
        ? '<div data-hf-inner-root style="position:absolute;inset:0"></div>'
        : "";
      await page.setContent(`<body style="margin:0">
        <div data-composition-id="main" style="position:relative;width:640px;height:360px;background:white">
          <div style="position:absolute;inset:0;${options.ancestor ? clip : ""}">
            <div id="headline" data-layout-allow-occlusion style="position:absolute;left:60px;top:100px;width:500px;height:80px;font:60px/80px Arial;color:#eee;${options.ancestor ? "" : clip}">Visible copy</div>
          </div>
          <div data-composition-id="overlay" style="position:absolute;inset:0;background:${options.painted ? "white" : "transparent"}">${overlay}</div>
        </div>
      </body>`);
      const image = await page.screenshot();
      await page.addScriptTag({ content: script });
      const selectors = await page.evaluate(() =>
        window.__contrastAuditPrepare().map((entry) => entry.selector),
      );
      return { image, selectors };
    } finally {
      await page.close();
    }
  }

  it("audits an unchanged visible frame when a clip-path is added", async () => {
    const normal = await audit("none");
    const clipped = await audit("inset(0)");
    expect(clipped.image).toEqual(normal.image);
    expect(normal.selectors).toContain("#headline");
    expect(clipped.selectors).toContain("#headline");
  });

  it("audits partially revealed text beneath a transparent composition host", async () => {
    const partial = await audit("inset(0 50% 0 0)");
    const hidden = await audit("inset(0 100% 0 0)");
    expect(partial.image).not.toEqual(hidden.image);
    expect(partial.selectors).toContain("#headline");
    expect(hidden.selectors).not.toContain("#headline");
  });

  it("walks through nested transparent roots for an ancestor clip-path", async () => {
    const clipped = await audit("inset(0)", { ancestor: true, nested: true });
    expect(clipped.selectors).toContain("#headline");
  });

  it.each([{ ancestor: false }, { ancestor: true }])(
    "keeps fully clipped text out of contrast candidates with ancestor=$ancestor",
    async (options) => {
      const hidden = await audit("inset(0 100% 0 0)", options);
      expect(hidden.selectors).not.toContain("#headline");
    },
  );

  it("keeps text behind a painted composition host out of contrast candidates", async () => {
    const covered = await audit("inset(0)", { painted: true });
    expect(covered.selectors).not.toContain("#headline");
  });
});
