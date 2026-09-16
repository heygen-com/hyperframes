import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  terminateWindowsProcessTree,
  windowsProcessTreeKillArgs,
  type SpawnProcess,
} from "./processTree.js";

describe("Windows process-tree termination", () => {
  it("runs taskkill recursively and forcefully through the platform seam", async () => {
    const killer = new EventEmitter();
    const spawnProcess = vi.fn<SpawnProcess>(() => killer);

    const termination = terminateWindowsProcessTree(4321, spawnProcess);
    killer.emit("close", 0);
    await termination;

    expect(spawnProcess).toHaveBeenCalledWith("taskkill", windowsProcessTreeKillArgs(4321), {
      stdio: "ignore",
      windowsHide: true,
    });
  });

  it("surfaces taskkill failure so cancellable subprocesses can fall back", async () => {
    const killer = new EventEmitter();
    const spawnProcess = vi.fn<SpawnProcess>(() => killer);

    const termination = terminateWindowsProcessTree(55, spawnProcess);
    killer.emit("close", 1);

    await expect(termination).rejects.toThrow("taskkill exited with status 1");
  });
});
