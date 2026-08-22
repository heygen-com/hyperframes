import assert from "node:assert/strict";
import test from "node:test";
import { carveSources } from "./carve.mjs";

/** A voice as `detectTracks` yields it: an id plus its raw opening tag. */
function voice(id, group) {
  const attr = group === undefined ? "" : ` data-audio-group="${group}"`;
  return { id, tag: `<audio id="${id}"${attr} src="${id}.wav"></audio>` };
}

test("voices sharing one group carve against the group, not their ids", () => {
  // SKILL.md's invariant: "A carve against more than one clip id is wrong.
  // Group the clips and carve against the group." Naming the group lets
  // membership resolve at analysis time, so a voice added later is covered.
  const voices = [voice("vo1", "voiceover"), voice("vo2", "voiceover"), voice("vo3", "voiceover")];
  assert.deepEqual(carveSources(voices), ["voiceover"]);
});

test("a single grouped voice still records the group", () => {
  assert.deepEqual(carveSources([voice("vo1", "voiceover")]), ["voiceover"]);
});

test("ungrouped voices keep their ids, so the lint rule can still say so", () => {
  // Not silently inventing a group: `audio_carve_ungrouped_sources` is the
  // right signal here, and it needs the ids to fire on.
  assert.deepEqual(carveSources([voice("vo1"), voice("vo2")]), ["vo1", "vo2"]);
});

test("voices in DIFFERENT groups keep their ids", () => {
  // One carve cannot name two groups, and picking either would silently drop
  // the other's members from the analysis.
  const voices = [voice("vo1", "narration"), voice("vo2", "interview")];
  assert.deepEqual(carveSources(voices), ["vo1", "vo2"]);
});

test("a partially grouped set keeps its ids", () => {
  const voices = [voice("vo1", "voiceover"), voice("vo2")];
  assert.deepEqual(carveSources(voices), ["vo1", "vo2"]);
});

test("an empty group attribute is not a group", () => {
  assert.deepEqual(carveSources([voice("vo1", ""), voice("vo2", "")]), ["vo1", "vo2"]);
});
