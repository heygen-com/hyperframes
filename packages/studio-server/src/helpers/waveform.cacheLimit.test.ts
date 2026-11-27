import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markWaveformCacheUsed, WAVEFORM_CACHE_LIMITS, writeWaveformCache } from "./waveform.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function cacheWithEntries(count: number, contents = "[0]"): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-waveform-limit-"));
  dirs.push(dir);
  const cacheDir = join(dir, ".waveform-cache");
  mkdirSync(cacheDir);
  for (let i = 0; i < count; i++) {
    const path = join(cacheDir, `entry-${i}.json`);
    writeFileSync(path, contents);
    utimesSync(path, 1_000 + i, 1_000 + i);
  }
  return cacheDir;
}

describe("writeWaveformCache", () => {
  it("keeps the cache folder at its entry limit by dropping the oldest entries", () => {
    const cacheDir = cacheWithEntries(WAVEFORM_CACHE_LIMITS.entries + 5);

    writeWaveformCache(join(cacheDir, "newest.json"), [0.5]);

    const left = readdirSync(cacheDir);
    expect(left).toHaveLength(WAVEFORM_CACHE_LIMITS.entries);
    expect(left).toContain("newest.json");
    for (let i = 0; i < 6; i++) expect(left).not.toContain(`entry-${i}.json`);
    expect(left).toContain("entry-6.json");
  });

  it("keeps the cache folder under its byte limit", () => {
    const cacheDir = cacheWithEntries(4, `[${"0,".repeat(49)}0]`);

    writeWaveformCache(join(cacheDir, "newest.json"), [0.5], { entries: 100, bytes: 250 });

    expect(readdirSync(cacheDir).sort()).toEqual(["entry-2.json", "entry-3.json", "newest.json"]);
  });

  it("drops the least recently used entry, not the oldest written", async () => {
    const cacheDir = cacheWithEntries(3);
    await markWaveformCacheUsed(join(cacheDir, "entry-0.json"));

    writeWaveformCache(join(cacheDir, "newest.json"), [0.5], { entries: 3, bytes: 1_000 });

    expect(readdirSync(cacheDir).sort()).toEqual(["entry-0.json", "entry-2.json", "newest.json"]);
  });
});
