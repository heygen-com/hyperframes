import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupProxyCache } from "./proxyCache.js";

const tempDirs: string[] = [];

function cacheDir(): string {
  const root = mkdtempSync(join(tmpdir(), "hf-proxy-cache-"));
  tempDirs.push(root);
  const cache = join(root, ".transcode-cache");
  mkdirSync(cache);
  return cache;
}

/** A proxy path named the way the transcoder names one. */
const proxy = (cache: string, label: string, extension = ".mp4") =>
  join(cache, `${createHash("sha256").update(label).digest("hex")}${extension}`);

function writeEntry(path: string, bytes: number, modifiedAt: number): void {
  writeFileSync(path, Buffer.alloc(bytes));
  const date = new Date(modifiedAt);
  utimesSync(path, date, date);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("cleanupProxyCache", () => {
  it("removes idle and oldest entries until the cache is within its byte budget", () => {
    const cache = cacheDir();
    const now = 1_800_000_000_000;
    const expired = proxy(cache, "expired");
    const oldest = proxy(cache, "oldest");
    const newest = proxy(cache, "newest");
    writeEntry(expired, 4, now - 31 * 24 * 60 * 60 * 1000);
    writeEntry(oldest, 6, now - 3_000);
    writeEntry(newest, 6, now - 1_000);

    const result = cleanupProxyCache(cache, {
      now,
      maxBytes: 8,
      maxIdleMs: 30 * 24 * 60 * 60 * 1000,
      minSweepIntervalMs: 0,
    });

    expect(result.removed).toEqual([expired, oldest]);
    expect(result.bytesAfter).toBe(6);
    expect(existsSync(expired)).toBe(false);
    expect(existsSync(oldest)).toBe(false);
    expect(existsSync(newest)).toBe(true);
  });

  it("reports the same removals in a dry run and removes nothing", () => {
    const cache = cacheDir();
    const now = 1_800_000_000_000;
    const idle = proxy(cache, "idle");
    const older = proxy(cache, "older");
    const recent = proxy(cache, "recent");
    writeEntry(idle, 4, now - 2 * 60 * 60 * 1000);
    writeEntry(older, 3, now - 10_000);
    writeEntry(recent, 6, now - 1_000);
    const options = { now, maxBytes: 7, maxIdleMs: 60 * 60 * 1000, minSweepIntervalMs: 0 };

    const planned = cleanupProxyCache(cache, { ...options, dryRun: true });
    expect(existsSync(idle)).toBe(true);
    expect(cleanupProxyCache(cache, options)).toEqual(planned);
    expect(planned).toMatchObject({ removed: [idle, older], bytesBefore: 13, bytesAfter: 6 });
    expect(existsSync(idle)).toBe(false);
    expect(existsSync(recent)).toBe(true);
  });

  it("counts and evicts WebM proxies alongside MP4 proxies", () => {
    const cache = cacheDir();
    const now = 1_800_000_000_000;
    const webm = proxy(cache, "alpha", ".webm");
    const mp4 = proxy(cache, "opaque");
    writeEntry(webm, 6, now - 2_000);
    writeEntry(mp4, 6, now - 1_000);

    const result = cleanupProxyCache(cache, {
      now,
      maxBytes: 6,
      maxIdleMs: 10_000,
      minSweepIntervalMs: 0,
    });

    expect(result.bytesBefore).toBe(12);
    expect(result.removed).toEqual([webm]);
    expect(result.bytesAfter).toBe(6);
  });

  it("preserves in-flight entries and removes stale temporary files", () => {
    const cache = cacheDir();
    const now = 1_800_000_000_000;
    const inFlight = proxy(cache, "active");
    const staleTemp = join(cache, `.tmp-${randomUUID()}-${basename(inFlight)}`);
    writeEntry(inFlight, 12, now - 40 * 24 * 60 * 60 * 1000);
    writeEntry(staleTemp, 3, now - 2 * 60 * 60 * 1000);

    const result = cleanupProxyCache(cache, {
      now,
      maxBytes: 1,
      maxIdleMs: 30 * 24 * 60 * 60 * 1000,
      staleTempMs: 60 * 60 * 1000,
      minSweepIntervalMs: 0,
      protectedPaths: new Set([inFlight]),
    });

    expect(result.removed).toEqual([staleTemp]);
    expect(result.bytesAfter).toBe(12);
    expect(existsSync(inFlight)).toBe(true);
  });

  it("never removes a file the transcoder did not name, even from an idle cache over budget", () => {
    const cache = cacheDir();
    const now = 1_800_000_000_000;
    const userFiles = [join(cache, "holiday.mp4"), join(cache, ".tmp-notes.mp4")];
    for (const path of userFiles) writeEntry(path, 4, now - 40 * 24 * 60 * 60 * 1000);

    const result = cleanupProxyCache(cache, {
      now,
      maxBytes: 0,
      maxIdleMs: 1,
      staleTempMs: 1,
      minSweepIntervalMs: 0,
    });

    expect(result.removed).toEqual([]);
    for (const path of userFiles) expect(existsSync(path)).toBe(true);
  });

  it("rate-limits repeated directory sweeps", () => {
    const cache = cacheDir();
    const path = proxy(cache, "entry");
    writeEntry(path, 2, 1_000);

    const first = cleanupProxyCache(cache, {
      now: 2_000,
      maxBytes: 10,
      maxIdleMs: 10_000,
      minSweepIntervalMs: 5_000,
    });
    const second = cleanupProxyCache(cache, {
      now: 3_000,
      maxBytes: 1,
      maxIdleMs: 10_000,
      minSweepIntervalMs: 5_000,
    });

    expect(first.skipped).toBe(false);
    expect(second.skipped).toBe(true);
    expect(existsSync(path)).toBe(true);
  });
});
