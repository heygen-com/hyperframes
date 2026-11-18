import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtifactRecord, VideoState } from "./videoState.js";

// Windows path rules on any host, and a disk that records every path it is asked about.
const disk = vi.hoisted(() => ({
  files: new Set<string>(),
  touched: [] as string[],
}));
vi.mock("node:path", async () => {
  const path = await vi.importActual<typeof import("node:path")>("node:path");
  return { ...path.win32, default: path.win32 };
});
vi.mock("node:fs", async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const missing = (path: string) => Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
  const look = (path: string) => (disk.touched.push(path), disk.files.has(path.toLowerCase()));
  const overrides = {
    existsSync: look,
    openSync: (path: string) => {
      if (!look(path)) throw missing(path);
      return 100;
    },
    lstatSync: (path: string) => {
      if (!look(path)) throw missing(path);
      return { isSymbolicLink: () => false };
    },
  };
  return { ...fs, ...overrides, default: { ...fs, ...overrides } };
});
// The built package would keep the host's own path rules; its source runs under the Windows ones above.
vi.mock(
  "@hyperframes/parsers/asset-resolution",
  () => import("../../../parsers/src/assetResolution.js"),
);
vi.mock("../helpers/safePath.js", async () => {
  const { win32 } = await vi.importActual<typeof import("node:path")>("node:path");
  const realFilePath = (path: string) => (disk.touched.push(path), path);
  const pinProjectRecord = (base: string, relative: string) => {
    disk.touched.push(win32.join(base, relative));
    return win32.join(base, relative);
  };
  return { realFilePath, pinProjectRecord };
});

const { finishArtifactCleanup, planArtifactCleanup, recordedFileGone } =
  await import("./artifactCleanup.js");

const PROJECT = "C:\\project";
const LOCAL = `${PROJECT}\\.hyperframes\\artifacts\\checks\\run\\report.json`;
const SHARES = [
  "\\\\host\\share\\report.json",
  "//host/share/report.json",
  "\\\\?\\UNC\\host\\share\\report.json",
  "\\\\.\\pipe\\report.json",
];
const onShare = (path: string) => /^[\\/]{2}/.test(path);

function record(id: string, report: string): ArtifactRecord {
  return {
    id,
    report,
    revision: "old",
    createdAt: 1,
    contentHash: "hash",
    inputFingerprint: "fp",
    inputScope: "local-project-files",
    attribution: "recorded-revision",
  } as ArtifactRecord;
}

function stateWith(checks: ArtifactRecord[], pending: string[] = []): VideoState {
  const collection = (list: ArtifactRecord[]) => ({
    latest: null,
    revisions: list.length ? { old: list } : {},
    unversioned: [],
  });
  return {
    version: 1,
    historyId: "h",
    currentRevision: "new",
    pendingChanges: false,
    files: {},
    revisions: {},
    checks: collection(checks),
    snapshots: collection([]),
    pendingArtifactCleanup: pending.map((path, i) => ({
      path,
      hash: "hash",
      revision: "old",
      id: `p${i}`,
      kind: "checks" as const,
    })),
  } as unknown as VideoState;
}

const render = {
  id: "r",
  completedAt: 2,
  output: "out.mp4",
  status: "completed" as const,
};

beforeEach(() => {
  disk.files.clear();
  disk.touched.length = 0;
});

describe("recorded artifact paths on another computer's share", () => {
  it.each(SHARES)("counts %s as gone without looking it up", (path) => {
    expect(recordedFileGone(PROJECT, path)).toBe(true);
    expect(disk.touched).toEqual([]);
  });

  it.each(SHARES)("plans cleanup around %s without looking it up", (path) => {
    const state = stateWith([record("share", path)]);
    planArtifactCleanup(PROJECT, state, render);

    expect(disk.touched.filter(onShare)).toEqual([]);
    expect(state.checks.revisions.old?.[0]?.status).toBeUndefined();
  });

  it.each(SHARES)("drops pending cleanup of %s unread", (path) => {
    const state = stateWith([record("share", path)], [path]);
    finishArtifactCleanup(PROJECT, state);

    expect(disk.touched.filter(onShare)).toEqual([]);
    expect(state.pendingArtifactCleanup).toEqual([]);
  });

  it("leaves a recorded path outside the artifacts folder unlooked-up", () => {
    const state = stateWith([], ["C:\\elsewhere\\report.json"]);
    finishArtifactCleanup(PROJECT, state);

    expect(disk.touched).not.toContain("C:\\elsewhere\\report.json");
    expect(state.pendingArtifactCleanup).toEqual([]);
  });

  it("still checks and cleans the project's own artifacts", () => {
    disk.files.add(LOCAL.toLowerCase());
    expect(recordedFileGone(PROJECT, LOCAL)).toBe(false);

    const state = stateWith([record("local", LOCAL)]);
    planArtifactCleanup(PROJECT, state, render);
    expect(state.checks.revisions.old?.[0]?.status).toBe("cleaned");
    expect(state.pendingArtifactCleanup?.map((item) => item.path)).toEqual([LOCAL]);
  });
});
