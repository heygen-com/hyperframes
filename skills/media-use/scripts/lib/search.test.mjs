import { strict as assert } from "node:assert";
import { test } from "node:test";
import { searchRecords } from "./search.mjs";

const recs = Array.from({ length: 23 }, (_, i) => ({
  id: `bgm_${i}`,
  type: i % 2 ? "bgm" : "sfx",
  description: i === 5 ? "energetic tech whoosh" : `track ${i}`,
}));

test("matches id / description / type, case-insensitively", () => {
  assert.equal(searchRecords(recs, "ENERGETIC").results.length, 1);
  assert.equal(searchRecords(recs, "energetic").results[0].id, "bgm_5");
  assert.ok(searchRecords(recs, "sfx").total > 0);
});

test("caps page size and reports pagination", () => {
  const r = searchRecords(recs, "", { pageSize: 10 });
  assert.equal(r.results.length, 10, "never returns more than a page");
  assert.equal(r.total, 23);
  assert.equal(r.pages, 3);
  assert.equal(r.page, 1);
});

test("page navigation returns the right slice, clamps out-of-range", () => {
  assert.equal(searchRecords(recs, "", { page: 3, pageSize: 10 }).results.length, 3);
  assert.equal(searchRecords(recs, "", { page: 99, pageSize: 10 }).page, 3, "clamped to last page");
});

test("empty query returns everything (paginated)", () => {
  assert.equal(searchRecords(recs, "").total, 23);
});
