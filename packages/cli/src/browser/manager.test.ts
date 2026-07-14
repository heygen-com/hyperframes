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
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHROME_VERSION } from "./manager.js";

// Use `path.join` so the fake paths line up with whatever separator Node's
// real `path.join` produces in `manager.ts` on the host running the test
// (forward slashes on Linux/macOS, backslashes on Windows CI). Hardcoded
// `/fake/home/...` literals would fail on Windows because the set lookup
// would never match the `\\`-joined real paths.
const FAKE_HOME = join("/", "fake", "home");
const CACHE_ROOT = join(FAKE_HOME, ".cache", "hyperframes");
const HF_CACHE = join(FAKE_HOME, ".cache", "hyperframes", "chrome");
const HF_LOCK = join(CACHE_ROOT, ".chrome.install.lock");
const HF_RECLAIM_LOCK = join(CACHE_ROOT, ".chrome.install.reclaim.lock");
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
const TEST_LOCK_TIMINGS = {
  staleMs: 50,
  pollMs: 5,
  heartbeatMs: 10,
  waitNoticeMs: 1_000,
};

interface FsMockOptions {
  existing: ReadonlySet<string>;
  /** map of dir path -> entries returned by readdirSync */
  dirs?: Record<string, string[]>;
  touchError?: Error;
  initialMtimeMs?: number;
}

function installFsMocks({ existing, dirs, touchError, initialMtimeMs = 0 }: FsMockOptions) {
  // Mutable, and returned, so tests can pre-seed a "lock already held" path or
  // assert the lock dir doesn't leak after ensureBrowser resolves.
  const paths = new Set(existing);
  const mtimes = new Map([...existing].map((p) => [p, initialMtimeMs]));
  vi.doMock("node:fs", () => ({
    existsSync: (p: string) => paths.has(p),
    readdirSync: (p: string) => {
      const entries = dirs?.[p];
      if (!entries) throw new Error(`ENOENT: readdirSync mock had no entry for ${p}`);
      return entries;
    },
    mkdirSync: (p: string, opts?: { recursive?: boolean }) => {
      if (!opts?.recursive && paths.has(p)) {
        const err = new Error(`EEXIST: file already exists, mkdir '${p}'`);
        (err as NodeJS.ErrnoException).code = "EEXIST";
        throw err;
      }
      paths.add(p);
      mtimes.set(p, Date.now());
    },
    rmSync: (p: string) => {
      // Real rmSync({recursive:true}) removes the target AND everything under
      // it; the mock's flat path Set has no real tree structure, so simulate
      // that by also dropping any tracked path nested under `p`.
      for (const existingPath of [...paths]) {
        if (existingPath === p || existingPath.startsWith(p + sep)) {
          paths.delete(existingPath);
          mtimes.delete(existingPath);
        }
      }
    },
    statSync: (p: string) => {
      if (!paths.has(p)) {
        const err = new Error(`ENOENT: no such file or directory, stat '${p}'`);
        (err as NodeJS.ErrnoException).code = "ENOENT";
        throw err;
      }
      return { mtimeMs: mtimes.get(p) ?? 0 };
    },
    utimesSync: (p: string, _atime: Date, mtime: Date) => {
      if (touchError) throw touchError;
      if (!paths.has(p)) {
        const err = new Error(`ENOENT: no such file or directory, utimes '${p}'`);
        (err as NodeJS.ErrnoException).code = "ENOENT";
        throw err;
      }
      mtimes.set(p, mtime.getTime());
    },
  }));
  vi.doMock("node:os", () => ({
    homedir: () => FAKE_HOME,
    platform: () => "linux",
    arch: () => "x64",
  }));
  return paths;
}

function installPuppeteerBrowsersMock(
  opts: {
    installedInHfCache?: Array<{
      browser: string;
      executablePath: string;
      path?: string;
      buildId?: string;
    }>;
    installedInHfCacheError?: Error;
    installResult?: { executablePath: string };
    installImpl?: () => Promise<{ executablePath: string }>;
  } = {},
) {
  vi.doMock("@puppeteer/browsers", () => ({
    Browser: { CHROMEHEADLESSSHELL: "chrome-headless-shell" },
    detectBrowserPlatform: () => "linux",
    getInstalledBrowsers: opts.installedInHfCacheError
      ? vi.fn().mockRejectedValue(opts.installedInHfCacheError)
      : vi.fn().mockResolvedValue(opts.installedInHfCache ?? []),
    install: vi
      .fn()
      .mockImplementation(
        opts.installImpl ?? (async () => opts.installResult ?? { executablePath: HF_BINARY }),
      ),
  }));
}

function installChildProcessMocks() {
  vi.doMock("node:child_process", () => ({
    execSync: vi.fn(() => {
      throw new Error("not found");
    }),
    spawnSync: vi.fn(),
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
    installChildProcessMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
    Object.defineProperty(process, "arch", { value: origArch, configurable: true });
    vi.restoreAllMocks();
    vi.doUnmock("node:fs");
    vi.doUnmock("node:os");
    vi.doUnmock("node:child_process");
    vi.doUnmock("@puppeteer/browsers");
  });

  it("resolves to the hyperframes-managed cache when puppeteer cache is empty", async () => {
    // Only HF cache populated. Puppeteer cache is the higher-priority path
    // (see "prefers puppeteer cache" test below), so this exercises the
    // last-resort fallback.
    installFsMocks({ existing: new Set([HF_CACHE, HF_BINARY]) });
    installPuppeteerBrowsersMock({
      installedInHfCache: [
        { browser: "chrome-headless-shell", executablePath: HF_BINARY, buildId: CHROME_VERSION },
      ],
    });

    const { findBrowser } = await import("./manager.js");
    const result = await findBrowser();

    expect(result).toEqual({ executablePath: HF_BINARY, source: "cache" });
  });

  it("does not resolve to a hyperframes-cache build from an older CHROME_VERSION pin", async () => {
    // A build downloaded by a prior hyperframes version (this pin has moved
    // 131 -> 151 -> 152 across releases) must not satisfy resolution, or an
    // upgrade silently keeps running a stale build forever instead of ever
    // fetching the version the new release actually needs (HF#2060 review).
    installFsMocks({ existing: new Set([HF_CACHE, HF_BINARY, SYSTEM_CHROME]) });
    installPuppeteerBrowsersMock({
      installedInHfCache: [
        { browser: "chrome-headless-shell", executablePath: HF_BINARY, buildId: "131.0.6778.85" },
      ],
    });

    const { findBrowser } = await import("./manager.js");
    const result = await findBrowser();

    expect(result?.executablePath).not.toBe(HF_BINARY);
    expect(result).toEqual({ executablePath: SYSTEM_CHROME, source: "system" });
  });

  it("re-downloads when the hyperframes cache manifest points at a missing binary", async () => {
    const redownloadedBinary = join(
      HF_CACHE,
      "chrome-headless-shell",
      "linux-131.0.6778.85",
      "chrome-headless-shell-linux64",
      "redownloaded-chrome-headless-shell",
    );
    const staleInstallDir = join(HF_CACHE, "chrome-headless-shell", "linux-131.0.6778.85");
    // The stale install DIR is present (extraction got partway through, e.g. an
    // ABOUT/LICENSE-only extract) even though the exe itself is missing —
    // exercises the purge-before-redownload fix, not just the redownload path.
    const paths = installFsMocks({ existing: new Set([HF_CACHE, staleInstallDir]) });
    installPuppeteerBrowsersMock({
      installedInHfCache: [
        {
          browser: "chrome-headless-shell",
          executablePath: HF_BINARY,
          path: staleInstallDir,
          buildId: CHROME_VERSION,
        },
      ],
      installResult: { executablePath: redownloadedBinary },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { findBrowser } = await import("./manager.js");
    const result = await findBrowser();

    expect(result).toEqual({ executablePath: redownloadedBinary, source: "download" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Cached binary missing"));
    // The stale directory must be gone before @puppeteer/browsers' install()
    // sees it — otherwise install() throws "folder exists but exe missing"
    // instead of re-extracting (the exact bug both feedback reports hit).
    expect(paths.has(staleInstallDir)).toBe(false);
  });

  it("ensureBrowser({force: true}) purges the whole cache before downloading, bypassing any cache/system shortcut", async () => {
    const staleInstallDir = join(HF_CACHE, "chrome-headless-shell", "linux-131.0.6778.85");
    const downloadedBinary = join(HF_CACHE, "chrome-headless-shell", "force-downloaded");
    // A HEALTHY cached binary AND system Chrome are both present — force must
    // ignore both shortcuts and always re-download, which is the whole point
    // of the flag (the reported bug: --force did nothing, a stale dir kept
    // winning over every retry).
    const paths = installFsMocks({
      existing: new Set([HF_CACHE, HF_BINARY, staleInstallDir, SYSTEM_CHROME]),
    });
    installPuppeteerBrowsersMock({
      installedInHfCache: [
        { browser: "chrome-headless-shell", executablePath: HF_BINARY, path: staleInstallDir },
      ],
      installResult: { executablePath: downloadedBinary },
    });

    const { ensureBrowser } = await import("./manager.js");
    const result = await ensureBrowser({ force: true });

    expect(result).toEqual({ executablePath: downloadedBinary, source: "download" });
    // clearBrowser() wipes prior contents; withInstallLock uses a sibling lock
    // outside CACHE_DIR, so assert the purge on what was actually INSIDE it,
    // not the directory's own existence.
    expect(paths.has(staleInstallDir)).toBe(false);
    expect(paths.has(HF_BINARY)).toBe(false);
  });

  it("serializes concurrent force downloads so one purge cannot delete another installer's lock", async () => {
    const downloadedBinary = join(HF_CACHE, "chrome-headless-shell", "force-downloaded");
    const paths = installFsMocks({ existing: new Set([CACHE_ROOT, HF_CACHE, HF_BINARY]) });
    let activeInstalls = 0;
    let maxActiveInstalls = 0;
    installPuppeteerBrowsersMock({
      installedInHfCache: [{ browser: "chrome-headless-shell", executablePath: HF_BINARY }],
      installImpl: async () => {
        activeInstalls += 1;
        maxActiveInstalls = Math.max(maxActiveInstalls, activeInstalls);
        expect(paths.has(HF_LOCK)).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeInstalls -= 1;
        return { executablePath: downloadedBinary };
      },
    });

    const { ensureBrowser } = await import("./manager.js");

    await expect(
      Promise.all([ensureBrowser({ force: true }), ensureBrowser({ force: true })]),
    ).resolves.toEqual([
      { executablePath: downloadedBinary, source: "download" },
      { executablePath: downloadedBinary, source: "download" },
    ]);
    expect(maxActiveInstalls).toBe(1);
    expect(paths.has(HF_LOCK)).toBe(false);
  });

  it("ensureBrowser does not leak the install lock directory after a successful download", async () => {
    // Regression: @puppeteer/browsers' install() has no concurrency guard —
    // two CLI invocations that both miss the cache AND system Chrome (the
    // reported scenario: two `hyperframes browser ensure` runs racing) hit
    // ensureBrowser's final download-of-last-resort at once, racing on the
    // same extract target. mkdirSync as an atomic mutex closes that race;
    // this asserts the lock is actually released afterward (a leaked lock
    // would permanently wedge every future render on this machine).
    const downloadedBinary = join(HF_CACHE, "chrome-headless-shell", "downloaded");
    // Cache dir exists but is empty (no manifest entries) — distinct from the
    // ENOTDIR "cache unreadable" case, which falls back to system instead.
    const paths = installFsMocks({ existing: new Set([HF_CACHE]) });
    installPuppeteerBrowsersMock({
      installedInHfCache: [],
      installResult: { executablePath: downloadedBinary },
    });

    const { ensureBrowser } = await import("./manager.js");
    const result = await ensureBrowser();

    expect(result).toEqual({ executablePath: downloadedBinary, source: "download" });
    expect(paths.has(HF_LOCK)).toBe(false);
  });

  it("withInstallLock reclaims a lock held past the timeout instead of hanging forever", async () => {
    const paths = installFsMocks({ existing: new Set([CACHE_ROOT, HF_LOCK]) });

    const { withInstallLock } = await import("./manager.js");
    const result = await withInstallLock(async () => "done", TEST_LOCK_TIMINGS);

    expect(result).toBe("done");
    expect(paths.has(HF_LOCK)).toBe(false);
  });

  it("withInstallLock recovers when a crashed reclaimer leaves both lock directories", async () => {
    vi.useFakeTimers();
    const paths = installFsMocks({
      existing: new Set([CACHE_ROOT, HF_LOCK, HF_RECLAIM_LOCK]),
    });

    const { withInstallLock } = await import("./manager.js");
    const acquisition = withInstallLock(async () => "done", TEST_LOCK_TIMINGS);
    await vi.advanceTimersByTimeAsync(TEST_LOCK_TIMINGS.pollMs * 2);

    await expect(Promise.race([acquisition, Promise.resolve("still waiting")])).resolves.toBe(
      "done",
    );
    expect(paths.has(HF_LOCK)).toBe(false);
    expect(paths.has(HF_RECLAIM_LOCK)).toBe(false);
  });

  it("withInstallLock does not reclaim another waiter's fresh lock after this waiter timed out", async () => {
    // Regression guard for the timeout-reclaim race: if multiple waiters cross
    // the stale-lock deadline together, waiter A can reclaim the stale lock and
    // acquire a fresh one. Waiter B's old deadline is still expired, but it must
    // not delete A's fresh lock.
    const paths = installFsMocks({ existing: new Set([CACHE_ROOT, HF_LOCK]) });

    const { withInstallLock } = await import("./manager.js");
    const reclaimOnlyTimings = { ...TEST_LOCK_TIMINGS, heartbeatMs: 1_000 };
    const first = withInstallLock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return "first";
    }, reclaimOnlyTimings);
    const second = withInstallLock(async () => "second", reclaimOnlyTimings);

    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(paths.has(HF_LOCK)).toBe(false);
    expect(paths.has(HF_RECLAIM_LOCK)).toBe(false);
  });

  it("withInstallLock does not let a second caller run concurrently with a slow-but-alive holder", async () => {
    const paths = installFsMocks({ existing: new Set([CACHE_ROOT]) });

    const { withInstallLock } = await import("./manager.js");

    let concurrent = 0;
    let maxConcurrent = 0;
    const trackConcurrency = async (label: string, durationMs: number) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      concurrent -= 1;
      return label;
    };

    const first = withInstallLock(() => trackConcurrency("first", 120), TEST_LOCK_TIMINGS);
    await new Promise((resolve) => setTimeout(resolve, 5)); // let `first` acquire the lock
    const second = withInstallLock(() => trackConcurrency("second", 10), TEST_LOCK_TIMINGS);

    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(maxConcurrent).toBe(1);
    expect(paths.has(HF_LOCK)).toBe(false);
  });

  it("withInstallLock reports progress while waiting instead of staying silent", async () => {
    // Fake timers freeze Date.now() so the lock mtime stays non-stale across
    // the dynamic import that follows — without them, a slow import beat could
    // push wall-clock past staleMs before `withInstallLock` even starts polling,
    // firing the immediate-stale short-circuit and skipping the wait-notice
    // branch this test exists to observe.
    vi.useFakeTimers();
    const paths = installFsMocks({
      existing: new Set([CACHE_ROOT, HF_LOCK]),
      initialMtimeMs: Date.now(),
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { withInstallLock } = await import("./manager.js");
    const acquisition = withInstallLock(async () => "done", {
      ...TEST_LOCK_TIMINGS,
      waitNoticeMs: 20,
    });

    // Advance past waitNoticeMs (fires the "Waiting for…" warn), then past
    // staleMs (lets `reclaimStaleInstallLock` clear the held lock so the
    // acquisition resolves).
    await vi.advanceTimersByTimeAsync(TEST_LOCK_TIMINGS.staleMs + TEST_LOCK_TIMINGS.pollMs * 5);

    await expect(acquisition).resolves.toBe("done");
    expect(paths.has(HF_LOCK)).toBe(false);
    expect(
      warnSpy.mock.calls.some(([msg]) =>
        String(msg).includes("Waiting for another hyperframes process"),
      ),
    ).toBe(true);
  });

  it("keeps the holder running when a heartbeat cannot touch the lock", async () => {
    installFsMocks({
      existing: new Set([CACHE_ROOT]),
      touchError: Object.assign(new Error("EACCES"), { code: "EACCES" }),
    });

    const { withInstallLock } = await import("./manager.js");
    await expect(
      withInstallLock(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return "done";
      }, TEST_LOCK_TIMINGS),
    ).resolves.toBe("done");
  });

  it("warns and falls through when the hyperframes cache cannot be read", async () => {
    installFsMocks({ existing: new Set([HF_CACHE, SYSTEM_CHROME]) });
    installPuppeteerBrowsersMock({
      installedInHfCacheError: Object.assign(new Error("ENOTDIR: not a directory"), {
        code: "ENOTDIR",
      }),
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { findBrowser, _resetSystemFallbackWarnForTests } = await import("./manager.js");
    _resetSystemFallbackWarnForTests();
    const result = await findBrowser();

    expect(result).toEqual({ executablePath: SYSTEM_CHROME, source: "system" });
    expect(warnSpy.mock.calls[0]?.[0]).toContain("Browser cache read failed (ENOTDIR)");
    expect(warnSpy.mock.calls[0]?.[0]).toContain("Falling back to system Chrome");
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

describe("isCorruptArchiveError", () => {
  it("matches truncated / corrupt archive extraction failures", async () => {
    const { isCorruptArchiveError } = await import("./manager.js");
    for (const msg of [
      "invalid end-of-central-directory record",
      "end of central directory record signature not found",
      "invalid or corrupt zip file",
      "File is not a zip file",
      "unexpected end of file",
      "the archive is corrupted",
    ]) {
      expect(isCorruptArchiveError(new Error(msg))).toBe(true);
    }
  });

  it("does not match network or unrelated errors", async () => {
    const { isCorruptArchiveError } = await import("./manager.js");
    for (const msg of ["ECONNRESET", "socket hang up", "ENOENT: no such file", "boom"]) {
      expect(isCorruptArchiveError(new Error(msg))).toBe(false);
    }
  });
});

describe("installWithCorruptArchiveRecovery", () => {
  it("clears the cache and re-downloads once on a corrupt archive, then succeeds", async () => {
    const { installWithCorruptArchiveRecovery } = await import("./manager.js");
    const runInstall = vi
      .fn()
      .mockRejectedValueOnce(new Error("invalid end-of-central-directory record"))
      .mockResolvedValueOnce({ executablePath: "/ok" });
    const clearCache = vi.fn();
    const onRecover = vi.fn();

    const result = await installWithCorruptArchiveRecovery(runInstall, clearCache, onRecover);

    expect(result).toEqual({ executablePath: "/ok" });
    expect(runInstall).toHaveBeenCalledTimes(2);
    expect(clearCache).toHaveBeenCalledTimes(1);
    expect(onRecover).toHaveBeenCalledTimes(1);
  });

  it("propagates a non-corruption error without clearing the cache", async () => {
    const { installWithCorruptArchiveRecovery } = await import("./manager.js");
    const runInstall = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const clearCache = vi.fn();

    await expect(installWithCorruptArchiveRecovery(runInstall, clearCache)).rejects.toThrow(
      "ECONNRESET",
    );
    expect(runInstall).toHaveBeenCalledTimes(1);
    expect(clearCache).not.toHaveBeenCalled();
  });

  it("does not retry forever: a second corruption propagates", async () => {
    const { installWithCorruptArchiveRecovery } = await import("./manager.js");
    const runInstall = vi.fn().mockRejectedValue(new Error("end of central directory not found"));
    const clearCache = vi.fn();

    await expect(installWithCorruptArchiveRecovery(runInstall, clearCache)).rejects.toThrow(
      "end of central directory",
    );
    expect(runInstall).toHaveBeenCalledTimes(2);
    expect(clearCache).toHaveBeenCalledTimes(1);
  });
});

// Regression guard for HF#2103: `hyperframes render` hung forever on macOS
// (Apple Silicon) under Node >= 24.16. Root cause was NOT in this file — it was
// the extractor `@puppeteer/browsers` <3.0.2 shells out to. That chain
// (`@puppeteer/browsers` -> `extract-zip@2.0.1` -> `yauzl@2.10.0`) hits a
// classic-stream backpressure regression (nodejs/node#63487) that surfaces a
// latent fd-slicer `destroy()` bug in yauzl 2.x (yauzl#169): the inflate read
// stream stalls partway through the first entry large enough to cross the write
// highWaterMark, never emits `end`, and `stream.pipeline` never settles — so
// extraction busy-spins forever, leaving a half-extracted cache with no
// executable (puppeteer/puppeteer#14957).
//
// `@puppeteer/browsers` 3.0.2 dropped `extract-zip` as a dependency and now
// extracts with `modern-tar` by default (`yauzl` lingers only as an optional
// peer fallback — no longer a runtime dependency), which is the fix. This test
// fails if a dependency change ever drags the pin back below 3.x — i.e.
// reintroduces the broken extractor as a hard dependency.
describe("@puppeteer/browsers pin (HF#2103 extractor-hang regression guard)", () => {
  it("stays on the major (>= 3) that dropped extract-zip and no longer depends on yauzl", async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const pkg = require("@puppeteer/browsers/package.json") as {
      version: string;
      dependencies?: Record<string, string>;
    };

    const major = Number.parseInt(pkg.version.split(".")[0] ?? "0", 10);
    expect(major).toBeGreaterThanOrEqual(3);

    // Belt and suspenders: the durable fix is the *absence* of the broken
    // extractor, not just a version number, so assert it directly.
    const deps = pkg.dependencies ?? {};
    expect(deps["extract-zip"]).toBeUndefined();
    expect(deps["yauzl"]).toBeUndefined();
  });
});
