import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openProjectHistory, type ProjectHistory } from "./projectHistory.js";
import {
  recordRenderSuccess,
  artifactDirectory,
  beginArtifactCapture,
  recordArtifact,
  recordArtifacts,
  forgetRecordedArtifacts,
  VideoStateCorruptError,
  type VideoState,
} from "./videoState.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const person = { kind: "person", name: "You" } as const;
function read(dir: string): VideoState {
  return JSON.parse(readFileSync(join(dir, ".hyperframes/video-state.json"), "utf8"));
}
async function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "hf-video-state-"));
  const projectDir = join(root, "project");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(projectDir);
  writeFileSync(join(projectDir, "index.html"), "initial");
  let history: ProjectHistory = await openProjectHistory({
    projectDir,
    historyRoot: join(root, "history"),
    ...options,
  });
  cleanups.push(async () => {
    await history.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    projectDir,
    get history() {
      return history;
    },
    async reopen() {
      await history.close();
      history = await openProjectHistory({
        projectDir,
        historyRoot: join(root, "history"),
        ...options,
      });
    },
    async edit(text: string) {
      const window = await history.beginWindow(person, "Edit title");
      writeFileSync(join(projectDir, "index.html"), text);
      await window.close();
      return read(projectDir).currentRevision!;
    },
  };
}

describe("video state", () => {
  it("projects real committed history and blob paths, pending writes, undo and redo", async () => {
    const f = await fixture();
    expect(read(f.projectDir).currentRevision).toBeNull();
    const first = await f.edit("first");
    const state = read(f.projectDir);
    expect(state.pendingChanges).toBe(false);
    expect(readFileSync(state.revisions[first].files["index.html"].before!, "utf8")).toBe(
      "initial",
    );
    expect(readFileSync(state.revisions[first].files["index.html"].after!, "utf8")).toBe("first");
    const window = await f.history.beginWindow(person, "Pending");
    writeFileSync(join(f.projectDir, "index.html"), "pending");
    f.history.noteChange("index.html");
    await new Promise((r) => setTimeout(r, 80));
    expect(read(f.projectDir).pendingChanges).toBe(true);
    expect(read(f.projectDir).currentRevision).toBe(first);
    await window.close();
    const second = read(f.projectDir).currentRevision!;
    await f.history.step("back", person);
    expect(read(f.projectDir).revisions[read(f.projectDir).currentRevision!].undoes).toBe(second);
    await f.history.step("forward", person);
    expect(readFileSync(join(f.projectDir, "index.html"), "utf8")).toBe("pending");
    const count = Object.keys(read(f.projectDir).revisions).length;
    await f.history.flush();
    expect(Object.keys(read(f.projectDir).revisions)).toHaveLength(count);
  });

  it("merges concurrent artifacts and history updates and retains records on restart", async () => {
    const f = await fixture();
    const revision = await f.edit("first");
    const capture = await beginArtifactCapture(f.projectDir);
    const image = join(f.projectDir, ".hyperframes/frame.png");
    const report = join(f.projectDir, ".hyperframes/check.json");
    writeFileSync(image, "png");
    writeFileSync(report, "{}");
    await Promise.all([
      recordArtifact(f.projectDir, capture, {
        kind: "snapshot",
        id: "s1",
        time: 3,
        scope: "full",
        image,
      }),
      recordArtifact(f.projectDir, capture, {
        kind: "snapshot",
        id: "s2",
        time: 8,
        scope: "full",
        image: report,
      }),
      recordArtifact(f.projectDir, capture, { kind: "check", id: "c1", scope: "project", report }),
      f.history.flush(),
    ]);
    expect(read(f.projectDir).snapshots.revisions[revision]).toHaveLength(2);
    expect(read(f.projectDir).checks.latest).toEqual({ revision, id: "c1" });
    await f.reopen();
    expect(read(f.projectDir).snapshots.revisions[revision]).toHaveLength(2);
    await recordArtifact(f.projectDir, capture, {
      kind: "snapshot",
      id: "s3",
      time: 4,
      scope: "full",
      image,
    });
    expect(read(f.projectDir).snapshots.revisions[revision].map((x) => x.id)).toEqual(["s2", "s3"]);
  });

  it("does not attribute changed or uncommitted files to a revision", async () => {
    const f = await fixture();
    const noRevision = await beginArtifactCapture(f.projectDir);
    expect(noRevision.revision).toBeNull();
    await f.edit("first");
    const capture = await beginArtifactCapture(f.projectDir);
    writeFileSync(join(f.projectDir, "index.html"), "outside");
    const image = join(f.projectDir, ".hyperframes/frame.png");
    writeFileSync(image, "png");
    await recordArtifact(f.projectDir, capture, {
      kind: "snapshot",
      id: "s1",
      time: 1,
      scope: "full",
      image,
    });
    expect(read(f.projectDir).snapshots.latest?.revision).toBeNull();
    expect(read(f.projectDir).snapshots.unversioned[0].attribution).toBe("inputs-changed");
    expect((await beginArtifactCapture(f.projectDir)).revision).toBeNull();
  });

  it("removes pruned revision metadata and artifact associations", async () => {
    const f = await fixture({ budgetBytes: 10 });
    const first = await f.edit("first");
    const capture = await beginArtifactCapture(f.projectDir);
    const image = join(f.projectDir, ".hyperframes/old.png");
    writeFileSync(image, "png");
    await recordArtifact(f.projectDir, capture, {
      kind: "snapshot",
      id: "old",
      time: 1,
      scope: "full",
      image,
    });
    expect(read(f.projectDir).snapshots.revisions[first]).toHaveLength(1);
    await f.edit("second");
    const state = read(f.projectDir);
    expect(Object.keys(state.revisions)).toEqual(f.history.list().map((x) => x.id));
    expect(state.revisions[first]).toBeUndefined();
    expect(state.snapshots.revisions[first]).toBeUndefined();
    expect(state.snapshots.latest).toBeNull();
    expect(artifactDirectory(f.projectDir, "snapshots")).not.toBe(
      artifactDirectory(f.projectDir, "snapshots"),
    );
  });
  it("batches multiple frames without storing a second log or file versions", async () => {
    const f = await fixture();
    const revision = await f.edit("first");
    const capture = await beginArtifactCapture(f.projectDir);
    const image = join(f.projectDir, ".hyperframes/one.png");
    const second = join(f.projectDir, ".hyperframes/two.png");
    writeFileSync(image, "first image");
    writeFileSync(second, "second image");
    await recordArtifacts(f.projectDir, capture, [
      { kind: "snapshot", id: "s1", time: 1, scope: "full", image },
      { kind: "snapshot", id: "s2", time: 2, scope: "#title", image: second },
    ]);
    expect(read(f.projectDir).snapshots.revisions[revision]).toHaveLength(2);
    expect(read(f.projectDir).snapshots.revisions[revision][0].contentHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(readdirSync(join(f.projectDir, ".hyperframes"))).not.toContain("events.jsonl");
    expect(readdirSync(join(f.projectDir, ".hyperframes"))).not.toContain("blobs");
  });

  it("drops a record when a later run replaces the file without recording", async () => {
    const f = await fixture();
    const revision = await f.edit("first");
    const capture = await beginArtifactCapture(f.projectDir);
    const image = join(f.projectDir, "snapshots", "frame.png");
    mkdirSync(join(f.projectDir, "snapshots"));
    writeFileSync(image, "first image");
    await recordArtifacts(f.projectDir, capture, [
      { kind: "snapshot", id: "s1", time: 1, scope: "full", image },
    ]);
    writeFileSync(image, "replaced image");
    await forgetRecordedArtifacts(f.projectDir, [image]);
    const state = read(f.projectDir);
    expect(state.snapshots.revisions[revision] ?? []).toEqual([]);
    expect(state.snapshots.latest).toBeNull();
  });

  it("restores a damaged state from the backup instead of starting over", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = await fixture();
    const revision = await f.edit("first");
    const statePath = join(f.projectDir, ".hyperframes/video-state.json");
    writeFileSync(statePath, "{bad");
    await f.history.flush();
    expect(read(f.projectDir).currentRevision).toBe(revision);
    const aside = readdirSync(join(f.projectDir, ".hyperframes")).find((name) =>
      name.startsWith("video-state.json.invalid-"),
    );
    expect(aside).toBeDefined();
    expect(readFileSync(join(f.projectDir, ".hyperframes", aside!), "utf8")).toBe("{bad");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("restored the last published state"));
    warn.mockRestore();
  });

  it("keeps a damaged state and reports it when no backup can be restored", async () => {
    const errors: unknown[] = [];
    const f = await fixture({ onError: (error: unknown) => errors.push(error) });
    await f.edit("first");
    const statePath = join(f.projectDir, ".hyperframes/video-state.json");
    rmSync(join(f.projectDir, ".hyperframes/video-state.json.bak"));
    writeFileSync(statePath, '{"version":1,"historyId":');
    await f.history.flush();
    expect(readFileSync(statePath, "utf8")).toBe('{"version":1,"historyId":');
    const failure = errors.find((error) => error instanceof VideoStateCorruptError);
    expect(failure).toBeInstanceOf(VideoStateCorruptError);
    expect((failure as VideoStateCorruptError).message).toContain(statePath);
    expect((failure as VideoStateCorruptError).message).toContain("delete it");
    expect(
      readdirSync(join(f.projectDir, ".hyperframes")).some((name) =>
        name.startsWith("video-state.json.invalid-"),
      ),
    ).toBe(false);
  });

  it("rejects a write over a damaged state that has no backup", async () => {
    const f = await fixture();
    await f.edit("first");
    const statePath = join(f.projectDir, ".hyperframes/video-state.json");
    rmSync(join(f.projectDir, ".hyperframes/video-state.json.bak"));
    writeFileSync(statePath, "NUL".repeat(64));
    await expect(
      forgetRecordedArtifacts(f.projectDir, [join(f.projectDir, "gone.png")]),
    ).rejects.toThrow(VideoStateCorruptError);
    expect(readFileSync(statePath, "utf8")).toBe("NUL".repeat(64));
  });

  it("rejects a state file symlink outside the project", async () => {
    const f = await fixture();
    const outsideDir = mkdtempSync(join(tmpdir(), "hf-state-outside-"));
    const outside = join(outsideDir, "video-state.json");
    cleanups.unshift(async () => {
      rmSync(outsideDir, { recursive: true, force: true });
    });
    writeFileSync(outside, "untouched");
    const path = join(f.projectDir, ".hyperframes/video-state.json");
    rmSync(path);
    symlinkSync(outside, path);
    await expect(beginArtifactCapture(f.projectDir)).rejects.toThrow("inside the project");
    expect(readFileSync(outside, "utf8")).toBe("untouched");
  });
  it("keeps coalesced DOM target provenance in history and its state projection", async () => {
    const f = await fixture();
    const targets = [{ file: "index.html", id: "title" }];
    writeFileSync(join(f.projectDir, "index.html"), "one");
    await f.history.claim(person, "Drag", ["index.html"], { coalesceKey: "drag", targets });
    writeFileSync(join(f.projectDir, "index.html"), "two");
    await f.history.claim(person, "Drag", ["index.html"], {
      coalesceKey: "drag",
      targets: [...targets, { file: "index.html", selector: ".word", selectorIndex: 2 }],
    });
    await f.history.flush();
    expect(f.history.list()).toHaveLength(1);
    const expected = [...targets, { file: "index.html", selector: ".word", selectorIndex: 2 }];
    expect(f.history.list()[0].targets).toEqual(expected);
    const revision = read(f.projectDir).currentRevision!;
    expect(read(f.projectDir).revisions[revision].targets).toEqual(expected);
    await f.reopen();
    expect(f.history.list()[0].targets).toEqual(expected);
    await f.history.step("back", person);
    expect(f.history.list().at(-1)?.targets).toEqual(expected);
    expect(read(f.projectDir).revisions[read(f.projectDir).currentRevision!].targets).toEqual(
      expected,
    );
  });
});

it("records each successful render without replacing revision or artifact state", async () => {
  const { projectDir } = await fixture();
  const before = read(projectDir);
  writeFileSync(join(projectDir, "out.mp4"), "video");
  const first = await recordRenderSuccess(projectDir, join(projectDir, "out.mp4"));
  const second = await recordRenderSuccess(
    projectDir,
    join(projectDir, "out.mp4"),
    "completed_with_warnings",
  );
  expect(second.id).not.toBe(first.id);
  const state = read(projectDir);
  expect(state.renders?.latest).toEqual(second);
  expect(state.renders?.latest?.status).toBe("completed_with_warnings");
  expect(state.revisions).toEqual(before.revisions);
  expect(state.checks).toEqual(before.checks);
});
