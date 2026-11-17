import { describe, expect, it, vi } from "vitest";
import type { ProjectTimeline, TimelineRow } from "../../timeline/describeProject.js";
import type { FilmQuery } from "./targets.js";

// Windows path rules on any host, and a disk and decoder that record every path they are given.
const touched = vi.hoisted(() => [] as string[]);
const present = vi.hoisted(() => new Set<string>());
vi.mock("node:path", async () => {
  const path = await vi.importActual<typeof import("node:path")>("node:path");
  return { ...path.win32, default: path.win32 };
});
vi.mock("node:fs", async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const existsSync = (path: string) => {
    touched.push(path);
    return present.has(path);
  };
  const statSync = (path: string) => {
    touched.push(path);
    throw new Error(`no stat in this test: ${path}`);
  };
  return { ...fs, existsSync, statSync, default: { ...fs, existsSync, statSync } };
});
vi.mock("./decode.js", () => ({
  probeAudio: async (path: string) => {
    touched.push(path);
    return null;
  },
  decodeAudio: async (path: string) => {
    touched.push(path);
    return null;
  },
}));

const { filmTargets } = await import("./targets.js");
const { analyzeTargets } = await import("./run.js");

const PROJECT = "C:\\project";
const SHARES = [
  "\\\\host\\share\\a.wav",
  "//host/share/a.wav",
  "\\\\?\\UNC\\host\\share\\a.wav",
  "/\\host\\share\\a.wav",
  "\\\\host\\share\\a.wav?v=2",
];

function row(ref: string, src: string, absStart: number): TimelineRow {
  return {
    warnings: [],
    id: ref.slice(1),
    ref,
    kind: "audio",
    label: null,
    trackKind: "audio",
    absStart,
    absEnd: absStart + 2,
    start: absStart,
    duration: 2,
    end: absStart + 2,
    file: "index.html",
    index: 0,
    nested: false,
    host: null,
    hostRow: null,
    children: [],
    parentRow: null,
    trackIndex: 0,
    src,
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
  };
}

const film = (rows: TimelineRow[]): ProjectTimeline => ({
  duration: 20,
  tracks: [{ kind: "audio", rows }],
});

const onAShare = (path: string) => /^[\\/]{2}/.test(path);

describe("hyperframes audio with a src on another computer's share", () => {
  const timeline = film(SHARES.map((src, i) => row(`#s${i}`, src, i * 2)));
  const queries: FilmQuery[] = [
    { by: "all" },
    { by: "at", t: 5 },
    { by: "range", start: 0, end: 10 },
    ...SHARES.map((_, i): FilmQuery => ({ by: "element", ref: `#s${i}` })),
  ];

  it.each(queries)("reports the clip and never looks it up (%o)", async (query) => {
    touched.length = 0;
    const targets = filmTargets(PROJECT, timeline, query);
    const report = await analyzeTargets(targets, { capabilities: ["moments"] });
    expect(touched.filter(onAShare)).toEqual([]);
    expect(report.items.length).toBeGreaterThan(0);
    for (const item of report.items)
      expect(item.error).toBe("network share paths are not analyzed");
  });
});

describe("hyperframes audio with a local src under Windows rules", () => {
  it("resolves a relative src in the project as before", () => {
    present.clear();
    present.add("C:\\project\\audio\\a.wav");
    const [target] = filmTargets(PROJECT, film([row("#a", "audio/a.wav", 0)]), { by: "all" });
    expect(target).toMatchObject({ path: "C:\\project\\audio\\a.wav" });
    expect(target).not.toHaveProperty("onAnotherNetworkRoot");
  });

  it("keeps an absolute src in the project as written and looks it up", async () => {
    touched.length = 0;
    present.clear();
    const [target] = filmTargets(PROJECT, film([row("#a", "C:\\project\\gone.wav", 0)]), {
      by: "all",
    });
    expect(target).toMatchObject({ path: "C:\\project\\gone.wav" });
    const report = await analyzeTargets([target!], { capabilities: ["moments"] });
    expect(report.items[0]?.error).toBe("file not found");
    expect(touched).toContain("C:\\project\\gone.wav");
  });

  it("reads a src on the share the project itself lives on", () => {
    const [target] = filmTargets(
      "\\\\nas\\films\\project",
      film([row("#a", "//NAS/films/voice.wav", 0)]),
      { by: "all" },
    );
    expect(target).not.toHaveProperty("onAnotherNetworkRoot");
  });
});
