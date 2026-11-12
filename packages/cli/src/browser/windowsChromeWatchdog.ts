import { spawn, type ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import { win32 } from "node:path";

export function chromeKillCommand(
  pid: number,
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
): { file: string; args: string[] } {
  return {
    file: win32.join(env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
    args: ["/PID", String(pid), "/T", "/F", "/FI", `IMAGENAME eq ${win32.basename(executable)}`],
  };
}

export const WATCHDOG = `let clean = false;
let gone = false;
const alive = () => { try { return process.kill(Number(process.env.HF_CHROME_PID), 0); } catch { return false; } };
const watch = setInterval(() => { if (!gone && !alive()) { gone = true; console.log("gone"); } }, Number(process.env.HF_WATCH_MS) || 500);
console.log("armed");
const done = () => {
  clearInterval(watch);
  if (!clean && !gone && alive()) {
    const { file, args } = JSON.parse(process.env.HF_CHROME_KILL);
    require("node:child_process").spawnSync(file, args, { windowsHide: true, timeout: 20000 });
  }
  process.exit(0);
};
process.stdin.on("data", (data) => { clean ||= String(data).includes("clean"); });
process.stdin.on("end", done);
process.stdin.on("error", done);`;

export interface ChromeWatchdog {
  release(clean: boolean): void;
}

function executableOf(chrome: ChildProcess): string | undefined {
  try {
    return realpathSync.native(chrome.spawnfile);
  } catch {
    return undefined;
  }
}

/** Ends Chrome's tree if the CLI dies. ponytail: a pid reused within one 500 ms poll of its exit is still killed. */
export function watchChromeTree(chrome: ChildProcess): ChromeWatchdog | undefined {
  const executable = process.platform === "win32" ? executableOf(chrome) : undefined;
  if (!executable || chrome.pid === undefined) return undefined;
  const watchdog = spawn(process.execPath, ["-e", WATCHDOG], {
    detached: true,
    env: {
      ...process.env,
      HF_CHROME_PID: String(chrome.pid),
      HF_CHROME_KILL: JSON.stringify(chromeKillCommand(chrome.pid, executable)),
    },
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
