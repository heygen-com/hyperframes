import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hostAudio, keepHostAudio } from "./host-audio.mjs";

const onDisk = new Set([
  "assets/bgm/host.mp3",
  "assets/sfx/custom-whoosh.mp3",
  "assets/sfx/whoosh.mp3",
]);
const exists = (path) => onDisk.has(path);
const hostWhoosh = {
  frame: 1,
  file: "assets/sfx/custom-whoosh.mp3",
  offset_s: 0,
  duration_s: 2,
  source: "host",
};

test("a host sound and bed survive a rebuild, and the host's frame takes no looked-up sound", () => {
  const previous = {
    bgm: { path: "assets/bgm/host.mp3", source: "host" },
    sfx: [hostWhoosh, { frame: 2, file: "assets/sfx/whoosh.mp3", offset_s: 0 }],
  };
  const rebuilt = {
    bgm: null,
    voices: [],
    sfx: [
      { frame: 1, file: "assets/sfx/whoosh.mp3", offset_s: 0 },
      { frame: 2, file: "assets/sfx/whoosh.mp3", offset_s: 0 },
    ],
  };
  const kept = keepHostAudio(rebuilt, hostAudio(previous, exists));
  assert.deepEqual(kept.bgm, previous.bgm);
  assert.deepEqual(kept.sfx, [hostWhoosh, rebuilt.sfx[1]]);
});

test("an unmarked entry or a missing file is not the host's", () => {
  const previous = {
    bgm: { path: "assets/bgm/gone.mp3", source: "host" },
    sfx: [
      { frame: 1, file: "assets/sfx/whoosh.mp3", offset_s: 0 },
      { frame: 3, file: "assets/sfx/gone.mp3", source: "host" },
    ],
  };
  const host = hostAudio(previous, exists);
  assert.equal(host.bgm, null);
  assert.deepEqual(host.sfx, []);
  const rebuilt = { bgm: { path: "assets/bgm/looked.mp3" }, voices: [], sfx: [] };
  assert.deepEqual(keepHostAudio(rebuilt, host), rebuilt);
});

test("no earlier audio_meta.json keeps the rebuild as it is", () => {
  const rebuilt = { bgm: null, voices: [], sfx: [{ frame: 1, file: "assets/sfx/whoosh.mp3" }] };
  assert.deepEqual(keepHostAudio(rebuilt, hostAudio(null, exists)), rebuilt);
});

// The narrated workflows tell the agent the same host-audio contract and the same meaning of silent.
const workflowText = (skill, file) =>
  readFileSync(new URL(`../../../../${skill}/${file}`, import.meta.url), "utf8");

test("each narrated workflow tells a host app's music and sounds the way in, and when a film is silent", () => {
  for (const skill of ["product-launch-video", "pr-to-video", "faceless-explainer"]) {
    const steps = workflowText(skill, "SKILL.md");
    assert.match(
      steps,
      /host app's own tools make the music or a sound effect[^\n]+"source": "host"/,
      skill,
    );
    assert.match(steps, /"duration_s": <its length>[^\n]+Every audio pass keeps these/, skill);
    assert.match(steps, /no `SCRIPT.md`, \*\*and\*\* no `sfx:` cues or host audio/, skill);
    assert.match(
      steps,
      /marked silent \(`music: none`, no `SCRIPT.md`, no `sfx:` cues or host audio\)/,
      skill,
    );
    assert.match(
      workflowText(skill, "references/story-design.md"),
      /no `SCRIPT.md` \+ no `sfx:` cues or host audio\*\* — the canonical/,
      skill,
    );
  }
});

test("a frame written as a string is the same frame, and a gone host file is reported", () => {
  const previous = {
    bgm: { path: "assets/bgm/gone.mp3", source: "host" },
    sfx: [{ ...hostWhoosh, frame: "1" }],
  };
  const host = hostAudio(previous, exists);
  assert.deepEqual(host.sfx, [hostWhoosh]);
  assert.ok(host.frames.has(1));
  assert.deepEqual(host.dropped, ["assets/bgm/gone.mp3 is not on disk"]);
  const rebuilt = { bgm: null, voices: [], sfx: [{ frame: 1, file: "assets/sfx/whoosh.mp3" }] };
  assert.deepEqual(keepHostAudio(rebuilt, host).sfx, [hostWhoosh]);
});

test("a host entry with no path is reported, not thrown", () => {
  const throwsOnNonString = (path) => {
    if (typeof path !== "string") throw new TypeError("path must be a string");
    return onDisk.has(path);
  };
  const host = hostAudio({ bgm: { src: "x.mp3", source: "host" }, sfx: [] }, throwsOnNonString);
  assert.equal(host.bgm, null);
  assert.deepEqual(host.dropped, ['a host entry has no "path"']);
});
