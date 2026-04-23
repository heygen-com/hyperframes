import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  COMPLETE_SENTINEL,
  FRAME_FILENAME_PREFIX,
  SCHEMA_PREFIX,
  cacheEntryDirName,
  computeCacheKey,
  ensureCacheEntryDir,
  lookupCacheEntry,
  markCacheEntryComplete,
  readKeyStat,
  type CacheKeyInput,
} from "./extractionCache.js";

const keyFor = (videoPath: string, overrides: Partial<CacheKeyInput> = {}): CacheKeyInput => {
  const stat = readKeyStat(videoPath);
  if (!stat) throw new Error(`keyFor fixture missing on disk: ${videoPath}`);
  return {
    videoPath,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    mediaStart: 0,
    duration: 3,
    fps: 30,
    format: "jpg",
    ...overrides,
  };
};

describe("extractionCache constants", () => {
  it("exposes the v2 schema prefix", () => {
    expect(SCHEMA_PREFIX).toBe("hfcache-v2-");
  });

  it("exposes the frame filename prefix shared with the extractor", () => {
    expect(FRAME_FILENAME_PREFIX).toBe("frame_");
  });

  it("uses a dotfile sentinel so ls-without-A hides it", () => {
    expect(COMPLETE_SENTINEL.startsWith(".")).toBe(true);
  });
});

describe("computeCacheKey", () => {
  let tmpRoot: string;
  let sourceFile: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "hf-extract-cache-test-"));
    sourceFile = join(tmpRoot, "clip.mp4");
    writeFileSync(sourceFile, "fake-video-bytes", "utf-8");
  });

  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  const base = (videoPath: string): CacheKeyInput => keyFor(videoPath);

  it("returns the same key for identical inputs", () => {
    const a = computeCacheKey(base(sourceFile));
    const b = computeCacheKey(base(sourceFile));
    expect(a).toBe(b);
  });

  it("produces a 64-char hex SHA-256 digest", () => {
    const key = computeCacheKey(base(sourceFile));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when path changes (moved files re-extract)", () => {
    const other = join(tmpRoot, "other.mp4");
    writeFileSync(other, "fake-video-bytes", "utf-8");
    const a = computeCacheKey(base(sourceFile));
    const b = computeCacheKey(base(other));
    expect(a).not.toBe(b);
  });

  it("changes when mediaStart changes", () => {
    const a = computeCacheKey(base(sourceFile));
    const b = computeCacheKey({ ...base(sourceFile), mediaStart: 1 });
    expect(a).not.toBe(b);
  });

  it("changes when duration changes", () => {
    const a = computeCacheKey(base(sourceFile));
    const b = computeCacheKey({ ...base(sourceFile), duration: 5 });
    expect(a).not.toBe(b);
  });

  it("changes when fps changes (different frame count invalidates key)", () => {
    const a = computeCacheKey(base(sourceFile));
    const b = computeCacheKey({ ...base(sourceFile), fps: 60 });
    expect(a).not.toBe(b);
  });

  it("changes when format changes", () => {
    const a = computeCacheKey(base(sourceFile));
    const b = computeCacheKey({ ...base(sourceFile), format: "png" });
    expect(a).not.toBe(b);
  });

  it("normalizes non-finite duration so Infinity doesn't produce unstable keys", () => {
    const a = computeCacheKey({ ...base(sourceFile), duration: Infinity });
    const b = computeCacheKey({ ...base(sourceFile), duration: Infinity });
    expect(a).toBe(b);
  });

  it("changes when file content changes (mtime+size bump)", () => {
    const before = computeCacheKey(base(sourceFile));
    // Force an mtime change by waiting 5ms then overwriting with different bytes.
    // 5ms is well above the Linux mtime resolution (typically nanoseconds) and
    // below any Windows cache coherency window. Using a longer sleep pads against
    // coarse filesystem mtime granularity without slowing the suite.
    const start = Date.now();
    while (Date.now() - start < 5) {
      /* spin */
    }
    writeFileSync(sourceFile, "different-bytes-longer-than-before", "utf-8");
    const after = computeCacheKey(base(sourceFile));
    expect(after).not.toBe(before);
  });

  it("readKeyStat returns null for a missing source (callers skip the cache)", () => {
    // Previously readKeyStat returned a `{mtimeMs: 0, size: 0}` sentinel for
    // missing files; two unrelated missing paths then shared the same cache
    // key tuple and polluted the cache. The contract now returns null so
    // callers can explicitly skip the cache path and let the extractor
    // surface the real file-not-found error.
    const missing = join(tmpRoot, "does-not-exist.mp4");
    expect(readKeyStat(missing)).toBeNull();
  });
});

describe("cacheEntryDirName", () => {
  it("prefixes with the schema and truncates to 16 hex chars", () => {
    const full = "a".repeat(64);
    expect(cacheEntryDirName(full)).toBe(`${SCHEMA_PREFIX}${"a".repeat(16)}`);
  });
});

describe("lookupCacheEntry / markCacheEntryComplete", () => {
  let tmpRoot: string;
  let sourceFile: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "hf-extract-cache-test-"));
    sourceFile = join(tmpRoot, "clip.mp4");
    writeFileSync(sourceFile, "fake-video-bytes", "utf-8");
  });

  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  const base = (videoPath: string): CacheKeyInput => keyFor(videoPath);

  it("misses on an empty cache root", () => {
    const lookup = lookupCacheEntry(tmpRoot, base(sourceFile));
    expect(lookup.hit).toBe(false);
    expect(lookup.entry.dir.startsWith(tmpRoot)).toBe(true);
  });

  it("hits after ensureCacheEntryDir + markCacheEntryComplete", () => {
    const first = lookupCacheEntry(tmpRoot, base(sourceFile));
    ensureCacheEntryDir(first.entry);
    markCacheEntryComplete(first.entry);

    const second = lookupCacheEntry(tmpRoot, base(sourceFile));
    expect(second.hit).toBe(true);
    expect(second.entry.dir).toBe(first.entry.dir);
  });

  it("treats an in-progress dir without the sentinel as a miss", () => {
    const lookup = lookupCacheEntry(tmpRoot, base(sourceFile));
    ensureCacheEntryDir(lookup.entry);
    // Simulate abandoned extraction — frames written but sentinel never marked.
    writeFileSync(join(lookup.entry.dir, "frame_00001.jpg"), "x", "utf-8");
    const again = lookupCacheEntry(tmpRoot, base(sourceFile));
    expect(again.hit).toBe(false);
  });

  it("places entries under the cache root, not the source parent", () => {
    const subroot = join(tmpRoot, "cache-root");
    mkdirSync(subroot, { recursive: true });
    const lookup = lookupCacheEntry(subroot, base(sourceFile));
    expect(lookup.entry.dir.startsWith(subroot)).toBe(true);
  });

  it("uses the same directory for identical inputs across lookups", () => {
    const a = lookupCacheEntry(tmpRoot, base(sourceFile));
    const b = lookupCacheEntry(tmpRoot, base(sourceFile));
    expect(a.entry.dir).toBe(b.entry.dir);
  });
});
