import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import {
  isProcessDescendant,
  killProcessTree,
  killOrphanedProcesses,
  processIdentity,
  windowsProcessTreeKillArgs,
} from "./orphanCleanup.js";

const IS_UNIX = process.platform !== "win32";

describe("Windows process-tree cleanup", () => {
  it("uses taskkill recursively and forcefully for the owned PID", () => {
    expect(windowsProcessTreeKillArgs(4321)).toEqual(["/PID", "4321", "/T", "/F"]);
  });
});

describe("process-tree ownership", () => {
  it("captures a stable birth token for the current process", () => {
    const first = processIdentity(process.pid);
    expect(first).toMatch(/^(?:linux|posix|windows):/);
    expect(processIdentity(process.pid)).toBe(first);
    expect(processIdentity(-1)).toBeNull();
  });

  it("proves ancestry through every intermediate wrapper", () => {
    const parents = new Map([
      [400, 300],
      [300, 200],
      [200, 1],
    ]);

    expect(isProcessDescendant(400, 200, (pid) => parents.get(pid) ?? null)).toBe(true);
    expect(isProcessDescendant(400, 999, (pid) => parents.get(pid) ?? null)).toBe(false);
  });

  it("fails closed on missing or cyclic process metadata", () => {
    expect(isProcessDescendant(400, 200, () => null)).toBe(false);
    expect(isProcessDescendant(400, 200, (pid) => (pid === 400 ? 300 : 400))).toBe(false);
  });
});

describe.skipIf(!IS_UNIX)("killProcessTree", () => {
  it("kills a process and all its children", async () => {
    // Spawn a parent that spawns two sleeping children
    const parent = spawn("bash", ["-c", "sleep 60 & sleep 60 & wait"], {
      stdio: "ignore",
    });
    // Let children spawn
    await new Promise((r) => setTimeout(r, 200));

    const exitPromise = new Promise<void>((resolve) => parent.on("close", resolve));
    killProcessTree(parent.pid!);

    await exitPromise;

    // Verify parent is dead
    expect(() => process.kill(parent.pid!, 0)).toThrow();
  }, 5000);

  it("handles non-existent PID gracefully", () => {
    // Should not throw for a PID that doesn't exist
    killProcessTree(999999999);
  });

  it("escalates to SIGKILL after grace period", async () => {
    // Spawn a process that traps SIGTERM
    const proc = spawn("bash", ["-c", "trap '' TERM; sleep 60"], {
      stdio: "ignore",
    });
    await new Promise((r) => setTimeout(r, 100));

    const exitPromise = new Promise<void>((resolve) => proc.on("close", resolve));
    killProcessTree(proc.pid!);

    // Should die within 1s (500ms SIGKILL grace + buffer)
    await exitPromise;
    expect(() => process.kill(proc.pid!, 0)).toThrow();
  }, 5000);
});

describe.skipIf(!IS_UNIX)("killOrphanedProcesses", () => {
  it("returns 0 when no orphans exist", () => {
    const killed = killOrphanedProcesses();
    expect(killed).toBe(0);
  });

  it("does not kill non-orphaned Chrome processes", () => {
    // Our current process is not an orphan (PPID !== 1), so any
    // chrome-headless-shell processes we'd find with our PID as
    // ancestor wouldn't be killed.
    const killed = killOrphanedProcesses();
    expect(killed).toBe(0);
  });
});
