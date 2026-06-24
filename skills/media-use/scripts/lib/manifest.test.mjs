import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readManifest,
  appendRecord,
  findByPrompt,
  findByEntity,
  nextId,
  manifestPath,
  mediaDir,
  typeDirPath,
} from "./manifest.mjs";
import { regenerateIndex, generateIndexContent } from "./index-gen.mjs";
import {
  contentHash,
  cachePut,
  cacheGet,
  cacheGetByEntity,
  importFromCache,
  promote,
} from "./cache.mjs";

let tmp;

function setup() {
  tmp = mkdtempSync(join(tmpdir(), "mu-test-"));
}

function cleanup() {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}

function makeRecord(overrides = {}) {
  return {
    id: "bgm_001",
    type: "bgm",
    path: ".media/audio/bgm/bgm_001.wav",
    source: "search",
    description: "soft minimal ambient",
    duration: 11,
    provenance: { provider: "heygen.audio.sounds", prompt: "subtle tech" },
    ...overrides,
  };
}

function runTests() {
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // --- manifest.mjs ---

  test("readManifest returns empty array when no manifest exists", () => {
    setup();
    const result = readManifest(tmp);
    assert.deepStrictEqual(result, []);
    cleanup();
  });

  test("appendRecord writes valid JSONL and readManifest parses it back", () => {
    setup();
    const record = makeRecord();
    appendRecord(tmp, record);
    const records = readManifest(tmp);
    assert.equal(records.length, 1);
    assert.deepStrictEqual(records[0], record);
    cleanup();
  });

  test("appendRecord creates .media/ and type subdirs on first write", () => {
    setup();
    appendRecord(tmp, makeRecord());
    assert.ok(existsSync(mediaDir(tmp)));
    assert.ok(existsSync(typeDirPath(tmp, "bgm")));
    cleanup();
  });

  test("appendRecord appends multiple records", () => {
    setup();
    appendRecord(tmp, makeRecord({ id: "bgm_001" }));
    appendRecord(tmp, makeRecord({ id: "bgm_002", provenance: { prompt: "energetic" } }));
    const records = readManifest(tmp);
    assert.equal(records.length, 2);
    assert.equal(records[0].id, "bgm_001");
    assert.equal(records[1].id, "bgm_002");
    cleanup();
  });

  test("findByPrompt returns exact-match record", () => {
    setup();
    appendRecord(tmp, makeRecord());
    const found = findByPrompt(tmp, "subtle tech", "bgm");
    assert.ok(found);
    assert.equal(found.id, "bgm_001");
    cleanup();
  });

  test("findByPrompt returns null on miss", () => {
    setup();
    appendRecord(tmp, makeRecord());
    assert.equal(findByPrompt(tmp, "nonexistent", "bgm"), null);
    cleanup();
  });

  test("findByPrompt filters by type", () => {
    setup();
    appendRecord(tmp, makeRecord({ type: "sfx" }));
    assert.equal(findByPrompt(tmp, "subtle tech", "bgm"), null);
    assert.ok(findByPrompt(tmp, "subtle tech", "sfx"));
    cleanup();
  });

  test("findByEntity matches case-insensitively", () => {
    setup();
    appendRecord(tmp, makeRecord({ entity: "GitHub", type: "icon" }));
    assert.ok(findByEntity(tmp, "github"));
    assert.ok(findByEntity(tmp, "GITHUB"));
    assert.equal(findByEntity(tmp, "gitlab"), null);
    cleanup();
  });

  test("nextId generates sequential ids", () => {
    setup();
    assert.equal(nextId(tmp, "bgm"), "bgm_001");
    appendRecord(tmp, makeRecord({ id: "bgm_001" }));
    assert.equal(nextId(tmp, "bgm"), "bgm_002");
    appendRecord(tmp, makeRecord({ id: "bgm_002" }));
    assert.equal(nextId(tmp, "bgm"), "bgm_003");
    cleanup();
  });

  // --- index-gen.mjs ---

  test("regenerateIndex produces plain-column table", () => {
    setup();
    appendRecord(tmp, makeRecord());
    regenerateIndex(tmp);
    const content = readFileSync(join(tmp, ".media", "index.md"), "utf8");
    assert.ok(content.includes("# .media · 1 asset"));
    assert.ok(content.includes("bgm_001"));
    assert.ok(content.includes("soft minimal ambient"));
    assert.ok(content.includes("11s"));
    cleanup();
  });

  test("regenerateIndex handles empty manifest", () => {
    setup();
    mkdirSync(join(tmp, ".media"), { recursive: true });
    writeFileSync(manifestPath(tmp), "");
    regenerateIndex(tmp);
    const content = readFileSync(join(tmp, ".media", "index.md"), "utf8");
    assert.ok(content.includes("# .media · 0 assets"));
    cleanup();
  });

  test("generateIndexContent includes dims for images", () => {
    const records = [
      makeRecord({ id: "img_001", type: "image", width: 1920, height: 1080, duration: null }),
    ];
    const content = generateIndexContent(records);
    assert.ok(content.includes("1920×1080"));
    assert.ok(content.includes("img_001"));
  });

  test("regenerateIndex matches manifest content after multiple writes", () => {
    setup();
    appendRecord(tmp, makeRecord({ id: "bgm_001" }));
    appendRecord(
      tmp,
      makeRecord({ id: "sfx_001", type: "sfx", description: "whoosh", duration: 3 }),
    );
    regenerateIndex(tmp);
    const content = readFileSync(join(tmp, ".media", "index.md"), "utf8");
    assert.ok(content.includes("# .media · 2 assets"));
    assert.ok(content.includes("bgm_001"));
    assert.ok(content.includes("sfx_001"));
    assert.ok(content.includes("whoosh"));
    cleanup();
  });

  // --- cache.mjs ---

  test("cacheGet returns null when cache is empty", () => {
    const result = cacheGet("nonexistent prompt", "bgm");
    assert.equal(result, null);
  });

  test("cachePut + cacheGet round-trip", () => {
    setup();
    const filePath = join(tmp, "test.wav");
    writeFileSync(filePath, "fake audio bytes for testing");
    const record = makeRecord({ provenance: { prompt: "cache test" } });

    const { sha } = cachePut(filePath, record);
    assert.ok(sha);
    assert.equal(sha.length, 64);

    const found = cacheGet("cache test", "bgm");
    assert.ok(found);
    assert.equal(found.reusable, true);
    assert.equal(found.sha, sha);
    cleanup();
  });

  test("cacheGetByEntity finds cached asset", () => {
    setup();
    const filePath = join(tmp, "logo.png");
    writeFileSync(filePath, "fake png bytes");
    const record = makeRecord({
      type: "icon",
      entity: "TestCorp",
      provenance: { prompt: "TestCorp logo" },
    });

    cachePut(filePath, record);
    const found = cacheGetByEntity("testcorp");
    assert.ok(found);
    assert.equal(found.entity, "TestCorp");
    cleanup();
  });

  test("contentHash is deterministic", () => {
    setup();
    const filePath = join(tmp, "det.bin");
    writeFileSync(filePath, "deterministic content");
    const h1 = contentHash(filePath);
    const h2 = contentHash(filePath);
    assert.equal(h1, h2);
    cleanup();
  });

  test("promote copies project asset to global cache", () => {
    setup();
    const record = makeRecord();
    appendRecord(tmp, record);
    const filePath = join(tmp, record.path);
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, "promotable audio data");

    const { sha } = promote(tmp, "bgm_001");
    assert.ok(sha);

    const cached = cacheGet("subtle tech", "bgm");
    assert.ok(cached);
    assert.equal(cached.sha, sha);
    cleanup();
  });

  test("importFromCache copies cached file into project", () => {
    setup();
    const filePath = join(tmp, "source.wav");
    writeFileSync(filePath, "importable audio");
    const record = makeRecord({ provenance: { prompt: "import test" } });
    const { sha } = cachePut(filePath, record);

    const cached = cacheGet("import test", "bgm");
    const projectDir = mkdtempSync(join(tmpdir(), "mu-import-"));
    const imported = importFromCache(cached, projectDir, "bgm_001", ".media/audio/bgm/bgm_001.wav");

    assert.ok(imported);
    assert.equal(imported.id, "bgm_001");
    assert.equal(imported.provenance.imported_from, sha);
    assert.ok(existsSync(join(projectDir, ".media/audio/bgm/bgm_001.wav")));

    rmSync(projectDir, { recursive: true, force: true });
    cleanup();
  });

  // --- run ---

  let passed = 0;
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      fn();
      passed++;
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } catch (err) {
      failed++;
      console.log(`  \x1b[31m✗\x1b[0m ${name}`);
      console.log(`    ${err.message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

console.log("media-use · manifest/index/cache tests\n");
runTests();
