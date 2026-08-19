import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "puppeteer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureVideoManifest,
  remainingVideoDownloadTimeoutMs,
  renderLottiePreviews,
  saveLottieAnimations,
} from "./mediaCapture.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-media-budget-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

describe("Lottie capture budget", () => {
  it("does not start another Lottie fetch after the live budget expires", async () => {
    const dir = tempDir();
    let remainingMs = 10_000;
    const fetchMock = vi.fn(async () => {
      remainingMs = 0;
      return new Response(JSON.stringify({ w: 100, h: 100, layers: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const saved = await saveLottieAnimations(
      [{ url: "https://one.example/a.json" }, { url: "https://two.example/b.json" }],
      dir,
      { remainingMs: () => remainingMs },
    );

    expect(saved).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not open another Lottie preview page after the live budget expires", async () => {
    const dir = tempDir();
    const lottieDir = join(dir, "assets", "lottie");
    mkdirSync(join(dir, "extracted"), { recursive: true });
    mkdirSync(lottieDir, { recursive: true });
    const lottie = JSON.stringify({ w: 100, h: 100, fr: 30, ip: 0, op: 30, layers: [] });
    writeFileSync(join(lottieDir, "a.json"), lottie);
    writeFileSync(join(lottieDir, "b.json"), lottie);

    let remainingMs = 10_000;
    const previewPage = {
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const newPage = vi.fn(async () => {
      remainingMs = 0;
      return previewPage;
    });
    const browser = { newPage } as unknown as Browser;

    await renderLottiePreviews(browser, lottieDir, dir, { remainingMs: () => remainingMs });

    expect(newPage).toHaveBeenCalledTimes(1);
    expect(previewPage.setViewport).not.toHaveBeenCalled();
    expect(previewPage.screenshot).not.toHaveBeenCalled();
  });

  it("omits a preview path when the budget expires after Lottie readiness", async () => {
    const dir = tempDir();
    const lottieDir = join(dir, "assets", "lottie");
    mkdirSync(join(dir, "extracted"), { recursive: true });
    mkdirSync(lottieDir, { recursive: true });
    writeFileSync(
      join(lottieDir, "logo.json"),
      JSON.stringify({
        nm: "Logo",
        w: 100,
        h: 100,
        fr: 30,
        ip: 0,
        op: 30,
        layers: [],
      }),
    );

    const screenshot = vi.fn(async () => undefined);
    const previewPage = {
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => undefined),
      screenshot,
      close: vi.fn(async () => undefined),
    };
    const browser = { newPage: vi.fn(async () => previewPage) } as unknown as Browser;
    let budgetChecks = 0;

    await renderLottiePreviews(browser, lottieDir, dir, {
      remainingMs: () => (++budgetChecks < 4 ? 10_000 : 0),
    });

    const manifest = JSON.parse(
      readFileSync(join(dir, "extracted", "lottie-manifest.json"), "utf-8"),
    );
    expect(screenshot).not.toHaveBeenCalled();
    expect(manifest).toHaveLength(1);
    expect(manifest[0]).toMatchObject({
      file: "assets/lottie/logo.json",
      name: "Logo",
      width: 100,
      height: 100,
    });
    expect(manifest[0]).not.toHaveProperty("preview");
    expect(existsSync(join(lottieDir, "previews", "logo-preview.png"))).toBe(false);
  });
});

describe("video capture live budget", () => {
  it("does not preview or download when the budget expires during DOM sampling", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const dir = tempDir();
    mkdirSync(join(dir, "extracted"), { recursive: true });
    const descriptor = {
      src: "https://video.example/hero.mp4",
      filename: "hero.mp4",
      width: 640,
      height: 360,
      sourceWidth: 640,
      sourceHeight: 360,
      top: 0,
      left: 0,
      heading: "Hero",
      caption: "Demo",
      ariaLabel: "",
    };
    const screenshot = vi.fn(async () => Buffer.from("preview"));
    const evaluate = vi.fn(async (expression: unknown) =>
      typeof expression === "function" ? { x: 0, y: 0, width: 640, height: 360 } : [descriptor],
    );
    const page = { evaluate, screenshot } as unknown as Page;
    const fetchMock = vi.fn(
      async () =>
        new Response(Buffer.alloc(2048), {
          status: 200,
          headers: { "content-type": "video/mp4" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const capture = captureVideoManifest(page, dir, () => {}, {
      sampleMs: 10_000,
      downloadBudgetMs: 10_000,
      remainingMs: () => Math.max(0, 1_000 - Date.now()),
    });
    await vi.runAllTimersAsync();
    await capture;

    expect(screenshot).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("remainingVideoDownloadTimeoutMs", () => {
  it("caps a video request to the remaining capture budget", () => {
    expect(remainingVideoDownloadTimeoutMs(1_000, 5_000, 4_500)).toBe(1_500);
  });

  it("returns zero after the aggregate budget is exhausted", () => {
    expect(remainingVideoDownloadTimeoutMs(1_000, 5_000, 6_001)).toBe(0);
  });

  it("retains the existing per-request ceiling when more budget remains", () => {
    expect(remainingVideoDownloadTimeoutMs(1_000, 300_000, 2_000)).toBe(120_000);
  });
});
