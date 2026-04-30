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

  it("rolls back files already written when a later file write fails", async () => {
    const reads: Record<string, string> = {
      "index.html": "index-before",
      "scene.html": "scene-before",
    };
    const writes: Array<[string, string]> = [];
    const recordEdit = vi.fn();

    await expect(
      saveProjectFilesWithHistory({
        projectId: "project-1",
        label: "Move layer",
        kind: "manual",
        files: {
          "index.html": "index-after",
          "scene.html": "scene-after",
        },
        readFile: async (path) => reads[path],
        writeFile: async (path, content) => {
          writes.push([path, content]);
          if (path === "scene.html") {
            throw new Error("disk full");
          }
        },
        recordEdit,
      }),
    ).rejects.toThrow("disk full");

    expect(writes).toEqual([
      ["index.html", "index-after"],
      ["scene.html", "scene-after"],
      ["index.html", "index-before"],
    ]);
    expect(recordEdit).not.toHaveBeenCalled();
  });

  it("rolls back written files when the injected history recorder throws", async () => {
    const reads: Record<string, string> = {
      "index.html": "index-before",
      "scene.html": "scene-before",
    };
    const writes: Array<[string, string]> = [];

    await expect(
      saveProjectFilesWithHistory({
        projectId: "project-1",
        label: "Move layer",
        kind: "manual",
        files: {
          "index.html": "index-after",
          "scene.html": "scene-after",
        },
        readFile: async (path) => reads[path],
        writeFile: async (path, content) => {
          writes.push([path, content]);
        },
        recordEdit: async () => {
          throw new Error("history unavailable");
        },
      }),
    ).rejects.toThrow("history unavailable");

    expect(writes).toEqual([
      ["index.html", "index-after"],
      ["scene.html", "scene-after"],
      ["scene.html", "scene-before"],
      ["index.html", "index-before"],
    ]);
  });

  it("reports rollback failure with the original write failure", async () => {
    const reads: Record<string, string> = {
      "index.html": "index-before",
      "scene.html": "scene-before",
    };
    const writes: Array<[string, string]> = [];

    await expect(
      saveProjectFilesWithHistory({
        projectId: "project-1",
        label: "Move layer",
        kind: "manual",
        files: {
          "index.html": "index-after",
          "scene.html": "scene-after",
        },
        readFile: async (path) => reads[path],
        writeFile: async (path, content) => {
          writes.push([path, content]);
          if (path === "scene.html" && content === "scene-after") {
            throw new Error("write denied");
          }
          if (path === "index.html" && content === "index-before") {
            throw new Error("rollback denied");
          }
        },
        recordEdit: vi.fn(),
      }),
    ).rejects.toThrow("rollback did not complete");

    expect(writes).toEqual([
      ["index.html", "index-after"],
      ["scene.html", "scene-after"],
      ["index.html", "index-before"],
    ]);
  });
});
