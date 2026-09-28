import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findByPrompt, readManifest } from "../../../scripts/lib/manifest.mjs";
import { agentWritePath, recordInManifest, voicePaths, writtenAssets } from "./media-record.mjs";

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

test("a rerun that writes the same take keeps one record", (t) => {
  const dir = project(t);

  recordInManifest(dir, voiceLine("Hello world", 1.25));
  recordInManifest(dir, voiceLine("Hello world", 1.25));

  assert.equal(readManifest(dir).length, 1);
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

test("the engine writes over only its own files, else the next free name", (t) => {
  const dir = project(t);
  mkdirSync(join(dir, "assets/sfx"), { recursive: true });
  const names = ["mine", "made", "adopted", "twice", "twice-2", "kept", "kept-2"];
  for (const name of names) writeFileSync(join(dir, `assets/sfx/${name}.mp3`), name);
  for (const path of ["assets/sfx/made.mp3", "assets/sfx/kept-2.mp3"])
    recordInManifest(dir, [{ path, type: "sfx", source: "search" }]);
  recordInManifest(dir, [{ path: "assets/sfx/adopted.mp3", type: "sfx", source: "existing" }]);
  const anomalies = [];
  const at = (name, reusable) =>
    agentWritePath(dir, `assets/sfx/${name}.mp3`, { anomalies, reusable });

  assert.equal(at("new"), "assets/sfx/new.mp3");
  assert.equal(at("made"), "assets/sfx/made.mp3");
  assert.equal(
    at("mine", (path) => path === "assets/sfx/mine.mp3"),
    "assets/sfx/mine.mp3",
  );
  assert.deepEqual(anomalies, []);
  assert.equal(at("mine"), "assets/sfx/mine-2.mp3");
  assert.equal(at("adopted"), "assets/sfx/adopted-2.mp3");
  assert.equal(at("twice"), "assets/sfx/twice-3.mp3");
  assert.equal(at("kept"), "assets/sfx/kept-2.mp3");
  assert.equal(anomalies.length, 4);
  assert.match(
    anomalies[0],
    /^assets\/sfx\/mine\.mp3: kept, .* writing assets\/sfx\/mine-2\.mp3 instead/,
  );
});

test("two spoken lines never share a file when one's name is taken by the person", (t) => {
  const dir = project(t);
  mkdirSync(join(dir, "assets/voice"), { recursive: true });
  writeFileSync(join(dir, "assets/voice/hook.wav"), "the person's own hook");
  const anomalies = [];

  const paths = voicePaths(
    dir,
    [
      { id: "hook", text: "First" },
      { id: "hook-2", text: "Second" },
      { id: "blank", text: " " },
    ],
    anomalies,
  );

  assert.deepEqual(Object.fromEntries(paths), {
    hook: "assets/voice/hook-2.wav",
    "hook-2": "assets/voice/hook-2-2.wav",
  });
  assert.equal(anomalies.length, 2);
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
