import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureDOMParser } from "../utils/dom.js";
import { describeProject } from "./describeProject.js";
import { formatTimeline } from "./formatTimeline.js";

const INDEX = `<html><body>
<div data-composition-id="main" data-width="1920" data-height="1080" data-duration="10">
  <video id="a-roll" src="a.mp4" data-start="0" data-duration="4" data-track-index="0" data-playback-rate="2"></video>
  <div id="title" data-composition-src="compositions/title.html" data-start="a-roll + 1" data-duration="3" data-track-index="1"></div>
  <audio id="vo" src="vo.mp3" data-start="0" data-duration="8" data-track-index="2" data-volume="0.5" data-audio-group="vo"
    data-automation='{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":0.2},{"t":2,"v":1}]}]}'></audio>
  <div id="wrapper"><img id="logo" src="logo.png" data-track-kind="graphics"></div>
</div></body></html>`;

const TITLE = `<template><div data-composition-id="title"><h1 id="t1" data-start="0" data-duration="2">Hi</h1><h2 id="t2" data-start="t1 + 0.5" data-duration="1">There</h2></div></template>`;

let dir = "";
const project = () => {
  dir = mkdtempSync(join(tmpdir(), "hf-timeline-"));
  mkdirSync(join(dir, "compositions"));
  writeFileSync(join(dir, "index.html"), INDEX);
  writeFileSync(join(dir, "compositions", "title.html"), TITLE);
  return join(dir, "index.html");
};

beforeAll(ensureDOMParser);
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("describeProject", () => {
  it("groups rows into tracks by kind with resolved timing and clip facts", () => {
    const timeline = describeProject(project());
    expect(timeline.duration).toBe(10);
    expect(timeline.tracks.map((t) => [t.kind, t.rows.map((r) => r.id)])).toEqual([
      ["video", ["a-roll"]],
      ["graphics", ["logo", "title"]],
      ["audio", ["vo"]],
    ]);
    const [video] = timeline.tracks[0]!.rows;
    expect(video).toMatchObject({ start: 0, duration: 4, playbackRate: 2, src: "a.mp4" });
    const title = timeline.tracks[1]!.rows.find((r) => r.id === "title")!;
    expect(title).toMatchObject({ start: 5, end: 8, sourceFile: "compositions/title.html" });
    const vo = timeline.tracks[2]!.rows[0]!;
    expect(vo).toMatchObject({ volume: 0.5, audioGroup: "vo" });
    expect(vo.lanes).toEqual([
      {
        target: "volume",
        points: [
          { t: 0, v: 0.2 },
          { t: 2, v: 1 },
        ],
      },
    ]);
  });

  it("nests a sub-composition's clips one level down with local times", () => {
    const title = describeProject(project())
      .tracks.flatMap((t) => t.rows)
      .find((r) => r.id === "title")!;
    expect(title.children.map((c) => [c.id, c.start, c.end])).toEqual([
      ["t1", 0, 2],
      ["t2", 2.5, 3.5],
    ]);
  });

  it("marks a clip without an authored duration instead of reporting 0 as a fact", () => {
    const logo = describeProject(project())
      .tracks.flatMap((t) => t.rows)
      .find((r) => r.id === "logo")!;
    expect(logo.durationAuthored).toBe(false);
  });
});

describe("formatTimeline", () => {
  it("prints one bar per row under its track heading", () => {
    const text = formatTimeline(describeProject(project()));
    expect(text).toMatch(/^timeline 10s\n\nvideo \(1\)\n  \|█{16}/);
    expect(text).toContain("audio (1)");
    expect(text).toContain("vol=0.5 group=vo volume[0:0.2 2:1]");
    expect(text).toContain("rate=2");
  });
});
