import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findByPrompt, readManifest } from "../../../scripts/lib/manifest.mjs";
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

const voiceLine = (intent, duration) => [
  { path: "assets/voice/01.wav", type: "voice", source: "generated", intent, duration },
];

test("a rerun that writes the same take keeps one record, and a new length is a new take", (t) => {
  const dir = project(t);

  recordInManifest(dir, voiceLine("Hello world", 1.25));
  recordInManifest(dir, voiceLine("Hello world", 1.25));
  assert.equal(readManifest(dir).length, 1);

  recordInManifest(dir, voiceLine("Hello world", 2));
  assert.deepEqual(
    readManifest(dir).map(({ duration }) => duration),
    [1.3, 2],
  );
});

test("a rerun with new text records the new take, and the old text no longer finds the file", (t) => {
  const dir = project(t);

  recordInManifest(dir, voiceLine("Hello world", 1.25));
  recordInManifest(dir, voiceLine("Welcome back to the show", 3.5));

  assert.deepEqual(
    readManifest(dir).map(({ description, duration }) => [description, duration]),
    [
      ["Hello world", 1.3],
      ["Welcome back to the show", 3.5],
    ],
  );
  assert.equal(findByPrompt(dir, "Hello world", "voice"), null);
  const index = readFileSync(join(dir, ".media/index.md"), "utf8");
  assert.match(index, /Welcome back to the show/);
  assert.doesNotMatch(index, /Hello world/);
  assert.equal(findByPrompt(dir, "Welcome back to the show", "voice")?.path, "assets/voice/01.wav");
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
    assets.map(({ path, source, provider }) => [path, source, provider]),
    [
      ["assets/bgm/track.mp3", "search", undefined],
      ["assets/sfx/whoosh.mp3", "bundled", "bundled.sfx"],
      ["assets/sfx/glass.mp3", "search", "heygen"],
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

test("a record never takes the id of a download still in flight", (t) => {
  const dir = project(t);
  mkdirSync(join(dir, ".media/audio/bgm"), { recursive: true });
  writeFileSync(join(dir, ".media/audio/bgm/bgm_001.mp3"), "");

  recordInManifest(dir, [{ path: "assets/bgm/track.wav", type: "bgm", source: "generated" }]);

  assert.deepEqual(
    readManifest(dir).map(({ id }) => id),
    ["bgm_002"],
  );
});
