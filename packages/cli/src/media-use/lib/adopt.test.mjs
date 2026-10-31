import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findExistingAsset, adoptExistingAssets } from "./adopt.mjs";

let tmp;
function setup() {
  tmp = mkdtempSync(join(tmpdir(), "mu-adopt-test-"));
}
function cleanup() {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}
function drop(rel) {
  const full = join(tmp, "assets", rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, "x");
}

function runTests() {
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });

  test("does NOT false-match a short filename stem (who.mp3 vs 'whoosh')", () => {
    setup();
    drop("sfx/who.mp3");
    assert.equal(findExistingAsset(tmp, "whoosh", "sfx"), null);
    cleanup();
  });

  test("does NOT match a one-letter filename against any intent", () => {
    setup();
    drop("images/a.jpg");
    assert.equal(findExistingAsset(tmp, "gradient tech background", "image"), null);
    cleanup();
  });

  test("matches on a shared meaningful word", () => {
    setup();
    drop("images/hero-shot.jpg");
    const hit = findExistingAsset(tmp, "hero image", "image");
    assert.ok(hit);
    assert.equal(hit.relativePath, "assets/images/hero-shot.jpg");
    cleanup();
  });

  test("matches multi-word overlap", () => {
    setup();
    drop("images/gradient-tech-bg.jpg");
    assert.ok(findExistingAsset(tmp, "gradient tech background", "image"));
    cleanup();
  });

  test("a shared stopword alone does not match", () => {
    setup();
    drop("video/the-video.mp4");
    assert.equal(findExistingAsset(tmp, "the rocket", null), null);
    cleanup();
  });

  test("respects the type filter", () => {
    setup();
    drop("sfx/rocket.mp3");
    assert.equal(findExistingAsset(tmp, "rocket", "image"), null, "wrong type is skipped");
    assert.ok(findExistingAsset(tmp, "rocket", "sfx"), "right type matches");
    cleanup();
  });

  test("adoptExistingAssets still imports every typed file (unaffected by match rule)", () => {
    setup();
    drop("sfx/who.mp3");
    drop("images/a.jpg");
    assert.equal(adoptExistingAssets(tmp).length, 2);
    cleanup();
  });

  test("labels an audio file by its folder or its file name, not always bgm", () => {
    setup();
    drop("voice-intro.mp3");
    drop("sfx-click.mp3");
    drop("narration.mp3");
    drop("soundtrack/main.mp3");
    drop("track.mp3");
    drop("soundfx/pop.mp3");
    const types = Object.fromEntries(
      adoptExistingAssets(tmp).map((record) => [record.path, record.type]),
    );
    assert.deepEqual(types, {
      "assets/voice-intro.mp3": "voice",
      "assets/sfx-click.mp3": "sfx",
      "assets/narration.mp3": "voice",
      "assets/soundtrack/main.mp3": "bgm",
      "assets/track.mp3": "bgm",
      "assets/soundfx/pop.mp3": "sfx",
    });
    cleanup();
  });

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

console.log("media-use · adopt / findExistingAsset tests\n");
runTests();
