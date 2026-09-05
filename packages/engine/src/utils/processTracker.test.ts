import { describe, it, expect, beforeEach, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  beginTrackedProcessDrain,
  findOwnedOrphanedFfmpegProcesses,
  trackChildProcess,
  killTrackedProcesses,
} from "./processTracker.js";

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

  it("removes an exited process before its stdio closes", async () => {
    const proc = spawn("sleep", ["60"], { stdio: "ignore" });
    const closePromise = new Promise<void>((resolve) => proc.on("close", resolve));
    const kill = vi.spyOn(proc, "kill");
    trackChildProcess(proc);

    try {
      proc.emit("exit", 0, null);
      killTrackedProcesses();

      expect(kill).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
      proc.kill("SIGKILL");
      await closePromise;
    }
  });

  it("removes the process on spawn error", async () => {
    const proc = spawn("/nonexistent-binary-that-does-not-exist", { stdio: "ignore" });
    proc.on("error", () => undefined);
    trackChildProcess(proc);

    await new Promise<void>((resolve) => proc.on("close", () => resolve()));

    killTrackedProcesses();
  });

  it("keeps a process tracked after a post-spawn error", () => {
    const proc = spawn("sleep", ["60"], { stdio: "ignore" });
    const kill = vi.spyOn(proc, "kill");
    proc.on("error", () => undefined);
    trackChildProcess(proc);

    proc.emit("error", new Error("kill EPERM"));
    killTrackedProcesses();

    expect(kill).toHaveBeenCalledWith("SIGTERM");
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

  it("registers owned FFmpeg identity and removes it on clean exit", async () => {
    const registryDir = mkdtempSync(join(tmpdir(), "hf-owned-ffmpeg-"));
    const proc = spawn("sleep", ["60"], { stdio: "ignore" });
    const exitPromise = new Promise<void>((resolve) => proc.on("close", () => resolve()));
    try {
      trackChildProcess(proc, { kind: "ffmpeg", registryDir });
      expect(readdirSync(registryDir)).toHaveLength(1);

      proc.kill("SIGTERM");
      await exitPromise;
      expect(readdirSync(registryDir)).toHaveLength(0);
    } finally {
      proc.kill("SIGKILL");
      await exitPromise;
      rmSync(registryDir, { recursive: true, force: true });
    }
  });

  it("recovers only identity-matched FFmpeg records reparented to init", () => {
    const registryDir = mkdtempSync(join(tmpdir(), "hf-owned-ffmpeg-scan-"));
    try {
      for (const [pid, identity] of [
        [101, "linux:one"],
        [102, "linux:two"],
        [103, "linux:stale"],
      ] as const) {
        writeFileSync(
          join(registryDir, `${pid}.json`),
          JSON.stringify({ version: 1, kind: "ffmpeg", pid, identity }),
        );
      }

      expect(
        findOwnedOrphanedFfmpegProcesses({
          registryDir,
          identityForPid: (pid) =>
            ({ 101: "linux:one", 102: "linux:two", 103: "linux:reused" })[pid] ?? null,
          parentPidForPid: (pid) => (pid === 101 ? 1 : 77),
        }),
      ).toEqual([{ pid: 101, identity: "linux:one" }]);
      expect(readdirSync(registryDir)).not.toContain("103.json");
      expect(readdirSync(registryDir)).toContain("102.json");
    } finally {
      rmSync(registryDir, { recursive: true, force: true });
    }
  });

  it("kills a child registered after the terminal drain begins", async () => {
    beginTrackedProcessDrain();
    const proc = spawn("sleep", ["60"], { stdio: "ignore" });
    const exitPromise = new Promise<number | null>((resolve) => proc.on("close", resolve));

    trackChildProcess(proc);

    expect(await exitPromise).toBeNull();
  });
});
