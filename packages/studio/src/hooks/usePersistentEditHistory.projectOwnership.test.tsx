// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { createMemoryEditHistoryStorage } from "../utils/editHistoryStorage";
import { usePersistentEditHistory } from "./usePersistentEditHistory";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flushAsyncEffects(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("usePersistentEditHistory project ownership", () => {
  it("rejects a delayed project A recorder after project B becomes active", async () => {
    const storage = createMemoryEditHistoryStorage();
    const now = () => 100;
    const captured: { history: ReturnType<typeof usePersistentEditHistory> | null } = {
      history: null,
    };

    function Probe({ projectId }: { projectId: string }) {
      captured.history = usePersistentEditHistory({ projectId, storage, now });
      return null;
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe projectId="project-a" />));
    await flushAsyncEffects();
    const recordProjectA = captured.history?.recordEdit;
    if (!recordProjectA) throw new Error("project A history did not load");

    await act(async () => root.render(<Probe projectId="project-b" />));
    await expect(
      recordProjectA({
        label: "Delayed A edit",
        kind: "manual",
        files: { "index.html": { before: "A", after: "A2" } },
      }),
    ).rejects.toThrow("inactive project project-a");
    await flushAsyncEffects();

    const recordProjectB = captured.history?.recordEdit;
    if (!recordProjectB) throw new Error("project B history did not load");
    await act(async () => {
      await recordProjectB({
        label: "B edit",
        kind: "manual",
        files: { "index.html": { before: "B", after: "B2" } },
      });
    });

    expect(await storage.get("project-a")).toBeNull();
    expect((await storage.get("project-b"))?.undo.map((entry) => entry.label)).toEqual(["B edit"]);

    await act(async () => root.unmount());
  });
});
