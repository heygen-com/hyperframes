// @vitest-environment node
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  finishSnapshotCleanup,
  ownSnapshotRun,
  planSnapshotCleanup,
  releaseSnapshotRun,
  retainSnapshotOutput,
  SNAPSHOT_GRACE_MS,
} from "./snapshotRuns.js";
import * as atomicFile from "@hyperframes/core/atomic-file";
import { finishSnapshotRun } from "./videoState.js";
import type { ArtifactRecord, VideoState } from "./videoState.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    openSync: vi.fn(actual.openSync),
    ftruncateSync: vi.fn(actual.ftruncateSync),
  };
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const now = Date.now();
function ageRun(path: string): void {
  const time = new Date(now - SNAPSHOT_GRACE_MS * 3);
  utimesSync(path, time, time);
}
function fixture() {
  const project = mkdtempSync(join(tmpdir(), "hf-run-retention-"));
  roots.push(project);
  const root = join(project, ".hyperframes", "artifacts", "snapshots");
  mkdirSync(root, { recursive: true });
  const state: VideoState = {
    version: 1,
    historyId: null,
    currentRevision: null,
    pendingChanges: false,
    files: {},
    revisions: {},
    checks: { latest: null, revisions: {}, unversioned: [] },
    snapshots: { latest: null, revisions: {}, unversioned: [] },
  };
  function run(age = SNAPSHOT_GRACE_MS * 2, revision: string | null = null) {
    const path = join(root, randomUUID());
    mkdirSync(join(path, "derived"), { recursive: true });
    writeFileSync(join(path, "frame.png"), "pixels");
    writeFileSync(join(path, "contact-sheet.jpg"), "sheet");
    writeFileSync(join(path, "derived", "description.md"), "words");
    const record: ArtifactRecord = {
      id: randomUUID(),
      scope: "root",
      image: join(path, "frame.png"),
      createdAt: now - age,
      contentHash: "hash",
      revision,
      inputFingerprint: "input",
      inputScope: "local-project-files",
      attribution: revision ? "recorded-revision" : "unversioned",
    };
    (revision ? (state.snapshots.revisions[revision] ??= []) : state.snapshots.unversioned).push(
      record,
    );
    utimesSync(path, new Date(now - age), new Date(now - age));
    return { path, record };
  }
  function fill() {
    for (let i = 0; i < 10; i++) run(SNAPSHOT_GRACE_MS + i);
  }
  function collect() {
    const plan = planSnapshotCleanup(project, state, now);
    finishSnapshotCleanup(project, plan);
    return plan;
  }
  return { project, root, state, run, fill, collect };
}

it("does not delete files when retiring references fails to persist, then retries", async () => {
  const f = fixture();
  const old = f.run();
  f.fill();
  const file = join(f.project, ".hyperframes", "video-state.json");
  writeFileSync(file, JSON.stringify(f.state));
  const persist = vi.spyOn(atomicFile, "replaceFileAtomically");
  persist.mockImplementationOnce(() => {
    throw new Error("disk full");
  });
  try {
    await expect(finishSnapshotRun(f.project, f.root)).rejects.toThrow("disk full");
    expect(existsSync(old.path)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).snapshots.unversioned[0].image).toBe(
      old.record.image,
    );
    await finishSnapshotRun(f.project, f.root);
    expect(existsSync(old.path)).toBe(false);
    expect(JSON.parse(readFileSync(file, "utf8")).snapshots.unversioned[0].status).toBe("cleaned");
  } finally {
    persist.mockRestore();
  }
});
it("accepts explicit managed output on a fresh project", () => {
  const f = fixture();
  rmSync(f.root, { recursive: true });
  const path = join(f.root, randomUUID());
  retainSnapshotOutput(f.project, path);
  expect(existsSync(join(path, ".user-output"))).toBe(true);
});

it.each(["frame.png", "derived/description.md"])(
  "preserves explicit --keep output %s inside an old run",
  (file) => {
    const f = fixture();
    const old = f.run();
    f.fill();
    const output = join(old.path, file);
    retainSnapshotOutput(f.project, dirname(output));
    retainSnapshotOutput(f.project, dirname(output));
    writeFileSync(output, "new pixels or words");
    ageRun(old.path);
    f.collect();
    expect(existsSync(old.path)).toBe(true);
  },
);

it("retires old unversioned records before deleting entire runs and derived files", () => {
  const f = fixture();
  const old = f.run();
  f.fill();
  const plan = planSnapshotCleanup(f.project, f.state, now);
  expect(old.record.image).toBeUndefined();
  expect(old.record.status).toBe("cleaned");
  expect(existsSync(join(old.path, "contact-sheet.jpg"))).toBe(true);
  finishSnapshotCleanup(f.project, plan);
  expect(existsSync(old.path)).toBe(false);
});
it("bounds repeated current-revision runs while preserving the newest evidence", () => {
  const f = fixture();
  f.state.currentRevision = "r1";
  const old = f.run(SNAPSHOT_GRACE_MS * 3, "r1");
  const latest = f.run(SNAPSHOT_GRACE_MS * 2, "r1");
  f.fill();
  f.state.snapshots.latest = { revision: "r1", id: latest.record.id };
  f.collect();
  expect(existsSync(old.path)).toBe(false);
  expect(existsSync(latest.path)).toBe(true);
  expect(f.state.snapshots.latest?.id).toBe(latest.record.id);
});
it("keeps recent runs, latest evidence, retained rendered revisions and pending file cleanup", () => {
  const f = fixture();
  const latest = f.run();
  const rendered = f.run(undefined, "rendered");
  const pending = f.run();
  f.state.renders = { latest: null, retainedRevisions: ["rendered"] };
  f.state.snapshots.latest = { revision: null, id: latest.record.id };
  f.state.pendingArtifactCleanup = [
    {
      path: pending.record.image!,
      kind: "snapshots",
      revision: "old",
      id: pending.record.id,
      hash: "hash",
    },
  ];
  delete pending.record.image;
  pending.record.status = "cleaned";
  f.fill();
  const recent = f.run(1000);
  f.collect();
  for (const item of [latest, rendered, pending, recent]) expect(existsSync(item.path)).toBe(true);
});
it("protects live captures then releases completed runs in the same long-lived process", () => {
  const f = fixture();
  const path = join(f.root, randomUUID());
  ownSnapshotRun(f.project, path);
  writeFileSync(join(path, "frame.png"), "capture");
  ageRun(path);
  f.fill();
  f.collect();
  expect(existsSync(path)).toBe(true);
  releaseSnapshotRun(f.project, path);
  expect(JSON.parse(readFileSync(join(path, ".capture-owner.json"), "utf8")).released).toBe(true);
  ageRun(path);
  f.collect();
  expect(existsSync(path)).toBe(false);
});
it.each(["broken", '{"released":true}'])(
  "reclaims crashed captures but preserves malformed owner metadata %s",
  (metadata) => {
    const f = fixture();
    const crashed = f.run();
    const malformed = f.run();
    writeFileSync(
      join(crashed.path, ".capture-owner.json"),
      JSON.stringify({ version: 1, pid: 2147483647 }),
    );
    writeFileSync(join(malformed.path, ".capture-owner.json"), metadata);
    for (const item of [crashed, malformed])
      utimesSync(
        item.path,
        new Date(now - SNAPSHOT_GRACE_MS * 3),
        new Date(now - SNAPSHOT_GRACE_MS * 3),
      );
    f.fill();
    f.collect();
    expect(existsSync(crashed.path)).toBe(false);
    expect(existsSync(malformed.path)).toBe(true);
  },
);
it("does not traverse directory symlinks or delete arbitrary output directories", () => {
  const f = fixture();
  const outside = mkdtempSync(join(tmpdir(), "hf-external-"));
  roots.push(outside);
  writeFileSync(join(outside, "keep.png"), "keep");
  symlinkSync(outside, join(f.root, randomUUID()), "dir");
  mkdirSync(join(f.root, "custom-output"));
  const old = f.run();
  symlinkSync(outside, join(old.path, "external"), "dir");
  ageRun(old.path);
  f.fill();
  f.collect();
  expect(existsSync(old.path)).toBe(false);
  expect(readFileSync(join(outside, "keep.png"), "utf8")).toBe("keep");
  expect(existsSync(join(f.root, "custom-output"))).toBe(true);
});
it("refuses a symlinked managed root", () => {
  const f = fixture();
  rmSync(f.root, { recursive: true });
  const outside = mkdtempSync(join(tmpdir(), "hf-root-link-"));
  roots.push(outside);
  symlinkSync(outside, f.root, "dir");
  expect(planSnapshotCleanup(f.project, f.state, now)).toEqual([]);
  expect(() => ownSnapshotRun(f.project, join(f.root, randomUUID()))).toThrow("symlinks");
});
it("revalidates identity and activity after a deletion plan is persisted", () => {
  const f = fixture();
  const old = f.run();
  f.fill();
  const plan = planSnapshotCleanup(f.project, f.state, now);
  writeFileSync(join(old.path, "new.png"), "new activity");
  finishSnapshotCleanup(f.project, plan);
  expect(existsSync(old.path)).toBe(true);
});
it("treats a disappearing managed root as best-effort cleanup", () => {
  const f = fixture();
  rmSync(f.root, { recursive: true });
  expect(f.collect()).toEqual([]);
});

it.each(["symlink", "replacement"])("does not release a lease swapped for a %s", async (kind) => {
  const f = fixture();
  const path = join(f.root, randomUUID());
  ownSnapshotRun(f.project, path);
  const marker = join(path, ".capture-owner.json");
  const replacement = join(f.project, "replacement.json");
  writeFileSync(replacement, JSON.stringify({ pid: process.pid }));
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  vi.mocked(fs.openSync).mockImplementationOnce((...args) => {
    rmSync(marker);
    if (kind === "symlink") symlinkSync(replacement, marker);
    else actual.renameSync(replacement, marker);
    return actual.openSync(...args);
  });
  releaseSnapshotRun(f.project, path);
  expect(existsSync(marker)).toBe(true);
  expect(JSON.parse(readFileSync(marker, "utf8"))).toEqual({ pid: process.pid });
});

it("keeps a run when its owner is swapped for a symlink during cleanup", async () => {
  const f = fixture();
  const old = f.run();
  const marker = join(old.path, ".capture-owner.json");
  const replacement = join(f.project, "other-owner.json");
  writeFileSync(marker, JSON.stringify({ pid: 2147483647 }));
  writeFileSync(replacement, JSON.stringify({ pid: 2147483647 }));
  ageRun(old.path);
  f.fill();
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  vi.mocked(fs.openSync).mockImplementationOnce((...args) => {
    rmSync(marker);
    symlinkSync(replacement, marker);
    return actual.openSync(...args);
  });
  f.collect();
  expect(existsSync(old.path)).toBe(true);
  expect(old.record.status).not.toBe("cleaned");
});

it("releases its open file without deleting a replacement owner's marker", async () => {
  const f = fixture();
  const path = join(f.root, randomUUID());
  ownSnapshotRun(f.project, path);
  const marker = join(path, ".capture-owner.json");
  const previous = join(path, "previous-owner.json");
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  vi.mocked(fs.ftruncateSync).mockImplementationOnce((...args) => {
    actual.renameSync(marker, previous);
    writeFileSync(marker, JSON.stringify({ version: 1, pid: 1 }));
    return actual.ftruncateSync(...args);
  });
  releaseSnapshotRun(f.project, path);
  expect(JSON.parse(readFileSync(marker, "utf8")).pid).toBe(1);
  expect(JSON.parse(readFileSync(previous, "utf8")).released).toBe(true);
});

it("does not modify a hard-linked owner file outside snapshot storage", () => {
  const f = fixture();
  const old = f.run();
  const outside = join(f.project, "external-owner.json");
  const contents = JSON.stringify({ version: 1, pid: process.pid });
  writeFileSync(outside, contents);
  linkSync(outside, join(old.path, ".capture-owner.json"));
  releaseSnapshotRun(f.project, old.path);
  expect(readFileSync(outside, "utf8")).toBe(contents);
  ageRun(old.path);
  f.fill();
  f.collect();
  expect(existsSync(old.path)).toBe(true);
});

it("keeps a run whose pathname is replaced after opening its owner", async () => {
  const f = fixture();
  const old = f.run();
  const marker = join(old.path, ".capture-owner.json");
  writeFileSync(marker, JSON.stringify({ pid: 2147483647 }));
  ageRun(old.path);
  f.fill();
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  vi.mocked(fs.openSync).mockImplementationOnce((...args) => {
    const fd = actual.openSync(...args);
    actual.renameSync(marker, join(old.path, "previous-owner.json"));
    writeFileSync(marker, JSON.stringify({ pid: process.pid }));
    return fd;
  });
  f.collect();
  expect(existsSync(old.path)).toBe(true);
  expect(old.record.status).not.toBe("cleaned");
});

it("does not release an owned marker hard-linked elsewhere after creation", () => {
  const f = fixture();
  const path = join(f.root, randomUUID());
  ownSnapshotRun(f.project, path);
  const marker = join(path, ".capture-owner.json");
  const outside = join(f.project, "linked-owner.json");
  linkSync(marker, outside);
  const contents = readFileSync(outside, "utf8");
  releaseSnapshotRun(f.project, path);
  expect(readFileSync(outside, "utf8")).toBe(contents);
});
