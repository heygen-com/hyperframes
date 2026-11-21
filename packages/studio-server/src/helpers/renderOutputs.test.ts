import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { registerRenderOutput, readRenderOutputs } from "./renderOutputs.js";
import { listProjectFilesAsync, affectsProjectSignature } from "./projectSignature.js";
import { openProjectHistory } from "../history/projectHistory.js";
import { beginArtifactCapture, recordRenderSuccess } from "../history/videoState.js";

it("keeps root render outputs out of revisions while tracking source video edits", async () => {
  const root = mkdtempSync(join(tmpdir(), "hf-render-history-"));
  const project = join(root, "project");
  mkdirSync(project);
  writeFileSync(join(project, "index.html"), "initial");
  writeFileSync(join(project, "input.mp4"), "source video");
  const history = await openProjectHistory({
    projectDir: project,
    historyRoot: join(root, "history"),
  });
  const state = () =>
    JSON.parse(readFileSync(join(project, ".hyperframes/video-state.json"), "utf8"));
  try {
    const window = await history.beginWindow({ kind: "agent", name: "test" }, "edit");
    writeFileSync(join(project, "index.html"), "edited");
    await history.checkpoint();
    const revision = state().currentRevision;
    const output = join(project, "benefits.mp4");
    await registerRenderOutput(project, output);
    const capture = await beginArtifactCapture(project);
    expect(capture.revision).toBe(revision);
    for (const bytes of ["first render", "second render"]) {
      writeFileSync(output, bytes);
      const render = await recordRenderSuccess(project, output, "completed", capture);
      expect(render.revision).toBe(revision);
      await history.checkpoint();
      expect(state().currentRevision).toBe(revision);
      expect(state().pendingChanges).toBe(false);
      expect(state().files["benefits.mp4"]).toBeUndefined();
    }
    expect(affectsProjectSignature(project, output)).toBe(false);
    expect(affectsProjectSignature(project, join(project, "input.mp4"))).toBe(true);
    writeFileSync(join(project, "input.mp4"), "updated source video");
    await window.close();
    expect(state().currentRevision).not.toBe(revision);
    expect(Object.keys(state().revisions[state().currentRevision].files)).toEqual(["input.mp4"]);
    const nextCapture = await beginArtifactCapture(project);
    writeFileSync(join(project, "index.html"), "changed during rendering");
    writeFileSync(output, "third render");
    expect(
      (await recordRenderSuccess(project, output, "completed", nextCapture)).revision,
    ).toBeNull();
  } finally {
    await history.close();
    rmSync(root, { recursive: true, force: true });
  }
});
it("registers concurrent custom outputs and directory renders without excluding other media", async () => {
  const root = mkdtempSync(join(tmpdir(), "hf-render-registry-"));
  try {
    await Promise.all([
      registerRenderOutput(root, join(root, "a.webm")),
      registerRenderOutput(root, join(root, "hls")),
    ]);
    expect(readRenderOutputs(root)).toEqual(["a.webm", "hls"]);
    mkdirSync(join(root, "hls"));
    writeFileSync(join(root, "hls", "chunk.ts"), "output");
    writeFileSync(join(root, "a.webm"), "output");
    writeFileSync(join(root, "b.webm"), "input");
    expect((await listProjectFilesAsync(root)).map((file) => file.path)).toEqual(["b.webm"]);
    await registerRenderOutput(root, join(root, "..", "external.mp4"));
    expect(readRenderOutputs(root)).toEqual(["a.webm", "hls"]);
    await expect(registerRenderOutput(root, root)).rejects.toThrow("project directory");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("lists project files when the render output registry is unreadable", async () => {
  const project = mkdtempSync(join(tmpdir(), "hf-render-registry-"));
  try {
    writeFileSync(join(project, "index.html"), "x");
    writeFileSync(join(project, ".hyperframes"), "a file, not a folder");
    expect(readRenderOutputs(project)).toEqual([]);
    rmSync(join(project, ".hyperframes"));
    mkdirSync(join(project, ".hyperframes"));
    writeFileSync(join(project, ".hyperframes", "render-outputs.json"), "{not json");
    expect(() => readRenderOutputs(project)).toThrow();
    expect((await listProjectFilesAsync(project)).length).toBeGreaterThan(0);
    expect(affectsProjectSignature(project, join(project, "index.html"))).toBe(true);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
