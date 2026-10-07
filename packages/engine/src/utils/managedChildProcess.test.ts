import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedChildProcess } from "./managedChildProcess.js";

function childProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stderr = new EventEmitter();
  child.kill = vi.fn().mockReturnValue(true);
  return child as unknown as ChildProcess & {
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
}

describe("ManagedChildProcess", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a typed natural exit and bounded stderr tail", async () => {
    const child = childProcess();
    const managed = new ManagedChildProcess(child, { stderrMaxBytes: 5 });
    child.stderr.emit("data", Buffer.from("123456789"));
    child.emit("close", 0, null);

    await expect(managed.wait()).resolves.toMatchObject({
      reason: "exit",
      exitCode: 0,
      stderr: "56789",
    });
  });

  it("escalates abort from SIGTERM to SIGKILL and resolves only after close", async () => {
    vi.useFakeTimers();
    const child = childProcess();
    const controller = new AbortController();
    const managed = new ManagedChildProcess(child, {
      signal: controller.signal,
      terminationGraceMs: 50,
    });

    controller.abort();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await vi.advanceTimersByTimeAsync(50);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    let reaped = false;
    void managed.wait().then(() => {
      reaped = true;
    });
    await Promise.resolve();
    expect(reaped).toBe(false);
    child.emit("close", null, "SIGKILL");
    await expect(managed.wait()).resolves.toMatchObject({ reason: "abort", signal: "SIGKILL" });
  });

  it("keeps escalation and reaping active after a post-spawn error", async () => {
    vi.useFakeTimers();
    const child = childProcess();
    const controller = new AbortController();
    const managed = new ManagedChildProcess(child, {
      signal: controller.signal,
      terminationGraceMs: 50,
    });
    child.emit("spawn");

    controller.abort();
    child.emit("error", new Error("kill EPERM"));

    let reaped = false;
    void managed.wait().then(() => {
      reaped = true;
    });
    await Promise.resolve();
    expect(reaped).toBe(false);

    await vi.advanceTimersByTimeAsync(50);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    child.emit("error", new Error("kill EPERM"));
    expect(reaped).toBe(false);

    child.emit("close", null, "SIGKILL");
    await expect(managed.wait()).resolves.toMatchObject({ reason: "abort", signal: "SIGKILL" });
  });

  it("distinguishes deadline from inactivity and refreshes activity", async () => {
    vi.useFakeTimers();
    const deadlineChild = childProcess();
    const deadline = new ManagedChildProcess(deadlineChild, {
      deadlineAtMs: Date.now() + 100,
      terminationGraceMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(deadlineChild.kill).toHaveBeenCalledWith("SIGTERM");
    deadlineChild.emit("close", null, "SIGTERM");
    await expect(deadline.wait()).resolves.toMatchObject({ reason: "deadline" });

    const inactiveChild = childProcess();
    const inactive = new ManagedChildProcess(inactiveChild, {
      inactivityTimeoutMs: 100,
      terminationGraceMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(75);
    inactive.markActivity();
    await vi.advanceTimersByTimeAsync(75);
    expect(inactiveChild.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(25);
    expect(inactiveChild.kill).toHaveBeenCalledWith("SIGTERM");
    inactiveChild.emit("close", null, "SIGTERM");
    await expect(inactive.wait()).resolves.toMatchObject({ reason: "inactivity" });
  });

  it("settles a spawn failure and removes cancellation listeners", async () => {
    const child = childProcess();
    const controller = new AbortController();
    const managed = new ManagedChildProcess(child, { signal: controller.signal });
    child.emit("error", new Error("spawn ENOENT"));
    controller.abort();

    await expect(managed.wait()).resolves.toMatchObject({
      reason: "spawn_error",
      exitCode: null,
      stderr: "spawn ENOENT",
    });
    expect(child.kill).not.toHaveBeenCalled();
  });
});
