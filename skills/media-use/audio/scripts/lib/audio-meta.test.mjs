import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mergeVoices, openAudioMeta } from "./audio-meta.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "audio-meta-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("updates the read file from byte zero, truncates, and retains its mode", (t) => {
  const path = join(fixture(t), "meta.json");
  writeFileSync(path, JSON.stringify({ voices: ["long existing voice metadata"] }), {
    mode: 0o600,
  });
  const originalMode = statSync(path).mode;
  const handle = openAudioMeta(path);
  assert.deepEqual(handle.value, { voices: ["long existing voice metadata"] });
  handle.write({ voices: ["声"] });
  assert.equal(readFileSync(path, "utf8"), JSON.stringify({ voices: ["声"] }, null, 2));
  assert.equal(statSync(path).mode, originalMode);
});

test("pathname replacement cannot redirect the existing-file write", (t) => {
  const dir = fixture(t);
  const path = join(dir, "meta.json");
  const moved = join(dir, "original.json");
  writeFileSync(path, "{}");
  const handle = openAudioMeta(path);
  renameSync(path, moved);
  writeFileSync(path, "replacement must survive");
  handle.write({ voices: [] });
  assert.equal(readFileSync(path, "utf8"), "replacement must survive");
  assert.deepEqual(JSON.parse(readFileSync(moved, "utf8")), { voices: [] });
});

test("existing symlink outputs retain their original target even after retargeting", (t) => {
  const dir = fixture(t);
  const path = join(dir, "meta.json");
  const target = join(dir, "target.json");
  const victim = join(dir, "victim.json");
  writeFileSync(target, "{}");
  writeFileSync(victim, "untouched");
  symlinkSync(target, path);
  const handle = openAudioMeta(path);
  rmSync(path);
  symlinkSync(victim, path);
  handle.write({ bgm: null });
  assert.equal(readFileSync(victim, "utf8"), "untouched");
  assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { bgm: null });
});

test("missing output is created only when saved", (t) => {
  const path = join(fixture(t), "meta.json");
  const handle = openAudioMeta(path);
  assert.deepEqual(handle.value, {});
  assert.throws(() => statSync(path), { code: "ENOENT" });
  handle.write({ sfx: [] });
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { sfx: [] });
});

for (const replacement of ["file", "symlink"]) {
  test(`new output does not overwrite a racing ${replacement}`, (t) => {
    const dir = fixture(t);
    const path = join(dir, "meta.json");
    const victim = join(dir, "victim.json");
    const handle = openAudioMeta(path);
    writeFileSync(victim, "untouched");
    if (replacement === "symlink") symlinkSync(victim, path);
    else writeFileSync(path, "untouched");
    assert.throws(() => handle.write({}), { code: "EEXIST" });
    assert.equal(readFileSync(path, "utf8"), "untouched");
    assert.equal(readFileSync(victim, "utf8"), "untouched");
  });
}

test("malformed merge base remains an error without changing bytes", (t) => {
  const path = join(fixture(t), "meta.json");
  writeFileSync(path, "bad json");
  assert.throws(() => openAudioMeta(path), SyntaxError);
  assert.equal(readFileSync(path, "utf8"), "bad json");
});

test("CLI partial run retains unselected voices, BGM and SFX", (t) => {
  const dir = fixture(t);
  const path = join(dir, "meta.json");
  const request = join(dir, "request.json");
  const previous = {
    voices: [{ id: "a", duration_s: 2 }],
    bgm: { path: "bgm.wav" },
    sfx: [{ name: "click" }],
    tts_provider: "kokoro",
    voice_id: "voice-a",
  };
  writeFileSync(path, JSON.stringify(previous));
  writeFileSync(request, "{}");
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../audio.mjs", import.meta.url)),
      "--request",
      request,
      "--hyperframes",
      dir,
      "--out",
      path,
      "--only",
      "none",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        HYPERFRAMES_CONFIG_DIR: dir,
        HEYGEN_API_KEY: "",
        HYPERFRAMES_API_KEY: "",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(readFileSync(path, "utf8"));
  for (const key of Object.keys(previous)) assert.deepEqual(actual[key], previous[key]);
});

const voice = (id, duration_s = 1) => ({ id, path: `assets/voice/${id}.wav`, duration_s });
const [a, b, c] = ["a", "b", "c"].map((id) => voice(id));
const noFiles = () => false;

test("mergeVoices keeps unrequested voices and replaces a re-voiced line in place", () => {
  const b2 = voice("b", 2);
  assert.deepEqual(mergeVoices([a, b, c], [b2], { requested: ["b"], exists: noFiles }), [a, b2, c]);
});

test("mergeVoices appends a line that had no voice yet", () => {
  const d = voice("d");
  assert.deepEqual(mergeVoices([a, b], [d], { requested: ["d"], exists: noFiles }), [a, b, d]);
});

test("mergeVoices keeps a failed line's voice only while its file exists", () => {
  const onlyB = (path) => path === b.path;
  assert.deepEqual(mergeVoices([a, b, c], [], { requested: ["b"], exists: noFiles }), [a, c]);
  assert.deepEqual(mergeVoices([a, b, c], [], { requested: ["b"], exists: onlyB }), [a, b, c]);
});

test("mergeVoices returns a full run as synthesized, in request order", () => {
  const fresh = [voice("c", 3), voice("a", 4), voice("b", 5)];
  const requested = ["c", "a", "b"];
  assert.equal(mergeVoices([a, b, c], fresh, { requested, exists: () => true }), fresh);
  const failedB = mergeVoices([a, b], [fresh[1]], { requested: ["a", "b"], exists: () => true });
  assert.deepEqual(failedB, [fresh[1]]);
});
