import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveSfx } from "./lib/sfx.mjs";

// Proves the relocated engine (skills/media-use/audio/) still resolves its
// bundled SFX library from the moved location — the path most likely to break
// on a subtree move. Offline (heygenOK:false), no network.

const HERE = dirname(fileURLToPath(import.meta.url));
const sfxLibDir = join(HERE, "..", "assets", "sfx"); // same offset the engine uses

test("bundled SFX library resolves from the relocated path", async () => {
  assert.ok(existsSync(join(sfxLibDir, "manifest.json")), "moved manifest is present");
  const dir = mkdtempSync(join(tmpdir(), "mu-audio-"));
  try {
    const { sfx, anomalies } = await resolveSfx({
      cues: [{ id: "1", name: "whoosh" }],
      heygenOK: false,
      hyperframesDir: dir,
      sfxLibDir,
    });
    assert.equal(sfx.length, 1, `expected 1 resolved cue, got anomalies: ${anomalies.join("; ")}`);
    assert.equal(sfx[0].source, "local");
    assert.match(sfx[0].file, /assets\/sfx\//);
    assert.ok(existsSync(join(dir, sfx[0].file)), "matched SFX copied into the project");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown cue is reported, not fatal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-audio-"));
  try {
    const { sfx, anomalies } = await resolveSfx({
      cues: [{ id: "1", name: "definitely-not-a-real-sfx" }],
      heygenOK: false,
      hyperframesDir: dir,
      sfxLibDir,
    });
    assert.equal(sfx.length, 0);
    assert.ok(anomalies.some((a) => /not in bundled library/.test(a)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a person's own file under a bundled name is not labelled as the library's", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mu-audio-"));
  try {
    const resolve = () =>
      resolveSfx({
        cues: [{ id: "1", name: "whoosh" }],
        heygenOK: false,
        hyperframesDir: dir,
        sfxLibDir,
      });
    const copied = await resolve();
    const reused = await resolve();
    writeFileSync(join(dir, copied.sfx[0].file), "the person's own whoosh");
    const own = await resolve();

    assert.deepEqual(
      [copied, reused, own].map(({ sfx }) => sfx[0].source),
      ["local", "local", "project"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
