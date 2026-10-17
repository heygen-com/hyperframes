import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  terminateProcessTree,
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

  it("accepts taskkill's process-not-found result when the child has already exited", async () => {
    const killer = new EventEmitter();
    const spawnProcess = vi.fn<SpawnProcess>(() => killer);

    const termination = terminateWindowsProcessTree(4321, spawnProcess);
    killer.emit("close", 128);

    await expect(termination).resolves.toBeUndefined();
  });

  it.each([1, 5, null])(
    "surfaces taskkill status %s so subprocesses can fall back",
    async (status) => {
      const killer = new EventEmitter();
      const spawnProcess = vi.fn<SpawnProcess>(() => killer);

      const termination = terminateWindowsProcessTree(55, spawnProcess);
      killer.emit("close", status);

      await expect(termination).rejects.toThrow(
        `taskkill exited with status ${status ?? "unknown"}`,
      );
    },
  );

  it("preserves a taskkill spawn failure", async () => {
    const killer = new EventEmitter();
    const spawnProcess = vi.fn<SpawnProcess>(() => killer);
    const error = new Error("taskkill could not start");

    const termination = terminateWindowsProcessTree(55, spawnProcess);
    killer.emit("error", error);

    await expect(termination).rejects.toBe(error);
  });

  it("finishes tree teardown without a fallback kill for an already-exited child", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    const killer = new EventEmitter();
    const spawnProcess = vi.fn<SpawnProcess>(() => killer);
    const child = { kill: vi.fn(() => true) };

    try {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      const termination = terminateProcessTree(4321, { child, spawnProcess });
      killer.emit("close", 128);

      await expect(termination).resolves.toBe("SIGKILL");
      expect(child.kill).not.toHaveBeenCalled();
    } finally {
      if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
    }
  });
});
