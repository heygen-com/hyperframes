import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WAVEFORM_CACHE_LIMIT, writeWaveformCache } from "./waveform.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("writeWaveformCache", () => {
  it("keeps the cache folder at its limit by dropping the oldest entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-waveform-limit-"));
    dirs.push(dir);
    const cacheDir = join(dir, ".waveform-cache");
    mkdirSync(cacheDir);
    for (let i = 0; i < WAVEFORM_CACHE_LIMIT + 5; i++) {
      const path = join(cacheDir, `entry-${i}.json`);
      writeFileSync(path, "[0]");
      utimesSync(path, 1_000 + i, 1_000 + i);
    }

    writeWaveformCache(join(cacheDir, "newest.json"), [0.5]);

    const left = readdirSync(cacheDir);
    expect(left).toHaveLength(WAVEFORM_CACHE_LIMIT);
    expect(left).toContain("newest.json");
    for (let i = 0; i < 6; i++) expect(left).not.toContain(`entry-${i}.json`);
    expect(left).toContain("entry-6.json");
  });
});
