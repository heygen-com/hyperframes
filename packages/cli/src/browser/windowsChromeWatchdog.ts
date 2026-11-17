import { ChildProcess, spawn } from "node:child_process";

const WATCHDOG = `let clean = false;
const done = () => {
  if (!clean) require("node:child_process").spawnSync("taskkill", ["/PID", process.env.HF_CHROME_PID, "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 20000 });
  process.exit(0);
};
process.stdin.on("data", (data) => { clean ||= String(data).includes("clean"); });
process.stdin.on("end", done);
process.stdin.on("error", done);`;

export interface ChromeWatchdog {
  release(clean: boolean): void;
}

export function watchChromeTree(chrome: ChildProcess): ChromeWatchdog | undefined {
  if (process.platform !== "win32" || !(chrome instanceof ChildProcess) || chrome.pid === undefined)
    return undefined;
  const watchdog = spawn(process.execPath, ["-e", WATCHDOG], {
    detached: true,
    env: { ...process.env, HF_CHROME_PID: String(chrome.pid) },
    stdio: ["pipe", "ignore", "ignore"],
    windowsHide: true,
  });
  watchdog.on("error", () => {});
  watchdog.stdin?.on("error", () => {});
  watchdog.unref();
  (watchdog.stdin as unknown as { unref?: () => void } | null)?.unref?.();
  let released = false;
  return {
    release(clean) {
      if (released) return;
      released = true;
      watchdog.stdin?.end(clean ? "clean" : "");
    },
  };
}
