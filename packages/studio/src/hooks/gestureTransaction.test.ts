// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { trackStudioEvent } from "../utils/studioTelemetry";
import type { CommitMutation } from "./gsapScriptCommitTypes";
import { runGestureTransaction } from "./gestureTransaction";

vi.mock("../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));

const trackStudioEventMock = vi.mocked(trackStudioEvent);

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, width, height } as DOMRect;
}

describe("runGestureTransaction", () => {
  beforeEach(() => {
    trackStudioEventMock.mockReset();
  });

  it("settles synchronously before persist reaches its first await", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const transaction = runGestureTransaction({
      element: document.createElement("div"),
      label: "Resize layer",
      settle: () => order.push("settle"),
      persist: async () => {
        order.push("persist");
        await gate;
        order.push("persisted");
      },
      restore: vi.fn(),
      skipPixelAssert: true,
    });

    expect(order).toEqual(["settle", "persist"]);
    release();
    await transaction;
    expect(order).toEqual(["settle", "persist", "persisted"]);
  });

  it("injects one coalesce key and reloads only the final mutation", async () => {
    const element = document.createElement("div");
    const selection = { element, id: "clip" } as DomEditSelection;
    const underlying = vi.fn<CommitMutation>().mockResolvedValue(undefined);
    const now = vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValueOnce(112.6);

    await runGestureTransaction({
      element,
      label: "Resize layer",
      settle: vi.fn(),
      persist: async (commit) => {
        const commitMutation = commit(underlying);
        await commitMutation(selection, { type: "first" }, { label: "First" });
        await commitMutation(selection, { type: "last" }, { label: "Last", softReload: true });
      },
      restore: vi.fn(),
      skipPixelAssert: true,
    });

    const firstOptions = underlying.mock.calls[0]![2];
    const lastOptions = underlying.mock.calls[1]![2];
    expect(firstOptions.coalesceKey).toBe(lastOptions.coalesceKey);
    expect(firstOptions.coalesceKey).toMatch(/^tx:Resize layer:\d+$/);
    expect(firstOptions.coalesceMs).toBe(Number.POSITIVE_INFINITY);
    expect(lastOptions.coalesceMs).toBe(Number.POSITIVE_INFINITY);
    expect(firstOptions).toMatchObject({ skipReload: true });
    expect(firstOptions.softReload).toBeUndefined();
    expect(lastOptions).toMatchObject({ softReload: true });
    expect(lastOptions.skipReload).toBeUndefined();
    expect(trackStudioEventMock).toHaveBeenCalledWith("commit_transaction", {
      label: "Resize layer",
      mutation_count: 2,
      reload_count: 1,
      duration_ms: 13,
      pixel_asserted: false,
    });
    now.mockRestore();
  });

  it("restores exactly once and rethrows a persist failure", async () => {
    const error = new Error("persist failed with secret selector #private-layer");
    error.name = "PersistenceError";
    const restore = vi.fn();
    const element = document.createElement("div");
    const selection = { element, id: "clip" } as DomEditSelection;
    const underlying = vi.fn<CommitMutation>().mockResolvedValue(undefined);

    await expect(
      runGestureTransaction({
        element,
        label: "Resize layer",
        settle: vi.fn(),
        persist: async (commit) => {
          await commit(underlying)(selection, { type: "position" }, { label: "Position" });
          throw error;
        },
        restore,
        skipPixelAssert: true,
      }),
    ).rejects.toBe(error);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(trackStudioEventMock).toHaveBeenCalledWith("commit_transaction_failed", {
      label: "Resize layer",
      mutation_count: 1,
      error_name: "PersistenceError",
      restore_ran: true,
    });
    const failureProperties = trackStudioEventMock.mock.calls.find(
      ([event]) => event === "commit_transaction_failed",
    )?.[1];
    expect(JSON.stringify(failureProperties)).not.toContain(error.message);
    expect(JSON.stringify(failureProperties)).not.toContain("#private-layer");
  });

  it("reports when persistence changes pixels", async () => {
    const element = document.createElement("div");
    const getRect = vi
      .spyOn(element, "getBoundingClientRect")
      .mockReturnValueOnce(rect(10.04, 20.05, 100.05, 80.05))
      .mockReturnValueOnce(rect(11.19, 17.89, 100.29, 78.99));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const now = vi.spyOn(performance, "now").mockReturnValueOnce(50).mockReturnValueOnce(58.44);

    await runGestureTransaction({
      element,
      label: "Resize layer",
      settle: vi.fn(),
      persist: async () => undefined,
      restore: vi.fn(),
    });

    expect(getRect).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(
      "[hf-commit] persist changed pixels",
      expect.objectContaining({
        label: "Resize layer",
        delta: expect.objectContaining({ x: expect.any(Number) }),
      }),
    );
    expect(trackStudioEventMock).toHaveBeenCalledWith("commit_invariant_violation", {
      label: "Resize layer",
      delta_x: 1.2,
      delta_y: -2.2,
      delta_w: 0.2,
      delta_h: -1.1,
      mutation_count: 0,
      reload_count: 0,
      duration_ms: 8,
    });
    expect(trackStudioEventMock).toHaveBeenCalledWith(
      "commit_transaction",
      expect.objectContaining({ pixel_asserted: true }),
    );
    now.mockRestore();
    error.mockRestore();
  });

  it("skips the pixel assertion for live position tweens", async () => {
    const element = document.createElement("div");
    const getRect = vi.spyOn(element, "getBoundingClientRect");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runGestureTransaction({
      element,
      label: "Resize layer",
      settle: vi.fn(),
      persist: async () => undefined,
      restore: vi.fn(),
      skipPixelAssert: true,
    });

    expect(getRect).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalledWith("[hf-commit] persist changed pixels", expect.anything());
    expect(trackStudioEventMock).not.toHaveBeenCalledWith(
      "commit_invariant_violation",
      expect.anything(),
    );
    error.mockRestore();
  });
});
