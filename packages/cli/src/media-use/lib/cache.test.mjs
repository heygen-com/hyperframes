import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { appendRecord } from "./manifest.mjs";
import {
  cacheGet,
  cacheGetByEntity,
  cachePut,
  findGlobalBySha,
  importFromCache,
  readGlobalManifest,
} from "./cache.mjs";

function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), "mu-cache-recovery-"));
  const previous = process.env.HYPERFRAMES_MEDIA_HOME;
  process.env.HYPERFRAMES_MEDIA_HOME = join(root, "library");
  t.after(() => {
    if (previous === undefined) delete process.env.HYPERFRAMES_MEDIA_HOME;
    else process.env.HYPERFRAMES_MEDIA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  });
  const source = join(root, "original.wav");
  const bytes = "cache recovery fixture";
  writeFileSync(source, bytes);
  const record = {
    id: "bgm_001",
    type: "bgm",
    entity: "Recovery",
    provenance: { prompt: "cache recovery" },
  };
  return { root, source, bytes, record };
}

for (const invalid of [
  "missing file",
  "missing marker",
  "missing directory",
  "empty file",
  "directory",
]) {
  test(`cachePut repairs a ${invalid} before deduplicating`, (t) => {
    const { root, source, bytes, record } = sandbox(t);
    const first = cachePut(source, record);
    const entry = dirname(first.cached_path);
    if (invalid === "missing marker") rmSync(join(entry, ".hf-complete"));
    else if (invalid === "missing directory") rmSync(entry, { recursive: true });
    else if (invalid === "empty file") writeFileSync(first.cached_path, "");
    else {
      rmSync(first.cached_path);
      if (invalid === "directory") mkdirSync(first.cached_path);
    }

    const replacement = join(root, "replacement.wav");
    writeFileSync(replacement, bytes);
    const repaired = cachePut(replacement, record);

    assert.equal(repaired.deduped, undefined);
    assert.equal(repaired.sha, first.sha);
    assert.equal(readFileSync(repaired.cached_path, "utf8"), bytes);
    const cached = cacheGet("  Cache  Recovery ", "bgm");
    assert.equal(cached?.sha, repaired.sha);
    assert.equal(readFileSync(cached.cached_path, "utf8"), bytes);
    assert.equal(cacheGetByEntity("recovery")?.sha, repaired.sha);
    const imported = importFromCache(cached, join(root, "project"), "bgm_002", "restored.wav");
    assert.equal(imported?.provenance.imported_from, first.sha);
    assert.equal(readFileSync(join(root, "project", "restored.wav"), "utf8"), bytes);
  });
}

test("an intact cache stays deduplicated without adding a manifest record", (t) => {
  const { source, record } = sandbox(t);
  const first = cachePut(source, record);
  const second = cachePut(source, record);

  assert.deepEqual(second, { ...first, deduped: true });
  assert.equal(readGlobalManifest().length, 1);
});

test("prompt and entity lookups skip a stale entry for another complete match", (t) => {
  const { root, source, record } = sandbox(t);
  const first = cachePut(source, record);
  rmSync(first.cached_path);
  const secondSource = join(root, "second.wav");
  writeFileSync(secondSource, "different reusable bytes");
  const second = cachePut(secondSource, record);

  assert.equal(cacheGet("cache recovery", "bgm")?.sha, second.sha);
  assert.equal(cacheGetByEntity("RECOVERY")?.sha, second.sha);
  assert.equal(cacheGet("cache recovery", "sfx"), null);
});

test("sha reuse counts distinct content and selects the repaired record", (t) => {
  const { root, source, bytes, record } = sandbox(t);
  const first = cachePut(source, record);
  rmSync(first.cached_path);
  const replacement = join(dirname(first.cached_path), "replacement.wav");
  writeFileSync(replacement, bytes);
  appendRecord(join(root, "library"), {
    ...record,
    sha: first.sha,
    reusable: true,
    cached_path: replacement,
  });

  assert.equal(findGlobalBySha(first.sha)?.cached_path, replacement);
  assert.equal(findGlobalBySha(first.sha.slice(0, 16))?.cached_path, replacement);
});
