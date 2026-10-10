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

describe("a sub-composition's in-point", () => {
  it("shifts each split half's videos by its in-point and cuts them to that half", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-timeline-inpoint-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, "compositions"));
    writeFileSync(join(dir, "index.html"), SPLIT_INDEX);
    writeFileSync(join(dir, "compositions", "scene.html"), SCENE);

    const timeline = await describeProject(join(dir, "index.html"));
    const videos = timeline.tracks.find((t) => t.kind === "video")!.rows;

    expect(videos.map((r) => [r.host, r.id, r.absStart, r.absEnd])).toEqual([
      ["scene", "v1", 0, 4],
      ["scene", "v2", 4, 5],
      ["scene-split", "v2", 5, 8],
      ["scene-split", "v3", 8, 9],
      ["scene-split-split", "v3", 9, 12],
    ]);
  });
});
