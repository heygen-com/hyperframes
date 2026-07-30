import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "puppeteer-core";
import { captureFullPagePlate, MAX_PLATE_HEIGHT_PX } from "./screenshotCapture.js";

// The mocks declare their parameters so `mock.calls[i][0]` is a real slot — a zero-arg
// vi.fn() types its call tuple as [] and indexing it is a compile error.
function fakePage(overrides: Record<string, unknown> = {}) {
  const evaluate = vi.fn(async (_script?: unknown) => undefined);
  const screenshot = vi.fn(async (_opts?: unknown) => Buffer.from("PNG-BYTES"));
  return { page: { evaluate, screenshot, ...overrides } as unknown as Page, evaluate, screenshot };
}

describe("captureFullPagePlate — the scroll shot's plate", () => {
  it("writes one full-page png and returns its relative path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-plate-"));
    const { page, screenshot } = fakePage();

    const out = await captureFullPagePlate(page, dir, 10962);

    expect(out).toBe("screenshots/full-page.png");
    expect(screenshot).toHaveBeenCalledWith({ type: "png", fullPage: true });
    expect(readFileSync(join(dir, "full-page.png"), "utf8")).toBe("PNG-BYTES");
  });

  it("stays 1x: it never touches the viewport's deviceScaleFactor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-plate-"));
    const setViewport = vi.fn(async () => undefined);
    const { page } = fakePage({ setViewport });

    await captureFullPagePlate(page, dir, 4000);

    // A 2x plate would exceed the cap on exactly the long pages that want a scroll shot.
    expect(setViewport).not.toHaveBeenCalled();
  });

  it("skips a page taller than Chrome can capture, instead of writing a clipped plate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-plate-"));
    const { page, screenshot } = fakePage();

    const out = await captureFullPagePlate(page, dir, MAX_PLATE_HEIGHT_PX + 1);

    expect(out).toBeNull();
    expect(screenshot).not.toHaveBeenCalled();
    expect(existsSync(join(dir, "full-page.png"))).toBe(false);
  });

  it("neutralises sticky/fixed chrome for the shot and restores it afterwards", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-plate-"));
    const { page, evaluate, screenshot } = fakePage();

    await captureFullPagePlate(page, dir, 8000);

    const scripts = evaluate.mock.calls.map((c) => String(c[0]));
    expect(scripts).toHaveLength(2);
    // Neutralise first — a fixed header would otherwise bake in mid-plate.
    expect(scripts[0]).toContain("'fixed'");
    expect(scripts[0]).toContain("'sticky'");
    expect(scripts[0]).toContain("data-hf-plate-position");
    // Then hand the page back unchanged: the caller keeps reading the DOM after this.
    expect(scripts[1]).toContain("removeAttribute");
    expect(scripts[1]).toContain("data-hf-plate-position");
    expect(evaluate.mock.invocationCallOrder[0]).toBeLessThan(
      screenshot.mock.invocationCallOrder[0]!,
    );
    expect(screenshot.mock.invocationCallOrder[0]).toBeLessThan(
      evaluate.mock.invocationCallOrder[1]!,
    );
  });

  it("restores the page even when the screenshot throws", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-plate-"));
    const screenshot = vi.fn(async (_opts?: unknown) => {
      throw new Error("capture failed");
    });
    const { page, evaluate } = fakePage({ screenshot });

    await expect(captureFullPagePlate(page, dir, 8000)).rejects.toThrow("capture failed");
    // A page left with every sticky element forced static would corrupt the extraction
    // passes that run after this one.
    expect(String(evaluate.mock.calls.at(-1)?.[0])).toContain("removeAttribute");
  });
});
