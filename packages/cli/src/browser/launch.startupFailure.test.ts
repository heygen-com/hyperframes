import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { launchManagedBrowser } from "./launch.js";

function fakeBrowser(body: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "hf-fake-chrome-")), "chrome");
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe.runIf(process.platform !== "win32")("a browser that dies at startup", () => {
  it("fails the launch with its exit code and last stderr lines, not just 'Target closed'", async () => {
    const executablePath = fakeBrowser(
      'process.stderr.write("[1:1:FATAL:headless_shell] out of memory\\n"); process.exit(7);',
    );
    const puppeteer = (await import("puppeteer-core")).default;
    const failure = await launchManagedBrowser(puppeteer, {
      executablePath,
      headless: true,
      args: [],
    }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toContain("exited with code 7");
    expect(failure?.message).toContain("out of memory");
    expect(failure?.cause).toBeInstanceOf(Error);
  }, 60_000);

  it("starts the probe headless, as puppeteer starts it, so a full Chrome is not run headful", async () => {
    const executablePath = fakeBrowser(
      "console.error(process.argv.slice(2).join(' ')); process.exit(3);",
    );
    const puppeteer = (await import("puppeteer-core")).default;
    const failure = await launchManagedBrowser(puppeteer, {
      executablePath,
      headless: true,
      args: [],
    }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toMatch(/--headless/);
  }, 60_000);

  it("skips the diagnosis for a launch whose failure the caller handles, such as the GPU probe", async () => {
    const executablePath = fakeBrowser("process.exit(3);");
    const puppeteer = (await import("puppeteer-core")).default;
    const failure = await launchManagedBrowser(
      puppeteer,
      { executablePath, headless: true, args: [] },
      { diagnose: false },
    ).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(failure?.message).not.toContain("exited with code");
  }, 60_000);
});

describe("a launch failure whose diagnosis cannot run", () => {
  it("still reports the launch error when puppeteer cannot give the default arguments", async () => {
    const launchError = new Error("Failed to launch the browser process");
    const puppeteer = {
      launch: async () => {
        throw launchError;
      },
      defaultArgs: () => {
        throw new TypeError("no defaults");
      },
    };
    const failure = await launchManagedBrowser(puppeteer as never, {
      executablePath: "/bin/true",
      headless: true,
      args: [],
    }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(failure).toBe(launchError);
  });
});
