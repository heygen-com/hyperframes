import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mediaVectorRows } from "./local-media-search.mjs";

test("media vectors are read from the cache folder's catalog when HYPERFRAMES_CACHE_DIR is set", (t) => {
  const cache = mkdtempSync(join(tmpdir(), "hf-cache-"));
  const prior = process.env.HYPERFRAMES_CACHE_DIR;
  process.env.HYPERFRAMES_CACHE_DIR = cache;
  t.after(() => {
    if (prior === undefined) delete process.env.HYPERFRAMES_CACHE_DIR;
    else process.env.HYPERFRAMES_CACHE_DIR = prior;
    rmSync(cache, { recursive: true, force: true });
  });
  mkdirSync(join(cache, "catalog"));
  writeFileSync(
    join(cache, "catalog", "media-vectors.json"),
    JSON.stringify({ rows: [{ id: "a" }] }),
  );
  assert.deepEqual(mediaVectorRows(), [{ id: "a" }]);
});
