import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "puppeteer-core";
import { resolveHeadlessShellPath } from "./browserManager.js";
import { closeTestChrome, launchTestChrome } from "./__fixtures__/loopback.js";
import { readReferenceBackground } from "./referenceBackground.js";
import { initTransparentBackground } from "./screenshotService.js";

const chromePath = process.env.HF_REFERENCE_TEST_CHROME ?? resolveHeadlessShellPath();

describe.skipIf(!chromePath)("browser-computed reference background", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchTestChrome(chromePath);
  });
  afterAll(() => closeTestChrome(browser));

  it.each([
    ["body { background: rgb(10 46 138); }", { kind: "solid", rgb: [10, 46, 138] }],
    [
      "body { background: blue !important; } #film { background: rgb(10 46 138); }",
      { kind: "solid", rgb: [10, 46, 138] },
    ],
    [
      "body { --film-bg: rgb(10 46 138); background: var(--film-bg); }",
      { kind: "solid", rgb: [10, 46, 138] },
    ],
    [
      "#film { background: red !important; } [data-composition-id] { background: blue !important; }",
      { kind: "solid", rgb: [255, 0, 0] },
    ],
    ["body { background: none; }", { kind: "none" }],
    ["", { kind: "unknown" }],
    ["body { background-color: transparent; }", { kind: "unknown" }],
    [
      "body { background: linear-gradient(red, blue); background-color: white; }",
      { kind: "unsupported_non_solid" },
    ],
    [
      "body { background-image: url(data:image/png;base64,broken); background-color: white; }",
      { kind: "unsupported_non_solid" },
    ],
    ["body { background-color: var(--unresolved); }", { kind: "unknown" }],
  ])("reads the real cascade: %s", async (css, expected) => {
    const page = await browser.newPage();
    try {
      await page.setContent(
        `<style>${css}</style><body><div id="film" data-composition-id="film" data-duration="1"></div></body>`,
      );
      expect(await readReferenceBackground(page)).toEqual(expected);
    } finally {
      await page.close();
    }
  });

  it("does not call a known animated background stable", async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`<body style="background:blue"><div data-composition-id="film"></div><script>
        window.__timelines = { film: { getChildren: () => [{ vars: { backgroundColor: 'red' }, targets: () => [document.body] }] } };
      </script></body>`);
      expect(await readReferenceBackground(page)).toEqual({ kind: "unknown" });
    } finally {
      await page.close();
    }
  });

  it("uses the canonical initial JS state before transparent capture changes it", async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`<body style="background: red"><div data-composition-id="film"></div><script>
        window.__hf = { seek: (t) => { document.body.style.background = t === 0 ? 'rgb(10 46 138)' : 'yellow'; } };
      </script></body>`);
      const reference = await readReferenceBackground(page);
      await initTransparentBackground(page);
      expect(reference).toEqual({ kind: "solid", rgb: [10, 46, 138] });
      expect(await readReferenceBackground(page)).toEqual({ kind: "unknown" });
    } finally {
      await page.close();
    }
  });
});
