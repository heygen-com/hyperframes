import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { openProjectHistory } from "./projectHistory.js";
import {
  beginArtifactCapture,
  recordArtifacts,
  recordRenderSuccess,
  type VideoState,
} from "./videoState.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});
async function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), "hf-artifact-cleanup-"));
  const projectDir = join(root, "project");
  fs.mkdirSync(projectDir);
  fs.writeFileSync(join(projectDir, "index.html"), "initial");
  const history = await openProjectHistory({ projectDir, historyRoot: join(root, "history") });
  cleanup.push(async () => {
    await history.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const state = (): VideoState =>
    JSON.parse(fs.readFileSync(join(projectDir, ".hyperframes/video-state.json"), "utf8"));
  const output = join(projectDir, ".hyperframes", "out.mp4");
  fs.writeFileSync(output, "video");
  async function edit(text: string) {
    const window = await history.beginWindow({ kind: "person", name: "You" }, "Edit");
    fs.writeFileSync(join(projectDir, "index.html"), text);
    await window.close();
    return state().currentRevision!;
  }
  async function artifacts(id: string, custom = false) {
    const capture = await beginArtifactCapture(projectDir);
    const image = join(
      projectDir,
      custom ? "custom.png" : `.hyperframes/artifacts/snapshots/${id}.png`,
    );
    const report = join(projectDir, `.hyperframes/artifacts/checks/${id}.json`);
    for (const path of [image, report]) {
      fs.mkdirSync(join(path, ".."), { recursive: true });
      fs.writeFileSync(path, id);
    }
    await recordArtifacts(projectDir, capture, [
      { kind: "snapshot", id, scope: "full", image, time: 1 },
      { kind: "check", id, scope: "project", report, metadata: { ok: true } },
    ]);
    return { image, report };
  }
  const render = async () =>
    recordRenderSuccess(
      fs.realpathSync(projectDir),
      output,
      "completed",
      await beginArtifactCapture(projectDir),
    );
  return { projectDir, state, edit, artifacts, render, output };
}

it("retains current and last two rendered revisions, tombstones old artifacts, and preserves tombstones on later writes", async () => {
  const f = await fixture();
  const r1 = await f.edit("one"),
    a1 = await f.artifacts("one");
  await f.render();
  const r2 = await f.edit("two"),
    a2 = await f.artifacts("two");
  await f.render();
  await f.render();
  expect(fs.existsSync(a1.image)).toBe(true);
  const r3 = await f.edit("three"),
    a3 = await f.artifacts("three");
  await f.render();
  const s = f.state();
  expect(s.renders?.retainedRevisions).toEqual([r3, r2]);
  expect(fs.existsSync(a1.image)).toBe(false);
  expect(fs.existsSync(a1.report)).toBe(false);
  for (const a of [a2, a3]) {
    expect(fs.existsSync(a.image)).toBe(true);
    expect(fs.existsSync(a.report)).toBe(true);
  }
  expect(s.snapshots.revisions[r1][0]).toMatchObject({ status: "cleaned", revision: r1, time: 1 });
  expect(s.snapshots.revisions[r1][0].image).toBeUndefined();
  expect(s.checks.revisions[r1][0].metadata).toEqual({ ok: true });
  expect(s.snapshots.latest?.revision).toBe(r3);
  await f.artifacts("later");
  expect(f.state().snapshots.revisions[r1][0].status).toBe("cleaned");
  expect(fs.existsSync(f.output)).toBe(true);
});

it("does not clean on missing output, unknown revision, or changed render inputs", async () => {
  const f = await fixture();
  await f.edit("one");
  const a = await f.artifacts("one");
  await f.render();
  await f.edit("two");
  await f.render();
  await f.edit("three");
  const capture = await beginArtifactCapture(f.projectDir);
  await expect(
    recordRenderSuccess(f.projectDir, join(f.projectDir, "missing.mp4"), "completed", capture),
  ).rejects.toThrow();
  await recordRenderSuccess(f.projectDir, f.output);
  expect(fs.existsSync(a.image)).toBe(true);
  await f.edit("four");
  await recordRenderSuccess(f.projectDir, f.output, "completed", capture);
  expect(f.state().renders?.latest?.revision).toBeNull();
  expect(fs.existsSync(a.image)).toBe(true);
});

it("preserves custom paths, unversioned results, overwritten files and symlink targets", async () => {
  const f = await fixture();
  const unversioned = await f.artifacts("unversioned");
  await f.edit("one");
  const custom = await f.artifacts("custom", true);
  const changed = await f.artifacts("changed"),
    linked = await f.artifacts("linked");
  fs.writeFileSync(changed.image, "new writer");
  fs.unlinkSync(linked.image);
  fs.symlinkSync(custom.image, linked.image);
  await f.render();
  await f.edit("two");
  await f.render();
  await f.edit("three");
  await f.render();
  for (const p of [
    unversioned.image,
    unversioned.report,
    custom.image,
    changed.image,
    linked.image,
  ])
    expect(fs.existsSync(p)).toBe(true);
});

it("keeps a newer current revision when an older render completes", async () => {
  const f = await fixture();
  await f.edit("one");
  await f.render();
  await f.edit("two");
  const capture = await beginArtifactCapture(f.projectDir);
  await f.edit("three");
  const a = await f.artifacts("three");
  await recordRenderSuccess(f.projectDir, f.output, "completed", capture);
  expect(fs.existsSync(a.image)).toBe(true);
  expect(f.state().renders?.latest?.revision).toBeNull();
});

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "persists deletion work before unlink and retries failures without exposing dead paths",
  async () => {
    const f = await fixture();
    const r1 = await f.edit("one"),
      a = await f.artifacts("one");
    await f.render();
    await f.edit("two");
    await f.render();
    await f.edit("three");
    const directory = join(a.image, "..");
    fs.chmodSync(directory, 0o555);
    cleanup.unshift(async () => {
      fs.chmodSync(directory, 0o755);
    });
    await f.render();
    expect(f.state().pendingArtifactCleanup).toHaveLength(1);
    expect(fs.existsSync(a.image)).toBe(true);
    expect(f.state().snapshots.revisions[r1][0].image).toBeUndefined();
    fs.chmodSync(directory, 0o755);
    await f.render();
    expect(fs.existsSync(a.image)).toBe(false);
    expect(f.state().pendingArtifactCleanup).toEqual([]);
  },
);
