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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { managedChromeVersion } from "./manager.js";

const CHROME_VERSION = managedChromeVersion();

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

// Points node:os homedir at a fresh temp dir so the manager runs against the real filesystem.
function useRealCacheHome(): string {
  const home = mkdtempSync(join(tmpdir(), "hf-browser-cache-"));
  vi.doMock("node:os", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:os")>()),
    homedir: () => home,
  }));
  return home;
}

function stagedVersionDir(cacheDir: string, buildId: string): string {
  return join(cacheDir, "chrome-headless-shell", `linux-${buildId}`);
}

function writeStagedInstall(cacheDir: string, buildId: string, content: string) {
  const path = stagedVersionDir(cacheDir, buildId);
  const executablePath = join(path, "chrome-headless-shell-linux64", "chrome-headless-shell");
  mkdirSync(dirname(executablePath), { recursive: true });
  writeFileSync(executablePath, content);
  return { executablePath, path };
}

// The mocked fs path set of the current test, so the install mock can stage files into it.
let mockedPaths: Set<string> | undefined;

interface FsMockOptions {
  existing: ReadonlySet<string>;
  /** map of dir path -> entries returned by readdirSync */
  dirs?: Record<string, string[]>;
  touchError?: Error;
  initialMtimeMs?: number;
  /** what node:os reports; defaults to a Linux host */
  osHost?: { platform: string; release: string };
  /** paths whose stat reports 0 bytes */
  emptyFiles?: ReadonlySet<string>;
}

function installFsMocks({
  existing,
  dirs,
  touchError,
  initialMtimeMs = 0,
  osHost = { platform: "linux", release: "24.0.0" },
  emptyFiles,
}: FsMockOptions) {
  // Mutable, and returned, so tests can pre-seed a "lock already held" path or
  // assert the lock dir doesn't leak after ensureBrowser resolves.
  const paths = new Set(existing);
  mockedPaths = paths;
  const mtimes = new Map([...existing].map((p) => [p, initialMtimeMs]));
  const contents = new Map<string, string>();
  vi.doMock("node:fs", () => ({
    existsSync: (p: string) => paths.has(p),
    readdirSync: (p: string) => {
      const entries = dirs?.[p];
      if (!entries) {
        const err = new Error(`ENOENT: readdirSync mock had no entry for ${p}`);
        (err as NodeJS.ErrnoException).code = "ENOENT";
        throw err;
      }
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
          contents.delete(existingPath);
        }
      }
    },
    renameSync: (from: string, to: string) => {
      const moved = [...paths].filter((p) => p === from || p.startsWith(from + sep));
      if (moved.length === 0) {
        const err = new Error(`ENOENT: no such file or directory, rename '${from}'`);
        (err as NodeJS.ErrnoException).code = "ENOENT";
        throw err;
      }
      for (const p of moved) {
        paths.delete(p);
        paths.add(to + p.slice(from.length));
      }
    },
    statSync: (p: string, opts?: { throwIfNoEntry?: boolean }) => {
      if (!paths.has(p)) {
        if (opts?.throwIfNoEntry === false) return undefined;
        const err = new Error(`ENOENT: no such file or directory, stat '${p}'`);
        (err as NodeJS.ErrnoException).code = "ENOENT";
        throw err;
      }
      return { mtimeMs: mtimes.get(p) ?? 0, size: emptyFiles?.has(p) ? 0 : 1, isFile: () => true };
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
    writeFileSync: (p: string, value: string) => {
      paths.add(p);
      contents.set(p, value);
    },
    readFileSync: (p: string) => {
      const value = contents.get(p);
      if (value === undefined) {
        const err = new Error(`ENOENT: no such file or directory, read '${p}'`);
        (err as NodeJS.ErrnoException).code = "ENOENT";
        throw err;
      }
      return value;
    },
  }));
  vi.doMock("node:os", () => ({
    homedir: () => FAKE_HOME,
    platform: () => osHost.platform,
    release: () => osHost.release,
    arch: () => "x64",
  }));
  return paths;
}

interface InstallMockOptions {
  buildId: string;
  cacheDir: string;
  logger?: (prefix: string) => ((...args: unknown[]) => void) | undefined;
}

function installPuppeteerBrowsersMock(
  opts: {
    installedInHfCache?: Array<{
      browser: string;
      executablePath: string;
      path?: string;
      buildId?: string;
      platform?: string;
    }>;
    browserPlatform?: string;
    installedInHfCacheError?: Error;
    installResult?: { executablePath: string; path?: string };
    installImpl?: (
      options: InstallMockOptions,
    ) => Promise<{ executablePath: string; path?: string }>;
  } = {},
) {
  const impl =
    opts.installImpl ?? (async () => opts.installResult ?? { executablePath: HF_BINARY });
  // Fixtures name the binary where it lands in HF_CACHE; install() really writes it under its own cacheDir.
  const stagedInstall = async (options: InstallMockOptions) => {
    const result = await impl(options);
    if (result.path || !result.executablePath.startsWith(HF_CACHE + sep)) return result;
    const rel = relative(HF_CACHE, result.executablePath);
    const executablePath = join(options.cacheDir, rel);
    const path = join(options.cacheDir, ...rel.split(sep).slice(0, 2));
    mockedPaths?.add(path).add(executablePath);
    return { executablePath, path };
  };
  vi.doMock("@puppeteer/browsers", () => ({
    Browser: { CHROMEHEADLESSSHELL: "chrome-headless-shell" },
    detectBrowserPlatform: () => opts.browserPlatform ?? "linux",
    getInstalledBrowsers: opts.installedInHfCacheError
      ? vi.fn().mockRejectedValue(opts.installedInHfCacheError)
      : vi.fn().mockResolvedValue(
          (opts.installedInHfCache ?? []).map((browser) => ({
            platform: opts.browserPlatform ?? "linux",
            ...browser,
          })),
        ),
    install: vi.fn().mockImplementation(stagedInstall),
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
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    Object.defineProperty(process, "arch", {
      value: "x64",
      configurable: true,
    });
    delete process.env["HYPERFRAMES_BROWSER_PATH"];
    delete process.env["PRODUCER_HEADLESS_SHELL_PATH"];
    installChildProcessMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process, "platform", {
      value: origPlatform,
      configurable: true,
    });
    Object.defineProperty(process, "arch", {
      value: origArch,
      configurable: true,
    });
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
        {
          browser: "chrome-headless-shell",
          executablePath: HF_BINARY,
          buildId: CHROME_VERSION,
        },
      ],
    });

    const { findBrowser } = await import("./manager.js");
    const result = await findBrowser();

    expect(result).toEqual({ executablePath: HF_BINARY, source: "cache" });
  });

  it("hides the Windows console used by the where lookup", async () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    installFsMocks({ existing: new Set() });
    installPuppeteerBrowsersMock();
    const execSync = vi.fn((command: string) =>
      command === "where google-chrome" ? "C:\\Chrome\\chrome.exe\n" : "",
    );
    vi.doMock("node:child_process", () => ({ execSync, spawnSync: vi.fn() }));

    const { findBrowser } = await import("./manager.js");
    const result = await findBrowser();

    expect(result).toEqual({
      executablePath: "C:\\Chrome\\chrome.exe",
      source: "system",
    });
    expect(execSync).toHaveBeenCalledWith(
      "where google-chrome",
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it("finds Chrome in the standard Windows Program Files location", async () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    const windowsChrome = join(
      "C:\\Program Files",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    );
    installFsMocks({ existing: new Set([windowsChrome]) });
    installPuppeteerBrowsersMock();

    const { findSystemBrowser } = await import("./manager.js");

    expect(findSystemBrowser()).toEqual({
      executablePath: windowsChrome,
      source: "system",
    });
  });

  it("does not resolve to a hyperframes-cache build from an older CHROME_VERSION pin", async () => {
    // A build downloaded by a prior hyperframes version (this pin has moved
    // 131 -> 151 -> 152 across releases) must not satisfy resolution, or an
    // upgrade silently keeps running a stale build forever instead of ever
    // fetching the version the new release actually needs (HF#2060 review).
    installFsMocks({ existing: new Set([HF_CACHE, HF_BINARY, SYSTEM_CHROME]) });
    installPuppeteerBrowsersMock({
      installedInHfCache: [
        {
          browser: "chrome-headless-shell",
          executablePath: HF_BINARY,
          buildId: "131.0.6778.85",
        },
      ],
    });

    const { findBrowser } = await import("./manager.js");
    const result = await findBrowser();

    expect(result?.executablePath).not.toBe(HF_BINARY);
    expect(result).toEqual({ executablePath: SYSTEM_CHROME, source: "system" });
  });

  it("ignores a current-version HyperFrames cache entry for another platform", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    Object.defineProperty(process, "arch", {
      value: "arm64",
      configurable: true,
    });
    const macArm64Binary = join(
      HF_CACHE,
      "chrome-headless-shell",
      "mac_arm-131.0.6778.85",
      "chrome-headless-shell-mac-arm64",
      "chrome-headless-shell",
    );
    installFsMocks({
      existing: new Set([HF_CACHE, HF_BINARY, macArm64Binary]),
    });
    installPuppeteerBrowsersMock({
      browserPlatform: "mac_arm",
      installedInHfCache: [
        {
          browser: "chrome-headless-shell",
          executablePath: HF_BINARY,
          buildId: CHROME_VERSION,
          platform: "linux",
        },
        {
          browser: "chrome-headless-shell",
          executablePath: macArm64Binary,
          buildId: CHROME_VERSION,
          platform: "mac_arm",
        },
      ],
    });

    const { findBrowser } = await import("./manager.js");
    const result = await findBrowser();

    expect(result).toEqual({ executablePath: macArm64Binary, source: "cache" });
  });

  it("re-downloads when the hyperframes cache manifest points at a missing binary", async () => {
    const redownloadedBinary = join(
      HF_CACHE,
      "chrome-headless-shell",
      "linux-131.0.6778.85",
      "chrome-headless-shell-linux64",
      "redownloaded-chrome-headless-shell",
    );
    const staleInstallDir = stagedVersionDir(HF_CACHE, "131.0.6778.85");
    // The stale install DIR is present (extraction got partway through, e.g. an
    // ABOUT/LICENSE-only extract) even though the exe itself is missing —
    // exercises the purge-before-redownload fix, not just the redownload path.
    const staleLeftover = join(staleInstallDir, "ABOUT");
    const paths = installFsMocks({
      existing: new Set([HF_CACHE, staleInstallDir, staleLeftover]),
    });
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

    expect(result).toEqual({
      executablePath: redownloadedBinary,
      source: "download",
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Cached binary unusable"));
    // The partial extract is replaced wholesale, not merged into (install() would
    // otherwise throw "folder exists but exe missing", the bug both feedback reports hit).
    expect(paths.has(staleLeftover)).toBe(false);
    expect(paths.has(redownloadedBinary)).toBe(true);
  });

  it("ensureBrowser({force: true}) re-downloads without purging the cache, bypassing any cache/system shortcut", async () => {
    const staleInstallDir = stagedVersionDir(HF_CACHE, "131.0.6778.85");
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
        {
          browser: "chrome-headless-shell",
          executablePath: HF_BINARY,
          path: staleInstallDir,
        },
      ],
      installResult: { executablePath: downloadedBinary },
    });

    const { ensureBrowser } = await import("./manager.js");
    const result = await ensureBrowser({ force: true });

    expect(result).toEqual({
      executablePath: downloadedBinary,
      source: "download",
    });
    // Only the downloaded version dir is swapped in; other cache entries stay.
    expect(paths.has(downloadedBinary)).toBe(true);
    expect(paths.has(HF_BINARY)).toBe(true);
  });

  it("keeps a live reader's binary valid while a concurrent --force re-downloads it", async () => {
    const home = useRealCacheHome();
    let label = "old";
    let seenMidInstall: string | undefined;
    let liveBinary: string | undefined;
    installPuppeteerBrowsersMock({
      installImpl: async ({ cacheDir, buildId }) => {
        if (liveBinary) seenMidInstall = readFileSync(liveBinary, "utf8");
        return writeStagedInstall(cacheDir, buildId, label);
      },
    });
    try {
      const { ensureBrowser, CACHE_DIR } = await import("./manager.js");
      const otherVersion = join(stagedVersionDir(CACHE_DIR, "1.0.0"), "marker");
      mkdirSync(dirname(otherVersion), { recursive: true });
      writeFileSync(otherVersion, "other");

      liveBinary = (await ensureBrowser({ force: true })).executablePath;
      label = "new";
      const forced = await ensureBrowser({ force: true });

      expect(seenMidInstall).toBe("old");
      expect(forced.executablePath).toBe(liveBinary);
      expect(readFileSync(liveBinary, "utf8")).toBe("new");
      expect(readFileSync(otherVersion, "utf8")).toBe("other");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("installs again instead of reusing an empty cached executable", async () => {
    const home = useRealCacheHome();
    installPuppeteerBrowsersMock({
      installImpl: async ({ cacheDir, buildId }) => writeStagedInstall(cacheDir, buildId, "fresh"),
    });
    try {
      const { ensureBrowser } = await import("./manager.js");
      const cached = await ensureBrowser({ force: true });
      writeFileSync(cached.executablePath, "");
      const { getInstalledBrowsers } = await import("@puppeteer/browsers");
      vi.mocked(getInstalledBrowsers).mockResolvedValue([
        {
          browser: "chrome-headless-shell",
          buildId: CHROME_VERSION,
          platform: "linux",
          executablePath: cached.executablePath,
        } as never,
      ]);
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const again = await ensureBrowser({ preferManagedChrome: true });

      expect(again.source).toBe("download");
      expect(readFileSync(again.executablePath, "utf8")).toBe("fresh");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("restores the previous version when the staged install cannot be moved in", async () => {
    const home = useRealCacheHome();
    let stageNothing = false;
    installPuppeteerBrowsersMock({
      installImpl: async ({ cacheDir, buildId, logger }) => {
        if (!stageNothing) return writeStagedInstall(cacheDir, buildId, "old");
        logger?.("puppeteer:browsers:fileUtil")?.(
          "tar.exe extraction failed: before PowerShell worked",
        );
        // A real executable passes the unzip check, but its version dir is gone, so only the move fails.
        const elsewhere = writeStagedInstall(join(cacheDir, "elsewhere"), buildId, "new");
        return {
          executablePath: elsewhere.executablePath,
          path: stagedVersionDir(cacheDir, buildId),
        };
      },
    });
    try {
      const { ensureBrowser } = await import("./manager.js");
      const liveBinary = (await ensureBrowser({ force: true })).executablePath;
      stageNothing = true;

      const failure = await ensureBrowser({ force: true }).catch((err: unknown) => String(err));
      expect(failure).toContain("HYPERFRAMES_BROWSER_PATH");
      expect(failure).not.toContain("Unzip errors");
      expect(readFileSync(liveBinary, "utf8")).toBe("old");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it.each([
    { label: "missing", unpacked: "none", state: "is missing" },
    { label: "empty", unpacked: "file", state: "is empty" },
    { label: "a folder", unpacked: "folder", state: "is not a file" },
  ])("fails instead of reporting a browser the unzip left $label", async ({ unpacked, state }) => {
    const home = useRealCacheHome();
    installPuppeteerBrowsersMock({
      installImpl: async ({ cacheDir, buildId, logger }) => {
        const staged = writeStagedInstall(cacheDir, buildId, "");
        rmSync(staged.executablePath);
        if (unpacked === "file") writeFileSync(staged.executablePath, "");
        if (unpacked === "folder")
          mkdirSync(join(staged.executablePath, "inside"), { recursive: true });
        logger?.("puppeteer:browsers:fileUtil")?.("tar.exe extraction failed: Error: boom");
        return staged;
      },
    });
    try {
      const { ensureBrowser, CACHE_DIR } = await import("./manager.js");

      const ensured = ensureBrowser({ preferManagedChrome: true });

      await expect(ensured).rejects.toThrow(`chrome-headless-shell ${state} after unzipping`);
      await expect(ensured).rejects.toThrow("tar.exe extraction failed: Error: boom");
      expect(existsSync(CACHE_DIR)).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("names the unzip errors when every unzip tool failed", async () => {
    const home = useRealCacheHome();
    installPuppeteerBrowsersMock({
      installImpl: async ({ logger }) => {
        logger?.("puppeteer:browsers:fileUtil")?.("tar.exe extraction failed: Error: tar boom");
        logger?.("puppeteer:browsers:fileUtil")?.(
          "powershell.exe extraction failed: Error: ps boom",
        );
        throw new Error("Extraction failed: no zip archiver is available.");
      },
    });
    try {
      const { ensureBrowser } = await import("./manager.js");

      const ensured = ensureBrowser({ force: true });

      await expect(ensured).rejects.toThrow(
        "no zip archiver is available. Unzip errors: tar.exe extraction failed: Error: tar boom; powershell.exe extraction failed: Error: ps boom",
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("names the unzip error a wrapping extraction failure carries as its cause", async () => {
    const home = useRealCacheHome();
    installPuppeteerBrowsersMock({
      installImpl: async () => {
        throw new Error("Extraction failed: /tmp/a.zip", {
          cause: new Error("invalid relative path: ../escape"),
        });
      },
    });
    try {
      const { ensureBrowser } = await import("./manager.js");

      await expect(ensureBrowser({ force: true })).rejects.toThrow(
        "Extraction failed: /tmp/a.zip: invalid relative path: ../escape",
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("reports only the last attempt's unzip errors after a corrupt-archive retry", async () => {
    const home = useRealCacheHome();
    let attempt = 0;
    installPuppeteerBrowsersMock({
      installImpl: async ({ cacheDir, buildId, logger }) => {
        attempt += 1;
        logger?.("puppeteer:browsers:fileUtil")?.(`tar.exe extraction failed: attempt ${attempt}`);
        if (attempt === 1) throw new Error("invalid end of central directory");
        const staged = writeStagedInstall(cacheDir, buildId, "");
        rmSync(staged.executablePath);
        return staged;
      },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { ensureBrowser } = await import("./manager.js");

      const error = await ensureBrowser({ force: true }).catch((err: unknown) => err);

      expect(String(error)).toContain("tar.exe extraction failed: attempt 2");
      expect(String(error)).not.toContain("attempt 1");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("sweeps dirs leaked by a killed install on the next install and on clear", async () => {
    const home = useRealCacheHome();
    installPuppeteerBrowsersMock({
      installImpl: async ({ cacheDir, buildId }) => writeStagedInstall(cacheDir, buildId, "fresh"),
    });
    const root = join(home, ".cache", "hyperframes");
    const leftovers = [join(root, ".chrome-staging-dead"), join(root, ".chrome-replaced-dead")];
    const seedLeftovers = () => {
      for (const dir of leftovers) mkdirSync(join(dir, "partial"), { recursive: true });
    };
    try {
      const { ensureBrowser, clearBrowser } = await import("./manager.js");
      seedLeftovers();
      await ensureBrowser({ force: true });
      expect(leftovers.filter((dir) => existsSync(dir))).toEqual([]);

      seedLeftovers();
      expect(clearBrowser()).toBe(true);
      expect(leftovers.filter((dir) => existsSync(dir))).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("serializes concurrent force downloads so they never install at the same time", async () => {
    const downloadedBinary = join(HF_CACHE, "chrome-headless-shell", "force-downloaded");
    const paths = installFsMocks({
      existing: new Set([CACHE_ROOT, HF_CACHE, HF_BINARY]),
    });
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

    expect(result).toEqual({
      executablePath: downloadedBinary,
      source: "download",
    });
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

    expect(result).toEqual({
      executablePath: PUPPETEER_BINARY,
      source: "cache",
    });
  });

  it.each([
    {
      hostPlatform: "darwin",
      hostArch: "arm64",
      expectedDirectory: "chrome-headless-shell-mac-arm64",
      expectedExecutable: "chrome-headless-shell",
    },
    {
      hostPlatform: "darwin",
      hostArch: "x64",
      expectedDirectory: "chrome-headless-shell-mac-x64",
      expectedExecutable: "chrome-headless-shell",
    },
    {
      hostPlatform: "linux",
      hostArch: "x64",
      expectedDirectory: "chrome-headless-shell-linux64",
      expectedExecutable: "chrome-headless-shell",
    },
    {
      hostPlatform: "win32",
      hostArch: "ia32",
      expectedDirectory: "chrome-headless-shell-win32",
      expectedExecutable: "chrome-headless-shell.exe",
    },
    {
      hostPlatform: "win32",
      hostArch: "x64",
      expectedDirectory: "chrome-headless-shell-win64",
      expectedExecutable: "chrome-headless-shell.exe",
    },
  ])(
    "selects only the host-compatible cached shell on $hostPlatform/$hostArch when every platform is present",
    async ({ hostPlatform, hostArch, expectedDirectory, expectedExecutable }) => {
      Object.defineProperty(process, "platform", {
        value: hostPlatform,
        configurable: true,
      });
      Object.defineProperty(process, "arch", {
        value: hostArch,
        configurable: true,
      });
      const version = "host-148.0.7778.97";
      const candidates = [
        ["chrome-headless-shell-linux64", "chrome-headless-shell"],
        ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"],
        ["chrome-headless-shell-mac-x64", "chrome-headless-shell"],
        ["chrome-headless-shell-win32", "chrome-headless-shell.exe"],
        ["chrome-headless-shell-win64", "chrome-headless-shell.exe"],
      ] as const;
      const binaries = candidates.map(([directory, executable]) =>
        join(PUPPETEER_CACHE, version, directory, executable),
      );
      const expectedBinary = join(PUPPETEER_CACHE, version, expectedDirectory, expectedExecutable);
      installFsMocks({
        existing: new Set([PUPPETEER_CACHE, ...binaries]),
        dirs: { [PUPPETEER_CACHE]: [version] },
      });
      installPuppeteerBrowsersMock();

      const { findBrowser } = await import("./manager.js");
      const result = await findBrowser();

      expect(result).toEqual({
        executablePath: expectedBinary,
        source: "cache",
      });
    },
  );

  it.each([
    { hostPlatform: "linux", hostArch: "arm64" },
    { hostPlatform: "win32", hostArch: "arm64" },
  ])(
    "does not select a foreign cached shell on unsupported $hostPlatform/$hostArch",
    async ({ hostPlatform, hostArch }) => {
      Object.defineProperty(process, "platform", {
        value: hostPlatform,
        configurable: true,
      });
      Object.defineProperty(process, "arch", {
        value: hostArch,
        configurable: true,
      });
      const version = "host-148.0.7778.97";
      const binaries = [
        join(PUPPETEER_CACHE, version, "chrome-headless-shell-linux64", "chrome-headless-shell"),
        join(PUPPETEER_CACHE, version, "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
      ];
      installFsMocks({
        existing: new Set([PUPPETEER_CACHE, ...binaries]),
        dirs: { [PUPPETEER_CACHE]: [version] },
      });
      installPuppeteerBrowsersMock();

      const { findBrowser } = await import("./manager.js");
      await expect(findBrowser()).resolves.toBeUndefined();
    },
  );

  it("skips an empty executable in the puppeteer cache", async () => {
    installFsMocks({
      existing: new Set([PUPPETEER_CACHE, PUPPETEER_BINARY]),
      dirs: { [PUPPETEER_CACHE]: ["linux-148.0.7778.97"] },
      emptyFiles: new Set([PUPPETEER_BINARY]),
    });
    installPuppeteerBrowsersMock();

    const { findBrowser } = await import("./manager.js");
    const result = await findBrowser();

    expect(result?.executablePath).not.toBe(PUPPETEER_BINARY);
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
      dirs: {
        [PUPPETEER_CACHE]: ["linux-131.0.6778.85", "linux-148.0.7778.97"],
      },
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
      dirs: {
        [PUPPETEER_CACHE]: ["linux-99.0.6533.123", "linux-148.0.7778.97"],
      },
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

  // Sibling env-var alias for the CLI resolver. The engine layer already
  // honors `PRODUCER_HEADLESS_SHELL_PATH` (see
  // `packages/engine/src/services/browserManager.ts`), and docs
  // (skills/hyperframes-animation/adapters/typegpu.md,
  // packages/gcp-cloud-run/Dockerfile, examples/k8s-jobs/Dockerfile.example)
  // all instruct users to set that name. Before this alias, `hyperframes
  // check`/`snapshot`/`compare` — which all route through `openSettledCompositionPage`
  // → `ensureBrowser` → `findFromEnv` — silently ignored a documented escape
  // hatch that `render` had honored, so a user with a broken pinned build
  // (win32/x64 STATUS_STACK_BUFFER_OVERRUN 3221225595, #hyperframes-cli-feedback
  // ts=1784095034) could render successfully but check would still crash on
  // the cached headless-shell. The alias closes that direction of the
  // symmetry (the engine side is being closed by #2459).
  it("resolves via PRODUCER_HEADLESS_SHELL_PATH when HYPERFRAMES_BROWSER_PATH is unset", async () => {
    const directShell = "/opt/chrome-headless-shell/chrome-headless-shell";
    installFsMocks({ existing: new Set([directShell]) });
    installPuppeteerBrowsersMock();
    process.env["PRODUCER_HEADLESS_SHELL_PATH"] = directShell;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { findBrowser, _resetSystemFallbackWarnForTests } = await import("./manager.js");
    _resetSystemFallbackWarnForTests();
    const result = await findBrowser();

    expect(result?.executablePath).toBe(directShell);
    expect(result?.source).toBe("env");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("prefers HYPERFRAMES_BROWSER_PATH over PRODUCER_HEADLESS_SHELL_PATH when both are set", async () => {
    // Tiebreak matches `render.ts` — the CLI-native name canonicalizes; the
    // engine name is a compatibility alias. If both are set the caller almost
    // certainly meant the CLI-native one.
    const hfPath = "/opt/hf/chrome-headless-shell";
    const producerPath = "/opt/producer/chrome-headless-shell";
    installFsMocks({ existing: new Set([hfPath, producerPath]) });
    installPuppeteerBrowsersMock();
    process.env["HYPERFRAMES_BROWSER_PATH"] = hfPath;
    process.env["PRODUCER_HEADLESS_SHELL_PATH"] = producerPath;

    const { findBrowser, _resetSystemFallbackWarnForTests } = await import("./manager.js");
    _resetSystemFallbackWarnForTests();
    const result = await findBrowser();

    expect(result?.executablePath).toBe(hfPath);
    expect(result?.source).toBe("env");
  });

  it("does NOT warn on macOS when falling back to system Chrome", async () => {
    // macOS Chrome still works fine for the screenshot path and the perf
    // claims around BeginFrame are Linux-only — keep the warning Linux-scoped
    // so darwin users don't get spammed about a "fix" that doesn't apply.
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
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

  it("matches a corrupt archive reported in the error's cause", async () => {
    const { isCorruptArchiveError } = await import("./manager.js");
    const unzipError = new Error("end of central directory record signature not found");

    expect(
      isCorruptArchiveError(new Error("Extraction failed: /tmp/a.zip", { cause: unzipError })),
    ).toBe(true);
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

// Sibling failure mode to #2078 (SIGTRAP at launch): the field feedback in
// #hyperframes-cli-feedback ts 1784055194.202169 (darwin/arm64, HF CLI 0.7.57)
// hit `All providers failed for chrome-headless-shell 152.0.7928.2` at download
// time and had to discover `HYPERFRAMES_BROWSER_PATH` on their own. The raw
// error propagated straight through `downloadBrowser` without naming the
// escape hatch. This guards the rewrap so the next reporter sees the hint.
//
// Parameterized across all three OS families because `browserPathHintForPlatform`
// branches on `process.platform` and each branch has to survive on its own —
// the field reporter was macOS but the same rewrap is what a Windows or Linux
// (non-ARM) user would see next time providers fail, and each branch names a
// different Chrome install path that has to be spelled correctly.
describe("downloadBrowser — install failure surfaces HYPERFRAMES_BROWSER_PATH hint", () => {
  const origPlatform = process.platform;
  const origArch = process.arch;

  beforeEach(() => {
    vi.resetModules();
    delete process.env["HYPERFRAMES_BROWSER_PATH"];
    delete process.env["PRODUCER_HEADLESS_SHELL_PATH"];
    installChildProcessMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: origPlatform,
      configurable: true,
    });
    Object.defineProperty(process, "arch", {
      value: origArch,
      configurable: true,
    });
    vi.restoreAllMocks();
    vi.doUnmock("node:fs");
    vi.doUnmock("node:os");
    vi.doUnmock("node:child_process");
    vi.doUnmock("@puppeteer/browsers");
  });

  // Note: linux/arm64 is deliberately excluded — `downloadBrowser` short-circuits
  // into `ensureLinuxArmBrowser` before it ever reaches the install() call this
  // suite guards (chrome-headless-shell has no linux-arm64 build; see `isLinuxArm`
  // at the top of `downloadBrowser`). Use linux/x64 to exercise the linux branch
  // of `browserPathHintForPlatform`.
  it.each([
    {
      label: "darwin/arm64",
      platform: "darwin",
      arch: "arm64",
      expectedPathHint: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
    {
      label: "win32/x64",
      platform: "win32",
      arch: "x64",
      expectedPathHint: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    },
    {
      label: "linux/x64",
      platform: "linux",
      arch: "x64",
      expectedPathHint: "/usr/bin/google-chrome",
    },
  ])(
    "rethrows a non-corrupt install failure with an HYPERFRAMES_BROWSER_PATH hint and preserves the original via cause ($label)",
    async ({ platform, arch, expectedPathHint }) => {
      Object.defineProperty(process, "platform", {
        value: platform,
        configurable: true,
      });
      Object.defineProperty(process, "arch", {
        value: arch,
        configurable: true,
      });

      // No cache, no system Chrome — forces the download-of-last-resort path
      // that ends in @puppeteer/browsers install().
      installFsMocks({ existing: new Set([CACHE_ROOT]) });
      const rawMsg = "All providers failed for chrome-headless-shell 152.0.7928.2";
      const originalError = new Error(rawMsg);
      installPuppeteerBrowsersMock({
        installedInHfCache: [],
        installImpl: async () => {
          throw originalError;
        },
      });

      const { ensureBrowser } = await import("./manager.js");

      let caught: unknown;
      try {
        await ensureBrowser();
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(Error);
      const msg = (caught as Error).message;
      // Names the escape-hatch env var by name (that's the entire point).
      expect(msg).toContain("HYPERFRAMES_BROWSER_PATH");
      // Includes the platform-specific example path from
      // `browserPathHintForPlatform`.
      expect(msg).toContain(expectedPathHint);
      // Keeps the original provider-failure text so the user can still
      // diagnose the underlying cause from the surfaced message.
      expect(msg).toContain(rawMsg);
      // Structured `cause` chain intact for tooling that walks it.
      expect((caught as Error).cause).toBe(originalError);
    },
  );
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

describe("browser resolution on macOS 12 (Darwin < 22)", () => {
  const MAC_12 = { platform: "darwin", release: "21.6.0" };
  const MAC_13 = { platform: "darwin", release: "22.1.0" };
  const OLD_BUILD = "150.0.7871.124";
  const MAC_HF_BINARY = join(HF_CACHE, "chrome-headless-shell", "mac-x", "chrome-headless-shell");
  const macPuppeteerBinary = (dir: string) =>
    join(PUPPETEER_CACHE, dir, "chrome-headless-shell-mac-x64", "chrome-headless-shell");

  const origPlatform = process.platform;
  const origArch = process.arch;

  beforeEach(() => {
    vi.resetModules();
    delete process.env["HYPERFRAMES_BROWSER_PATH"];
    delete process.env["PRODUCER_HEADLESS_SHELL_PATH"];
    installChildProcessMocks();
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    Object.defineProperty(process, "arch", {
      value: "x64",
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: origPlatform,
      configurable: true,
    });
    Object.defineProperty(process, "arch", {
      value: origArch,
      configurable: true,
    });
    vi.unstubAllEnvs();
    vi.doUnmock("node:fs");
    vi.doUnmock("node:os");
    vi.doUnmock("node:child_process");
    vi.doUnmock("@puppeteer/browsers");
  });

  it.each([
    { host: MAC_12, expected: OLD_BUILD },
    { host: MAC_13, expected: "152.0.7977.30" },
  ])("downloads $expected on $host.release", async ({ host, expected }) => {
    installFsMocks({ existing: new Set(), osHost: host });
    const install = vi.fn(async () => ({ executablePath: MAC_HF_BINARY }));
    installPuppeteerBrowsersMock({
      installImpl: install,
      browserPlatform: "mac",
    });
    const { ensureBrowser } = await import("./manager.js");

    await ensureBrowser({ preferManagedChrome: true });

    expect(install).toHaveBeenCalledWith(expect.objectContaining({ buildId: expected }));
  });

  it("ignores a cached newer managed build on macOS 12", async () => {
    installFsMocks({
      existing: new Set([HF_CACHE, MAC_HF_BINARY]),
      osHost: MAC_12,
    });
    installPuppeteerBrowsersMock({
      browserPlatform: "mac",
      installedInHfCache: [
        {
          browser: "chrome-headless-shell",
          executablePath: MAC_HF_BINARY,
          buildId: "152.0.7977.30",
        },
      ],
    });
    const { findBrowser } = await import("./manager.js");

    await expect(findBrowser()).resolves.toBeUndefined();
  });

  it("uses the cached macOS 12 build on macOS 12", async () => {
    installFsMocks({
      existing: new Set([HF_CACHE, MAC_HF_BINARY]),
      osHost: MAC_12,
    });
    installPuppeteerBrowsersMock({
      browserPlatform: "mac",
      installedInHfCache: [
        {
          browser: "chrome-headless-shell",
          executablePath: MAC_HF_BINARY,
          buildId: OLD_BUILD,
        },
      ],
    });
    const { findBrowser } = await import("./manager.js");

    await expect(findBrowser()).resolves.toEqual({
      executablePath: MAC_HF_BINARY,
      source: "cache",
    });
  });

  it("skips a puppeteer-cache build newer than 150 on macOS 12 but keeps 150", async () => {
    installFsMocks({
      existing: new Set([
        PUPPETEER_CACHE,
        macPuppeteerBinary("mac-152.0.7977.30"),
        macPuppeteerBinary("mac-150.0.7871.124"),
      ]),
      dirs: { [PUPPETEER_CACHE]: ["mac-152.0.7977.30", "mac-150.0.7871.124"] },
      osHost: MAC_12,
    });
    installPuppeteerBrowsersMock({ browserPlatform: "mac" });
    const { findBrowser } = await import("./manager.js");

    await expect(findBrowser()).resolves.toEqual({
      executablePath: macPuppeteerBinary("mac-150.0.7871.124"),
      source: "cache",
    });
  });

  it("keeps the newest puppeteer-cache build on macOS 13", async () => {
    installFsMocks({
      existing: new Set([
        PUPPETEER_CACHE,
        macPuppeteerBinary("mac-152.0.7977.30"),
        macPuppeteerBinary("mac-150.0.7871.124"),
      ]),
      dirs: { [PUPPETEER_CACHE]: ["mac-152.0.7977.30", "mac-150.0.7871.124"] },
      osHost: MAC_13,
    });
    installPuppeteerBrowsersMock({ browserPlatform: "mac" });
    const { findBrowser } = await import("./manager.js");

    await expect(findBrowser()).resolves.toEqual({
      executablePath: macPuppeteerBinary("mac-152.0.7977.30"),
      source: "cache",
    });
  });

  it("lets HYPERFRAMES_BROWSER_PATH win on macOS 12", async () => {
    const envBinary = join("/", "opt", "my-chrome");
    vi.stubEnv("HYPERFRAMES_BROWSER_PATH", envBinary);
    installFsMocks({ existing: new Set([envBinary]), osHost: MAC_12 });
    installPuppeteerBrowsersMock({ browserPlatform: "mac" });
    const { ensureBrowser } = await import("./manager.js");

    await expect(ensureBrowser({ preferManagedChrome: true })).resolves.toEqual({
      executablePath: envBinary,
      source: "env",
    });
    vi.unstubAllEnvs();
  });
});
