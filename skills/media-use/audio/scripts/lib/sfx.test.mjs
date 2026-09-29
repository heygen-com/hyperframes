import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendRecord } from "../../../scripts/lib/manifest.mjs";
import { resolveSfx } from "./sfx.mjs";

// Offline (no HeyGen) SFX resolution: the bundled library may ship manifest.json
// without the actual mp3s. The old code copied only when the source existed but
// pushed the sfx entry unconditionally — producing a dangling reference that
// silently dropped downstream ("not on disk"). These tests lock in the loud
// behavior: a present file is copied + referenced; a missing file yields an
// anomaly and NO dangling entry.

async function withDirs(fn) {
  const root = mkdtempSync(join(tmpdir(), "hf-sfx-"));
  const libDir = join(root, "lib");
  const projDir = join(root, "proj");
  mkdirSync(libDir, { recursive: true });
  mkdirSync(projDir, { recursive: true });
  try {
    // `await` is load-bearing: without it the finally cleanup runs before the
    // async test body resolves, deleting the temp dir mid-assertion.
    return await fn({ libDir, projDir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("offline: copies and references a present bundled file", async () => {
  await withDirs(async ({ libDir, projDir }) => {
    writeFileSync(
      join(libDir, "manifest.json"),
      JSON.stringify({ whoosh: { file: "whoosh.mp3", duration: 0.8 } }),
    );
    writeFileSync(join(libDir, "whoosh.mp3"), "ID3-fake-bytes");
    const { sfx, anomalies } = await resolveSfx({
      cues: [{ id: "s1", name: "whoosh" }],
      heygenOK: false,
      hyperframesDir: projDir,
      sfxLibDir: libDir,
    });
    assert.equal(sfx.length, 1);
    assert.equal(sfx[0].file, "assets/sfx/whoosh.mp3");
    assert.equal(sfx[0].source, "local");
    assert.ok(existsSync(join(projDir, "assets/sfx/whoosh.mp3")), "mp3 copied into project");
    assert.equal(anomalies.length, 0);
  });
});

test("offline: a matched-but-missing bundled file yields an anomaly and NO dangling entry", async () => {
  await withDirs(async ({ libDir, projDir }) => {
    // Manifest names whoosh.mp3, but the mp3 was never shipped (the reported bug).
    writeFileSync(
      join(libDir, "manifest.json"),
      JSON.stringify({ whoosh: { file: "whoosh.mp3", duration: 0.8 } }),
    );
    const { sfx, anomalies } = await resolveSfx({
      cues: [{ id: "s1", name: "whoosh" }],
      heygenOK: false,
      hyperframesDir: projDir,
      sfxLibDir: libDir,
    });
    assert.equal(sfx.length, 0, "no dangling entry for a file that was never copied");
    assert.equal(anomalies.length, 1);
    assert.match(anomalies[0], /missing from the offline library/);
    assert.ok(!existsSync(join(projDir, "assets/sfx/whoosh.mp3")), "nothing copied");
  });
});

const whooshLibrary = (libDir, withFile) => {
  writeFileSync(
    join(libDir, "manifest.json"),
    JSON.stringify({ whoosh: { file: "whoosh.mp3", duration: 0.8 } }),
  );
  if (withFile) writeFileSync(join(libDir, "whoosh.mp3"), "ID3-library-bytes");
};
const record = (projDir, source) =>
  appendRecord(projDir, { id: "sfx_001", type: "sfx", path: "assets/sfx/whoosh.mp3", source });
const offline = (libDir, projDir) =>
  resolveSfx({
    cues: [{ id: "s1", name: "whoosh" }],
    heygenOK: false,
    hyperframesDir: projDir,
    sfxLibDir: libDir,
  });

test("offline: the engine's earlier copy stands in for a library file this install lacks", async () => {
  await withDirs(async ({ libDir, projDir }) => {
    whooshLibrary(libDir, false);
    mkdirSync(join(projDir, "assets/sfx"), { recursive: true });
    writeFileSync(join(projDir, "assets/sfx/whoosh.mp3"), "engine copy");
    record(projDir, "bundled");

    const { sfx, anomalies } = await offline(libDir, projDir);

    assert.deepEqual(
      sfx.map(({ file }) => file),
      ["assets/sfx/whoosh.mp3"],
    );
    assert.deepEqual(anomalies, []);
  });
});

test("offline: a person's file with the library's bytes stays theirs once recorded as their own", async () => {
  await withDirs(async ({ libDir, projDir }) => {
    whooshLibrary(libDir, true);
    mkdirSync(join(projDir, "assets/sfx"), { recursive: true });
    writeFileSync(join(projDir, "assets/sfx/whoosh.mp3"), "ID3-library-bytes");
    record(projDir, "existing");

    const { sfx } = await offline(libDir, projDir);

    assert.deepEqual(
      sfx.map(({ file }) => file),
      ["assets/sfx/whoosh-2.mp3"],
    );
    assert.equal(readFileSync(join(projDir, "assets/sfx/whoosh.mp3"), "utf8"), "ID3-library-bytes");
  });
});
