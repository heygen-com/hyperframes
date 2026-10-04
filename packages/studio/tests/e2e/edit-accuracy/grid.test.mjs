import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_CDN, buildGrid, localAsset, writeFixture } from "./grid.mjs";

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
