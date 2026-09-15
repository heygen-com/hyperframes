import { join } from "node:path";
import { homedir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SYSTEM_CHROME = "/usr/bin/google-chrome";
// Both the puppeteer and the hyperframes-managed caches live under here.
const HOME_CACHE_ROOT = join(homedir(), ".cache");
const PUPPETEER_CACHE = join(HOME_CACHE_ROOT, "puppeteer", "chrome-headless-shell");
const PUPPETEER_VERSION_DIR = "linux-148.0.7778.97";
const PUPPETEER_BINARY = join(
  PUPPETEER_CACHE,
  PUPPETEER_VERSION_DIR,
  "chrome-headless-shell-linux64",
  "chrome-headless-shell",
);

describe("hyperframes browser path", () => {
  const origPlatform = process.platform;
  const origArch = process.arch;
  const origEnv = {
    HYPERFRAMES_BROWSER_PATH: process.env["HYPERFRAMES_BROWSER_PATH"],
    PRODUCER_HEADLESS_SHELL_PATH: process.env["PRODUCER_HEADLESS_SHELL_PATH"],
  };

  beforeEach(() => {
    vi.resetModules();
    delete process.env["HYPERFRAMES_BROWSER_PATH"];
    delete process.env["PRODUCER_HEADLESS_SHELL_PATH"];
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
    Object.defineProperty(process, "arch", { value: origArch, configurable: true });
    for (const [key, value] of Object.entries(origEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
    vi.doUnmock("node:fs");
  });

  it("prints the system Chromium path on Linux ARM64 without downloading", async () => {
    // `browser path` resolves with preferManagedChrome so it prints what
    // render uses. On Linux ARM64 there is no managed build, so that lookup
    // must still surface system Chromium directly — not fall into the
    // download path (ensureBrowser) to reach the same answer.
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    Object.defineProperty(process, "arch", { value: "arm64", configurable: true });
    vi.doMock("node:fs", async (importOriginal) => {
      const real = await importOriginal<typeof import("node:fs")>();
      return {
        ...real,
        existsSync: (p: string) => {
          if (p === SYSTEM_CHROME) return true;
          // Whatever the host has cached must not leak into this fixture.
          if (p.startsWith(HOME_CACHE_ROOT)) return false;
          return real.existsSync(p);
        },
      };
    });

    const manager = await import("../browser/manager.js");
    const ensureSpy = vi
      .spyOn(manager, "ensureBrowser")
      .mockResolvedValue({ executablePath: "/downloaded/chrome", source: "download" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const written: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

    try {
      const { default: browserCommand } = await import("./browser.js");
      await browserCommand.run?.({
        args: { subcommand: "path", force: false, _: [] },
        cmd: browserCommand,
        rawArgs: ["path"],
      });
    } finally {
      stdoutSpy.mockRestore();
    }

    expect(written.join("")).toBe(`${SYSTEM_CHROME}\n`);
    expect(ensureSpy).not.toHaveBeenCalled();
  });

  it("does not print a puppeteer-cache binary on x64 when the pinned managed cache is empty", async () => {
    // The ARM64 case above cannot tell a qualified lookup from an unqualified
    // one — preferManagedChrome is a no-op there by design. On x64 the two
    // diverge: the unqualified resolution would print the puppeteer-cache
    // binary, which a preferManagedChrome render ignores and re-downloads
    // over. Both `runPath` resolutions must carry the option so the printed
    // path is the one render will actually launch.
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    Object.defineProperty(process, "arch", { value: "x64", configurable: true });
    vi.doMock("node:fs", async (importOriginal) => {
      const real = await importOriginal<typeof import("node:fs")>();
      return {
        ...real,
        existsSync: (p: string) => {
          if (p === PUPPETEER_CACHE || p === PUPPETEER_BINARY) return true;
          if (p.startsWith(HOME_CACHE_ROOT)) return false;
          return real.existsSync(p);
        },
        readdirSync: ((p: string, ...rest: unknown[]) =>
          p === PUPPETEER_CACHE
            ? [PUPPETEER_VERSION_DIR]
            : (real.readdirSync as (...args: unknown[]) => unknown)(
                p,
                ...rest,
              )) as typeof real.readdirSync,
      };
    });

    const manager = await import("../browser/manager.js");
    const findSpy = vi.spyOn(manager, "findBrowser");
    const ensureSpy = vi
      .spyOn(manager, "ensureBrowser")
      .mockResolvedValue({ executablePath: "/downloaded/chrome", source: "download" });
    const written: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

    try {
      const { default: browserCommand } = await import("./browser.js");
      await browserCommand.run?.({
        args: { subcommand: "path", force: false, _: [] },
        cmd: browserCommand,
        rawArgs: ["path"],
      });
    } finally {
      stdoutSpy.mockRestore();
    }

    // Sanity: the fixture really does hold a binary the unqualified lookup
    // would have accepted, so a miss below is the option at work.
    expect(await manager.findBrowser()).toEqual({
      executablePath: PUPPETEER_BINARY,
      source: "cache",
    });
    expect(written.join("")).toBe("/downloaded/chrome\n");
    expect(findSpy).toHaveBeenCalledWith({ preferManagedChrome: true });
    expect(ensureSpy).toHaveBeenCalledTimes(1);
    expect(ensureSpy).toHaveBeenCalledWith({ preferManagedChrome: true });
  });
});
