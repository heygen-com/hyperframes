import { describe, expect, it } from "vitest";
import {
  buildEditHistoryEntry,
  canApplyEditHistoryEntry,
  createEmptyEditHistory,
  hashEditHistoryContent,
  pushEditHistoryEntry,
  redoEditHistory,
  undoEditHistory,
} from "./editHistory";

describe("edit history", () => {
  it("pushes changed file snapshots onto undo and clears redo", () => {
    const state = createEmptyEditHistory();
    const entry = buildEditHistoryEntry({
      projectId: "project-1",
      label: "Move layer",
      files: {
        "index.html": {
          before: '<div style="left: 0px"></div>',
          after: '<div style="left: 20px"></div>',
        },
      },
      now: 100,
      id: "entry-1",
    });

    const withUndo = pushEditHistoryEntry(state, entry);
    const redoEntry = buildEditHistoryEntry({
      projectId: "project-1",
      label: "Redoable edit",
      files: {
        "index.html": {
          before: '<div style="left: 20px"></div>',
          after: '<div style="left: 40px"></div>',
        },
      },
      now: 200,
      id: "redo-entry",
    });

    const next = pushEditHistoryEntry(
      {
        ...withUndo,
        redo: [redoEntry],
      },
      {
        ...entry,
        id: "entry-2",
        label: "Resize layer",
        createdAt: 300,
      },
    );

    expect(withUndo.undo).toHaveLength(1);
    expect(withUndo.redo).toHaveLength(0);
    expect(next.undo.map((item) => item.label)).toEqual(["Move layer", "Resize layer"]);
    expect(next.redo).toHaveLength(0);
  });

  it("undo returns before contents and moves entry to redo", () => {
    const entry = buildEditHistoryEntry({
      projectId: "project-1",
      label: "Move layer",
      files: {
        "index.html": { before: "before", after: "after" },
      },
      now: 100,
      id: "entry-1",
    });
    const state = pushEditHistoryEntry(createEmptyEditHistory(), entry);

    const result = undoEditHistory(state, { "index.html": hashEditHistoryContent("after") }, 200);

    expect(result.ok).toBe(true);
    expect(result.filesToWrite).toEqual({ "index.html": "before" });
    expect(result.state.undo).toHaveLength(0);
    expect(result.state.redo.map((item) => item.id)).toEqual(["entry-1"]);
  });

  it("redo returns after contents and moves entry to undo", () => {
    const entry = buildEditHistoryEntry({
      projectId: "project-1",
      label: "Move layer",
      files: {
        "index.html": { before: "before", after: "after" },
      },
      now: 100,
      id: "entry-1",
    });
    const undone = undoEditHistory(
      pushEditHistoryEntry(createEmptyEditHistory(), entry),
      { "index.html": hashEditHistoryContent("after") },
      200,
    ).state;

    const result = redoEditHistory(undone, { "index.html": hashEditHistoryContent("before") }, 300);

    expect(result.ok).toBe(true);
    expect(result.filesToWrite).toEqual({ "index.html": "after" });
    expect(result.state.undo.map((item) => item.id)).toEqual(["entry-1"]);
    expect(result.state.redo).toHaveLength(0);
  });

  it("blocks undo when current content hash does not match the recorded after hash", () => {
    const entry = buildEditHistoryEntry({
      projectId: "project-1",
      label: "Move layer",
      files: {
        "index.html": { before: "before", after: "after" },
      },
      now: 100,
      id: "entry-1",
    });
    const state = pushEditHistoryEntry(createEmptyEditHistory(), entry);

    const result = undoEditHistory(
      state,
      { "index.html": hashEditHistoryContent("external") },
      200,
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("content-mismatch");
    expect(result.state).toBe(state);
    expect(result.filesToWrite).toEqual({});
  });

  it("can validate all files in a multi-file entry before applying", () => {
    const entry = buildEditHistoryEntry({
      projectId: "project-1",
      label: "Update files",
      files: {
        "index.html": { before: "a", after: "b" },
        "compositions/title.html": { before: "c", after: "d" },
      },
      now: 100,
      id: "entry-1",
    });

    expect(
      canApplyEditHistoryEntry(entry, "undo", {
        "index.html": hashEditHistoryContent("b"),
        "compositions/title.html": hashEditHistoryContent("d"),
      }),
    ).toEqual({ ok: true });
    expect(
      canApplyEditHistoryEntry(entry, "undo", {
        "index.html": hashEditHistoryContent("b"),
        "compositions/title.html": hashEditHistoryContent("external"),
      }),
    ).toEqual({ ok: false, reason: "content-mismatch", path: "compositions/title.html" });
  });

  it("prunes oldest undo entries when the limit is exceeded", () => {
    let state = createEmptyEditHistory({ maxEntries: 2 });
    for (let index = 1; index <= 3; index += 1) {
      state = pushEditHistoryEntry(
        state,
        buildEditHistoryEntry({
          projectId: "project-1",
          label: `Edit ${index}`,
          files: {
            "index.html": { before: `${index - 1}`, after: `${index}` },
          },
          now: index,
          id: `entry-${index}`,
        }),
        { maxEntries: 2 },
      );
    }

    expect(state.undo.map((entry) => entry.id)).toEqual(["entry-2", "entry-3"]);
  });

  it("coalesces source editor edits for the same file inside the coalesce window", () => {
    const first = buildEditHistoryEntry({
      projectId: "project-1",
      label: "Edit source",
      kind: "source",
      coalesceKey: "source:index.html",
      files: {
        "index.html": { before: "a", after: "b" },
      },
      now: 100,
      id: "entry-1",
    });
    const second = buildEditHistoryEntry({
      projectId: "project-1",
      label: "Edit source",
      kind: "source",
      coalesceKey: "source:index.html",
      files: {
        "index.html": { before: "b", after: "c" },
      },
      now: 300,
      id: "entry-2",
    });

    const state = pushEditHistoryEntry(
      pushEditHistoryEntry(createEmptyEditHistory(), first),
      second,
      { coalesceMs: 1000 },
    );

    expect(state.undo).toHaveLength(1);
    expect(state.undo[0].id).toBe("entry-2");
    expect(state.undo[0].files["index.html"].before).toBe("a");
    expect(state.undo[0].files["index.html"].after).toBe("c");
  });

  it("does not coalesce source editor edits outside the coalesce window", () => {
    const first = buildEditHistoryEntry({
      projectId: "project-1",
      label: "Edit source",
      kind: "source",
      coalesceKey: "source:index.html",
      files: {
        "index.html": { before: "a", after: "b" },
      },
      now: 100,
      id: "entry-1",
    });
    const second = buildEditHistoryEntry({
      projectId: "project-1",
      label: "Edit source",
      kind: "source",
      coalesceKey: "source:index.html",
      files: {
        "index.html": { before: "b", after: "c" },
      },
      now: 5000,
      id: "entry-2",
    });

    const state = pushEditHistoryEntry(
      pushEditHistoryEntry(createEmptyEditHistory(), first),
      second,
      { coalesceMs: 1000 },
    );

    expect(state.undo.map((entry) => entry.id)).toEqual(["entry-1", "entry-2"]);
  });
});
