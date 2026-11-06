// Real-Chromium pins for text_in_fallback_face: Chrome says which faces drew the text, so no script is special-cased.
// Skipped without a local Chrome; opt-in on Windows (HYPERFRAMES_BROWSER_TESTS=1), like the other Chromium suites.
import { existsSync, readFileSync } from "node:fs";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findSystemBrowser } from "../browser/manager.js";
import { createPageDriver } from "./checkBrowser.js";
import { collectFontFallback, declaresNamedFamily, firstFamily } from "./checkFonts.js";
import { DEFAULT_CHECK_OPTIONS, runAuditGrid } from "./checkPipeline.js";

function resolveExecutable(): string | undefined {
  for (const name of ["HYPERFRAMES_BROWSER_PATH", "PUPPETEER_EXECUTABLE_PATH"]) {
    const candidate = process.env[name];
    if (candidate && existsSync(candidate)) return candidate;
  }
  return findSystemBrowser()?.executablePath;
}

const executablePath = resolveExecutable();
const RUNS_CHROMIUM =
  !!executablePath &&
  (process.platform !== "win32" || process.env.HYPERFRAMES_BROWSER_TESTS === "1");
const BROWSER_LAUNCH_TIMEOUT_MS = 120_000;

// A monospace webfont checked into the repo. Declared for capitals only (unicode-range), so any lowercase letter
// is a character this face does not cover and Chrome must draw it elsewhere: the same situation as Hangul in a
// Latin-only face, but deterministic on a box with or without a Hangul system font.
const LATIN_ONLY_WOFF2 = new URL(
  "../../../../.agents/skills/changelog-video/assets/fonts/tt_norms_pro_mono_regular-webfont.woff2",
  import.meta.url,
);

function page(body: string): string {
  const font = readFileSync(LATIN_ONLY_WOFF2).toString("base64");
  return `<!doctype html><html><head><style>
    @font-face { font-family: "FixtureMono"; src: url(data:font/woff2;base64,${font}) format("woff2"); unicode-range: U+0041-005A, U+0020; }
    body { margin: 0; font-size: 32px; }
    .mono { font-family: "FixtureMono", monospace; }
  </style></head><body><div data-composition-id="main" data-duration="2">${body}</div></body></html>`;
}

describe("firstFamily / declaresNamedFamily", () => {
  it("reads the first family unquoted and ignores generic keywords", () => {
    expect(firstFamily(`"IBM Plex Mono", monospace`)).toBe("IBM Plex Mono");
    expect(declaresNamedFamily("IBM Plex Mono")).toBe(true);
    expect(declaresNamedFamily("monospace")).toBe(false);
    expect(declaresNamedFamily("system-ui")).toBe(false);
    expect(declaresNamedFamily("")).toBe(false);
  });
});

describe.skipIf(!RUNS_CHROMIUM)("collectFontFallback (real Chromium)", () => {
  let browser: Browser;
  let tab: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    });
    tab = await browser.newPage();
  }, BROWSER_LAUNCH_TIMEOUT_MS);

  afterAll(async () => {
    await browser?.close();
  });

  async function findingsFor(body: string) {
    await tab.setContent(page(body), { waitUntil: "load" });
    await tab.evaluate(() => document.fonts.ready.then(() => undefined));
    return collectFontFallback(tab, 0.5, async (requests) =>
      requests.map((request) => ({
        selector: request.selector,
        dataAttributes: {},
        sourceFile: "index.html",
        bbox: request.bbox,
        time: request.time,
      })),
    );
  }

  it("flags characters the declared face does not cover, naming the fallback and which characters", async () => {
    const findings = await findingsFor(`<p id="mix" class="mono">ABC xyz</p>`);
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding).toMatchObject({
      code: "text_in_fallback_face",
      severity: "error",
      selector: "#mix",
      declaredFamily: "FixtureMono",
      glyphCount: 3,
      text: "xyz",
    });
    expect(finding?.usedFamily).not.toBe("");
    expect(finding?.usedFamily).not.toBe("FixtureMono");
  });

  it("does not flag text the declared face covers", async () => {
    expect(await findingsFor(`<p id="en" class="mono">ABC DEF</p>`)).toEqual([]);
  });

  it("does not flag an element whose first family is only a generic keyword", async () => {
    expect(await findingsFor(`<p style="font-family: sans-serif">ABC xyz</p>`)).toEqual([]);
  });

  it("ignores hidden text", async () => {
    expect(await findingsFor(`<p class="mono" style="display:none">xyz</p>`)).toEqual([]);
  });

  it("reaches the check report's fonts section through the page driver", async () => {
    await tab.setContent(
      page(
        `<p id="mix" class="mono">ABC xyz</p><script>window.__hf = { duration: 2, seek() {} };</script>`,
      ),
      { waitUntil: "load" },
    );
    await tab.evaluate(() => document.fonts.ready.then(() => undefined));
    const result = await runAuditGrid(
      createPageDriver(tab),
      { ...DEFAULT_CHECK_OPTIONS, samples: 2, contrast: false },
      { kind: "none" },
    );
    expect(result.fontFindings.map((f) => [f.code, f.selector, f.text])).toEqual([
      ["text_in_fallback_face", "#mix", "xyz"],
    ]);
  });
});
