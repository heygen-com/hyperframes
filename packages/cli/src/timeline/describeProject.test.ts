import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  <audio id="bad" src="b.mp3" data-start="0" data-duration="1" data-track-index="3" data-automation="{nope"></audio>
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
      ["audio", ["vo", "bad"]],
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

  it("reports unreadable automation instead of showing no lanes", () => {
    const bad = describeProject(project())
      .tracks.flatMap((t) => t.rows)
      .find((r) => r.id === "bad")!;
    expect(bad.lanes).toEqual([]);
    expect(bad.laneError).toMatch(/not valid JSON/);
    expect(formatTimeline(describeProject(project()))).toContain("lanes unreadable:");
  });

  it("does not read a sub-composition outside the project or a directory", () => {
    const index = project();
    writeFileSync(join(dir, "..", "hf-outside.html"), TITLE);
    writeFileSync(
      index,
      `<div data-composition-id="m"><div id="o" data-composition-src="../hf-outside.html" data-start="0" data-duration="1"></div><div id="d" data-composition-src="compositions" data-start="0" data-duration="1"></div></div>`,
    );
    const rows = describeProject(index).tracks.flatMap((t) => t.rows);
    expect(rows.map((r) => [r.id, r.children.length])).toEqual([
      ["o", 0],
      ["d", 0],
    ]);
    rmSync(join(dir, "..", "hf-outside.html"));
  });

  it("reads a sub-composition whose folder name starts with two dots", () => {
    const index = project();
    mkdirSync(join(dir, "..scenes"));
    writeFileSync(join(dir, "..scenes", "s.html"), TITLE);
    writeFileSync(
      index,
      `<div data-composition-id="m"><div id="s" data-composition-src="..scenes/s.html" data-start="0" data-duration="1"></div></div>`,
    );
    const [row] = describeProject(index).tracks.flatMap((t) => t.rows);
    expect(row!.children.length).toBe(2);
  });

  it("does not follow a symlink out of the project", () => {
    const index = project();
    const outside = mkdtempSync(join(tmpdir(), "hf-outside-"));
    writeFileSync(join(outside, "secret.html"), TITLE);
    symlinkSync(join(outside, "secret.html"), join(dir, "compositions", "link.html"));
    writeFileSync(
      index,
      `<div data-composition-id="m"><div id="l" data-composition-src="compositions/link.html" data-start="0" data-duration="1"></div></div>`,
    );
    const [row] = describeProject(index).tracks.flatMap((t) => t.rows);
    expect(row!.children).toEqual([]);
    rmSync(outside, { recursive: true, force: true });
  });

  it("marks a clip without an authored duration instead of reporting 0 as a fact", () => {
    const logo = describeProject(project())
      .tracks.flatMap((t) => t.rows)
      .find((r) => r.id === "logo")!;
    expect(logo.durationAuthored).toBe(false);
    expect(formatTimeline(describeProject(project()))).toContain(
      "logo 0-0s src=logo.png duration=unauthored",
    );
  });
});

// A direct clip declared with a big data-start (20) reads as "the later one",
// but a clip nested in a host that starts at 5 with its own local start of 1
// actually plays at 6 on the main timeline: earlier than the direct clip.
const INVERSION_INDEX = `<div data-composition-id="main" data-duration="30">
  <video id="direct" src="d.mp4" data-start="20" data-duration="5" data-track-index="0"></video>
  <div id="host" data-composition-src="compositions/scene.html" data-start="5" data-duration="10" data-track-index="1"></div>
</div>`;
const INVERSION_SCENE = `<template><div data-composition-id="scene"><video id="nested" src="n.mp4" data-start="1" data-duration="2" data-track-index="0"></video></div></template>`;

const inversionProject = () => {
  dir = mkdtempSync(join(tmpdir(), "hf-timeline-abs-"));
  mkdirSync(join(dir, "compositions"));
  writeFileSync(join(dir, "index.html"), INVERSION_INDEX);
  writeFileSync(join(dir, "compositions", "scene.html"), INVERSION_SCENE);
  return join(dir, "index.html");
};

describe("absolute main-timeline time", () => {
  it("gives a nested clip an absolute start smaller than a later-declared direct clip's, plus the owning file", () => {
    const rows = describeProject(inversionProject()).tracks.flatMap((t) => t.rows);
    const direct = rows.find((r) => r.id === "direct")!;
    const host = rows.find((r) => r.id === "host")!;
    const nested = host.children.find((c) => c.id === "nested")!;

    // Hand-computed: host starts at 5, nested is 1s into it, so nested's
    // absolute start is 5 + 1 = 6, smaller than direct's 20.
    expect(direct).toMatchObject({
      start: 20,
      end: 25,
      absStart: 20,
      absEnd: 25,
      file: "index.html",
    });
    expect(host).toMatchObject({ start: 5, end: 15, absStart: 5, absEnd: 15, file: "index.html" });
    expect(nested).toMatchObject({
      start: 1,
      end: 3,
      absStart: 6,
      absEnd: 8,
      file: "compositions/scene.html",
    });
    expect(nested.absStart).toBeLessThan(direct.absStart);
  });

  it("places a nested media clip with a negative start where the runtime plays it", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-timeline-neg-"));
    mkdirSync(join(dir, "compositions"));
    writeFileSync(join(dir, "index.html"), INVERSION_INDEX);
    writeFileSync(
      join(dir, "compositions", "scene.html"),
      INVERSION_SCENE.replace('data-start="1"', 'data-start="-3"'),
    );
    const host = describeProject(join(dir, "index.html"))
      .tracks.flatMap((t) => t.rows)
      .find((r) => r.id === "host")!;
    // Host starts at 5 and the runtime adds the raw -3: it plays at 2, not at the clamped 5.
    expect(host.children.find((c) => c.id === "nested")).toMatchObject({ absStart: 2, absEnd: 4 });
  });

  it("clamps a negative media start to 0 when the host starts at 0, as the runtime does", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-timeline-neg0-"));
    writeFileSync(
      join(dir, "index.html"),
      `<div data-composition-id="main" data-duration="10"><video id="v" src="v.mp4" data-start="-3" data-duration="2" data-track-index="0"></video></div>`,
    );
    const v = describeProject(join(dir, "index.html")).tracks.flatMap((t) => t.rows)[0];
    expect(v).toMatchObject({ id: "v", absStart: 0, absEnd: 2 });
  });

  it("prints the absolute time first and the local time in parentheses for a nested row", () => {
    const text = formatTimeline(describeProject(inversionProject()));
    expect(text).toContain("direct 20-25s");
    expect(text).toContain("nested 6-8s (local 1-3s) in compositions/scene.html");
  });
});

describe("formatTimeline", () => {
  it("treats playback rate 1 as unset and does not expand a host nested inside a sub-composition", () => {
    const index = project();
    writeFileSync(
      join(dir, "compositions", "title.html"),
      `<template><div data-composition-id="t"><video id="v" src="v.mp4" data-start="0" data-duration="1" data-playback-rate="1"></video><div id="deep" data-composition-src="title.html" data-start="0" data-duration="1"></div></div></template>`,
    );
    const title = describeProject(index)
      .tracks.flatMap((t) => t.rows)
      .find((r) => r.id === "title")!;
    expect(title.children.map((c) => [c.id, c.playbackRate, c.children.length])).toEqual([
      ["v", null, 0],
      ["deep", null, 0],
    ]);
  });

  it("prints a small volume unrounded to two decimals", () => {
    const index = project();
    writeFileSync(
      index,
      `<div data-composition-id="m"><audio id="q" src="q.mp3" data-start="2.317" data-duration="1" data-volume="0.009772"></audio></div>`,
    );
    const text = formatTimeline(describeProject(index));
    expect(text).toContain("vol=0.009772");
    expect(text).toContain("2.317-3.317s");
  });

  it("prints one bar per row under its track heading", () => {
    const text = formatTimeline(describeProject(project()));
    expect(text).toMatch(/^timeline 10s\n\nvideo \(1\)\n  \|█{16}/);
    expect(text).toContain("audio (2)");
    expect(text).toContain("vol=0.5 group=vo volume[0:0.2 2:1]");
    expect(text).toContain("rate=2");
  });
});

const SKILL_DOC = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../skills/hyperframes-cli/references/upgrade-info-misc.md",
);

// The documented one-liners run verbatim; only the example query values are swapped for the fixture's.
const oneLiners = (kind: "jq" | "node -e"): string[] =>
  readFileSync(SKILL_DOC, "utf8")
    .split("\n")
    .filter((l) => l.startsWith(`${kind} `) && l.endsWith('<<<"$TL"'))
    .map((l) => l.replace("12.5", "7").replace("tsfx-pet2", "nested"));

const hasJq = (() => {
  try {
    execFileSync("jq", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();

const runOneLiner = (line: string): string =>
  execFileSync("bash", ["-c", line], {
    env: { ...process.env, TL: JSON.stringify({ timeline: describeProject(inversionProject()) }) },
    encoding: "utf8",
  });

describe("skill query one-liners", () => {
  it("documents four node one-liners, each answering from the fixture", () => {
    const lines = oneLiners("node -e");
    expect(lines).toHaveLength(4);
    const [at, find, track, gaps] = lines.map(runOneLiner);
    expect(at.split("\n").filter(Boolean)).toEqual([
      "host index.html",
      "nested compositions/scene.html",
    ]);
    expect(find).toBe("compositions/scene.html video 6 8\n");
    expect(track).toBe("direct 20 25\n");
    expect(gaps).toBe("");
  });

  it.skipIf(!hasJq)("documents four jq one-liners that agree with the node ones", () => {
    const lines = oneLiners("jq");
    expect(lines).toHaveLength(4);
    const [at, find, track, gaps] = lines.map((l) =>
      JSON.parse(`[${runOneLiner(l).replace(/}\s*{/g, "},{")}]`),
    );
    expect(at[0].map((r: { id: string }) => r.id)).toEqual(["host", "nested"]);
    expect(find).toEqual([
      { file: "compositions/scene.html", trackKind: "video", absStart: 6, absEnd: 8 },
    ]);
    expect(track).toEqual([{ id: "direct", absStart: 20, absEnd: 25 }]);
    expect(gaps[0]).toEqual([]);
  });
});
