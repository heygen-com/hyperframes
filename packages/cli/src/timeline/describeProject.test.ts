import { execFileSync } from "node:child_process";
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
import { dirname, join } from "node:path";
import { MEDIA_DURATION_FIXTURES } from "@hyperframes/parsers/media-duration-fixtures";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureDOMParser } from "../utils/dom.js";
import { createProbeGate, describeProject } from "./describeProject.js";
import { formatTimeline } from "./formatTimeline.js";

const REAL_AUDIO = new URL("../../../../skills/media-use/audio/assets/sfx/pop.mp3", import.meta.url)
  .pathname;

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
const rowsOf = async (html: string, withSting = false) => {
  const index = project();
  writeFileSync(index, html);
  if (withSting) copyFileSync(REAL_AUDIO, join(dir, "sting.mp3"));
  const timeline = await describeProject(index);
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

  it("nests a sub-composition's clips one level down with local times", async () => {
    const title = (await describeProject(project())).tracks
      .flatMap((t) => t.rows)
      .find((r) => r.id === "title")!;
    expect(title.children.map((c) => [c.id, c.start, c.end])).toEqual([
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
    );
    // (0.72 - 0.2) / 2, hand-computed
    expect(row!.duration).toBeCloseTo(0.26, 1);
  });

  it("probes a media leaf's real duration when none is authored", async () => {
    const {
      rows: [row],
      text,
    } = await rowsOf(
      `<div data-composition-id="m"><audio id="sting" src="sting.mp3" data-start="0"></audio></div>`,
      true,
    );
    expect(row).toMatchObject({ durationAuthored: false, durationSource: "media" });
    expect(row!.pendingReason).toBeNull();
    expect(row!.duration).toBeCloseTo(0.72, 1);
    expect(row!.end).toBeCloseTo(0.72, 1);
    expect(text).toContain("duration=media");
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
    const rows = (await describeProject(inversionProject())).tracks.flatMap((t) => t.rows);
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

  it("places a nested media clip with a negative start where the runtime plays it", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-timeline-neg-"));
    mkdirSync(join(dir, "compositions"));
    writeFileSync(join(dir, "index.html"), INVERSION_INDEX);
    writeFileSync(
      join(dir, "compositions", "scene.html"),
      INVERSION_SCENE.replace('data-start="1"', 'data-start="-3"'),
    );
    const host = (await describeProject(join(dir, "index.html"))).tracks
      .flatMap((t) => t.rows)
      .find((r) => r.id === "host")!;
    // Host starts at 5 and the runtime adds the raw -3: it plays at 2, not at the clamped 5.
    expect(host.children.find((c) => c.id === "nested")).toMatchObject({ absStart: 2, absEnd: 4 });
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
    const host = (await describeProject(join(dir, "index.html"))).tracks
      .flatMap((t) => t.rows)
      .find((r) => r.id === "host")!;
    // nested ends at local 3, so "nested + 1" is local 4; the host at 5 puts it at 9 on the main timeline.
    expect(host.children.find((c) => c.id === "after")).toMatchObject({ start: 4, absStart: 9 });
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
    const rows = (await describeProject(join(dir, "index.html"))).tracks.flatMap((t) => t.rows);
    const clip = rows.find((r) => r.id === "a")!.children[0]!;
    const sfx = rows.find((r) => r.id === "b")!.children[0]!;
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
    const rows = (await describeProject(join(dir, "index.html"))).tracks.flatMap((t) => t.rows);
    const videos = rows.flatMap((r) => r.children).filter((c) => c.kind === "video");
    const byAbsStart = [...videos].sort((a, b) => a.absStart - b.absStart);
    expect(byAbsStart.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(byAbsStart[1]).toMatchObject({ id: "v2", absStart: 6 });
  });

  it("prints the absolute time first and the local time in parentheses for a nested row", async () => {
    const text = formatTimeline(await describeProject(inversionProject()));
    expect(text).toContain("direct 20-25s");
    expect(text).toContain("nested 6-8s (local 1-3s) in compositions/scene.html");
  });
});

describe("formatTimeline", () => {
  it("treats playback rate 1 as unset and does not expand a host nested inside a sub-composition", async () => {
    const index = project();
    writeFileSync(
      join(dir, "compositions", "title.html"),
      `<template><div data-composition-id="t"><video id="v" src="v.mp4" data-start="0" data-duration="1" data-playback-rate="1"></video><div id="deep" data-composition-src="title.html" data-start="0" data-duration="1"></div></div></template>`,
    );
    const title = (await describeProject(index)).tracks
      .flatMap((t) => t.rows)
      .find((r) => r.id === "title")!;
    expect(title.children.map((c) => [c.id, c.playbackRate, c.children.length])).toEqual([
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

const runOneLiner = async (line: string): Promise<string> =>
  execFileSync("bash", ["-c", line], {
    env: {
      ...process.env,
      TL: JSON.stringify({ timeline: await describeProject(inversionProject()) }),
    },
    encoding: "utf8",
  });

describe("skill query one-liners", () => {
  it("documents four node one-liners, each answering from the fixture", async () => {
    const lines = oneLiners("node -e");
    expect(lines).toHaveLength(4);
    const [at = "", find, track, gaps] = await Promise.all(lines.map(runOneLiner));
    expect(at.split("\n").filter(Boolean)).toEqual([
      "host index.html",
      "nested compositions/scene.html",
    ]);
    expect(find).toBe("compositions/scene.html video 6 8\n");
    expect(track).toBe("direct 20 25\n");
    expect(gaps).toBe("");
  });

  it.skipIf(!hasJq)("documents four jq one-liners that agree with the node ones", async () => {
    const lines = oneLiners("jq");
    expect(lines).toHaveLength(4);
    const [at, find, track, gaps] = (await Promise.all(lines.map(runOneLiner))).map((out) =>
      JSON.parse(`[${out.replace(/}\s*{/g, "},{")}]`),
    );
    expect(at[0].map((r: { id: string }) => r.id)).toEqual(["host", "nested"]);
    expect(find).toEqual([
      { file: "compositions/scene.html", trackKind: "video", absStart: 6, absEnd: 8 },
    ]);
    expect(track).toEqual([{ id: "direct", absStart: 20, absEnd: 25 }]);
    expect(gaps[0]).toEqual([]);
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
  it("never runs more than its limit at once", async () => {
    const gate = createProbeGate(4);
    let running = 0;
    let peak = 0;
    const job = () =>
      gate(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running -= 1;
      });
    const firstWave = Array.from({ length: 12 }, job);
    await new Promise((r) => setTimeout(r, 40));
    await Promise.all([...firstWave, ...Array.from({ length: 12 }, job)]);
    expect(peak).toBe(4);
  });
});
