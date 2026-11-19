import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { Browser } from "puppeteer-core";
import { afterEach, expect, it, vi } from "vitest";

const { treeEnds } = vi.hoisted(() => ({ treeEnds: vi.fn(async (_pid: number) => {}) }));
vi.mock("../utils/processTree.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/processTree.js")>()),
  terminateWindowsProcessTree: treeEnds,
}));

import { closeManagedBrowser } from "./launch.js";
import { watchChromeTree } from "./windowsChromeWatchdog.js";

const platform = process.platform;
afterEach(() => Object.defineProperty(process, "platform", { value: platform }));

const handedPid = () =>
  Object.assign(new EventEmitter(), {
    pid: process.pid,
    exitCode: null,
    signalCode: null,
    kill: () => true,
  });

it("on Windows, a forced close or a watchdog ends only a process the CLI started, never a pid it was handed", async () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  const child = handedPid();
  const browser = {
    process: () => child,
    close: () => new Promise(() => {}),
  } as unknown as Browser;
  await expect(closeManagedBrowser(browser)).rejects.toThrow(
    "Browser process did not exit after forced shutdown.",
  );
  expect(treeEnds).not.toHaveBeenCalled();
  expect(watchChromeTree(handedPid() as unknown as ChildProcess)).toBeUndefined();
});
