import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectTimeline, TimelineRow } from "../../timeline/describeProject.js";
import { fileTime, filmTargets, filmTime, type Placement } from "./targets.js";

function row(
  fields: Partial<TimelineRow> & Pick<TimelineRow, "ref" | "kind" | "absStart" | "absEnd">,
): TimelineRow {
  return {
    warnings: [],
    id: fields.ref.replace(/^#/, ""),
    label: null,
    trackKind: fields.kind === "video" ? "video" : "audio",
    start: fields.absStart,
    duration: fields.absEnd - fields.absStart,
    end: fields.absEnd,
    file: "index.html",
    index: 0,
    nested: false,
    host: null,
    hostRow: null,
    children: [],
    parentRow: null,
    trackIndex: 0,
    src: "audio/a.wav",
    sourceFile: null,
    volume: null,
    lanes: [],
    playbackRate: null,
    audioGroup: null,
    role: null,
    durationAuthored: true,
    durationSource: "authored",
    pendingReason: null,
    laneError: null,
    syncOffsetFrames: null,
    mediaStart: 0,
    ...fields,
  };
}

const timeline: ProjectTimeline = {
  duration: 20,
  tracks: [
    {
      kind: "video",
      rows: [
        row({ ref: "#clip", kind: "video", absStart: 0, absEnd: 6, src: "clip.mp4" }),
        row({ ref: "#silent", kind: "video", absStart: 0, absEnd: 6, src: "b.mp4", volume: 0 }),
      ],
    },
    {
      kind: "audio",
      rows: [
        row({ ref: "#score", kind: "audio", absStart: 0, absEnd: 20, src: "audio/score.wav" }),
        row({
          ref: "#hit",
          kind: "audio",
          absStart: 4.2,
          absEnd: 5,
          src: "sfx/hit.wav",
          mediaStart: 0.1,
        }),
        row({
          ref: "#fast",
          kind: "audio",
          absStart: 8,
          absEnd: 10,
          src: "../shared/riser.wav",
          start: 2,
          file: "compositions/scene.html",
          playbackRate: 2,
          mediaStart: 1,
        }),
      ],
    },
  ],
};

describe("film and file time", () => {
  const placed: Placement = {
    start: 8,
    end: 10,
    dataStart: 8,
    mediaStart: 1,
    playbackRate: 2,
    volume: 1,
  };

  it("maps a file second to the film through the clip's start, in-point and rate, and back", () => {
    expect(filmTime(placed, 3)).toBe(9);
    expect(fileTime(placed, 9)).toBe(3);
  });
});

describe("filmTargets", () => {
  const ids = (query: Parameters<typeof filmTargets>[2]) =>
    filmTargets("/p", timeline, query).map((t) => t.ref);

  it("lists every clip that sounds, leaving out muted ones", () => {
    expect(ids({ by: "all" })).toEqual(["#clip", "#score", "#hit", "#fast"]);
  });

  it("picks the clips playing at a second or in a range", () => {
    expect(ids({ by: "at", t: 4.5 })).toEqual(["#clip", "#score", "#hit"]);
    expect(ids({ by: "at", t: 5 })).toEqual(["#clip", "#score"]);
    expect(ids({ by: "range", start: 5.5, end: 8.5 })).toEqual(["#clip", "#score", "#fast"]);
  });

  it("reads only the part of the file a range plays, through the in-point and rate", () => {
    const [fast] = filmTargets("/p", timeline, { by: "range", start: 9, end: 12 }).filter(
      (t) => t.ref === "#fast",
    );
    expect(fast!.window).toEqual({ from: 3, seconds: 2 });
    expect(fast!.clip).toEqual({ from: 1, seconds: 4 });
  });

  it("resolves a source against the file that declares the clip, and keeps its local data-start", () => {
    const [fast] = filmTargets("/p", timeline, { by: "element", ref: "#fast" });
    expect(fast!.path).toBe(resolve("/p/shared/riser.wav"));
    expect(fast!.placement).toEqual({
      start: 8,
      end: 10,
      dataStart: 2,
      mediaStart: 1,
      playbackRate: 2,
      volume: 1,
    });
  });

  it("finds media the way preview and render load it: root assets from a nested scene, percent-encoded names", () => {
    const projectDir = realpathSync(mkdtempSync(join(tmpdir(), "hf-audio-targets-")));
    try {
      mkdirSync(join(projectDir, "assets"));
      mkdirSync(join(projectDir, "compositions", "sfx"), { recursive: true });
      writeFileSync(join(projectDir, "assets", "music bed.mp3"), "");
      writeFileSync(join(projectDir, "compositions", "sfx", "hit.wav"), "");
      const scene = { absStart: 0, absEnd: 5, file: "compositions/scene.html" } as const;
      const nested: ProjectTimeline = {
        ...timeline,
        tracks: [
          {
            ...timeline.tracks[0]!,
            rows: [
              row({ ...scene, ref: "#bed", kind: "audio", src: "assets/music%20bed.mp3" }),
              row({ ...scene, ref: "#hit", kind: "audio", src: "sfx/hit.wav" }),
            ],
          },
        ],
      };

      const paths = filmTargets(projectDir, nested, { by: "all" }).map((t) => t.path);

      expect(paths).toEqual([
        join(projectDir, "assets", "music bed.mp3"),
        join(projectDir, "compositions", "sfx", "hit.wav"),
      ]);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("says when an element is missing or is not sound", () => {
    expect(() => filmTargets("/p", timeline, { by: "element", ref: "#nope" })).toThrow(
      /was not found/,
    );
    const withTitle: ProjectTimeline = {
      ...timeline,
      tracks: [
        {
          kind: "graphics",
          rows: [row({ ref: "#title", kind: "div", absStart: 0, absEnd: 2, src: null })],
        },
      ],
    };
    expect(() => filmTargets("/p", withTitle, { by: "element", ref: "#title" })).toThrow(
      /not an audio or video clip/,
    );
  });
});
