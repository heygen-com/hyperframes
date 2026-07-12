// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  addStudioPendingEditFlushListener,
  flushStudioPendingEdits,
  trackStudioPendingEdit,
} from "./studioPendingEdits";

describe("studio pending edit flush", () => {
  it("waits for mounted panels to persist pending local edits", async () => {
    const persist = vi.fn(async () => undefined);
    const remove = addStudioPendingEditFlushListener(persist);

    try {
      await flushStudioPendingEdits();
      expect(persist).toHaveBeenCalledTimes(1);
    } finally {
      remove();
    }
  });

  it("waits for edits already started by unmounted panels", async () => {
    const steps: string[] = [];
    let resolvePersist!: () => void;
    trackStudioPendingEdit(
      new Promise<void>((resolve) => {
        resolvePersist = resolve;
      }).then(() => {
        steps.push("persisted");
      }),
    );

    const flushed = flushStudioPendingEdits().then(() => {
      steps.push("flushed");
    });
    await Promise.resolve();
    expect(steps).toEqual([]);

    resolvePersist();
    await flushed;
    expect(steps).toEqual(["persisted", "flushed"]);
  });
});
