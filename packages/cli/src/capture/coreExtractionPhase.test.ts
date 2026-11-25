import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page, Browser } from "puppeteer-core";
import { runCoreExtraction } from "./coreExtractionPhase.js";
import { createPartialCaptureState } from "./partialCapture.js";
import { createCaptureDownloadBudget } from "./readBoundedResponse.js";
import { StageBudgetTimeoutError } from "./captureTimeout.js";

const control = vi.hoisted(() => ({
  remaining: 10000,
  expireLazy: false,
  throwCatalog: false,
  styleError: "",
}));
vi.mock("./lazyScrollForCapture.js", () => ({
  lazyScrollForCapture: async () => {
    if (control.expireLazy) control.remaining = 0;
    return { steps: 0, timedOut: false };
  },
}));
vi.mock("./animationCataloger.js", () => ({
  collectAnimationCatalog: async () => {
    if (control.throwCatalog) throw new StageBudgetTimeoutError("catalog", 0);
    return { catalog: undefined, timedOut: true };
  },
}));
vi.mock("./tokenExtractor.js", () => ({
  extractTokens: async () => ({
    title: "Fixture",
    description: "",
    cssVariables: {},
    fonts: [],
    colors: [],
    headings: [],
    ctas: [],
    svgs: [],
    sections: [],
  }),
}));
vi.mock("./designStyleExtractor.js", () => ({
  extractDesignStyles: async () => {
    if (control.styleError) throw new Error(control.styleError);
    return {
      typography: [],
      spacing: { observed: [], baseUnit: 0 },
      radius: [],
      shadows: [],
      buttons: [],
      cards: [],
      nav: null,
    };
  },
}));
vi.mock("./assetCataloger.js", () => ({ catalogAssets: async () => [] }));
vi.mock("./htmlExtractor.js", () => ({
  extractHtml: async () => ({
    headHtml: "",
    bodyHtml: "",
    cssomRules: "",
    htmlAttrs: "",
    viewportWidth: 1920,
    viewportHeight: 1080,
    fullPageHeight: 10000,
  }),
}));
vi.mock("./contentExtractor.js", () => ({
  detectLibraries: async () => [],
  extractVisibleText: async () => "Fixture",
}));
vi.mock("./mediaCapture.js", () => ({
  saveLottieAnimations: async () => 0,
  renderLottiePreviews: async () => {},
  captureVideoManifest: async () => {},
}));

afterEach(() => {
  control.remaining = 10000;
  control.expireLazy = false;
  control.throwCatalog = false;
  control.styleError = "";
  vi.restoreAllMocks();
});

const REFUSED = "Protocol error (Page.captureScreenshot): Unable to capture screenshot";

/** `refuseShots`: the screenshot calls (1-based) Chrome refuses. */
async function extract(expireScreenshot = false, refuseShots: number[] = []) {
  vi.useFakeTimers();
  const outputDir = mkdtempSync(join(tmpdir(), "hf-core-budget-"));
  mkdirSync(join(outputDir, "extracted"));
  const state = createPartialCaptureState({ url: "https://example.com", outputDir });
  let shots = 0;
  const screenshot = vi.fn(async () => {
    if (refuseShots.includes(++shots)) throw new Error(REFUSED);
    if (expireScreenshot) control.remaining = 0;
    return new Uint8Array(24);
  });
  const page = {
    evaluate: async (script: unknown) => {
      if (String(script).includes("scrollHeight")) return 10000;
      if (script === "window.innerHeight") return 1080;
      return [];
    },
    screenshot,
    close: async () => {},
  } as unknown as Page;
  try {
    const pending = runCoreExtraction({
      page1: page,
      chromeBrowser: {} as Browser,
      cdp: { send: async () => {} } as never,
      cdpAnims: [],
      state,
      outputDir,
      warnings: state.warnings,
      progress: () => {},
      remainingMs: () => control.remaining,
      maxScreenshots: 3,
      pageContentCheck: {
        textLength: 200,
        title: "Fixture",
        hasChallengeElement: false,
        bodyChildCount: 2,
      },
      contentCheckTimedOut: false,
      discoveredLotties: [],
      lottieDiscovery: { run: async () => [] } as never,
      discoveredVideoUrls: new Set(),
      animationCatalog: undefined,
      capturedShaders: undefined,
      catalogedAssets: [],
      detectedLibraries: [],
      visibleTextContent: "",
      faviconLinks: [],
      tokens: state.tokens,
      extracted: state.extracted,
      screenshots: [],
      downloadByteBudget: createCaptureDownloadBudget(),
      canWrite: () => true,
    });
    await vi.runAllTimersAsync();
    const result = await pending;
    return { result, warnings: state.warnings, screenshot };
  } finally {
    vi.useRealTimers();
    rmSync(outputDir, { recursive: true, force: true });
  }
}

describe("core extraction screenshot budget", () => {
  it.each([false, true])(
    "names the phase that exhausted the budget with thrown catalog timeout %s",
    async (throws) => {
      control.expireLazy = true;
      control.throwCatalog = throws;
      const { result, warnings, screenshot } = await extract();
      expect(result.screenshotOutcome).toEqual({
        kind: "failed",
        reason: "budget-exhausted",
      });
      expect(warnings).toContain(
        "0/3 requested screenshot files captured: --capture-budget exhausted during lazy scrolling",
      );
      expect(warnings).toContain(
        "--capture-budget spent before the animation catalog finished; continuing without animation catalog",
      );
      expect(warnings).not.toContain(
        "animation catalog evaluate timed out; continuing without animation catalog",
      );
      expect(screenshot).not.toHaveBeenCalled();
    },
  );
  it("names the screenshot Chrome refused twice and keeps the rest", async () => {
    const { result, warnings } = await extract(false, [2, 3]);
    expect(result.screenshots).toEqual(["screenshots/scroll-000.png", "screenshots/full-page.png"]);
    expect(warnings).toContain(
      `2/3 requested screenshot files captured: could not capture screenshots/scroll-100.png (scrolled to 8920px): ${REFUSED}`,
    );
    expect(result.screenshotOutcome).toEqual({ kind: "partial", reason: "internal-error" });
  });
  it("keeps a positive partial count and names actual versus requested", async () => {
    const { result, warnings } = await extract(true);
    expect(result.screenshots).toHaveLength(1);
    expect(warnings).toContain(
      "1/3 requested screenshot files captured: --capture-budget exhausted during screenshots",
    );
    expect(result.screenshotOutcome).toEqual({
      kind: "partial",
      reason: "budget-exhausted",
    });
    expect(warnings).toContain(
      "animation catalog evaluate timed out; continuing without animation catalog",
    );
  });
  // fails without the fix: a line break in the reason started a line of its own
  it("keeps the reason design styles could not be read on one line", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    control.styleError = "no styles\n  ✓ Captured";
    const { warnings } = await extract();
    const line = String(error.mock.calls[0]![0]);
    expect(line).toMatch(
      /^ {2}⚠ Design style extraction failed: no styles\\x0a {2}✓ Captured\\x0a/,
    );
    expect(line).not.toContain("\n");
    expect(warnings.join()).toContain("no styles\n  ✓ Captured");
  });
});
