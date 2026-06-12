// fallow-ignore-file code-duplication
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
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Use `path.join` so the fake paths line up with whatever separator Node's
// real `path.join` produces in `manager.ts` on the host running the test
// (forward slashes on Linux/macOS, backslashes on Windows CI). Hardcoded
// `/fake/home/...` literals would fail on Windows because the set lookup
// would never match the `\\`-joined real paths.
const FAKE_HOME = join("/", "fake", "home");
const HF_CACHE = join(FAKE_HOME, ".cache", "hyperframes", "chrome");
const PUPPETEER_CACHE = join(FAKE_HOME, ".cache", "puppeteer", "chrome-headless-shell");
const PUPPETEER_BINARY = join(
  PUPPETEER_CACHE,
  "linux-148.0.7778.97",
  "chrome-headless-shell-linux64",
  "chrome-headless-shell",
);
const HF_BINARY = join(
  HF_CACHE,
  "chrome-headless-shell",
  "linux-131.0.6778.85",
  "chrome-headless-shell-linux64",
  "chrome-headless-shell",
);
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
    installResult?: { executablePath: string };
  } = {},
) {
  vi.doMock("@puppeteer/browsers", () => ({
    Browser: { CHROMEHEADLESSSHELL: "chrome-headless-shell" },
    detectBrowserPlatform: () => "linux",
    getInstalledBrowsers: vi.fn().mockResolvedValue(opts.installedInHfCache ?? []),
    install: vi.fn().mockResolvedValue(opts.installResult ?? { executablePath: HF_BINARY }),
  }));
}

describe("findBrowser — cache resolution", () => {
  const origPlatform = process.platform;
  const origArch = process.arch;

  beforeEach(() => {
    vi.resetModules();
    // Force Linux for the system-fallback warning assertions. The
    // `Object.defineProperty` dance is needed because `process.platform` is a
    // getter on Node — direct assignment is silently a no-op.
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    Object.defineProperty(process, "arch", { value: "x64", configurable: true });
    delete process.env["HYPERFRAMES_BROWSER_PATH"];
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
    Object.defineProperty(process, "arch", { value: origArch, configurable: true });
    vi.restoreAllMocks();
    vi.doUnmock("node:fs");
    vi.doUnmock("node:os");
    vi.doUnmock("@puppeteer/browsers");
  });

  it("resolves to the hyperframes-managed cache when puppeteer cache is empty", async () => {
    // Only HF cache populated. Puppeteer cache is the higher-priority path
    // (see "prefers puppeteer cache" test below), so this exercises the
    // last-resort fallback.
    installFsMocks({ existing: new Set([HF_CACHE, HF_BINARY]) });
    installPuppeteerBrowsersMock({
      installedInHfCache: [{ browser: "chrome-headless-shell", executablePath: HF_BINARY }],
    });

    const { findBrowser } = await import("./manager.js");
    const result = await findBrowser();

    expect(result).toEqual({ executablePath: HF_BINARY, source: "cache" });
  });

  it("re-downloads when the hyperframes cache manifest points at a missing binary", async () => {
    const redownloadedBinary = join(
      HF_CACHE,
      "chrome-headless-shell",
      "linux-131.0.6778.85",
      "chrome-headless-shell-linux64",
      "redownloaded-chrome-headless-shell",
    );
    installFsMocks({ existing: new Set([HF_CACHE]) });
    installPuppeteerBrowsersMock({
      installedInHfCache: [{ browser: "chrome-headless-shell", executablePath: HF_BINARY }],
      installResult: { executablePath: redownloadedBinary },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { findBrowser } = await import("./manager.js");
    const result = await findBrowser();

    expect(result).toEqual({ executablePath: redownloadedBinary, source: "download" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Cached binary missing"));
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

  it("prefers the puppeteer cache over the hyperframes cache when BOTH are populated", async () => {
    // The HF cache is pinned to `CHROME_VERSION` (131-era) which lags upstream
    // by many releases. The engine's `resolveHeadlessShellPath` scans the
    // puppeteer cache and selects newest-version-first; if the CLI handed
    // engine the older HF-cache binary while a newer puppeteer-cache binary
    // exists, the two would silently disagree on which binary to use.
    // This test pins the priority: puppeteer cache wins when both are populated.
    installFsMocks({
      existing: new Set([HF_CACHE, HF_BINARY, PUPPETEER_CACHE, PUPPETEER_BINARY]),
      dirs: { [PUPPETEER_CACHE]: ["linux-148.0.7778.97"] },
    });
    installPuppeteerBrowsersMock({
      installedInHfCache: [{ browser: "chrome-headless-shell", executablePath: HF_BINARY }],
    });

    const { findBrowser } = await import("./manager.js");
    const result = await findBrowser();

    expect(result?.executablePath).toBe(PUPPETEER_BINARY);
    expect(result?.source).toBe("cache");
  });

  it("picks the newest version when multiple chrome-headless-shell builds are cached", async () => {
    const olderBinary = join(
      PUPPETEER_CACHE,
      "linux-131.0.6778.85",
      "chrome-headless-shell-linux64",
      "chrome-headless-shell",
    );
    installFsMocks({
      existing: new Set([PUPPETEER_CACHE, PUPPETEER_BINARY, olderBinary]),
      dirs: { [PUPPETEER_CACHE]: ["linux-131.0.6778.85", "linux-148.0.7778.97"] },
    });
    installPuppeteerBrowsersMock();

    const { findBrowser } = await import("./manager.js");
    const result = await findBrowser();

    expect(result?.executablePath).toBe(PUPPETEER_BINARY);
  });

  it("uses numeric (not lexicographic) version ordering — linux-148 beats linux-99", async () => {
    // Regression guard for the lexicographic-sort bug: `"linux-99..."` sorts
    // after `"linux-148..."` character-by-character (because `'9' > '1'`),
    // which would have caused the CLI to hand engine an ancient 99-era binary
    // when a fresh 148 was sitting right next to it. Numeric semver-style
    // ordering is the only correct semantic.
    const linux99Binary = join(
      PUPPETEER_CACHE,
      "linux-99.0.6533.123",
      "chrome-headless-shell-linux64",
      "chrome-headless-shell",
    );
    installFsMocks({
      existing: new Set([PUPPETEER_CACHE, PUPPETEER_BINARY, linux99Binary]),
      // Intentionally list the entries in an order that would expose the bug
      // under naive `.sort().reverse()` (which puts `linux-99...` first).
      dirs: { [PUPPETEER_CACHE]: ["linux-99.0.6533.123", "linux-148.0.7778.97"] },
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
