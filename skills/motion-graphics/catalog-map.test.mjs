import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const catalog = readFileSync(new URL("./catalog-map.md", import.meta.url), "utf8");

test("the stat catalog names only installable blocks and documented rules", () => {
  assert.doesNotMatch(catalog, /`stat-motion`/);
  assert.match(
    catalog,
    /\| \*\*stat\*\*[^\n]*`apple-money-count`[^\n]*hand-author[^\n]*`counting-dynamic-scale`[^\n]*`stat-bars-and-fills`/,
  );
});
