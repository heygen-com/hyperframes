import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { testProcessIsAlive, waitForTestCondition } from "../utils/processTestUtils.js";
import { watchChromeTree } from "./windowsChromeWatchdog.js";

const started: ChildProcess[] = [];
afterEach(() => {
  for (const child of started.splice(0)) child.kill("SIGKILL");
});

/** A live process standing where the watched Chrome was: `program` is what the watchdog was told it runs. */
function standIn(program: string): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  started.push(child);
  Object.defineProperty(child, "spawnfile", { value: program });
  return child;
}

describe.skipIf(process.platform !== "win32")("the Windows Chrome watchdog", () => {
  // fails without the fix: an unclean release ran taskkill /T on the saved pid whatever now held it, so a pid
  // Windows had given to another program (a test worker on CI) was ended with its whole tree.
  it("leaves a process alone once its pid runs another program", async () => {
    const other = standIn("C:\\chrome\\chrome-headless-shell.exe");
    await waitForTestCondition(() => testProcessIsAlive(other.pid!), 5_000);
    await watchChromeTree(other)!.release(false);
    expect(testProcessIsAlive(other.pid!)).toBe(true);
  });

  it("still ends the Chrome it watches on an unclean release", async () => {
    const chrome = standIn(process.execPath);
    await waitForTestCondition(() => testProcessIsAlive(chrome.pid!), 5_000);
    await watchChromeTree(chrome)!.release(false);
    await waitForTestCondition(() => !testProcessIsAlive(chrome.pid!), 5_000);
  });
});
