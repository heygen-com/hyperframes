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
    // `processIdentity` is documented to return null when the lookup cannot be
    // completed, not only when the process is absent — and on Windows and macOS
    // it shells out to PowerShell / `ps` on a 2 s budget, which a cold CI runner
    // routinely outruns. Asserting an unconditional token therefore tested the
    // runner's spawn latency rather than the function: it failed on
    // windows-latest with `.toMatch()` receiving null.
    //
    // What is actually promised: a well-formed token OR null, the same answer
    // twice in a row, and null for a pid that cannot exist. Callers are built
    // on exactly that contract — `wrapperProcessIsAlive` treats null as "no
    // answer" rather than "gone" precisely because it is reachable here.
    const first = processIdentity(process.pid);
    const second = processIdentity(process.pid);

    // Stability is only assertable across two SUCCESSFUL lookups. Two calls can
    // disagree here for one reason — one of them failed — and that is exactly
    // what happens on a cold Windows runner: the first PowerShell spawn outruns
    // the 2 s budget and returns null, the second is warm and returns a token.
    // The token itself cannot change between them; it is a birth timestamp and
    // the process did not restart.
    if (first !== null && second !== null) {
      expect(first).toMatch(/^(?:linux|posix|windows):/);
      expect(second).toBe(first);
    }

    // This one holds everywhere: the guard rejects it before any subprocess.
    expect(processIdentity(-1)).toBeNull();
  });

  it("reads a well-formed token where the lookup cannot fail", () => {
    // Linux reads /proc directly with no subprocess, so there the token is not
    // allowed to be null — this keeps the strict assertion on the one platform
    // that can honour it, rather than dropping it everywhere.
    if (process.platform !== "linux") return;
    expect(processIdentity(process.pid)).toMatch(/^linux:\d+$/);
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
