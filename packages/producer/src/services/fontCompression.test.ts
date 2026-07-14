import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compressToWoff2, fontToDataUri } from "./fontCompression.js";

/**
 * Locate a system TTF font for real compression tests. macOS ships plenty
 * of .ttf files in /System/Library/Fonts/Supplemental; we pick the first
 * one found from a short list. Returns null on Linux CI or any environment
 * without the expected fonts — those tests are skipped gracefully.
 */
function findSystemTtf(): Buffer | null {
  const candidates = [
    "/System/Library/Fonts/Supplemental/Andale Mono.ttf",
    "/System/Library/Fonts/Supplemental/Courier New.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];
  for (const path of candidates) {
    if (existsSync(path)) return readFileSync(path);
  }
  return null;
}

describe("compressToWoff2", () => {
  it("compresses a TTF buffer to a smaller woff2 buffer", async () => {
    const ttf = findSystemTtf();
    if (!ttf) {
      console.warn("Skipping: no system TTF font available");
      return;
    }
    const woff2 = await compressToWoff2(ttf);
    expect(woff2).toBeInstanceOf(Buffer);
    expect(woff2.length).toBeGreaterThan(0);
    expect(woff2.length).toBeLessThan(ttf.length);
  });

  it("throws on invalid input", async () => {
    const garbage = Buffer.from("this is not a font file");
    await expect(compressToWoff2(garbage)).rejects.toThrow();
  });
});

describe("fontToDataUri", () => {
  it("reuses cached compression across calls", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "hf-local-font-cache-"));
    const raw = Buffer.from("stable-font-content");
    let compressionCalls = 0;
    const compressImpl = async () => {
      compressionCalls += 1;
      return Buffer.from("compressed-font-content");
    };

    try {
      const first = await fontToDataUri(raw, "ttf", { cacheDir, compressImpl });
      const second = await fontToDataUri(raw, "ttf", { cacheDir, compressImpl });

      expect(second).toBe(first);
      expect(compressionCalls).toBe(1);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("skips compression for woff2 input and returns a data URI", async () => {
    const raw = Buffer.from("fake-woff2-bytes");
    const uri = await fontToDataUri(raw, "woff2");
    const expectedBase64 = raw.toString("base64");
    expect(uri).toBe(`data:font/woff2;base64,${expectedBase64}`);
  });

  it("compresses a TTF and returns a woff2 data URI", async () => {
    const ttf = findSystemTtf();
    if (!ttf) {
      console.warn("Skipping: no system TTF font available");
      return;
    }
    const uri = await fontToDataUri(ttf, "ttf");
    expect(uri).toMatch(/^data:font\/woff2;base64,/);
    const naiveLength = `data:font/ttf;base64,${ttf.toString("base64")}`.length;
    expect(uri.length).toBeLessThan(naiveLength);
  });

  it("falls back to raw ttf on compression failure", async () => {
    const garbage = Buffer.from("this is not a font file");
    const uri = await fontToDataUri(garbage, "ttf");
    expect(uri).toMatch(/^data:font\/ttf;base64,/);
  });

  it("falls back with correct MIME type for otf", async () => {
    const garbage = Buffer.from("not a font");
    const uri = await fontToDataUri(garbage, "otf");
    expect(uri).toMatch(/^data:font\/otf;base64,/);
  });

  it("falls back with correct MIME type for ttc", async () => {
    const garbage = Buffer.from("not a font");
    const uri = await fontToDataUri(garbage, "ttc");
    expect(uri).toMatch(/^data:font\/collection;base64,/);
  });
});
