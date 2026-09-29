import { describe, expect, it, spyOn } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  it("preserves a pre-existing temporary file and still populates the cache", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "hf-local-font-cache-"));
    const raw = Buffer.from("stable-font-content");
    const compressed = Buffer.from("compressed-font-content");
    const compressImpl = async () => compressed;
    const clock = spyOn(Date, "now").mockReturnValue(1234567890);
    try {
      const first = await fontToDataUri(raw, "ttf", { cacheDir, compressImpl });
      const [cacheName] = readdirSync(cacheDir);
      if (!cacheName) throw new Error("Expected a cached font");
      rmSync(join(cacheDir, cacheName));
      const existingName = `${cacheName}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(join(cacheDir, existingName), "another writer's file");

      expect(await fontToDataUri(raw, "ttf", { cacheDir, compressImpl })).toBe(first);
      expect(readFileSync(join(cacheDir, existingName), "utf8")).toBe("another writer's file");
      expect(readFileSync(join(cacheDir, cacheName))).toEqual(compressed);
      expect(readdirSync(cacheDir).sort()).toEqual([cacheName, existingName].sort());
    } finally {
      clock.mockRestore();
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("cleans up its temporary files when publishing the cache fails", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "hf-local-font-cache-"));
    const raw = Buffer.from("stable-font-content");
    const compressImpl = async () => Buffer.from("compressed-font-content");
    try {
      const first = await fontToDataUri(raw, "ttf", { cacheDir, compressImpl });
      const [cacheName] = readdirSync(cacheDir);
      if (!cacheName) throw new Error("Expected a cached font");
      rmSync(join(cacheDir, cacheName));
      mkdirSync(join(cacheDir, cacheName));

      expect(await fontToDataUri(raw, "ttf", { cacheDir, compressImpl })).toBe(first);
      expect(readdirSync(cacheDir)).toEqual([cacheName]);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("returns compressed data when the cache directory cannot be created", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-local-font-cache-"));
    const cacheDir = join(root, "not-a-directory");
    writeFileSync(cacheDir, "keep");
    try {
      const compressed = Buffer.from("compressed-font-content");
      const uri = await fontToDataUri(Buffer.from("font"), "ttf", {
        cacheDir,
        compressImpl: async () => compressed,
      });
      expect(uri).toBe(`data:font/woff2;base64,${compressed.toString("base64")}`);
      expect(readFileSync(cacheDir, "utf8")).toBe("keep");
      expect(readdirSync(root)).toEqual(["not-a-directory"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

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

  it("embeds ttc collections raw without attempting slow woff2 compression", async () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      const raw = Buffer.from("ttc-bytes");
      const uri = await fontToDataUri(raw, "ttc");
      expect(uri).toBe(`data:font/collection;base64,${raw.toString("base64")}`);
      expect(warnings).toHaveLength(0);
    } finally {
      console.warn = originalWarn;
    }
  });
});
