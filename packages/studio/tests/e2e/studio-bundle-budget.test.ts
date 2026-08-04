import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs gate script, no type declarations
import {
  checkEagerBundleBudget,
  EAGER_ENTRY_CHUNK_GZIP_RATCHET_BYTES,
  findEagerAssets,
} from "./studio-bundle-budget.mjs";

const ENTRY_TAG = '<script type="module" crossorigin src="/assets/index.js"></script>';
const PRELOAD_TAG = '<link rel="modulepreload" crossorigin href="/assets/vendor.js">';
const STYLE_TAG = '<link rel="stylesheet" href="/assets/index.css">';
const BUDGET: number = EAGER_ENTRY_CHUNK_GZIP_RATCHET_BYTES;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

/** Incompressible bytes, so each fixture's gzip size tracks its declared size. */
function fixtureDist(entryBytes: number, preloadBytes?: number): string {
  const distDir = mkdtempSync(join(tmpdir(), "studio-bundle-budget-"));
  temporaryDirectories.push(distDir);
  mkdirSync(join(distDir, "assets"));
  const preload = preloadBytes == null ? "" : PRELOAD_TAG;
  writeFileSync(join(distDir, "index.html"), `${ENTRY_TAG}${preload}${STYLE_TAG}`);
  writeFileSync(join(distDir, "assets/index.js"), randomBytes(entryBytes));
  if (preloadBytes != null) {
    writeFileSync(join(distDir, "assets/vendor.js"), randomBytes(preloadBytes));
  }
  return distDir;
}

describe("studio bundle budget", () => {
  it("reads exactly one eagerly-loaded entry module plus its modulepreloads", () => {
    const { entries, preloads } = findEagerAssets(`${ENTRY_TAG}${PRELOAD_TAG}${STYLE_TAG}`);
    expect(entries).toEqual(["/assets/index.js"]);
    // The stylesheet link must not be mistaken for a preloaded module.
    expect(preloads).toEqual(["/assets/vendor.js"]);
  });

  it("fails when index.html has more than one eager entry module", () => {
    const distDir = fixtureDist(64);
    writeFileSync(join(distDir, "index.html"), `${ENTRY_TAG}${ENTRY_TAG}`);

    const { passed, report } = checkEagerBundleBudget(distDir, BUDGET);

    expect(passed).toBe(false);
    expect(report).toContain("FAIL eagerEntryModuleCount measured=2 budget=1");
  });

  it("fails, naming the measured and budgeted values, on an over-budget artifact", () => {
    const { passed, report, gzipBytes } = checkEagerBundleBudget(
      fixtureDist(BUDGET + 64 * 1024),
      BUDGET,
    );

    expect(passed).toBe(false);
    expect(report).toContain(
      `FAIL eagerEntryChunkGzipBytes measured=${gzipBytes}B budget=${BUDGET}B`,
    );
  });

  it("counts modulepreloaded chunks, so a manualChunks split cannot game the budget", () => {
    const total = BUDGET + 64 * 1024;
    const whole = checkEagerBundleBudget(fixtureDist(total), BUDGET);
    const split = checkEagerBundleBudget(fixtureDist(total / 2, total / 2), BUDGET);

    // Same eager payload, two chunks instead of one — the verdict must not change.
    expect(split.gzipBytes).toBeGreaterThan(whole.gzipBytes * 0.99);
    expect(split.passed).toBe(false);
  });

  it("passes when the whole eager graph fits the budget", () => {
    const { passed, report } = checkEagerBundleBudget(fixtureDist(1_024, 1_024), 5_000_000);

    expect(passed).toBe(true);
    expect(report).toContain("PASS eagerEntryChunkGzipBytes");
  });
});
