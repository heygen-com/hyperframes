import { describe, expect, it, vi } from "vitest";
import { saveProjectFilesWithHistory } from "./studioFileHistory";

describe("saveProjectFilesWithHistory", () => {
  it("reads before content, writes after content, and records a history entry", async () => {
    const reads: Record<string, string> = { "index.html": "before" };
    const writes: Record<string, string> = {};
    const recordEdit = vi.fn();

    await saveProjectFilesWithHistory({
      projectId: "project-1",
      label: "Move layer",
      kind: "manual",
      files: { "index.html": "after" },
      readFile: async (path) => reads[path],
      writeFile: async (path, content) => {
        writes[path] = content;
      },
      recordEdit,
    });

    expect(writes).toEqual({ "index.html": "after" });
    expect(recordEdit).toHaveBeenCalledWith({
      label: "Move layer",
      kind: "manual",
      coalesceKey: undefined,
      files: { "index.html": { before: "before", after: "after" } },
    });
  });

  it("skips writes and history for unchanged content", async () => {
    const writeFile = vi.fn();
    const recordEdit = vi.fn();

    const changedPaths = await saveProjectFilesWithHistory({
      projectId: "project-1",
      label: "Edit layer",
      kind: "manual",
      files: { "index.html": "same" },
      readFile: async () => "same",
      writeFile,
      recordEdit,
    });

    expect(changedPaths).toEqual([]);
    expect(writeFile).not.toHaveBeenCalled();
    expect(recordEdit).not.toHaveBeenCalled();
  });
});
