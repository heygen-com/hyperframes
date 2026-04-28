import { beforeEach, describe, expect, it } from "vitest";
import { buildEditHistoryEntry, createEmptyEditHistory, pushEditHistoryEntry } from "./editHistory";
import {
  createMemoryEditHistoryStorage,
  loadEditHistoryState,
  saveEditHistoryState,
} from "./editHistoryStorage";

describe("edit history storage", () => {
  let storage: ReturnType<typeof createMemoryEditHistoryStorage>;

  beforeEach(() => {
    storage = createMemoryEditHistoryStorage();
  });

  it("returns empty history for projects without persisted state", async () => {
    const state = await loadEditHistoryState(storage, "project-1");

    expect(state).toEqual(createEmptyEditHistory());
  });

  it("saves and loads history per project", async () => {
    const entry = buildEditHistoryEntry({
      id: "entry-1",
      projectId: "project-1",
      label: "Move layer",
      files: { "index.html": { before: "a", after: "b" } },
      now: 100,
    });
    const state = pushEditHistoryEntry(createEmptyEditHistory(), entry);

    await saveEditHistoryState(storage, "project-1", state);

    expect(await loadEditHistoryState(storage, "project-1")).toEqual(state);
    expect(await loadEditHistoryState(storage, "project-2")).toEqual(createEmptyEditHistory());
  });
});
