import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { chromeKillCommand, watchChromeTree } from "./windowsChromeWatchdog.js";

const alive = (pid: number) => {
  try {
    return process.kill(pid, 0);
  } catch {
    return false;
  }
};
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((done) => setTimeout(done, 100));
};

describe("the Windows Chrome watchdog's kill", () => {
  it("is taskkill from System32 on the pid and its tree, filtered to the program's image name, never PowerShell", () => {
    const { file, args } = chromeKillCommand(
      4242,
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      { SystemRoot: "D:\\Win" },
    );
    expect(file).toBe("D:\\Win\\System32\\taskkill.exe");
    expect(args).toEqual(["/PID", "4242", "/T", "/F", "/FI", "IMAGENAME eq chrome.exe"]);
    expect(`${file} ${args.join(" ")}`).not.toMatch(/powershell/i);
  });
});

// A Windows run: the CLI dies without a clean close, and Chrome (here a node) and what it started end with it.
describe.runIf(process.platform === "win32")("on Windows", () => {
  it("ends Chrome and its child when the CLI releases it unclean, and leaves them on a clean close", async () => {
    const start = () =>
      spawn(
        process.execPath,
        [
          "-e",
          'const c = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); console.log(c.pid); setInterval(() => {}, 1000);',
        ],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
    const run = async (clean: boolean) => {
      const chrome = start();
      const child = await new Promise<number>((resolve) =>
        chrome.stdout?.once("data", (data) => resolve(Number(String(data).trim()))),
      );
      const watchdog = watchChromeTree(chrome);
      expect(watchdog).toBeDefined();
      watchdog?.release(clean);
      return { chrome, child };
    };
    const killed = await run(false);
    await until(() => !alive(killed.chrome.pid!) && !alive(killed.child));
    expect(alive(killed.chrome.pid!)).toBe(false);
    expect(alive(killed.child)).toBe(false);

    const kept = await run(true);
    await new Promise((done) => setTimeout(done, 1500));
    expect(alive(kept.chrome.pid!) && alive(kept.child)).toBe(true);
    process.kill(kept.chrome.pid!);
    process.kill(kept.child);
  }, 30_000);
});
