import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readManifest } from "../../../scripts/lib/manifest.mjs";
import { recordInManifest, writtenAssets } from "./media-record.mjs";

const noBgm = { bgm: null, bgmFields: { bgm_pending: false } };

function project(t) {
  const dir = mkdtempSync(join(tmpdir(), "mu-record-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("a voice run leaves a manifest entry marked generated", (t) => {
  const dir = project(t);
  const assets = writtenAssets({
    only: new Set(["tts"]),
    lines: [{ id: "01", text: "Welcome to the launch" }],
    voices: [{ id: "01", path: "assets/voice/01.wav", duration_s: 2.34 }],
    ttsProvider: "kokoro",
    sfx: [],
    ...noBgm,
  });

  assert.deepEqual(recordInManifest(dir, assets), []);

  assert.deepEqual(
    readManifest(dir).map(({ path, type, source, description, duration, provenance }) => ({
      path,
      type,
      source,
      description,
      duration,
      provenance,
    })),
    [
      {
        path: "assets/voice/01.wav",
        type: "voice",
        source: "generated",
        description: "Welcome to the launch",
        duration: 2.3,
        provenance: { provider: "kokoro", prompt: "Welcome to the launch" },
      },
    ],
  );
});

test("a rerun that rewrites the same files keeps one record each", (t) => {
  const dir = project(t);
  const run = () =>
    recordInManifest(dir, [{ path: "assets/voice/01.wav", type: "voice", source: "generated" }]);

  run();
  run();

  assert.equal(readManifest(dir).length, 1);
});

test("music and sound effects are marked by where they came from", () => {
  const assets = writtenAssets({
    only: new Set(["bgm", "sfx"]),
    lines: [],
    voices: [{ id: "01", path: "assets/voice/01.wav" }],
    bgm: { path: "assets/bgm/track.mp3", query: "calm" },
    bgmFields: { bgm_pending: false, bgm_mode: "retrieve" },
    sfx: [
      { file: "assets/sfx/whoosh.mp3", name: "whoosh", source: "local" },
      { file: "assets/sfx/whoosh.mp3", name: "whoosh", source: "local" },
      { file: "assets/sfx/glass.mp3", name: "glass", source: "heygen" },
      { file: "assets/sfx/pop.mp3", name: "pop", source: "project" },
    ],
  });

  assert.deepEqual(
    assets.map(({ path, source }) => [path, source]),
    [
      ["assets/bgm/track.mp3", "search"],
      ["assets/sfx/whoosh.mp3", "bundled"],
      ["assets/sfx/glass.mp3", "search"],
    ],
  );
});

test("music made locally is marked generated once it is ready, not while pending", () => {
  const written = (bgm_pending) =>
    writtenAssets({
      only: new Set(["bgm"]),
      lines: [],
      voices: [],
      sfx: [],
      bgm: { path: "assets/bgm/track.wav" },
      bgmFields: { bgm_pending, bgm_mode: "detached-single" },
    }).map(({ source }) => source);

  assert.deepEqual(written(true), []);
  assert.deepEqual(written(false), ["generated"]);
});

test("a file that cannot be recorded becomes an anomaly, not a failure", (t) => {
  const dir = project(t);
  writeFileSync(join(dir, ".media"), "a file where the media folder should be");

  const anomalies = recordInManifest(dir, [
    { path: "assets/voice/01.wav", type: "voice", source: "generated" },
  ]);

  assert.equal(anomalies.length, 1);
  assert.match(anomalies[0], /^assets\/voice\/01\.wav: not recorded in the media manifest/);
});
