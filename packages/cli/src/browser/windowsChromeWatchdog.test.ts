import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WATCHDOG, chromeKillCommand, watchChromeTree } from "./windowsChromeWatchdog.js";

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

// fails without the guard: a Chrome that exited earlier left its pid to be reused, and the sweep killed whatever held it.
describe("the watchdog's reuse guard", () => {
  const runWatchdog = async (pid: number, until: "armed" | "gone", clean: boolean) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-watchdog-"));
    const marker = join(dir, "killed");
    const kill = {
      file: process.execPath,
      args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")`],
    };
    const watchdog = spawn(process.execPath, ["-e", WATCHDOG], {
      env: {
        ...process.env,
        HF_CHROME_PID: String(pid),
        HF_CHROME_KILL: JSON.stringify(kill),
        HF_WATCH_MS: "20",
      },
      stdio: ["pipe", "pipe", "ignore"],
    });
    let said = "";
    await new Promise<void>((resolve) =>
      watchdog.stdout?.on("data", (data) => {
        said += String(data);
        if (said.includes(until)) resolve();
      }),
    );
    watchdog.stdin?.end(clean ? "clean" : "");
    await new Promise((done) => watchdog.once("exit", done));
    const killed = existsSync(marker);
    rmSync(dir, { recursive: true, force: true });
    return killed;
  };

  it("kills a Chrome that is alive when the CLI ends", async () => {
    expect(await runWatchdog(process.pid, "armed", false)).toBe(true);
  });

  it("never kills for a Chrome it saw exit, even when the CLI then ends unclean", async () => {
    const chrome = spawn(process.execPath, ["-e", ""]);
    const pid = chrome.pid!;
    await new Promise((done) => chrome.once("exit", done));
    expect(await runWatchdog(pid, "gone", false)).toBe(false);
  });

  it("never kills for a pid that is gone when the CLI ends", async () => {
    const chrome = spawn(process.execPath, ["-e", ""]);
    const pid = chrome.pid!;
    await new Promise((done) => chrome.once("exit", done));
    expect(await runWatchdog(pid, "armed", false)).toBe(false);
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
