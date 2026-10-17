import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { ensureDOMParser } from "../utils/dom.js";
import { describeProject } from "./describeProject.js";

// What Studio's split writes when a 12 s scene clip is cut at 5 s and then at 9 s.
const SPLIT_INDEX = `<!DOCTYPE html><html><head></head><body><div data-composition-id="main" data-duration="12">
<div data-playback-start="0" id="scene" class="clip" data-composition-id="scene" data-composition-src="compositions/scene.html" data-start="0" data-duration="5" data-track-index="0"></div><div data-playback-start="5" id="scene-split" class="clip" data-composition-id="scene-split" data-composition-src="compositions/scene.html" data-start="5" data-duration="4" data-track-index="0"></div><div data-playback-start="9" id="scene-split-split" class="clip" data-composition-id="scene-split-split" data-composition-src="compositions/scene.html" data-start="9" data-duration="3" data-track-index="0"></div>
</div></body></html>`;
const SCENE = `<template id="scene-template"><div data-composition-id="scene" data-duration="12">
<video id="v1" class="clip" src="../sample.mp4" muted data-start="0" data-duration="4" data-media-start="1" data-track-index="0"></video>
<video id="v2" class="clip" src="../sample.mp4" muted data-start="4" data-duration="4" data-media-start="5" data-track-index="0"></video>
<video id="v3" class="clip" src="../sample.mp4" muted data-start="8" data-duration="4" data-media-start="2" data-track-index="0"></video>
</div></template>`;

beforeAll(ensureDOMParser);

/** The video rows of a project made of `index` and `compositions/scene.html`. */
async function videoRows(index: string, prefix: string, scene = SCENE) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "compositions"));
  writeFileSync(join(dir, "index.html"), index);
  writeFileSync(join(dir, "compositions", "scene.html"), scene);
  const timeline = await describeProject(join(dir, "index.html"));
  return timeline.tracks.find((t) => t.kind === "video")!.rows;
}

describe("a sub-composition's in-point", () => {
  it("shifts each later split half's videos by its in-point and cuts them to that half", async () => {
    const videos = await videoRows(SPLIT_INDEX, "hf-timeline-inpoint-");

    // The first half's in-point is 0, so it shows its children's authored extent, as before.
    expect(videos.map((r) => [r.host, r.id, r.absStart, r.absEnd])).toEqual([
      ["scene", "v1", 0, 4],
      ["scene", "v2", 4, 8],
      ["scene-split", "v2", 5, 8],
      ["scene", "v3", 8, 12],
      ["scene-split", "v3", 8, 9],
      ["scene-split-split", "v3", 9, 12],
    ]);
  });

  it("cuts a clip nested in a timed wrapper like the wrapper's own clips", async () => {
    const videos = await videoRows(
      `<div data-composition-id="main" data-duration="9"><div data-playback-start="5" id="half" data-composition-src="compositions/scene.html" data-start="5" data-duration="4"></div></div>`,
      "hf-timeline-inpoint-nested-",
      `<div data-composition-id="scene" data-duration="12"><div id="w" data-start="0" data-duration="12">
<video id="n" src="../sample.mp4" muted data-start="4" data-duration="4" data-media-start="5"></video></div></div>`,
    );

    expect(videos.map((r) => [r.id, r.absStart, r.absEnd, r.mediaStart])).toEqual([["n", 5, 8, 6]]);
  });

  it("moves each cut clip's media in-point by the part the cut skips", async () => {
    const videos = await videoRows(SPLIT_INDEX, "hf-timeline-inpoint-media-");

    expect(videos.map((r) => [r.host, r.id, r.mediaStart])).toEqual([
      ["scene", "v1", 1],
      ["scene", "v2", 5],
      ["scene-split", "v2", 6],
      ["scene", "v3", 2],
      ["scene-split", "v3", 2],
      ["scene-split-split", "v3", 3],
    ]);
  });

  it("cuts nothing for a host whose in-point is 0, as Studio stamps on every inserted scene", async () => {
    const videos = await videoRows(
      `<div data-composition-id="main" data-duration="12"><div id="scene" data-composition-src="compositions/scene.html" data-start="1" data-duration="3" data-playback-start="0"></div></div>`,
      "hf-timeline-inpoint0-",
    );

    expect(videos.map((r) => [r.id, r.absStart, r.absEnd])).toEqual([
      ["v1", 1, 5],
      ["v2", 5, 9],
      ["v3", 9, 13],
    ]);
  });
});
