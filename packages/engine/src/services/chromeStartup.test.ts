import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  diagnoseChromeStartup,
  explainChromeLaunchFailure,
  nameChromeExit,
} from "./chromeStartup.js";

function fakeBrowser(body: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "hf-fake-chrome-")), "chrome");
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe("nameChromeExit", () => {
  it("names the Windows codes a browser dies with, signed or unsigned", () => {
    expect(nameChromeExit(0xc0000135, "win32")).toContain("missing");
    expect(nameChromeExit(-1073741515, "win32")).toContain("0xC0000135");
    expect(nameChromeExit(3221225495, "win32")).toContain("out of memory");
  });

  it("names nothing off Windows or for an unknown code", () => {
    expect(nameChromeExit(0xc0000135, "linux")).toBeUndefined();
    expect(nameChromeExit(1, "win32")).toBeUndefined();
    expect(nameChromeExit(null, "win32")).toBeUndefined();
  });
});

describe.runIf(process.platform !== "win32")("diagnoseChromeStartup", () => {
  it("reports the exit code and last stderr lines of a browser that dies at start", async () => {
    const chrome = fakeBrowser(
      'process.stderr.write("[1:1:FATAL:zygote_host] No usable sandbox\\n"); process.exit(7);',
    );
    const diagnosis = await diagnoseChromeStartup(chrome, ["--headless"]);
    expect(diagnosis).toContain("exited with code 7");
    expect(diagnosis).toContain("No usable sandbox");
  });

  it("starts the probe on its own debugging port and profile, not the failed launch's pipe", async () => {
    const chrome = fakeBrowser("console.error(process.argv.slice(2).join(' ')); process.exit(3);");
    const diagnosis = await diagnoseChromeStartup(chrome, [
      "--remote-debugging-pipe",
      "--user-data-dir=/gone",
      "--no-sandbox",
    ]);
    expect(diagnosis).toContain("--no-sandbox");
    expect(diagnosis).toContain("--remote-debugging-port=0");
    expect(diagnosis).not.toContain("--remote-debugging-pipe");
    expect(diagnosis).not.toContain("/gone");
  });

  it("says so when the browser stays up, instead of inventing a crash", async () => {
    const chrome = fakeBrowser("setInterval(() => {}, 1000);");
    const diagnosis = await diagnoseChromeStartup(chrome, [], { timeoutMs: 300 });
    expect(diagnosis).toContain("kept running");
  });

  it("reports a binary that cannot be started", async () => {
    expect(await diagnoseChromeStartup("/no/such/chrome", [])).toContain("could not be started");
  });
});

describe.runIf(process.platform !== "win32")("diagnoseChromeStartup cancel and arguments", () => {
  it("stops the probe at once when the caller cancels it", async () => {
    const chrome = fakeBrowser("setInterval(() => {}, 1000);");
    const abort = new AbortController();
    const started = Date.now();
    const pending = diagnoseChromeStartup(chrome, [], { signal: abort.signal, timeoutMs: 30_000 });
    setTimeout(() => abort.abort(), 100);
    expect(await pending).toContain("cancelled");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("passes the flags it is given, such as --headless, and drops stray positional arguments", async () => {
    const chrome = fakeBrowser("console.error(process.argv.slice(2).join(' ')); process.exit(3);");
    const diagnosis = await diagnoseChromeStartup(chrome, [
      "--headless=new",
      "about:blank",
      "--no-first-run",
    ]);
    expect(diagnosis).toContain("--headless=new");
    expect(diagnosis).toContain("--no-first-run");
    expect(diagnosis.match(/about:blank/g)).toHaveLength(1);
  });
});

describe("explainChromeLaunchFailure for a browser Windows refuses to run", () => {
  it("names the file, the error number and the usual causes, and never launches the browser again", async () => {
    const marker = join(mkdtempSync(join(tmpdir(), "hf-refused-")), "launched");
    const executablePath = fakeBrowser(
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "");`,
    );
    const refused = Object.assign(new Error("spawn UNKNOWN"), {
      code: "UNKNOWN",
      errno: -4094,
      syscall: "spawn",
    });
    const explained = (await explainChromeLaunchFailure(refused, executablePath, [])) as Error;
    expect(explained.message).toContain(executablePath);
    expect(explained.message).toContain("error -4094");
    expect(explained.message).toContain("browser ensure --force");
    expect(explained.message).toContain("Application Control");
    expect(explained.message).toContain("HYPERFRAMES_BROWSER_PATH");
    expect(explained.cause).toBe(refused);
    expect(existsSync(marker)).toBe(false);
  });
});
