import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import type { Browser } from "puppeteer-core";
import { describe, expect, it } from "vitest";
import { closeManagedBrowser } from "./launch.js";

/** A browser whose close never finishes and whose process never reports 'exit', like a loaded Windows host. */
function silentBrowser(pid: number): Browser {
  const child = Object.assign(new EventEmitter(), {
    pid,
    exitCode: null,
    signalCode: null,
    kill: () => true,
  });
  return { process: () => child, close: () => new Promise(() => {}) } as unknown as Browser;
}

describe("closing a killed browser", () => {
  it("finishes once the OS reports the process gone, before Node reports its exit", async () => {
    const gone = spawn(process.execPath, ["-e", ""]);
    await once(gone, "exit");
    await expect(closeManagedBrowser(silentBrowser(gone.pid!))).resolves.toBeUndefined();
  });

  it("still fails when the process is alive after the forced shutdown", async () => {
    await expect(closeManagedBrowser(silentBrowser(process.pid))).rejects.toThrow(
      "Browser process did not exit after forced shutdown.",
    );
  });
});
