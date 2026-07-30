import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "puppeteer-core";
import { captureFullPagePlate, MAX_PLATE_HEIGHT_PX, pngHeight } from "./screenshotCapture.js";

// A real 1920x800 PNG header, so the produced-height guard sees something valid.
function pngBuffer(height: number, width = 1920): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

// The mocks declare their parameters so `mock.calls[i][0]` is a real slot — a zero-arg
// vi.fn() types its call tuple as [] and indexing it is a compile error.
// `docHeight` is what the in-function measurement returns; the plate reads the page height
// itself now rather than trusting a value the caller measured before scrolling.
function fakePage(
  { docHeight = 8000, plateHeight = 8000 }: { docHeight?: number; plateHeight?: number } = {},
  overrides: Record<string, unknown> = {},
) {
  const evaluate = vi.fn(async (script?: unknown) =>
    String(script).includes("scrollHeight") ? docHeight : undefined,
  );
  const screenshot = vi.fn(async (_opts?: unknown) => pngBuffer(plateHeight));
  return { page: { evaluate, screenshot, ...overrides } as unknown as Page, evaluate, screenshot };
}

describe("captureFullPagePlate — the scroll shot's plate", () => {
  it("writes one full-page png and returns its relative path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-plate-"));
    const { page, screenshot } = fakePage({ docHeight: 10962, plateHeight: 10962 });

    const out = await captureFullPagePlate(page, dir);

    expect(out).toBe("screenshots/full-page.png");
    expect(screenshot).toHaveBeenCalledWith({ type: "png", fullPage: true });
    expect(pngHeight(readFileSync(join(dir, "full-page.png")))).toBe(10962);
  });

  it("stays 1x: it never touches the viewport's deviceScaleFactor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-plate-"));
    const setViewport = vi.fn(async () => undefined);
    const { page } = fakePage({}, { setViewport });

    await captureFullPagePlate(page, dir);

    // A 2x plate would exceed the cap on exactly the long pages that want a scroll shot.
    expect(setViewport).not.toHaveBeenCalled();
  });

  it("skips a page taller than Chrome can capture, instead of writing a clipped plate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-plate-"));
    const { page, screenshot } = fakePage({ docHeight: MAX_PLATE_HEIGHT_PX + 1 });

    const out = await captureFullPagePlate(page, dir);

    expect(out).toBeNull();
    expect(screenshot).not.toHaveBeenCalled();
    expect(existsSync(join(dir, "full-page.png"))).toBe(false);
  });

  it("neutralises sticky/fixed chrome for the shot and restores it afterwards", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-plate-"));
    const { page, evaluate, screenshot } = fakePage();

    await captureFullPagePlate(page, dir);

    const scripts = evaluate.mock.calls.map((c) => String(c[0]));
    // neutralise, height probe, restore — the probe sits after neutralisation because
    // forcing fixed/sticky to `static` puts those elements back in flow and grows the page.
    expect(scripts).toHaveLength(3);
    expect(scripts[0]).toContain("'fixed'");
    expect(scripts[0]).toContain("'sticky'");
    expect(scripts[0]).toContain("data-hf-plate-position");
    expect(scripts[1]).toContain("scrollHeight");
    // Then hand the page back unchanged: the caller keeps reading the DOM after this.
    expect(scripts[2]).toContain("removeAttribute");
    expect(scripts[2]).toContain("data-hf-plate-position");
    expect(evaluate.mock.invocationCallOrder[1]).toBeLessThan(
      screenshot.mock.invocationCallOrder[0]!,
    );
    expect(screenshot.mock.invocationCallOrder[0]).toBeLessThan(
      evaluate.mock.invocationCallOrder[2]!,
    );
  });

  it("restores the page even when the screenshot throws", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-plate-"));
    const screenshot = vi.fn(async (_opts?: unknown) => {
      throw new Error("capture failed");
    });
    const { page, evaluate } = fakePage({}, { screenshot });

    await expect(captureFullPagePlate(page, dir)).rejects.toThrow("capture failed");
    // A page left with every sticky element forced static would corrupt the extraction
    // passes that run after this one.
    expect(String(evaluate.mock.calls.at(-1)?.[0])).toContain("removeAttribute");
  });
});

describe("captureFullPagePlate — guards against a silently clipped plate", () => {
  it("measures the height itself, after lazy content has grown the page", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-plate-"));
    // A page that measured 9000 before scrolling but is 20000 once lazy images land: the
    // pre-scroll number would have passed the guard and emitted a clipped plate.
    const { page, screenshot } = fakePage({ docHeight: 20000 });

    expect(await captureFullPagePlate(page, dir)).toBeNull();
    expect(screenshot).not.toHaveBeenCalled();
  });

  it("discards a plate Chrome clipped, even when the measurement passed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-plate-"));
    // Measurement said 16000, but the capture itself triggered more loading and came back
    // over the cap. Emitting it would be undetectable downstream.
    const { page } = fakePage({ docHeight: 16000, plateHeight: MAX_PLATE_HEIGHT_PX + 500 });

    expect(await captureFullPagePlate(page, dir)).toBeNull();
    expect(existsSync(join(dir, "full-page.png"))).toBe(false);
  });

  it("survives a restore that throws — the real error is what propagates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-plate-"));
    let call = 0;
    const evaluate = vi.fn(async (script?: unknown) => {
      call++;
      if (String(script).includes("scrollHeight")) return 8000;
      if (String(script).includes("removeAttribute")) throw new Error("page crashed");
      return undefined;
    });
    const screenshot = vi.fn(async (_opts?: unknown) => {
      throw new Error("capture failed");
    });
    const page = { evaluate, screenshot } as unknown as Page;

    // Without the try/catch in `finally`, "page crashed" would mask "capture failed".
    await expect(captureFullPagePlate(page, dir)).rejects.toThrow("capture failed");
    expect(call).toBeGreaterThanOrEqual(3);
  });
});

describe("pngHeight", () => {
  it("reads the height out of the IHDR chunk", () => {
    expect(pngHeight(pngBuffer(10962))).toBe(10962);
  });

  it("returns null for anything that is not a PNG", () => {
    expect(pngHeight(Buffer.from("not a png at all, definitely not"))).toBeNull();
    expect(pngHeight(Buffer.alloc(4))).toBeNull();
  });
});

describe("captureFullPagePlate — the guard sees the post-neutralisation page (Magi's case)", () => {
  it("skips when the initial height is under the cap but the final height is over it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-plate-"));
    // Pre-traversal the page measured 9000. Lazy content and un-fixing the sticky header push
    // it over the cap by the time the plate would be shot. Probing before either step would
    // have passed the guard and emitted a clipped plate.
    let neutralised = false;
    const evaluate = vi.fn(async (script?: unknown) => {
      const src = String(script);
      if (src.includes("'sticky'")) {
        neutralised = true;
        return undefined;
      }
      if (src.includes("scrollHeight")) return neutralised ? 20000 : 9000;
      return undefined;
    });
    const screenshot = vi.fn(async (_opts?: unknown) => pngBuffer(20000));
    const page = { evaluate, screenshot } as unknown as Page;

    expect(await captureFullPagePlate(page, dir)).toBeNull();
    expect(screenshot).not.toHaveBeenCalled();
    expect(existsSync(join(dir, "full-page.png"))).toBe(false);
    // Bailing out early must still hand the page back unmodified.
    expect(String(evaluate.mock.calls.at(-1)?.[0])).toContain("removeAttribute");
  });
});
