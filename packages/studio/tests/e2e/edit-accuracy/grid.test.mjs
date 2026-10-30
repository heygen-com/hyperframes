import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import timings from "./timings.json" with { type: "json" };
import { FIXTURE_CDN, buildGrid, localAsset, shardCases, writeFixture } from "./grid.mjs";

function fixtureUrls(spec) {
  const dir = mkdtempSync(join(tmpdir(), "edit-bench-urls-"));
  writeFixture(spec, dir);
  const pages = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".html"));
  const urls = pages.flatMap((f) =>
    [...readFileSync(join(dir, String(f)), "utf8").matchAll(/https?:\/\/[^"'\s)]+/g)].map(
      (m) => m[0],
    ),
  );
  rmSync(dir, { recursive: true });
  return urls;
}

// Only the CDN host is intercepted, so a mapped URL anywhere else would still reach the network.
const servedLocally = (url) => url.startsWith(FIXTURE_CDN) && localAsset(url) !== undefined;

describe("grid fixtures", () => {
  it("reference only URLs the bench serves from the repo", () => {
    const unserved = buildGrid("full")
      .flatMap(fixtureUrls)
      .filter((url) => !servedLocally(url));
    expect([...new Set(unserved)]).toEqual([]);
  }, 30_000);
});

describe("grid size", () => {
  it("holds 747 cases, 271 of them in the pull request slice, each id once", () => {
    const full = buildGrid("full");
    expect(full).toHaveLength(747);
    expect(new Set(full.map((c) => c.id)).size).toBe(747);
    expect(buildGrid("pr")).toHaveLength(271);
  });
});

describe("shards", () => {
  const seconds = (cases) => cases.reduce((sum, c) => sum + (timings[c.id] ?? 0), 0);

  it.each([
    ["full", 20],
    ["pr", 5],
  ])(
    "put each %s case in one of %i shards, all within one case's time of each other",
    (grid, shards) => {
      const cases = buildGrid(grid);
      const split = Array.from({ length: shards }, (_, i) => shardCases(cases, i + 1, shards));
      expect(
        split
          .flat()
          .map((c) => c.id)
          .sort(),
      ).toEqual(cases.map((c) => c.id).sort());
      const times = split.map(seconds);
      const slowestCase = Math.max(...cases.map((c) => timings[c.id] ?? 0));
      expect(Math.max(...times) - Math.min(...times)).toBeLessThanOrEqual(slowestCase);
    },
  );

  it("still run a case with no timing", () => {
    const cases = buildGrid("pr");
    const untimed = Object.fromEntries(
      Object.entries(timings).filter(([id]) => id !== cases[0].id),
    );
    const split = [1, 2, 3].flatMap((i) => shardCases(cases, i, 3, untimed));
    expect(split.filter((c) => c.id === cases[0].id)).toHaveLength(1);
  });
});
