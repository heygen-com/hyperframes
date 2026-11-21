import { ChildProcess, spawn } from "node:child_process";
import { windowsImageOf, windowsOwnTreeKillArgs } from "../utils/processTree.js";

const WATCHDOG = `let clean = false;
const killArgs = ${windowsOwnTreeKillArgs};
const done = () => {
  if (!clean) require("node:child_process").spawnSync("taskkill", killArgs(process.env.HF_CHROME_PID, process.env.HF_CHROME_IMAGE), { windowsHide: true, stdio: "ignore", timeout: 20000 });
  process.exit(0);
};
process.stdin.on("data", (data) => { clean ||= String(data).includes("clean"); });
process.stdin.on("end", done);
process.stdin.on("error", done);`;

export interface ChromeWatchdog {
  release(clean: boolean): Promise<void>;
}

export function watchChromeTree(chrome: ChildProcess): ChromeWatchdog | undefined {
  if (process.platform !== "win32" || !(chrome instanceof ChildProcess) || chrome.pid === undefined)
    return undefined;
  const watchdog = spawn(process.execPath, ["-e", WATCHDOG], {
    detached: true,
    env: {
      ...process.env,
      HF_CHROME_PID: String(chrome.pid),
      HF_CHROME_IMAGE: windowsImageOf(chrome.spawnfile),
    },
    stdio: ["pipe", "ignore", "ignore"],
    windowsHide: true,
  });
  watchdog.on("error", () => {});
  watchdog.stdin?.on("error", () => {});
  watchdog.unref();
  (watchdog.stdin as unknown as { unref?: () => void } | null)?.unref?.();
  const ended = new Promise<void>((resolve) => watchdog.once("close", () => resolve()));
  let released = false;
  return {
    release(clean) {
      if (!released) watchdog.stdin?.end(clean ? "clean" : "");
      released = true;
      return ended;
    },
  };
}
