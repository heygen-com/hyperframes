import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bundledSfxAssetPath } from "./bundled-sfx-provider.mjs";
import { mediaVectorRows } from "./local-media-search.mjs";

const SHIPPED_INDEX = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "registry",
  "catalog-artifact",
  "media-vectors.json",
);

function shippedIndex() {
  return JSON.parse(readFileSync(SHIPPED_INDEX, "utf8"));
}

function writeIndex(t, metadata) {
  const dir = mkdtempSync(join(tmpdir(), "hf-media-index-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "media-vectors.json");
  writeFileSync(path, JSON.stringify(metadata));
  return path;
}

function withRevision(metadata) {
  const metadataRevision = createHash("sha256").update(JSON.stringify(metadata.rows)).digest("hex");
  return { ...metadata, metadataRevision };
}

test("the bundled media index validates and every row names a bundled SFX file", () => {
  const rows = mediaVectorRows();
  assert.equal(rows.length, shippedIndex().rows.length);
  assert.ok(rows.length > 0);
  for (const row of rows) assert.ok(bundledSfxAssetPath(row.file), row.file);
});

test("a media index in the user's cache folder is never read", (t) => {
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
    JSON.stringify({
      rows: [{ id: "hosts", kind: "sfx", file: "/etc/hosts" }],
    }),
  );
  assert.deepEqual(mediaVectorRows(), shippedIndex().rows);
});

test("an index whose rows do not match its metadata revision is refused", (t) => {
  const metadata = shippedIndex();
  metadata.rows[0] = { ...metadata.rows[0], file: "/etc/hosts" };
  assert.throws(() => mediaVectorRows(writeIndex(t, metadata)), /metadataRevision/);
});

test("an index with the wrong dimensions or malformed rows is refused", (t) => {
  const base = shippedIndex();
  assert.throws(
    () => mediaVectorRows(writeIndex(t, { ...base, dimensions: 3072 })),
    /384 dimensions/,
  );
  const badRow = withRevision({
    ...base,
    rows: [{ ...base.rows[0], file: 7 }, ...base.rows.slice(1)],
  });
  assert.throws(() => mediaVectorRows(writeIndex(t, badRow)), /malformed or out of order/);
  const reordered = withRevision({ ...base, rows: [...base.rows].reverse() });
  assert.throws(() => mediaVectorRows(writeIndex(t, reordered)), /malformed or out of order/);
  assert.throws(
    () => mediaVectorRows(writeIndex(t, { ...base, names: base.names.slice(1) })),
    /do not line up/,
  );
});

test("a missing media index has no rows", () => {
  assert.deepEqual(mediaVectorRows(join(tmpdir(), "hf-no-such-index", "media-vectors.json")), []);
});
