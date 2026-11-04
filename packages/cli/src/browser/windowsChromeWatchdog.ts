import { spawn, type ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";

const SWEEP = `$b=[int]$env:HF_CHROME_PID; $x=$env:HF_CHROME_EXE; $t=[DateTimeOffset]::FromUnixTimeMilliseconds([int64]$env:HF_CHROME_SINCE).UtcDateTime; Get-CimInstance Win32_Process | Where-Object { ($_.ProcessId -eq $b -or $_.ParentProcessId -eq $b) -and $_.ExecutablePath -eq $x -and $_.CreationDate.ToUniversalTime() -ge $t } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;

const WATCHDOG = `let clean = false;
const done = () => {
  if (!clean) require("node:child_process").spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ${JSON.stringify(SWEEP)}], { windowsHide: true, timeout: 20000 });
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
export function watchChromeTree(
  chrome: ChildProcess,
  launchedAt: number,
): ChromeWatchdog | undefined {
  const executable = process.platform === "win32" ? executableOf(chrome) : undefined;
  if (!executable || chrome.pid === undefined) return undefined;
  const watchdog = spawn(process.execPath, ["-e", WATCHDOG], {
    detached: true,
    env: {
      ...process.env,
      HF_CHROME_PID: String(chrome.pid),
      HF_CHROME_EXE: executable,
      HF_CHROME_SINCE: String(launchedAt),
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
