import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WATCHDOG, chromeKillCommand } from "./windowsChromeWatchdog.js";

describe("the Windows Chrome watchdog's kill", () => {
  it("is taskkill from System32 on every listed pid and their trees, filtered to the image name, never PowerShell", () => {
    const { file, args } = chromeKillCommand(
      [4242, 77],
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      { SystemRoot: "D:\\Win" },
    );
    expect(file).toBe("D:\\Win\\System32\\taskkill.exe");
    expect(args).toEqual(["/PID", "4242", "/PID", "77", "/T", "/F", "/FI", "IMAGENAME eq chrome.exe"]);
    expect(`${file} ${args.join(" ")}`).not.toMatch(/powershell/i);
  });
});

// The CLI tells the watchdog what to run for the Chrome pids it last saw; it runs that when the CLI ends unclean.
describe("the watchdog", () => {
  const start = async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-watchdog-"));
    const marker = join(dir, "ran");
    const command = (pids: string) =>
      JSON.stringify({
        file: process.execPath,
        args: [
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(marker)}, process.argv[1])`,
          pids,
        ],
      });
    const watchdog = spawn(process.execPath, ["-e", WATCHDOG], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    await new Promise<void>((resolve) => watchdog.stdout?.once("data", () => resolve()));
    const ended = new Promise((done) => watchdog.once("exit", done));
    const ran = async () => {
      await ended;
      const text = existsSync(marker) ? readFileSync(marker, "utf8") : undefined;
      rmSync(dir, { recursive: true, force: true });
      return text;
    };
    return { watchdog, command, ran };
  };
  const run = async (lines: string[]) => {
    const { watchdog, command, ran } = await start();
    const text = lines.map((line) => (line.startsWith("pids ") ? command(line.slice(5)) : line));
    watchdog.stdin?.end(text.map((line) => `${line}\n`).join(""));
    return ran();
  };

  it("runs the last list it was given when the CLI ends unclean", async () => {
    expect(await run(["pids 1", "pids 1,2,3"])).toBe("1,2,3");
  });

  // fails without the one-second list: a pid that left the list (its process exited) was killed at its old number.
  it("does not kill a pid that left the list before the CLI ended", async () => {
    expect(await run(["pids 1,2,3", "pids 1,3"])).toBe("1,3");
  });

  it("kills nothing after a clean close, after Chrome's own exit, or before any list", async () => {
    expect(await run(["pids 1", "clean"])).toBeUndefined();
    expect(await run(["pids 1", "none"])).toBeUndefined();
    expect(await run([])).toBeUndefined();
  });

  it("reads a list split across writes", async () => {
    const { watchdog, command, ran } = await start();
    const text = command("9");
    watchdog.stdin?.write(text.slice(0, 20));
    watchdog.stdin?.end(`${text.slice(20)}\n`);
    expect(await ran()).toBe("9");
  });
});
