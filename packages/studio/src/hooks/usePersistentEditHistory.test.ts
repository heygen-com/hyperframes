import { describe, expect, it } from "vitest";
import type { EditHistoryStorageAdapter } from "../utils/editHistoryStorage";
import { createMemoryEditHistoryStorage } from "../utils/editHistoryStorage";
import {
  createPersistentEditHistoryController,
  createPersistentEditHistoryStore,
} from "./usePersistentEditHistory";

describe("createPersistentEditHistoryController", () => {
  it("records history and reloads it for the same project", async () => {
    const storage = createMemoryEditHistoryStorage();
    const first = await createPersistentEditHistoryController({
      projectId: "project-1",
      storage,
      now: () => 100,
      onChange: () => {},
    });

    await first.recordEdit({
      label: "Move layer",
      kind: "manual",
      files: { "index.html": { before: "a", after: "b" } },
    });

    const second = await createPersistentEditHistoryController({
      projectId: "project-1",
      storage,
      now: () => 200,
      onChange: () => {},
    });

    expect(second.snapshot().canUndo).toBe(true);
    expect(second.snapshot().undoLabel).toBe("Move layer");
    expect(second.snapshot().undoPaths).toEqual(["index.html"]);
  });

  it("undo applies files through the provided callback and persists redo state", async () => {
    const storage = createMemoryEditHistoryStorage();
    const controller = await createPersistentEditHistoryController({
      projectId: "project-1",
      storage,
      now: () => 100,
      onChange: () => {},
    });
    await controller.recordEdit({
      label: "Move layer",
      kind: "manual",
      files: { "index.html": { before: "a", after: "b" } },
    });

    const result = await controller.undo({
      readCurrentHashes: async () => ({ "index.html": "e70c2de5" }),
      writeFiles: async (files) => {
        expect(files).toEqual({ "index.html": "a" });
      },
    });
    expect(result.ok).toBe(true);

    expect(controller.snapshot().canUndo).toBe(false);
    expect(controller.snapshot().canRedo).toBe(true);
    expect(controller.snapshot().redoPaths).toEqual(["index.html"]);
  });

  it("keeps in-memory history when storage saves fail", async () => {
    const storage: EditHistoryStorageAdapter = {
      async get() {
        return null;
      },
      async set() {
        throw new Error("IndexedDB unavailable");
      },
      async delete() {},
    };
    const controller = await createPersistentEditHistoryController({
      projectId: "project-1",
      storage,
      now: () => 100,
      onChange: () => {},
    });

    await expect(
      controller.recordEdit({
        label: "Move layer",
        kind: "manual",
        files: { "index.html": { before: "a", after: "b" } },
      }),
    ).resolves.toBeUndefined();

    expect(controller.snapshot().canUndo).toBe(true);
  });

  it("serializes concurrent record edits against the latest state", async () => {
    const storage = createMemoryEditHistoryStorage();
    let timestamp = 100;
    const store = createPersistentEditHistoryStore({
      projectId: "project-1",
      storage,
      initialState: { undo: [], redo: [] },
      now: () => timestamp++,
      onChange: () => {},
    });

    await Promise.all([
      store.recordEdit({
        label: "Move layer",
        kind: "manual",
        files: { "index.html": { before: "a", after: "b" } },
      }),
      store.recordEdit({
        label: "Resize layer",
        kind: "manual",
        files: { "index.html": { before: "b", after: "c" } },
      }),
    ]);

    expect(store.snapshot().state.undo.map((entry) => entry.label)).toEqual([
      "Move layer",
      "Resize layer",
    ]);
  });

  it("still coalesces concurrent source edits that share a coalesce key", async () => {
    const storage = createMemoryEditHistoryStorage();
    let timestamp = 100;
    const store = createPersistentEditHistoryStore({
      projectId: "project-1",
      storage,
      initialState: { undo: [], redo: [] },
      now: () => timestamp++,
      onChange: () => {},
    });

    await Promise.all([
      store.recordEdit({
        label: "Edit source",
        kind: "source",
        coalesceKey: "source:index.html",
        files: { "index.html": { before: "a", after: "b" } },
      }),
      store.recordEdit({
        label: "Edit source",
        kind: "source",
        coalesceKey: "source:index.html",
        files: { "index.html": { before: "b", after: "c" } },
      }),
    ]);

    expect(store.snapshot().state.undo).toHaveLength(1);
    expect(store.snapshot().state.undo[0].files["index.html"].before).toBe("a");
    expect(store.snapshot().state.undo[0].files["index.html"].after).toBe("c");
  });
});
