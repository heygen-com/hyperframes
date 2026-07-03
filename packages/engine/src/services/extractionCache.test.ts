import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  COMPLETE_SENTINEL,
  FRAME_FILENAME_PREFIX,
  SCHEMA_PREFIX,
  cacheEntryDirName,
  computeCacheKey,
  ensureCacheEntryDir,
  gcExtractionCache,
  lookupCacheEntry,
  markCacheEntryComplete,
  partialCacheEntryDir,
  publishCacheEntry,
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

function makeCacheRoot(): { tmpRoot: string; sourceFile: string } {
  const tmpRoot = mkdtempSync(join(tmpdir(), "hf-extract-cache-test-"));
  const sourceFile = join(tmpRoot, "clip.mp4");
  writeFileSync(sourceFile, "fake-video-bytes", "utf-8");
  return { tmpRoot, sourceFile };
}

function removeCacheRoot(tmpRoot: string): void {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
}

/** Create and populate a partial dir for `entry` with one frame file. */
function seedPartialDir(entry: { dir: string; keyHash: string }, frameContent: string): string {
  const partialDir = partialCacheEntryDir(entry);
  mkdirSync(partialDir, { recursive: true });
  writeFileSync(join(partialDir, "frame_00001.jpg"), frameContent, "utf-8");
  return partialDir;
}

describe("extractionCache constants", () => {
  it("exposes the v2 schema prefix", () => {
    expect(SCHEMA_PREFIX).toBe("hfcache-v3-");
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
    ({ tmpRoot, sourceFile } = makeCacheRoot());
  });

  afterEach(() => {
    removeCacheRoot(tmpRoot);
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

  it("changes when a source transform is applied", () => {
    const plain = computeCacheKey(base(sourceFile));
    const transformedInput = { ...base(sourceFile), transform: "sdr2hdr-pq" };
    const transformed = computeCacheKey(transformedInput);
    expect(transformed).not.toBe(plain);
  });

  it("keeps undefined transform byte-compatible with omitted transform", () => {
    const omitted = computeCacheKey(base(sourceFile));
    const input = { ...base(sourceFile), transform: undefined };
    const explicitUndefined = computeCacheKey(input);
    expect(explicitUndefined).toBe(omitted);
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
    ({ tmpRoot, sourceFile } = makeCacheRoot());
  });

  afterEach(() => {
    removeCacheRoot(tmpRoot);
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

describe("publishCacheEntry", () => {
  let tmpRoot: string;
  let sourceFile: string;

  beforeEach(() => {
    ({ tmpRoot, sourceFile } = makeCacheRoot());
  });

  afterEach(() => {
    removeCacheRoot(tmpRoot);
  });

  function entry() {
    return lookupCacheEntry(tmpRoot, keyFor(sourceFile)).entry;
  }

  it("publishes a partial directory atomically with the complete sentinel inside", () => {
    const cacheEntry = entry();
    const partialDir = seedPartialDir(cacheEntry, "frame");

    const result = publishCacheEntry(cacheEntry, partialDir);

    expect(result).toEqual({ dir: cacheEntry.dir, published: true });
    expect(existsSync(partialDir)).toBe(false);
    expect(existsSync(join(cacheEntry.dir, "frame_00001.jpg"))).toBe(true);
    expect(existsSync(join(cacheEntry.dir, COMPLETE_SENTINEL))).toBe(true);
  });

  it("serves a complete winner when another writer publishes the same entry first", () => {
    const cacheEntry = entry();
    mkdirSync(cacheEntry.dir, { recursive: true });
    writeFileSync(join(cacheEntry.dir, "frame_00001.jpg"), "winner", "utf-8");
    markCacheEntryComplete(cacheEntry);

    const partialDir = seedPartialDir(cacheEntry, "loser");

    const result = publishCacheEntry(cacheEntry, partialDir);

    expect(result).toEqual({ dir: cacheEntry.dir, published: true });
    expect(existsSync(partialDir)).toBe(false);
    expect(existsSync(join(cacheEntry.dir, COMPLETE_SENTINEL))).toBe(true);
    expect(statSync(join(cacheEntry.dir, "frame_00001.jpg")).size).toBe("winner".length);
  });

  it("replaces a stale unsentineled final directory and retries publish once", () => {
    const cacheEntry = entry();
    mkdirSync(cacheEntry.dir, { recursive: true });
    writeFileSync(join(cacheEntry.dir, "frame_00001.jpg"), "stale", "utf-8");

    const partialDir = seedPartialDir(cacheEntry, "fresh");

    const result = publishCacheEntry(cacheEntry, partialDir);

    expect(result).toEqual({ dir: cacheEntry.dir, published: true });
    expect(existsSync(partialDir)).toBe(false);
    expect(statSync(join(cacheEntry.dir, "frame_00001.jpg")).size).toBe("fresh".length);
    expect(existsSync(join(cacheEntry.dir, COMPLETE_SENTINEL))).toBe(true);
  });
});

describe("gcExtractionCache", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "hf-extract-cache-gc-test-"));
  });

  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  function makeEntry(name: string, bytes: number, ageMs: number): string {
    const dir = join(tmpRoot, `${SCHEMA_PREFIX}${name}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "frame_00001.jpg"), "x".repeat(bytes), "utf-8");
    markCacheEntryComplete({ dir, keyHash: name.padEnd(64, "0") });
    const when = new Date(Date.now() - ageMs);
    utimesSync(join(dir, COMPLETE_SENTINEL), when, when);
    return dir;
  }

  it("evicts superseded-generation entries (hfcache-v2-*) under the size cap", () => {
    const oldGen = join(tmpRoot, "hfcache-v2-0123456789abcdef");
    mkdirSync(oldGen, { recursive: true });
    writeFileSync(join(oldGen, "frame_00001.jpg"), "x".repeat(2048), "utf-8");
    writeFileSync(join(oldGen, ".hf-complete"), "", "utf-8");
    const aged = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(join(oldGen, ".hf-complete"), aged, aged);
    utimesSync(oldGen, aged, aged);

    const stats = gcExtractionCache(tmpRoot, { maxBytes: 1024, minAgeMs: 60 * 60 * 1000 });

    expect(existsSync(oldGen)).toBe(false);
    expect(stats.evictedEntries).toBe(1);
  });

  it("evicts oldest complete entries first until under maxBytes while respecting minAge", () => {
    const oldest = makeEntry("oldest", 60, 120_000);
    const middle = makeEntry("middle", 60, 90_000);
    const young = makeEntry("young", 60, 1_000);

    gcExtractionCache(tmpRoot, { maxBytes: 100, minAgeMs: 60_000 });

    expect(existsSync(oldest)).toBe(false);
    expect(existsSync(middle)).toBe(false);
    expect(existsSync(young)).toBe(true);
  });

  it("removes aged partial directories", () => {
    const agedPartial = join(tmpRoot, `${SCHEMA_PREFIX}abc.partial-1234-deadbeef`);
    const freshPartial = join(tmpRoot, `${SCHEMA_PREFIX}def.partial-1234-feedface`);
    mkdirSync(agedPartial, { recursive: true });
    mkdirSync(freshPartial, { recursive: true });
    const old = new Date(Date.now() - 120_000);
    utimesSync(agedPartial, old, old);

    gcExtractionCache(tmpRoot, { maxBytes: 1_000_000, minAgeMs: 60_000 });

    expect(existsSync(agedPartial)).toBe(false);
    expect(existsSync(freshPartial)).toBe(true);
  });

  it("ignores non-cache-prefix directories under the same root", () => {
    const animatedGif = join(tmpRoot, "animated-gif");
    mkdirSync(animatedGif, { recursive: true });
    writeFileSync(join(animatedGif, "frame.png"), "keep", "utf-8");
    makeEntry("old", 200, 120_000);

    gcExtractionCache(tmpRoot, { maxBytes: 1, minAgeMs: 60_000 });

    expect(existsSync(animatedGif)).toBe(true);
    expect(readdirSync(animatedGif)).toEqual(["frame.png"]);
  });

  it("never throws when the cache root is missing", () => {
    expect(() =>
      gcExtractionCache(join(tmpRoot, "missing"), { maxBytes: 1, minAgeMs: 60_000 }),
    ).not.toThrow();
  });
});
