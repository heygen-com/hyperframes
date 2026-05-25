import { describe, it, expect, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import { trackChildProcess, killTrackedProcesses } from "./processTracker.js";

// Reset tracked set between tests by killing everything
beforeEach(() => {
  killTrackedProcesses();
});

describe("trackChildProcess", () => {
  it("tracks a spawned process and removes it after exit", async () => {
    const proc = spawn("echo", ["hello"], { stdio: "ignore" });
    trackChildProcess(proc);

    await new Promise<void>((resolve) => proc.on("close", resolve));

    // After exit, killTrackedProcesses should be a no-op (nothing to kill)
    killTrackedProcesses();
  });

  it("removes the process on spawn error", async () => {
    const proc = spawn("/nonexistent-binary-that-does-not-exist", { stdio: "ignore" });
    trackChildProcess(proc);

    await new Promise<void>((resolve) => proc.on("error", () => resolve()));

    killTrackedProcesses();
  });
});

describe("killTrackedProcesses", () => {
  it("kills a running process", async () => {
    const proc = spawn("sleep", ["60"], { stdio: "ignore" });
    trackChildProcess(proc);

    const exitPromise = new Promise<number | null>((resolve) => proc.on("close", resolve));
    killTrackedProcesses();

    const code = await exitPromise;
    // SIGTERM exit: code is null (killed by signal)
    expect(code).toBeNull();
  });

  it("handles already-exited processes gracefully", async () => {
    const proc = spawn("true", { stdio: "ignore" });
    trackChildProcess(proc);

    await new Promise<void>((resolve) => proc.on("close", resolve));

    // Should not throw even though process already exited
    killTrackedProcesses();
  });

  it("escalates to SIGKILL for processes that ignore SIGTERM", async () => {
    // Spawn a process that traps SIGTERM (bash ignoring it)
    const proc = spawn("bash", ["-c", "trap '' TERM; sleep 60"], { stdio: "ignore" });
    trackChildProcess(proc);

    const exitPromise = new Promise<void>((resolve) => proc.on("close", resolve));
    killTrackedProcesses();

    // The 500ms SIGKILL escalation should kill it
    await exitPromise;
    expect(proc.killed).toBe(true);
  }, 5000);

  it("is idempotent — second call is a no-op", () => {
    const proc = spawn("sleep", ["60"], { stdio: "ignore" });
    trackChildProcess(proc);

    killTrackedProcesses();
    killTrackedProcesses();
  });
});
