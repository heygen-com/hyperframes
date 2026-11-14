import { spawn, type ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import { win32 } from "node:path";
import type { Browser } from "puppeteer-core";

export function chromeKillCommand(
  pids: readonly number[],
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
): { file: string; args: string[] } {
  return {
    file: win32.join(env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
    args: [
      ...pids.flatMap((pid) => ["/PID", String(pid)]),
      "/T",
      "/F",
      "/FI",
      `IMAGENAME eq ${win32.basename(executable)}`,
    ],
  };
}

export const WATCHDOG = `let clean = false;
let kill;
let rest = "";
const take = (line) => {
  if (line === "clean") clean = true;
  else if (line === "none") kill = undefined;
  else if (line) kill = JSON.parse(line);
};
const done = () => {
  take(rest);
  if (!clean && kill) require("node:child_process").spawnSync(kill.file, kill.args, { windowsHide: true, timeout: 20000 });
  process.exit(0);
};
process.stdin.on("data", (data) => {
  const lines = (rest + data).split("\\n");
  rest = lines.pop();
  lines.forEach(take);
});
process.stdin.on("end", done);
process.stdin.on("error", done);
console.log("armed");`;

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

async function chromeProcessIds(browser: Browser): Promise<number[]> {
  const session = await browser.target().createCDPSession();
  try {
    const { processInfo } = await session.send("SystemInfo.getProcessInfo");
    return processInfo.map((each) => each.id);
  } finally {
    await session.detach().catch(() => {});
  }
}

/** Ends Chrome's tree if the CLI dies. ponytail: 1 s reuse window; a kill-on-close job object would close it. */
export function watchChromeTree(
  chrome: ChildProcess,
  browser: Browser,
): ChromeWatchdog | undefined {
  const executable = process.platform === "win32" ? executableOf(chrome) : undefined;
  if (!executable || chrome.pid === undefined) return undefined;
  const mainPid = chrome.pid;
  const watchdog = spawn(process.execPath, ["-e", WATCHDOG], {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
    windowsHide: true,
  });
  watchdog.on("error", () => {});
  watchdog.stdin?.on("error", () => {});
  watchdog.unref();
  (watchdog.stdin as unknown as { unref?: () => void } | null)?.unref?.();
  let stopped = false;
  const send = (pids: number[]) =>
    stopped || watchdog.stdin?.write(`${JSON.stringify(chromeKillCommand(pids, executable))}\n`);
  send([mainPid]);
  let asking = false;
  const poll = setInterval(() => {
    if (asking) return;
    asking = true;
    chromeProcessIds(browser)
      .then((pids) => send([...new Set([mainPid, ...pids])]))
      .catch(() => {})
      .finally(() => (asking = false));
  }, 1000);
  poll.unref();
  chrome.once("exit", () => {
    stopped = true;
    clearInterval(poll);
    watchdog.stdin?.write("none\n");
  });
  let released = false;
  return {
    release(clean) {
      if (released) return;
      released = true;
      stopped = true;
      clearInterval(poll);
      watchdog.stdin?.end(clean ? "clean\n" : "");
    },
  };
}
