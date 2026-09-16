import { describe, it, expect, vi } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import {
  isProcessDescendant,
  killOwnedOrphanedFfmpegProcesses,
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

describe("owned FFmpeg orphan cleanup", () => {
  it("kills only the ownership-verified PID list", () => {
    const kill = vi.fn();
    const records = [
      { pid: 41, identity: "linux:one" },
      { pid: 42, identity: "linux:two" },
    ];

    expect(
      killOwnedOrphanedFfmpegProcesses(
        records,
        kill,
        (pid) => records.find((record) => record.pid === pid)?.identity ?? null,
      ),
    ).toBe(2);
    expect(kill.mock.calls.map(([pid]) => pid)).toEqual([41, 42]);
    expect(kill.mock.calls.every(([, , stillOwned]) => stillOwned())).toBe(true);
  });

  it("does not kill when the PID birth identity changed after discovery", () => {
    const kill = vi.fn();

    expect(
      killOwnedOrphanedFfmpegProcesses(
        [{ pid: 41, identity: "linux:original" }],
        kill,
        () => "linux:reused",
      ),
    ).toBe(0);
    expect(kill).not.toHaveBeenCalled();
  });
});

// These run the REAL killProcessTree against a live child. The identity fake
// stands in for the OS handing the recorded PID to an unrelated process: it
// returns the recorded birth identity at discovery time and a different one
// afterwards, exactly as `processIdentity` would once the PID is recycled.
// The child must survive — a kill that reaches it means a revalidation is gone.
describe.skipIf(!IS_UNIX)("owned FFmpeg orphan cleanup — PID reuse with the real kill path", () => {
  function isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  it("does not signal a PID whose identity changed between discovery and kill", async () => {
    const proc = spawn("sleep", ["60"], { stdio: "ignore" });
    const closed = new Promise<void>((resolve) => proc.on("close", () => resolve()));
    const pid = proc.pid!;
    const identity = processIdentity(pid);
    expect(identity).not.toBeNull();
    try {
      let lookups = 0;
      const identityForPid = () => (++lookups === 1 ? identity : `${identity}:recycled`);

      killOwnedOrphanedFfmpegProcesses(
        [{ pid, identity: identity! }],
        killProcessTree,
        identityForPid,
      );

      // Longer than the 500 ms SIGKILL grace so a skipped escalation counts too.
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(lookups).toBeGreaterThanOrEqual(2);
      expect(isAlive(pid)).toBe(true);
    } finally {
      proc.kill("SIGKILL");
      await closed;
    }
  }, 5000);

  it("does not escalate to SIGKILL when ownership is lost during the grace period", async () => {
    // Ignores SIGTERM so only the escalation could end it.
    const proc = spawn("bash", ["-c", "trap '' TERM; sleep 60"], { stdio: "ignore" });
    const closed = new Promise<void>((resolve) => proc.on("close", () => resolve()));
    const pid = proc.pid!;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const identity = processIdentity(pid);
    expect(identity).not.toBeNull();
    try {
      let owned = true;
      let lookupsAfterLoss = 0;
      const identityForPid = () => {
        if (!owned) lookupsAfterLoss++;
        return owned ? identity : `${identity}:recycled`;
      };

      killOwnedOrphanedFfmpegProcesses(
        [{ pid, identity: identity! }],
        killProcessTree,
        identityForPid,
      );
      expect(isAlive(pid)).toBe(true);
      // The PID is handed to someone else before the grace period elapses.
      owned = false;

      await new Promise((resolve) => setTimeout(resolve, 800));
      // Proves the escalation timer ran and revalidated — a still-alive child
      // is not just a timer that has yet to fire.
      expect(lookupsAfterLoss).toBeGreaterThanOrEqual(1);
      expect(isAlive(pid)).toBe(true);
    } finally {
      killProcessTree(pid, "SIGKILL");
      await closed;
    }
  }, 5000);
});

describe.skipIf(!IS_UNIX)("killProcessTree", () => {
  it("does not escalate to SIGKILL on a descendant whose PID was recycled during the grace", async () => {
    // Root and descendant both ignore SIGTERM, so only the escalation can end
    // either. The root stays owned; the descendant's identity changes once the
    // SIGTERM pass has run, standing in for a child that exited and had its PID
    // handed to an unrelated process before the SIGKILL timer fired.
    const parent = spawn(
      "bash",
      ["-c", "trap '' TERM; bash -c 'trap \"\" TERM; exec sleep 60' & wait"],
      { stdio: "ignore" },
    );
    const parentClosed = new Promise<void>((resolve) => parent.on("close", () => resolve()));
    let child: number | undefined;
    try {
      await new Promise((r) => setTimeout(r, 200));
      const children = execFileSync("pgrep", ["-P", String(parent.pid)], { encoding: "utf8" })
        .trim()
        .split("\n")
        .map(Number);
      expect(children).toHaveLength(1);
      child = children[0]!;
      const descendant = child;
      let recycled = false;
      let childLookupsAfterRecycle = 0;
      const identityForPid = (pid: number) => {
        const real = processIdentity(pid);
        if (pid !== descendant || !recycled) return real;
        childLookupsAfterRecycle++;
        return `${real}:recycled`;
      };

      killProcessTree(parent.pid!, "SIGTERM", () => true, identityForPid);
      recycled = true;

      // The root was still owned, so its SIGKILL is what closes it.
      await parentClosed;
      // The escalation timer re-checked the descendant through the same oracle
      // (a re-check through a different lookup would leave this at 0) ...
      expect(childLookupsAfterRecycle).toBeGreaterThanOrEqual(1);
      // ... and acted on the answer: the descendant was not signalled.
      expect(() => process.kill(descendant, 0)).not.toThrow();
    } finally {
      if (child !== undefined) {
        try {
          process.kill(child, "SIGKILL");
        } catch {
          // Already gone — which is the failure the assertion above reports.
        }
      }
      parent.kill("SIGKILL");
      await parentClosed;
    }
  }, 5000);

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
