import { describe, expect, it, vi } from "vitest";
import {
  createAgentRunController,
  shouldCompleteActive,
  type AgentRunState,
} from "./agentRunController";
import type { TimelineComment } from "./types";

function comment(id: string): TimelineComment {
  return {
    id,
    status: "open",
    filePath: "index.html",
    rangeStart: 0,
    rangeEnd: 1,
    prompt: `prompt-${id}`,
    elements: [],
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createAgentRunController", () => {
  it("runs a single comment to completion", async () => {
    const statuses: Array<[string, AgentRunState | null]> = [];
    const settled = vi.fn();
    const d = deferred<void>();
    const controller = createAgentRunController({
      run: () => d.promise,
      onStatus: (id, s) => statuses.push([id, s]),
      onSettled: settled,
    });

    expect(controller.run(comment("a"))).toBe(true);
    expect(controller.activeId()).toBe("a");
    expect(statuses).toEqual([["a", { status: "running" }]]);

    d.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(statuses).toEqual([
      ["a", { status: "running" }],
      ["a", { status: "stopped", message: "Done." }],
    ]);
    expect(settled).toHaveBeenCalledWith("a");
    expect(controller.activeId()).toBeNull();
  });

  it("does not start another comment while one is active", async () => {
    const statuses: Array<[string, AgentRunState | null]> = [];
    const runs: string[] = [];
    const d = deferred<void>();
    const controller = createAgentRunController({
      run: (c) => {
        runs.push(c.id);
        return d.promise;
      },
      onStatus: (id, s) => statuses.push([id, s]),
    });

    expect(controller.run(comment("a"))).toBe(true);
    expect(controller.run(comment("b"))).toBe(false);

    expect(controller.activeId()).toBe("a");
    expect(runs).toEqual(["a"]);
    expect(statuses).toEqual([["a", { status: "running" }]]);

    d.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(controller.activeId()).toBeNull();
  });

  it("allows a new run after the active run settles", async () => {
    const statuses: Array<[string, AgentRunState | null]> = [];
    const deferreds = [deferred<void>(), deferred<void>()];
    let runCount = 0;
    const controller = createAgentRunController({
      run: () => deferreds[runCount++]!.promise,
      onStatus: (id, s) => statuses.push([id, s]),
    });

    expect(controller.run(comment("a"))).toBe(true);
    deferreds[0]!.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(controller.run(comment("b"))).toBe(true);
    expect(controller.activeId()).toBe("b");
    expect(statuses.find(([id, s]) => id === "b" && s?.status === "running")).toBeTruthy();

    deferreds[1]!.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(controller.activeId()).toBeNull();
  });

  it("cancels the active run via abort", async () => {
    const statuses: Array<[string, AgentRunState | null]> = [];
    const d = deferred<void>();
    const signals: AbortSignal[] = [];
    const controller = createAgentRunController({
      run: (_c, signal) => {
        signals.push(signal);
        signal.addEventListener("abort", () => d.reject(new Error("aborted")));
        return d.promise;
      },
      onStatus: (id, s) => statuses.push([id, s]),
    });

    controller.run(comment("a"));
    controller.cancel("a");
    await new Promise((r) => setTimeout(r, 0));

    expect(signals[0]!.aborted).toBe(true);
    expect(statuses).toEqual([
      ["a", { status: "running" }],
      ["a", { status: "stopped", message: "Stopped." }],
    ]);
    expect(controller.activeId()).toBeNull();
  });

  it("reports a completed run via abort as Done.", async () => {
    const statuses: Array<[string, AgentRunState | null]> = [];
    const d = deferred<void>();
    const signals: AbortSignal[] = [];
    const controller = createAgentRunController({
      run: (_c, signal) => {
        signals.push(signal);
        signal.addEventListener("abort", () => d.reject(new Error("aborted")));
        return d.promise;
      },
      onStatus: (id, s) => statuses.push([id, s]),
    });

    controller.run(comment("a"));
    controller.complete("a");
    await new Promise((r) => setTimeout(r, 0));

    expect(signals[0]!.aborted).toBe(true);
    expect(statuses).toEqual([
      ["a", { status: "running" }],
      ["a", { status: "stopped", message: "Done." }],
    ]);
    expect(controller.activeId()).toBeNull();
  });

  it("ignores complete for an inactive comment", async () => {
    const statuses: Array<[string, AgentRunState | null]> = [];
    const d = deferred<void>();
    const controller = createAgentRunController({
      run: () => d.promise,
      onStatus: (id, s) => statuses.push([id, s]),
    });

    controller.run(comment("a"));
    controller.complete("b");

    expect(controller.activeId()).toBe("a");
    expect(statuses).toEqual([["a", { status: "running" }]]);

    d.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("does not carry completingId into a later cancelled run", async () => {
    const statuses: Array<[string, AgentRunState | null]> = [];
    const deferreds = [deferred<void>(), deferred<void>()];
    let runCount = 0;
    const controller = createAgentRunController({
      run: (_c, signal) => {
        const d = deferreds[runCount++]!;
        signal.addEventListener("abort", () => d.reject(new Error("aborted")));
        return d.promise;
      },
      onStatus: (id, s) => statuses.push([id, s]),
    });

    controller.run(comment("a"));
    controller.complete("a");
    await new Promise((r) => setTimeout(r, 0));

    controller.run(comment("b"));
    controller.cancel("b");
    await new Promise((r) => setTimeout(r, 0));

    expect(statuses).toEqual([
      ["a", { status: "running" }],
      ["a", { status: "stopped", message: "Done." }],
      ["b", { status: "running" }],
      ["b", { status: "stopped", message: "Stopped." }],
    ]);
  });

  it("ignores cancel for an inactive comment", async () => {
    const statuses: Array<[string, AgentRunState | null]> = [];
    const d = deferred<void>();
    const controller = createAgentRunController({
      run: () => d.promise,
      onStatus: (id, s) => statuses.push([id, s]),
    });

    controller.run(comment("a"));
    controller.cancel("b");

    expect(controller.activeId()).toBe("a");
    expect(statuses).toEqual([["a", { status: "running" }]]);

    d.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("reports errors without starting another run", async () => {
    const statuses: Array<[string, AgentRunState | null]> = [];
    const d = deferred<void>();
    const controller = createAgentRunController({
      run: () => d.promise,
      onStatus: (id, s) => statuses.push([id, s]),
    });

    controller.run(comment("a"));
    expect(controller.run(comment("b"))).toBe(false);

    d.reject(new Error("boom"));
    await new Promise((r) => setTimeout(r, 0));

    expect(
      statuses.find(([id, s]) => id === "a" && s?.status === "error" && s.message === "boom"),
    ).toBeTruthy();
    expect(statuses.some(([id]) => id === "b")).toBe(false);
    expect(controller.activeId()).toBeNull();
  });

  it("clears status and notifies when a run is blocked by the backend", async () => {
    class BlockedError extends Error {}

    const statuses: Array<[string, AgentRunState | null]> = [];
    const blocked = vi.fn();
    const d = deferred<void>();
    const controller = createAgentRunController({
      run: () => d.promise,
      onStatus: (id, s) => statuses.push([id, s]),
      isBlockedError: (err) => err instanceof BlockedError,
      onBlocked: blocked,
    });

    controller.run(comment("a"));
    d.reject(new BlockedError("busy"));
    await new Promise((r) => setTimeout(r, 0));

    expect(statuses).toEqual([
      ["a", { status: "running" }],
      ["a", null],
    ]);
    expect(blocked).toHaveBeenCalledOnce();
    expect(controller.activeId()).toBeNull();
  });

  it("releases the active slot even when onSettled throws", async () => {
    const d = deferred<void>();
    const controller = createAgentRunController({
      run: () => d.promise,
      onStatus: () => null,
      onSettled: () => {
        throw new Error("boom from settled");
      },
    });

    controller.run(comment("a"));
    d.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(controller.activeId()).toBeNull();
    expect(controller.run(comment("b"))).toBe(true);
  });
});

describe("shouldCompleteActive", () => {
  it("returns true when the active id is no longer in the comments list", () => {
    expect(shouldCompleteActive("a", [{ id: "b" }, { id: "c" }])).toBe(true);
  });

  it("returns false when the active id is still in the comments list", () => {
    expect(shouldCompleteActive("a", [{ id: "a" }, { id: "b" }])).toBe(false);
  });

  it("returns false when no run is active", () => {
    expect(shouldCompleteActive(null, [{ id: "a" }])).toBe(false);
  });
});
