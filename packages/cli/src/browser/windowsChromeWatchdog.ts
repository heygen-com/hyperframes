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

const WATCHDOG = `let clean = false;
const done = () => {
  if (!clean) {
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

/** Windows does not end a process's children with it, so Chrome's children outlive a killed CLI without this. */
export function watchChromeTree(chrome: ChildProcess): ChromeWatchdog | undefined {
  const executable = process.platform === "win32" ? executableOf(chrome) : undefined;
  if (!executable || chrome.pid === undefined) return undefined;
  const watchdog = spawn(process.execPath, ["-e", WATCHDOG], {
    detached: true,
    env: {
      ...process.env,
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
