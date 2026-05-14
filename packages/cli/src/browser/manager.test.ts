/**
 * Browser-binary resolution tests for `findBrowser()`.
 *
 * The CLI's `ensureBrowser` is responsible for picking the Chrome binary the
 * engine will be launched with. There are two real-world failure modes this
 * suite guards against:
 *
 *   1. `chrome-headless-shell` is installed in the puppeteer cache (the
 *      directory the engine itself reads), but the CLI used to only scan its
 *      own `~/.cache/hyperframes/chrome` cache — leaving the engine without a
 *      headless-shell binary and silently disabling the BeginFrame capture
 *      path.
 *   2. The CLI falls back to system Chrome (`/usr/bin/google-chrome`) on
 *      Linux, which still launches successfully but has dropped
 *      `HeadlessExperimental.enable` — again disabling the BeginFrame path
 *      with no user-visible signal.
 *
 * Each test stubs filesystem + `@puppeteer/browsers` access using `vi.doMock`
 * + dynamic import (the same pattern other modules in this package use, e.g.
 * `background-removal/manager.test.ts`) so we don't touch the real
 * `HOME` cache.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FAKE_HOME = "/fake/home";

// Cache-relative paths (kept in lock-step with manager.ts).
const HF_CACHE = `${FAKE_HOME}/.cache/hyperframes/chrome`;
const PUPPETEER_CACHE = `${FAKE_HOME}/.cache/puppeteer/chrome-headless-shell`;
const PUPPETEER_BINARY = `${PUPPETEER_CACHE}/linux-148.0.7778.97/chrome-headless-shell-linux64/chrome-headless-shell`;
const HF_BINARY = `${HF_CACHE}/chrome-headless-shell/linux-131.0.6778.85/chrome-headless-shell-linux64/chrome-headless-shell`;
const SYSTEM_CHROME = "/usr/bin/google-chrome";

interface FsMockOptions {
  existing: ReadonlySet<string>;
  /** map of dir path -> entries returned by readdirSync */
  dirs?: Record<string, string[]>;
}

function installFsMocks({ existing, dirs }: FsMockOptions) {
  vi.doMock("node:fs", () => ({
    existsSync: (p: string) => existing.has(p),
    readdirSync: (p: string) => {
      const entries = dirs?.[p];
      if (!entries) throw new Error(`ENOENT: readdirSync mock had no entry for ${p}`);
      return entries;
    },
    rmSync: () => {},
  }));
  vi.doMock("node:os", () => ({
    homedir: () => FAKE_HOME,
    platform: () => "linux",
    arch: () => "x64",
  }));
}

function installPuppeteerBrowsersMock(
  opts: {
    installedInHfCache?: Array<{ browser: string; executablePath: string }>;
  } = {},
) {
  vi.doMock("@puppeteer/browsers", () => ({
    Browser: { CHROMEHEADLESSSHELL: "chrome-headless-shell" },
    detectBrowserPlatform: () => "linux",
    getInstalledBrowsers: vi.fn().mockResolvedValue(opts.installedInHfCache ?? []),
    install: vi.fn(),
  }));
}

describe("findBrowser — cache resolution", () => {
  const origPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    // Force Linux for the system-fallback warning assertions. The
    // `Object.defineProperty` dance is needed because `process.platform` is a
    // getter on Node — direct assignment is silently a no-op.
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    delete process.env["HYPERFRAMES_BROWSER_PATH"];
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
    vi.restoreAllMocks();
    vi.doUnmock("node:fs");
    vi.doUnmock("node:os");
    vi.doUnmock("@puppeteer/browsers");
  });

  it("resolves to the hyperframes-managed cache when present", async () => {
    installFsMocks({ existing: new Set([HF_CACHE, HF_BINARY]) });
    installPuppeteerBrowsersMock({
      installedInHfCache: [{ browser: "chrome-headless-shell", executablePath: HF_BINARY }],
    });

    const { findBrowser } = await import("./manager.js");
    const result = await findBrowser();

    expect(result).toEqual({ executablePath: HF_BINARY, source: "cache" });
  });

  it("falls back to the puppeteer-managed cache when hyperframes cache is empty", async () => {
    // Empty hyperframes cache, populated puppeteer cache — the regression
    // scenario from the hf#677 spike.
    installFsMocks({
      existing: new Set([PUPPETEER_CACHE, PUPPETEER_BINARY]),
      dirs: { [PUPPETEER_CACHE]: ["linux-148.0.7778.97"] },
    });
    installPuppeteerBrowsersMock();

    const { findBrowser } = await import("./manager.js");
    const result = await findBrowser();

    expect(result).toEqual({ executablePath: PUPPETEER_BINARY, source: "cache" });
  });

  it("picks the newest version when multiple chrome-headless-shell builds are cached", async () => {
    const olderBinary = `${PUPPETEER_CACHE}/linux-131.0.6778.85/chrome-headless-shell-linux64/chrome-headless-shell`;
    installFsMocks({
      existing: new Set([PUPPETEER_CACHE, PUPPETEER_BINARY, olderBinary]),
      dirs: { [PUPPETEER_CACHE]: ["linux-131.0.6778.85", "linux-148.0.7778.97"] },
    });
    installPuppeteerBrowsersMock();

    const { findBrowser } = await import("./manager.js");
    const result = await findBrowser();

    expect(result?.executablePath).toBe(PUPPETEER_BINARY);
  });

  it("falls back to system Chrome and warns on Linux when no cache has headless-shell", async () => {
    installFsMocks({ existing: new Set([SYSTEM_CHROME]) });
    installPuppeteerBrowsersMock();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { findBrowser, _resetSystemFallbackWarnForTests } = await import("./manager.js");
    _resetSystemFallbackWarnForTests();
    const result = await findBrowser();

    expect(result).toEqual({ executablePath: SYSTEM_CHROME, source: "system" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0]?.[0];
    expect(message).toContain(SYSTEM_CHROME);
    expect(message).toContain("HeadlessExperimental");
    expect(message).toContain("chrome-headless-shell");
  });

  it("does NOT warn when the system path happens to be chrome-headless-shell", async () => {
    // HYPERFRAMES_BROWSER_PATH-style override pointing directly at a
    // headless-shell binary should NOT trigger the system-Chrome warning. The
    // warning is gated on the binary name, not the path source.
    const directShell = "/opt/chrome-headless-shell/chrome-headless-shell";
    installFsMocks({ existing: new Set([directShell]) });
    installPuppeteerBrowsersMock();
    process.env["HYPERFRAMES_BROWSER_PATH"] = directShell;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { findBrowser, _resetSystemFallbackWarnForTests } = await import("./manager.js");
    _resetSystemFallbackWarnForTests();
    const result = await findBrowser();

    expect(result?.executablePath).toBe(directShell);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does NOT warn on macOS when falling back to system Chrome", async () => {
    // macOS Chrome still works fine for the screenshot path and the perf
    // claims around BeginFrame are Linux-only — keep the warning Linux-scoped
    // so darwin users don't get spammed about a "fix" that doesn't apply.
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    const darwinChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    installFsMocks({ existing: new Set([darwinChrome]) });
    vi.doMock("@puppeteer/browsers", () => ({
      Browser: { CHROMEHEADLESSSHELL: "chrome-headless-shell" },
      detectBrowserPlatform: () => "mac_arm",
      getInstalledBrowsers: vi.fn().mockResolvedValue([]),
      install: vi.fn(),
    }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { findBrowser, _resetSystemFallbackWarnForTests } = await import("./manager.js");
    _resetSystemFallbackWarnForTests();
    const result = await findBrowser();

    expect(result?.executablePath).toBe(darwinChrome);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("only warns once across repeated findBrowser() calls", async () => {
    installFsMocks({ existing: new Set([SYSTEM_CHROME]) });
    installPuppeteerBrowsersMock();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { findBrowser, _resetSystemFallbackWarnForTests } = await import("./manager.js");
    _resetSystemFallbackWarnForTests();
    await findBrowser();
    await findBrowser();
    await findBrowser();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
