import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { MEDIA_DURATION_FIXTURES } from "@hyperframes/parsers/media-duration-fixtures";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureDOMParser } from "../utils/dom.js";
import {
  createProbeGate,
  describeProject,
  type MeasureMedia,
  type ProjectTimeline,
  type TimelineRow,
} from "./describeProject.js";
import { formatTimeline } from "./formatTimeline.js";

const REAL_AUDIO = fileURLToPath(
  new URL("../../../../skills/media-use/audio/assets/sfx/pop.mp3", import.meta.url),
);
const hasFfprobe = spawnSync("ffprobe", ["-version"]).status === 0;
/** Recorded ffprobe answer for pop.mp3 (0.72 s), so the resolver path runs on runners without ffprobe. */
const POP_SECONDS = async () => 0.72;

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

const allRows = (t: ProjectTimeline) => t.tracks.flatMap((x) => x.rows);
const childrenOf = (t: ProjectTimeline, row: TimelineRow) =>
  allRows(t).filter((r) => row.children.some((c) => c.kind === r.trackKind && c.index === r.index));

let dir = "";
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);

const rowsOf = async (
  html: string,
  withSting = false,
  setup?: (root: string) => void,
  measure?: MeasureMedia,
) => {
  const index = project();
  writeFileSync(index, html);
  if (withSting) copyFileSync(REAL_AUDIO, join(dir, "sting.mp3"));
  setup?.(dir);
  const timeline = await describeProject(index, measure);
  return { rows: timeline.tracks.flatMap((t) => t.rows), text: formatTimeline(timeline) };
};

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
  it("groups rows into tracks by kind with resolved timing and clip facts", async () => {
    const timeline = await describeProject(project());
    expect(timeline.duration).toBe(10);
    expect(timeline.tracks.map((t) => [t.kind, t.rows.map((r) => r.id)])).toEqual([
      ["video", ["a-roll"]],
      ["graphics", ["logo", "title", "t1", "t2"]],
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

  it("nests a sub-composition's clips one level down with local times", async () => {
    const timeline = await describeProject(project());
    const title = allRows(timeline).find((r) => r.id === "title")!;
    expect(childrenOf(timeline, title).map((c) => [c.id, c.start, c.end])).toEqual([
      ["t1", 0, 2],
      ["t2", 2.5, 3.5],
    ]);
  });

  it("reports unreadable automation instead of showing no lanes", async () => {
    const bad = (await describeProject(project())).tracks
      .flatMap((t) => t.rows)
      .find((r) => r.id === "bad")!;
    expect(bad.lanes).toEqual([]);
    expect(bad.laneError).toMatch(/not valid JSON/);
    expect(formatTimeline(await describeProject(project()))).toContain("lanes unreadable:");
  });

  it("does not read a sub-composition outside the project or a directory", async () => {
    const index = project();
    writeFileSync(join(dir, "..", "hf-outside.html"), TITLE);
    writeFileSync(
      index,
      `<div data-composition-id="m"><div id="o" data-composition-src="../hf-outside.html" data-start="0" data-duration="1"></div><div id="d" data-composition-src="compositions" data-start="0" data-duration="1"></div></div>`,
    );
    const rows = (await describeProject(index)).tracks.flatMap((t) => t.rows);
    expect(rows.map((r) => [r.id, r.children.length])).toEqual([
      ["o", 0],
      ["d", 0],
    ]);
    rmSync(join(dir, "..", "hf-outside.html"));
  });

  it("reads a sub-composition whose folder name starts with two dots", async () => {
    const index = project();
    mkdirSync(join(dir, "..scenes"));
    writeFileSync(join(dir, "..scenes", "s.html"), TITLE);
    writeFileSync(
      index,
      `<div data-composition-id="m"><div id="s" data-composition-src="..scenes/s.html" data-start="0" data-duration="1"></div></div>`,
    );
    const [row] = (await describeProject(index)).tracks.flatMap((t) => t.rows);
    expect(row!.children.length).toBe(2);
  });

  it("does not follow a symlink out of the project", async () => {
    const index = project();
    const outside = mkdtempSync(join(tmpdir(), "hf-outside-"));
    writeFileSync(join(outside, "secret.html"), TITLE);
    symlinkSync(join(outside, "secret.html"), join(dir, "compositions", "link.html"));
    writeFileSync(
      index,
      `<div data-composition-id="m"><div id="l" data-composition-src="compositions/link.html" data-start="0" data-duration="1"></div></div>`,
    );
    const [row] = (await describeProject(index)).tracks.flatMap((t) => t.rows);
    expect(row!.children).toEqual([]);
    rmSync(outside, { recursive: true, force: true });
  });

  it("claims no duration source for a leaf with nothing authored and no children", async () => {
    const index = project();
    writeFileSync(index, `<div data-composition-id="m"><div id="bare" data-start="0"></div></div>`);
    const [row] = (await describeProject(index)).tracks.flatMap((t) => t.rows);
    expect(row).toMatchObject({ durationSource: null, duration: 0 });
    expect(formatTimeline(await describeProject(index))).not.toMatch(/duration=|pending/);
  });

  it("does not probe a remote, absolute or parent-relative src and says why", async () => {
    const index = project();
    const outside = mkdtempSync(join(tmpdir(), "hf-outside-media-"));
    copyFileSync(REAL_AUDIO, join(outside, "out.mp3"));
    copyFileSync(REAL_AUDIO, join(dir, "..", "hf-parent-media.mp3"));
    writeFileSync(
      index,
      `<div data-composition-id="m">
        <audio id="remote" src="https://example.com/a.mp3" data-start="0"></audio>
        <audio id="abs" src="${join(outside, "out.mp3")}" data-start="0"></audio>
        <audio id="up" src="../hf-parent-media.mp3" data-start="0"></audio>
      </div>`,
    );
    const rows = (await describeProject(index)).tracks.flatMap((t) => t.rows);
    const byId = (id: string) => rows.find((r) => r.id === id)!;
    expect(byId("remote")).toMatchObject({
      durationSource: "pending",
      pendingReason: "remote source not probed",
    });
    for (const id of ["abs", "up"]) {
      expect(byId(id)).toMatchObject({
        durationSource: "pending",
        pendingReason: "source file not found",
        duration: 0,
      });
    }
    rmSync(outside, { recursive: true, force: true });
    rmSync(join(dir, "..", "hf-parent-media.mp3"));
  });

  it("reports a still image used as a video source as pending, not a measured zero", async () => {
    const { rows, text } = await rowsOf(
      `<div data-composition-id="m"><video id="v" src="still.png" data-start="0"></video></div>`,
      false,
      (root) => writeFileSync(join(root, "still.png"), TINY_PNG),
    );
    expect(rows[0]).toMatchObject({
      durationSource: "pending",
      pendingReason: "source reports no duration",
      duration: 0,
    });
    expect(text).toContain("pending: source reports no duration");
  });

  it("does not probe a media src that is a symlink out of the project", async () => {
    const outside = mkdtempSync(join(tmpdir(), "hf-outside-"));
    try {
      copyFileSync(REAL_AUDIO, join(outside, "secret.mp3"));
      const { rows } = await rowsOf(
        `<div data-composition-id="m"><audio id="a" src="link.mp3" data-start="0"></audio></div>`,
        false,
        (root) => symlinkSync(join(outside, "secret.mp3"), join(root, "link.mp3")),
      );
      expect(rows[0]).toMatchObject({
        durationSource: "pending",
        pendingReason: "source file not found",
        duration: 0,
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("gives an image with no authored duration the resolver's default length", async () => {
    const logo = (await describeProject(project())).tracks
      .flatMap((t) => t.rows)
      .find((r) => r.id === "logo")!;
    expect(logo.durationAuthored).toBe(false);
    expect(logo).toMatchObject({ durationSource: "default", duration: 3, pendingReason: null });
    expect(formatTimeline(await describeProject(project()))).toContain(
      "logo 0-3s src=logo.png duration=default",
    );
  });

  it("infers a composition host's duration from its children", async () => {
    const {
      rows: [host],
      text,
    } = await rowsOf(
      `<div data-composition-id="m"><div id="h" data-composition-src="compositions/title.html" data-start="0"></div></div>`,
    );
    expect(host).toMatchObject({ durationSource: "inner", duration: 3.5 });
    expect(text).toContain("duration=inferred");
  });

  it("applies the media offset and playback rate through the resolver", async () => {
    const {
      rows: [row],
    } = await rowsOf(
      `<div data-composition-id="m"><audio id="s" src="sting.mp3" data-start="0" data-playback-start="0.2" data-playback-rate="2"></audio></div>`,
      true,
      undefined,
      POP_SECONDS,
    );
    // (0.72 - 0.2) / 2, hand-computed
    expect(row!.duration).toBeCloseTo(0.26, 1);
  });

  it("takes a media leaf's duration from the probe when none is authored", async () => {
    const probed: string[] = [];
    const {
      rows: [row],
      text,
    } = await rowsOf(
      `<div data-composition-id="m"><audio id="sting" src="sting.mp3" data-start="0"></audio></div>`,
      true,
      undefined,
      async (file, tag) => {
        probed.push(`${tag}:${basename(file)}`);
        return POP_SECONDS();
      },
    );
    expect(probed).toEqual(["audio:sting.mp3"]);
    expect(row).toMatchObject({ durationAuthored: false, durationSource: "media" });
    expect(row!.pendingReason).toBeNull();
    expect(row!.duration).toBeCloseTo(0.72, 1);
    expect(row!.end).toBeCloseTo(0.72, 1);
    expect(text).toContain("duration=media");
  });

  it.skipIf(!hasFfprobe)("measures a real audio file with ffprobe by default", async () => {
    const {
      rows: [row],
    } = await rowsOf(
      `<div data-composition-id="m"><audio id="sting" src="sting.mp3" data-start="0"></audio></div>`,
      true,
    );
    expect(row).toMatchObject({ durationSource: "media" });
    expect(row!.duration).toBeCloseTo(0.72, 1);
  });

  it("reports pending with a reason instead of guessing when the source file is missing", async () => {
    const {
      rows: [row],
      text,
    } = await rowsOf(
      `<div data-composition-id="m"><video id="missing" src="gone.mp4" data-start="0"></video></div>`,
    );
    expect(row).toMatchObject({
      durationAuthored: false,
      durationSource: "pending",
      pendingReason: "source file not found",
      duration: 0,
    });
    expect(text).toContain("pending: source file not found");
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
  it("gives a nested clip an absolute start smaller than a later-declared direct clip's, plus the owning file", async () => {
    const rows = allRows(await describeProject(inversionProject()));
    const direct = rows.find((r) => r.id === "direct")!;
    const host = rows.find((r) => r.id === "host")!;
    const nested = rows.find((r) => r.id === "nested")!;

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
    expect(nested).toMatchObject({
      nested: true,
      host: "host",
      hostRow: { kind: "graphics", index: host.index },
    });
    expect(host.children).toEqual([{ kind: "video", index: nested.index }]);
  });

  it("places a nested media clip with a negative start where the runtime plays it", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-timeline-neg-"));
    mkdirSync(join(dir, "compositions"));
    writeFileSync(join(dir, "index.html"), INVERSION_INDEX);
    writeFileSync(
      join(dir, "compositions", "scene.html"),
      INVERSION_SCENE.replace('data-start="1"', 'data-start="-3"'),
    );
    const rows = allRows(await describeProject(join(dir, "index.html")));
    // Host starts at 5 and the runtime adds the raw -3: it plays at 2, not at the clamped 5.
    expect(rows.find((r) => r.id === "nested")).toMatchObject({ absStart: 2, absEnd: 4 });
  });

  it("resolves a media start given as an expression like any other clip, not as a literal", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-timeline-expr-"));
    mkdirSync(join(dir, "compositions"));
    writeFileSync(join(dir, "index.html"), INVERSION_INDEX);
    writeFileSync(
      join(dir, "compositions", "scene.html"),
      INVERSION_SCENE.replace(
        "</video>",
        `</video><video id="after" src="a.mp4" data-start="nested + 1" data-duration="1" data-track-index="1"></video>`,
      ),
    );
    const rows = allRows(await describeProject(join(dir, "index.html")));
    // nested ends at local 3, so "nested + 1" is local 4; the host at 5 puts it at 9 on the main timeline.
    expect(rows.find((r) => r.id === "after")).toMatchObject({ start: 4, absStart: 9 });
  });

  it("clamps a negative media start to 0 when the host starts at 0, as the runtime does", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-timeline-neg0-"));
    writeFileSync(
      join(dir, "index.html"),
      `<div data-composition-id="main" data-duration="10"><video id="v" src="v.mp4" data-start="-3" data-duration="2" data-track-index="0"></video></div>`,
    );
    const v = (await describeProject(join(dir, "index.html"))).tracks.flatMap((t) => t.rows)[0];
    expect(v).toMatchObject({ id: "v", absStart: 0, absEnd: 2 });
  });

  // Reproduces an eval miss (pr-to-video-launch, task A): an sfx clip local to
  // its own sub-composition starts at 5.2s there, but that sub-composition is
  // hosted at main-timeline 5.2s too, and a video in an EARLIER host ends at
  // 5.27s — a 0.07s overlap only visible once both are on the same clock.
  it("carries enough absolute time to detect a sub-second overlap across two different sub-compositions", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-timeline-overlap-"));
    mkdirSync(join(dir, "compositions"));
    writeFileSync(
      join(dir, "index.html"),
      `<div data-composition-id="main" data-duration="10">
        <div id="a" data-composition-src="compositions/a.html" data-start="0" data-duration="5.2" data-track-index="0"></div>
        <div id="b" data-composition-src="compositions/b.html" data-start="5.2" data-duration="4.8" data-track-index="1"></div>
      </div>`,
    );
    writeFileSync(
      join(dir, "compositions", "a.html"),
      `<template><div data-composition-id="a"><video id="clip" src="c.mp4" data-start="0" data-duration="5.27" data-track-index="0"></video></div></template>`,
    );
    writeFileSync(
      join(dir, "compositions", "b.html"),
      `<template><div data-composition-id="b"><audio id="sfx" src="s.mp3" data-start="0" data-duration="0.4" data-track-index="0"></audio></div></template>`,
    );
    const timeline = await describeProject(join(dir, "index.html"));
    const rows = allRows(timeline);
    const clip = childrenOf(timeline, rows.find((r) => r.id === "a")!)[0]!;
    const sfx = childrenOf(timeline, rows.find((r) => r.id === "b")!)[0]!;
    expect(clip).toMatchObject({ absStart: 0, absEnd: 5.27 });
    expect(sfx).toMatchObject({ absStart: 5.2, absEnd: 5.6 });
    expect(sfx.absStart).toBeLessThan(clip.absEnd);
  });

  // Reproduces an eval miss (cloud-render-launch, task B): "the second video
  // clip" has to be found by comparing videos nested in DIFFERENT
  // sub-compositions, each printed with its own local 0-based start.
  it("orders videos nested in different sub-compositions by absolute start, not local start", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-timeline-order-"));
    mkdirSync(join(dir, "compositions"));
    writeFileSync(
      join(dir, "index.html"),
      `<div data-composition-id="main" data-duration="20">
        <div id="first" data-composition-src="compositions/first.html" data-start="0" data-duration="6" data-track-index="0"></div>
        <div id="second" data-composition-src="compositions/second.html" data-start="6" data-duration="6" data-track-index="1"></div>
      </div>`,
    );
    writeFileSync(
      join(dir, "compositions", "first.html"),
      `<template><div data-composition-id="first"><video id="v1" src="v1.mp4" data-start="0" data-duration="5" data-track-index="0"></video></div></template>`,
    );
    writeFileSync(
      join(dir, "compositions", "second.html"),
      `<template><div data-composition-id="second"><video id="v2" src="v2.mp4" data-start="0" data-duration="5" data-track-index="0"></video></div></template>`,
    );
    const videos = allRows(await describeProject(join(dir, "index.html"))).filter(
      (r) => r.nested && r.kind === "video",
    );
    const byAbsStart = [...videos].sort((a, b) => a.absStart - b.absStart);
    expect(byAbsStart.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(byAbsStart[1]).toMatchObject({ id: "v2", absStart: 6 });
  });

  it("prints the absolute time first and the local time in parentheses for a nested row", async () => {
    const text = formatTimeline(await describeProject(inversionProject()));
    expect(text).toContain("direct 20-25s");
    expect(text).toContain("nested 6-8s (local 1-3s) nested in host compositions/scene.html");
  });
});

describe("formatTimeline", () => {
  it("treats playback rate 1 as unset and does not expand a host nested inside a sub-composition", async () => {
    const index = project();
    writeFileSync(
      join(dir, "compositions", "title.html"),
      `<template><div data-composition-id="t"><video id="v" src="v.mp4" data-start="0" data-duration="1" data-playback-rate="1"></video><div id="deep" data-composition-src="title.html" data-start="0" data-duration="1"></div></div></template>`,
    );
    const timeline = await describeProject(index);
    const title = allRows(timeline).find((r) => r.id === "title")!;
    expect(
      childrenOf(timeline, title).map((c) => [c.id, c.playbackRate, c.children.length]),
    ).toEqual([
      ["v", null, 0],
      ["deep", null, 0],
    ]);
  });

  it("prints a small volume unrounded to two decimals", async () => {
    const index = project();
    writeFileSync(
      index,
      `<div data-composition-id="m"><audio id="q" src="q.mp3" data-start="2.317" data-duration="1" data-volume="0.009772"></audio></div>`,
    );
    const text = formatTimeline(await describeProject(index));
    expect(text).toContain("vol=0.009772");
    expect(text).toContain("2.317-3.317s");
  });

  it("prints one bar per row under its track heading", async () => {
    const text = formatTimeline(await describeProject(project()));
    expect(text).toMatch(/^timeline 10s\n\nvideo \(1\)\n  \|█{16}/);
    expect(text).toContain("audio (2)");
    expect(text).toContain("graphics (4: 2 top-level, 2 nested)");
    expect(text).toContain("vol=0.5 group=vo volume[0:0.2 2:1]");
    expect(text).toContain("rate=2");
  });
});

const SKILL_DOC = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../skills/hyperframes-cli/references/upgrade-info-misc.md",
);

const EVAL_INDEX = `<div data-composition-id="main" data-duration="40">
  <video id="v-replay1" src="r1.mp4" data-start="16.05" data-duration="4" data-track-index="0"></video>
  <video id="v-replay2" src="r2.mp4" data-start="24.09" data-duration="4" data-track-index="0"></video>
  <div id="sec-sfx" data-composition-src="compositions/terminal-sfx.html" data-start="10" data-duration="10" data-track-index="1"></div>
  <div id="sec-music" data-composition-src="compositions/terminal-music.html" data-start="12" data-duration="10" data-track-index="2"></div>
</div>`;
const EVAL_SFX = `<template><div data-composition-id="terminal-sfx">
  <video id="tsfx-pet1" src="p1.mp4" data-start="0.4" data-duration="1" data-track-index="0"></video>
  <video id="tsfx-pet2" src="p2.mp4" data-start="5.67" data-duration="1" data-track-index="0"></video>
  <audio id="tsfx-hit" src="h.mp3" data-start="1" data-duration="1" data-track-index="1"></audio>
</div></template>`;
const EVAL_MUSIC = `<template><div data-composition-id="terminal-music">
  <video id="tmus-pet1" src="m1.mp4" data-start="1" data-duration="1" data-track-index="0"></video>
  <video id="tmus-pet2" src="m2.mp4" data-start="2.5" data-duration="1" data-track-index="0"></video>
</div></template>`;

const evalTimeline = () => {
  dir = mkdtempSync(join(tmpdir(), "hf-timeline-eval-"));
  mkdirSync(join(dir, "compositions"));
  writeFileSync(join(dir, "index.html"), EVAL_INDEX);
  writeFileSync(join(dir, "compositions", "terminal-sfx.html"), EVAL_SFX);
  writeFileSync(join(dir, "compositions", "terminal-music.html"), EVAL_MUSIC);
  return describeProject(join(dir, "index.html"));
};

/** Ids, absent ids, and same ids across kinds and hosts; every clip has a distinct src. */
const collidingTimeline = () => {
  dir = mkdtempSync(join(tmpdir(), "hf-timeline-collide-"));
  mkdirSync(join(dir, "compositions"));
  writeFileSync(
    join(dir, "index.html"),
    `<div data-composition-id="main" data-duration="30">
  <video src="a.mp4" data-start="1" data-duration="2" data-track-index="0"></video>
  <video src="b.mp4" data-start="9" data-duration="2" data-track-index="0"></video>
  <div id="h" data-composition-src="compositions/s1.html" data-start="3" data-duration="3" data-track-index="1"></div>
  <div id="h" data-composition-src="compositions/s2.html" data-start="12" data-duration="3" data-track-index="2"></div>
  <video id="x" src="x.mp4" data-start="20" data-duration="2" data-track-index="3"></video>
  <audio id="x" src="x.mp3" data-start="22" data-duration="2" data-track-index="4"></audio>
</div>`,
  );
  const sub = (src: string) =>
    `<template><div data-composition-id="s"><video id="c" src="${src}" data-start="0" data-duration="1" data-track-index="0"></video></div></template>`;
  writeFileSync(join(dir, "compositions", "s1.html"), sub("c1.mp4"));
  writeFileSync(join(dir, "compositions", "s2.html"), sub("c2.mp4"));
  return describeProject(join(dir, "index.html"));
};

describe("kind tracks list every clip once", () => {
  it("counts nested videos in the header and lists them in absolute order with host and file", async () => {
    const timeline = await evalTimeline();
    const text = formatTimeline(timeline);
    // Hand-computed: 2 top-level + 4 nested = 6; nested abs = host start (10 or 12) + local start.
    expect(text).toContain("video (6: 2 top-level, 4 nested)");
    const video = text.slice(text.indexOf("video ("), text.indexOf("graphics"));
    const pattern =
      /(v-replay|tsfx-pet|tmus-pet)\d [\d.]+-[\d.]+s( \(local [^)]*\) nested in \S+ \S+)?/g;
    expect(video.match(pattern)).toEqual([
      "tsfx-pet1 10.4-11.4s (local 0.4-1.4s) nested in sec-sfx compositions/terminal-sfx.html",
      "tmus-pet1 13-14s (local 1-2s) nested in sec-music compositions/terminal-music.html",
      "tmus-pet2 14.5-15.5s (local 2.5-3.5s) nested in sec-music compositions/terminal-music.html",
      "tsfx-pet2 15.67-16.67s (local 5.67-6.67s) nested in sec-sfx compositions/terminal-sfx.html",
      "v-replay1 16.05-20.05s",
      "v-replay2 24.09-28.09s",
    ]);
    expect(text).toContain("audio (1: 0 top-level, 1 nested)");
  });

  it("gives JSON the complete flat rows, with children as refs to rows and no copies", async () => {
    const timeline = JSON.parse(JSON.stringify(await evalTimeline())) as ProjectTimeline;
    const video = timeline.tracks.find((t) => t.kind === "video")!;
    expect(video.rows.map((r) => [r.index, r.id, r.nested, r.host])).toEqual([
      [0, "tsfx-pet1", true, "sec-sfx"],
      [1, "tmus-pet1", true, "sec-music"],
      [2, "tmus-pet2", true, "sec-music"],
      [3, "tsfx-pet2", true, "sec-sfx"],
      [4, "v-replay1", false, null],
      [5, "v-replay2", false, null],
    ]);
    const graphics = timeline.tracks.find((t) => t.kind === "graphics")!;
    const sfx = graphics.rows.find((r) => r.id === "sec-sfx")!;
    expect(sfx.children).toEqual([
      { kind: "video", index: 0 },
      { kind: "audio", index: 0 },
      { kind: "video", index: 3 },
    ]);
    expect(video.rows[0]!.hostRow).toEqual({ kind: "graphics", index: sfx.index });
    expect(graphics.rows[sfx.index]).toBe(sfx);
    expect(
      allRows(timeline).every((r) => r.children.every((c) => typeof c.index === "number")),
    ).toBe(true);
  });

  it("prints and indexes each clip once when ids are missing, repeated, or shared across kinds", async () => {
    const timeline = await collidingTimeline();
    const text = formatTimeline(timeline);
    // Hand-computed absolute starts: a 1, c1 3+0, b 9, c2 12+0, x.mp4 20.
    const videos = ["a.mp4", "c1.mp4", "b.mp4", "c2.mp4", "x.mp4"];
    expect(text).toContain("video (5: 3 top-level, 2 nested)");
    expect(text.match(/src=\S+\.mp4/g)).toEqual(videos.map((v) => `src=${v}`));
    expect(text.match(/src=x\.mp3/g)).toHaveLength(1);
    const rows = allRows(timeline);
    expect(timeline.tracks.find((t) => t.kind === "video")!.rows.map((r) => r.src)).toEqual(videos);
    for (const row of rows) {
      const pointers = [...row.children, ...(row.hostRow ? [row.hostRow] : [])];
      for (const { kind, index } of pointers) {
        const track = timeline.tracks.find((t) => t.kind === kind)!;
        expect(track.rows[index]!.index).toBe(index);
      }
    }
    for (const track of timeline.tracks) {
      expect(track.rows.map((r) => r.index)).toEqual(track.rows.map((_, i) => i));
    }
    const [h1, h2] = rows.filter((r) => r.id === "h");
    expect(childrenOf(timeline, h1!).map((c) => c.src)).toEqual(["c1.mp4"]);
    expect(childrenOf(timeline, h2!).map((c) => c.src)).toEqual(["c2.mp4"]);
  });

  it("does not count a sub-composition inside a sub-composition", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-timeline-deep-"));
    mkdirSync(join(dir, "compositions"));
    writeFileSync(join(dir, "index.html"), EVAL_INDEX);
    writeFileSync(
      join(dir, "compositions", "terminal-sfx.html"),
      `<template><div data-composition-id="terminal-sfx"><div id="inner" data-composition-src="compositions/terminal-music.html" data-start="0" data-duration="3" data-track-index="0"></div></div></template>`,
    );
    writeFileSync(join(dir, "compositions", "terminal-music.html"), EVAL_MUSIC);
    const timeline = await describeProject(join(dir, "index.html"));
    const video = timeline.tracks.find((t) => t.kind === "video")!;
    expect(video.rows.map((r) => r.id)).toEqual([
      "tmus-pet1",
      "tmus-pet2",
      "v-replay1",
      "v-replay2",
    ]);
    expect(formatTimeline(timeline)).toContain("children=unread");
  });
});

// The documented one-liners run verbatim; only the example query values are swapped for the fixture's.
const docLines = (kind: "jq" | "node -e"): string[] =>
  readFileSync(SKILL_DOC, "utf8")
    .split("\n")
    .filter((l) => l.startsWith(`${kind} `) && l.endsWith('<<<"$TL"'));
const oneLiners = (kind: "jq" | "node -e"): string[] =>
  docLines(kind).map((l) => l.replace("12.5", "7").replace("tsfx-pet2", "nested"));

const hasJq = (() => {
  try {
    execFileSync("jq", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();

const runOneLiner = async (line: string, timeline?: ProjectTimeline): Promise<string> => {
  const own = timeline ? null : inversionProject();
  try {
    return execFileSync("bash", ["-c", line], {
      env: {
        ...process.env,
        TL: JSON.stringify({ timeline: timeline ?? (await describeProject(own!)) }),
      },
      encoding: "utf8",
    });
  } finally {
    if (own) rmSync(dirname(own), { recursive: true, force: true });
  }
};
const parseStream = (out: string) => JSON.parse(`[${out.replace(/}\s*{/g, "},{")}]`);

describe("skill query one-liners", () => {
  it("documents five node one-liners, each answering from the fixture", async () => {
    const lines = oneLiners("node -e");
    expect(lines).toHaveLength(5);
    const [at = "", find, track, gaps, nth] = await Promise.all(lines.map((l) => runOneLiner(l)));
    expect(at.split("\n").filter(Boolean)).toEqual([
      "nested compositions/scene.html",
      "host index.html",
    ]);
    expect(find).toBe("compositions/scene.html video 6 8\n");
    expect(track).toBe("nested 6 8\ndirect 20 25\n");
    expect(gaps).toBe("nested direct 12\n");
    expect(nth).toBe("1 direct 20 index.html\n");
  });

  it.skipIf(!hasJq)("documents five jq one-liners that agree with the node ones", async () => {
    const lines = oneLiners("jq");
    expect(lines).toHaveLength(5);
    const [at, find, track, gaps, nth] = (await Promise.all(lines.map((l) => runOneLiner(l)))).map(
      parseStream,
    );
    expect(at[0].map((r: { id: string }) => r.id)).toEqual(["nested", "host"]);
    expect(find).toEqual([
      { file: "compositions/scene.html", trackKind: "video", absStart: 6, absEnd: 8 },
    ]);
    expect(track).toEqual([
      { id: "nested", absStart: 6, absEnd: 8 },
      { id: "direct", absStart: 20, absEnd: 25 },
    ]);
    expect(gaps[0]).toEqual([{ a: "nested", b: "direct", delta: 12 }]);
    expect(nth).toEqual([
      { index: 1, id: "direct", absStart: 20, file: "index.html", nested: false },
    ]);
  });

  it("answers the eval questions exactly on the eval fixture, counting no clip twice", async () => {
    const timeline = await evalTimeline();
    const ids = ["tsfx-pet1", "tmus-pet1", "tmus-pet2", "tsfx-pet2", "v-replay1", "v-replay2"];
    const run = (l: string) => runOneLiner(l.replace("12.5", "15.7"), timeline);
    const [at = "", find = "", track = "", , nth = ""] = await Promise.all(
      docLines("node -e").map(run),
    );
    expect(at.split("\n").filter(Boolean)).toEqual([
      "tsfx-pet2 compositions/terminal-sfx.html",
      "sec-sfx index.html",
      "sec-music index.html",
    ]);
    expect(find).toBe("compositions/terminal-sfx.html video 15.67 16.67\n");
    expect(
      track
        .split("\n")
        .filter(Boolean)
        .map((l) => l.split(" ")[0]),
    ).toEqual(ids);
    expect(nth).toBe("1 tmus-pet1 13 compositions/terminal-music.html\n");
    if (!hasJq) return;
    const [jqAt = "", , jqTrack = "", , jqNth = ""] = await Promise.all(docLines("jq").map(run));
    expect(parseStream(jqAt)[0].map((r: { id: string }) => r.id)).toEqual([
      "tsfx-pet2",
      "sec-sfx",
      "sec-music",
    ]);
    expect(parseStream(jqTrack).map((r: { id: string }) => r.id)).toEqual(ids);
    expect(parseStream(jqNth)).toEqual([
      {
        index: 1,
        id: "tmus-pet1",
        absStart: 13,
        file: "compositions/terminal-music.html",
        nested: true,
      },
    ]);
  });
});

describe("shared media-duration fixtures", () => {
  const probeFree = MEDIA_DURATION_FIXTURES.filter(
    (f) => f.tag === "img" || f.sourceDurationSeconds === null || f.expected.source === "authored",
  );

  it.each(probeFree)("$name", async ({ tag, attrs, expected }) => {
    const attrText = Object.entries(attrs)
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");
    const { rows } = await rowsOf(
      `<div data-composition-id="m"><${tag} id="x" src="absent.bin" ${attrText}></${tag}></div>`,
    );
    expect(rows[0]).toMatchObject({
      durationSource: expected.source,
      duration: expected.seconds ?? 0,
    });
  });
});

describe("createProbeGate", () => {
  it("never runs more than its limit at once, even for jobs arriving while slots are held", async () => {
    const gate = createProbeGate(4);
    const releases: Array<() => void> = [];
    let running = 0;
    let peak = 0;
    const job = () =>
      gate(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise<void>((done) => releases.push(done));
        running -= 1;
      });
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const jobs = Array.from({ length: 8 }, job);
    await tick();
    releases.shift()!();
    await tick();
    jobs.push(...Array.from({ length: 8 }, job));
    await tick();
    while (releases.length > 0) {
      releases.shift()!();
      await tick();
    }
    await Promise.all(jobs);
    expect(peak).toBe(4);
  });
});
