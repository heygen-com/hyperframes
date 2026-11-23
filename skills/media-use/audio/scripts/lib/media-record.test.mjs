import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { AGENT_SOURCES, findByPrompt, readManifest } from "../../../scripts/lib/manifest.mjs";
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
      { file: "assets/sfx/glass.mp3", name: "glass", source: "openverse" },
    ],
  });

  assert.deepEqual(
    assets.map(({ path, source, provider }) => [path, source, provider]),
    [
      ["assets/bgm/track.mp3", "search", undefined],
      ["assets/sfx/whoosh.mp3", "bundled", "bundled.sfx"],
      ["assets/sfx/glass.mp3", "search", "openverse.audio"],
    ],
  );
});

test("a rerun of an Openverse sound effect writes over its own file, not a numbered copy", (t) => {
  const dir = project(t);
  mkdirSync(join(dir, "assets/sfx"), { recursive: true });
  const anomalies = [];
  for (let run = 0; run < 3; run++) {
    const file = agentWritePath(dir, "assets/sfx/door-knock.mp3", { anomalies });
    writeFileSync(join(dir, file), "knock");
    const sfx = [{ file, name: "door knock", source: "openverse", duration_s: 1 }];
    recordInManifest(
      dir,
      writtenAssets({ only: new Set(["sfx"]), lines: [], voices: [], sfx, ...noBgm }),
    );
  }

  assert.deepEqual(readdirSync(join(dir, "assets/sfx")), ["door-knock.mp3"]);
  assert.deepEqual(anomalies, []);
  assert.equal(readManifest(dir).length, 1);
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

test("a line id that is not a plain file name stops the run before any file is picked", (t) => {
  const dir = project(t);
  for (const id of ["../../x", "a/b", "a\\b", "C:x", "..", "."]) {
    assert.throws(() => voicePaths(dir, [{ id, text: "Hello" }], []), /must be a plain name/, id);
  }
  assert.equal(existsSync(join(dirname(dir), "x.wav")), false);
  assert.equal(existsSync(join(dir, "assets")), false);
});

test("the ids the skill writes keep their voice file names", (t) => {
  const dir = project(t);
  const ids = ["01", "intro", "s1-hook", "scene_2", "3.1"];
  const paths = voicePaths(
    dir,
    ids.map((id) => ({ id, text: "Hello" })),
    [],
  );
  assert.deepEqual(
    [...paths.values()],
    ids.map((id) => `assets/voice/${id}.wav`),
  );
});

test("a voice folder that links out of the project is never written", (t) => {
  const dir = project(t);
  const outside = mkdtempSync(join(tmpdir(), "mu-record-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(join(dir, "assets"));
  symlinkSync(outside, join(dir, "assets/voice"));
  assert.throws(
    () => voicePaths(dir, [{ id: "01", text: "Hello" }], []),
    /assets\/voice leads outside the project folder/,
  );
});

test("a link where a voice file goes is not written through, whatever the manifest says", (t) => {
  const dir = project(t);
  const outside = mkdtempSync(join(tmpdir(), "mu-record-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "theirs.wav"), "another project's voice");
  mkdirSync(join(dir, "assets/voice"), { recursive: true });
  symlinkSync(join(outside, "theirs.wav"), join(dir, "assets/voice/01.wav"));
  recordInManifest(dir, [{ path: "assets/voice/01.wav", type: "voice", source: "generated" }]);
  const anomalies = [];
  const paths = voicePaths(dir, [{ id: "01", text: "Hello" }], anomalies);
  assert.equal(paths.get("01"), "assets/voice/01-2.wav");
  assert.equal(anomalies.length, 1);
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

// An engine-written copy stays an agent source, or every rerun would write a numbered copy beside it
// (AGENT_SOURCES, manifest.mjs); what says it is the person's own voice is the provider and intent.
test("a recording line is recorded as your own recording, still an engine-written file", () => {
  const [asset] = writtenAssets({
    only: new Set(["tts"]),
    lines: [{ id: "01", audio: "take.m4a" }],
    voices: [{ id: "01", path: "assets/voice/01.wav", duration_s: 2, source: "recording" }],
    ttsProvider: "recording",
  });

  assert.equal(asset.provider, "recording");
  assert.equal(asset.intent, "your own recording");
  assert.ok(AGENT_SOURCES.includes(asset.source));
});

// Links planted in a received project's .media must not carry manifest or index writes outside it.
function outsideFile(t, content) {
  const outside = mkdtempSync(join(tmpdir(), "mu-record-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const file = join(outside, "target.txt");
  writeFileSync(file, content);
  return { outside, file };
}

const voiceAsset = (intent) => ({
  path: "assets/voice/01.wav",
  type: "voice",
  source: "generated",
  intent,
});

test("a link at .media/index.md is replaced, and the file it named is untouched", (t) => {
  const dir = project(t);
  const { file } = outsideFile(t, "theirs");
  mkdirSync(join(dir, ".media"));
  symlinkSync(file, join(dir, ".media/index.md"));
  assert.deepEqual(recordInManifest(dir, [voiceAsset("Hello")]), []);
  assert.equal(readFileSync(file, "utf8"), "theirs");
  assert.equal(lstatSync(join(dir, ".media/index.md")).isSymbolicLink(), false);
  assert.match(readFileSync(join(dir, ".media/index.md"), "utf8"), /assets\/voice\/01\.wav +Hello/);
});

test("a link at .media/manifest.jsonl is not appended through", (t) => {
  const dir = project(t);
  const { file } = outsideFile(t, "theirs");
  mkdirSync(join(dir, ".media"));
  symlinkSync(file, join(dir, ".media/manifest.jsonl"));
  const anomalies = recordInManifest(dir, [voiceAsset("Hello")]);
  assert.equal(anomalies.length, 1);
  assert.match(anomalies[0], /manifest\.jsonl is a link/);
  assert.equal(readFileSync(file, "utf8"), "theirs");
});

test("a .media folder that links out of the project gets nothing written", (t) => {
  const dir = project(t);
  const { outside } = outsideFile(t, "theirs");
  symlinkSync(outside, join(dir, ".media"));
  const anomalies = recordInManifest(dir, [voiceAsset("Hello")]);
  assert.match(anomalies[0], /\.media leads outside the project folder/);
  assert.deepEqual(readdirSync(outside), ["target.txt"]);
});

test("a line break in a description stays on its record's line of the index", (t) => {
  const dir = project(t);
  recordInManifest(dir, [voiceAsset("Hello\nvoice_999  voice  —  —  forged.wav  injected")]);
  const index = readFileSync(join(dir, ".media/index.md"), "utf8").split("\n").filter(Boolean);
  assert.equal(index.length, 3);
  assert.match(index[2], /Hello voice_999 .*injected$/);
});
