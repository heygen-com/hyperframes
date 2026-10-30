// fallow-ignore-file code-duplication
import { execSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import {
  browserPathFromEnv,
  managedChromeVersion,
  pickSharedShell,
} from "@hyperframes/engine/chrome-host-ceiling";
import { getFreeDiskMb } from "../telemetry/system.js";
import { BrowserDownloadStalledError, installInChild } from "./installInChild.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { runRenderSetupWorker } from "../utils/cancellableProcess.js";
import { unzipArchive } from "./unzipArchive.js";

type PuppeteerBrowsers = typeof import("@puppeteer/browsers");

async function loadPuppeteerBrowsers(): Promise<PuppeteerBrowsers> {
  try {
    return await import("@puppeteer/browsers");
  } catch (err) {
    const cause = normalizeErrorMessage(err);
    throw new Error(
      `Failed to load @puppeteer/browsers: ${cause}\n` +
        `Fix: run \`npm install\` or \`bun install\` to restore missing packages, then retry.`,
    );
  }
}

const CACHE_ROOT_DIR = join(homedir(), ".cache", "hyperframes");
const CACHE_DIR = join(homedir(), ".cache", "hyperframes", "chrome");
const ARCHIVE_PLUS_UNPACKED_SHELL_MB = 512;
// Puppeteer's managed cache — where `@puppeteer/browsers install
// chrome-headless-shell` (and `puppeteer install`) drop binaries. The engine's
// `resolveHeadlessShellPath` scans the same directory; the CLI must look here
// too or it silently picks system Chrome over a perfectly good headless-shell.
const PUPPETEER_CACHE_DIR = join(homedir(), ".cache", "puppeteer", "chrome-headless-shell");

// `@puppeteer/browsers`' install() has no concurrency guard of its own — two
// CLI invocations that both miss the cache at the same time both extract into
// the same target directory simultaneously. A killed/interrupted extraction
// from that race can leave a binary that merely *exists* (so doctor/lint/
// validate all report healthy) while missing bits a clean install sets (e.g.
// macOS Gatekeeper/quarantine + GPU/Metal entitlements) — reported as headless
// GPU frame capture silently returning all-black frames despite --browser-gpu
// auto/hardware, invisible until someone inspects the actual pixels.
//
// mkdirSync is atomic (EEXIST if another process already holds it), so it
// doubles as a zero-dependency cross-process mutex — no lockfile library needed.
const INSTALL_LOCK_DIR = join(CACHE_ROOT_DIR, ".chrome.install.lock");
const INSTALL_RECLAIM_LOCK_DIR = join(CACHE_ROOT_DIR, ".chrome.install.reclaim.lock");
const INSTALL_LOCK_OWNER_FILE = join(INSTALL_LOCK_DIR, "owner");
const INSTALL_LOCK_OWNER_ENV = "HYPERFRAMES_BROWSER_LOCK_OWNER";
let ownedInstallLockToken: string | undefined;
const INSTALL_LOCK_TIMINGS = {
  staleMs: 120_000,
  pollMs: 200,
  heartbeatMs: 15_000,
  waitNoticeMs: 10_000,
};

interface InstallLockTimings {
  staleMs: number;
  pollMs: number;
  heartbeatMs: number;
  waitNoticeMs: number;
}

function isErrno(err: unknown, code: string): boolean {
  return (err as NodeJS.ErrnoException).code === code;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryAcquireDirLock(lockDir: string): boolean {
  try {
    // recursive:false is load-bearing: it's what makes this throw EEXIST
    // (and therefore act as a mutex) instead of silently no-op'ing like
    // `mkdir -p` when the lock dir already exists.
    mkdirSync(lockDir, { recursive: false });
    return true;
  } catch (err) {
    if (!isErrno(err, "EEXIST")) throw err;
    return false;
  }
}

function isDirLockStale(lockDir: string, timeoutMs: number): boolean {
  try {
    return Date.now() - statSync(lockDir).mtimeMs > timeoutMs;
  } catch (err) {
    if (isErrno(err, "ENOENT")) return false;
    throw err;
  }
}

function reclaimStaleInstallLock(timeoutMs: number): void {
  if (!tryAcquireDirLock(INSTALL_RECLAIM_LOCK_DIR)) return;
  try {
    const mtimeMs = statSync(INSTALL_LOCK_DIR).mtimeMs;
    if (Date.now() - mtimeMs > timeoutMs) {
      rmSync(INSTALL_LOCK_DIR, { recursive: true, force: true });
    }
  } catch (err) {
    if (!isErrno(err, "ENOENT")) throw err;
  } finally {
    rmSync(INSTALL_RECLAIM_LOCK_DIR, { recursive: true, force: true });
  }
}

function reclaimAbandonedReclaimLock(timeoutMs: number): void {
  try {
    if (isDirLockStale(INSTALL_RECLAIM_LOCK_DIR, timeoutMs)) {
      rmSync(INSTALL_RECLAIM_LOCK_DIR, { recursive: true, force: true });
    }
  } catch (err) {
    if (!isErrno(err, "ENOENT")) throw err;
  }
}

function touchInstallLock(): void {
  try {
    const now = new Date();
    utimesSync(INSTALL_LOCK_DIR, now, now);
  } catch {
    // ponytail: heartbeat is best-effort; stale-lock reclaim remains the fallback.
  }
}

// fallow-ignore-next-line complexity
export async function withInstallLock<T>(
  fn: () => Promise<T>,
  timings: InstallLockTimings = INSTALL_LOCK_TIMINGS,
): Promise<T> {
  // recursive:false below needs the parent to already exist (unlike `mkdir -p`).
  // Keep lock dirs outside CACHE_DIR so force-clearing the Chrome cache cannot
  // delete another installer's in-flight lock.
  if (!existsSync(CACHE_ROOT_DIR)) mkdirSync(CACHE_ROOT_DIR, { recursive: true });
  let deadline = Date.now() + timings.staleMs;
  const waitStart = Date.now();
  let lastNoticeMs = 0;
  for (;;) {
    if (existsSync(INSTALL_RECLAIM_LOCK_DIR)) {
      // A process can die after acquiring the reclaim gate but before its
      // synchronous cleanup runs. Without aging out that gate, every future
      // installer sleeps here forever and never reaches the install-lock
      // timeout/reclaim path below.
      reclaimAbandonedReclaimLock(timings.staleMs);
      await sleep(timings.pollMs);
      continue;
    }
    if (tryAcquireDirLock(INSTALL_LOCK_DIR)) {
      ownedInstallLockToken = process.env[INSTALL_LOCK_OWNER_ENV] ?? randomUUID();
      try {
        writeFileSync(INSTALL_LOCK_OWNER_FILE, ownedInstallLockToken);
      } catch (error) {
        ownedInstallLockToken = undefined;
        rmSync(INSTALL_LOCK_DIR, { recursive: true, force: true });
        throw error;
      }
      rmSync(INSTALL_RECLAIM_LOCK_DIR, { recursive: true, force: true });
      break;
    }
    const waitedMs = Date.now() - waitStart;
    if (waitedMs - lastNoticeMs >= timings.waitNoticeMs) {
      lastNoticeMs = waitedMs;
      console.warn(
        `[browser] Waiting for another hyperframes process to finish installing chrome-headless-shell (${Math.round(waitedMs / 1000)}s elapsed)...`,
      );
    }
    if (isDirLockStale(INSTALL_LOCK_DIR, timings.staleMs) || Date.now() > deadline) {
      // The reclaim gate matters when multiple waiters cross the timeout at
      // once: without it, waiter A can delete the stale lock and acquire a
      // fresh one, then waiter B (whose old deadline also expired) can delete
      // A's fresh lock. The gate serializes reclaimers, and the mtime re-check
      // after the gate prevents deleting a fresh lock another waiter just won.
      reclaimStaleInstallLock(timings.staleMs);
      deadline = Date.now() + timings.staleMs;
      continue;
    }
    await sleep(timings.pollMs);
  }
  const heartbeat = setInterval(touchInstallLock, timings.heartbeatMs);
  if (typeof heartbeat.unref === "function") heartbeat.unref();
  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    releaseOwnedBrowserInstallLock();
  }
}

export function releaseOwnedBrowserInstallLock(): void {
  if (!ownedInstallLockToken) return;
  releaseBrowserInstallLock(ownedInstallLockToken);
}

function releaseBrowserInstallLock(ownerToken: string): void {
  if (ownedInstallLockToken === ownerToken) ownedInstallLockToken = undefined;
  try {
    if (readFileSync(INSTALL_LOCK_OWNER_FILE, "utf8") !== ownerToken) return;
  } catch {
    return;
  }
  rmSync(INSTALL_LOCK_DIR, { recursive: true, force: true });
}

export type BrowserSource = "env" | "cache" | "system" | "download";

export interface BrowserResult {
  executablePath: string;
  source: BrowserSource;
}

export interface EnsureBrowserOptions {
  onProgress?: (downloadedBytes: number, totalBytes: number) => void;
  downloadStallMs?: number;
  // Stalled-download attempts; default 3 on a terminal, 1 elsewhere (see ensureBrowser).
  downloadAttempts?: number;
  downloadBaseUrl?: string;
  // Re-download the managed build even when cached; only its version dir is replaced.
  force?: boolean;
  // Always resolve to OUR pinned `CHROME_VERSION` build (cached, or freshly
  // downloaded) — skip both the shared puppeteer-cache preference (some other
  // tool's install, arbitrary version) and system Chrome (tracks Stable,
  // arbitrary version, doesn't get updated in lockstep with this codebase).
  // Rendering behavior should not vary with whatever Chrome happens to be
  // sitting on the machine: it's the version we've actually tested against,
  // and the one known to implement `canvas.drawElementImage`. A build without
  // it no longer crashes (the engine probes and falls back to screenshot
  // capture), it just renders slower. `HYPERFRAMES_BROWSER_PATH` still wins
  // over this — an explicit override is still an explicit override.
  preferManagedChrome?: boolean;
  signal?: AbortSignal;
}

interface CacheLookupResult {
  result?: BrowserResult;
  staleHyperframesCachePath?: string;
}

// --- Internal helpers -------------------------------------------------------

const SYSTEM_CHROME_PATHS: ReadonlyArray<string> =
  process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : process.platform === "win32"
      ? [
          join(
            process.env["ProgramW6432"] ?? process.env["PROGRAMFILES"] ?? "C:\\Program Files",
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
          ),
          join(
            process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
          ),
          ...(process.env["LOCALAPPDATA"]
            ? [join(process.env["LOCALAPPDATA"], "Google", "Chrome", "Application", "chrome.exe")]
            : []),
        ]
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
        ];

function whichBinary(name: string): string | undefined {
  try {
    const cmd = process.platform === "win32" ? `where ${name}` : `which ${name}`;
    const output = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
      windowsHide: true,
    });
    const first = output
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    return first || undefined;
  } catch {
    return undefined;
  }
}

// A caller-supplied browser, named by HYPERFRAMES_BROWSER_PATH or PRODUCER_HEADLESS_SHELL_PATH (the engine's
// and the deploy docs' name). check, snapshot and compare honour it as render does; which name wins is
// browserPathFromEnv's, so the engine launches what this resolved.
function findFromEnv(): BrowserResult | undefined {
  const envPath = browserPathFromEnv()?.path;
  if (envPath && existsSync(envPath)) {
    return { executablePath: envPath, source: "env" };
  }
  return undefined;
}

/**
 * Hyperframes-managed cache only (populated by `ensureBrowser` as a
 * download-of-last-resort, pinned to `CHROME_VERSION`).
 */
async function findFromHyperframesCache(): Promise<CacheLookupResult> {
  if (!existsSync(CACHE_DIR)) return {};
  const { Browser, detectBrowserPlatform, getInstalledBrowsers } = await loadPuppeteerBrowsers();
  // A corrupt cache (stub file where a browser dir is expected, malformed
  // metadata) makes getInstalledBrowsers throw. Treat that as "no cached
  // browser" so resolution falls through to system/download instead of
  // crashing every caller.
  let installed: Awaited<ReturnType<typeof getInstalledBrowsers>>;
  try {
    installed = await getInstalledBrowsers({ cacheDir: CACHE_DIR });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    const suffix = code ? ` (${code})` : "";
    console.warn(
      `[hyperframes] Browser cache read failed${suffix}: ${normalizeErrorMessage(err)}. Falling back to system Chrome or a fresh download.`,
    );
    installed = [];
  }
  // Match on buildId too, not just browser type — an install left over from
  // an older hyperframes version (this pin has moved 131 → 151 → 152 across
  // releases) must NOT satisfy resolution, or an upgrade silently keeps
  // running whatever build happened to be cached instead of ever fetching
  // the version this release actually needs (HF#2060 review). Match platform
  // as well so a shared/migrated cache cannot return a foreign executable.
  const hostPlatform = detectBrowserPlatform();
  const match = installed.find(
    (b) =>
      b.browser === Browser.CHROMEHEADLESSSHELL &&
      b.buildId === managedChromeVersion() &&
      b.platform === hostPlatform,
  );
  if (match && isUsableExecutable(match.executablePath)) {
    return { result: { executablePath: match.executablePath, source: "cache" } };
  }
  if (match) {
    return { staleHyperframesCachePath: match.executablePath };
  }
  return {};
}

async function findFromCache(): Promise<CacheLookupResult> {
  // Our pinned build first, as the engine's resolveHeadlessShellPath reads it; then the shared cache's pick.
  const ours = await findFromHyperframesCache();
  if (ours.result) return ours;
  const fromPuppeteer = findFromPuppeteerCache();
  return fromPuppeteer ? { result: fromPuppeteer } : ours;
}

const CACHED_HEADLESS_SHELL_EXECUTABLES: Readonly<
  Record<string, readonly [directory: string, executable: string]>
> = {
  "darwin/arm64": ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"],
  "darwin/x64": ["chrome-headless-shell-mac-x64", "chrome-headless-shell"],
  "linux/x64": ["chrome-headless-shell-linux64", "chrome-headless-shell"],
  "win32/ia32": ["chrome-headless-shell-win32", "chrome-headless-shell.exe"],
  "win32/x64": ["chrome-headless-shell-win64", "chrome-headless-shell.exe"],
};

function cachedHeadlessShellExecutable(
  hostPlatform = process.platform,
  hostArch = process.arch,
): readonly [directory: string, executable: string] | undefined {
  // Chrome for Testing cache entries are host-specific. Resolve exactly one
  // platform/architecture directory so a foreign binary cannot win by probe order.
  // Chrome for Testing does not publish Linux ARM64 binaries. Windows ARM64 can
  // emulate x64 only on supported Windows 11 builds, which this platform/arch-only
  // resolver cannot prove, so both hosts deliberately fall through to system
  // browser discovery instead of attempting a potentially foreign cached binary.
  return CACHED_HEADLESS_SHELL_EXECUTABLES[`${hostPlatform}/${hostArch}`];
}

function findFromPuppeteerCache(): BrowserResult | undefined {
  if (!existsSync(PUPPETEER_CACHE_DIR)) return undefined;
  const executable = cachedHeadlessShellExecutable();
  if (!executable) return undefined;
  let versions: string[];
  try {
    versions = readdirSync(PUPPETEER_CACHE_DIR);
  } catch {
    return undefined;
  }
  const binary = pickSharedShell(versions, (version) => {
    const candidate = join(PUPPETEER_CACHE_DIR, version, ...executable);
    return isUsableExecutable(candidate) ? candidate : undefined;
  });
  return binary ? { executablePath: binary, source: "cache" } : undefined;
}

/**
 * True iff the binary at `executablePath` is `chrome-headless-shell` (i.e. the
 * Chromium build that still exposes `HeadlessExperimental.enable` /
 * `beginFrame`). Regular Chrome and `chromium` have dropped those domains, so
 * the engine's perf-optimized BeginFrame capture path silently degrades to
 * screenshot mode when those are used.
 */
function isHeadlessShellBinary(executablePath: string): boolean {
  const name = basename(executablePath).toLowerCase();
  return name === "chrome-headless-shell" || name === "chrome-headless-shell.exe";
}

/**
 * Emit a one-time warning when the CLI selects a non-headless-shell binary on
 * Linux. Idempotent across repeated `findBrowser()` calls so a long-running
 * `hyperframes studio` process doesn't get spammed.
 */
let _warnedSystemFallback = false;
function warnSystemFallbackOnce(executablePath: string): void {
  if (_warnedSystemFallback) return;
  if (process.platform !== "linux") return;
  if (isHeadlessShellBinary(executablePath)) return;
  _warnedSystemFallback = true;
  console.warn(
    `[hyperframes] Using system Chrome at ${executablePath}; HeadlessExperimental.beginFrame is unavailable in regular Chrome builds, so the perf-optimized capture path falls back to screenshot mode. Install chrome-headless-shell for the optimized path:\n  npx @puppeteer/browsers install chrome-headless-shell\n(Or set HYPERFRAMES_BROWSER_PATH to point at an existing chrome-headless-shell binary.)`,
  );
}

/** Test-only: reset the one-shot warn latch. */
export function _resetSystemFallbackWarnForTests(): void {
  _warnedSystemFallback = false;
}

export function findSystemBrowser(): BrowserResult | undefined {
  for (const p of SYSTEM_CHROME_PATHS) {
    if (existsSync(p)) {
      return { executablePath: p, source: "system" };
    }
  }

  const fromWhich = whichBinary("google-chrome") ?? whichBinary("chromium");
  if (fromWhich) {
    return { executablePath: fromWhich, source: "system" };
  }

  return undefined;
}

// --- Public API -------------------------------------------------------------

/**
 * Find an existing browser without downloading.
 * Resolution: env var -> cached download -> system Chrome.
 */
export async function findBrowser(): Promise<BrowserResult | undefined> {
  const fromEnv = findFromEnv();
  if (fromEnv) return fromEnv;

  const fromCache = await findFromCache();
  if (fromCache.result) return fromCache.result;
  if (fromCache.staleHyperframesCachePath) {
    console.warn(
      `[browser] Cached binary unusable (missing, empty or not a file) at ${fromCache.staleHyperframesCachePath} — re-downloading...`,
    );
    try {
      return await withInstallLock(() => downloadBrowser());
    } catch (err) {
      const cause = normalizeErrorMessage(err);
      throw new Error(
        `Cached Chrome binary was unusable at ${fromCache.staleHyperframesCachePath}, and re-download failed: ${cause}\n` +
          `Run \`hyperframes browser ensure --force\` to re-download.`,
      );
    }
  }

  const fromSystem = findSystemBrowser();
  if (fromSystem) {
    warnSystemFallbackOnce(fromSystem.executablePath);
  }
  return fromSystem;
}

/**
 * On Linux ARM64, attempt to auto-install system Chromium if not found.
 * This makes `hyperframes render` work out-of-the-box on DGX Spark / GB10 / Jetson.
 */
async function ensureLinuxArmBrowser(options?: EnsureBrowserOptions): Promise<BrowserResult> {
  void options;

  // If already available (env var or system path), use it directly.
  const existing = await findBrowser();
  if (existing) return existing;

  // Try auto-installing via apt (common on Ubuntu-based ARM systems).
  const hasApt = existsSync("/usr/bin/apt-get");
  if (hasApt) {
    console.error(
      "\n🔍 Linux ARM64 detected — Chrome Headless Shell is not available for this platform.",
    );
    console.error("📦 Auto-installing system Chromium via apt-get (this only happens once)...\n");

    // Use spawnSync so output streams to the terminal in real time.
    const result = spawnSync("apt-get", ["install", "-y", "chromium-browser"], {
      stdio: "inherit",
      timeout: 120_000,
    });

    if (result.status === 0) {
      const afterInstall = await findBrowser();
      if (afterInstall) {
        console.error(`\n✅ Chromium installed at ${afterInstall.executablePath}\n`);
        return afterInstall;
      }
    } else {
      // apt succeeded but binary not found, or apt failed — fall through to helpful error.
      console.error("\n⚠️  apt-get exited with errors. Trying anyway...\n");
      const afterAttempt = await findBrowser();
      if (afterAttempt) return afterAttempt;
    }
  }

  // Could not auto-install — give clear manual instructions.
  throw new Error(
    `Chrome Headless Shell is not available for Linux ARM64 (DGX Spark, GB10, Jetson).\n\n` +
      `Install Chromium manually and point hyperframes to it:\n\n` +
      `  sudo apt-get install -y chromium-browser\n` +
      `  export HYPERFRAMES_BROWSER_PATH=$(which chromium-browser)\n\n` +
      `Then re-run your command. The HYPERFRAMES_BROWSER_PATH env var persists for the session.`,
  );
}

/**
 * Find or download a browser.
 * Resolution: env var -> cached download -> system Chrome -> auto-download.
 * With `preferManagedChrome`: env var -> OUR pinned cache -> auto-download
 * (puppeteer-cache preference and system Chrome are both skipped).
 */
const BROWSER_WAIT_NOTICE_MS = 15_000;

/** Runs `task`, saying so every 15 s while it is still going, so a first-use download is never silent. */
export async function withBrowserWaitNotice<T>(
  task: Promise<T>,
  notify: (message: string) => void = console.warn,
  everyMs = BROWSER_WAIT_NOTICE_MS,
): Promise<T> {
  const timer = setInterval(
    () =>
      notify(
        "[hyperframes] Still getting Chrome ready; the first use downloads it. " +
          "Set HYPERFRAMES_BROWSER_PATH to use an installed Chrome instead.",
      ),
    everyMs,
  );
  timer.unref();
  try {
    return await task;
  } finally {
    clearInterval(timer);
  }
}

export async function ensureBrowser(options?: EnsureBrowserOptions): Promise<BrowserResult> {
  // Tools that time out at 120 s lose to three stalled attempts (~4 min); one stall then a clear error wins.
  const resolved = {
    ...options,
    downloadAttempts: options?.downloadAttempts ?? (process.stdout.isTTY ? DOWNLOAD_ATTEMPTS : 1),
  };
  const task = resolved.signal
    ? ensureBrowserInOwnedProcess(resolved)
    : ensureBrowserInCurrentProcess(resolved);
  return resolved.onProgress ? task : withBrowserWaitNotice(task);
}

// fallow-ignore-next-line complexity
async function ensureBrowserInCurrentProcess(
  options?: EnsureBrowserOptions,
): Promise<BrowserResult> {
  const configured = browserPathFromEnv();
  if (configured && !existsSync(configured.path)) {
    throw new Error(
      `${configured.name} is set to ${configured.path}, which does not exist. Fix the path or unset it.`,
    );
  }
  const fromEnv = findFromEnv();
  if (fromEnv) return fromEnv;

  if (!options?.force) {
    const fromCache = await (options?.preferManagedChrome
      ? findFromHyperframesCache()
      : findFromCache());
    if (fromCache.result) return fromCache.result;
    if (fromCache.staleHyperframesCachePath) {
      console.warn(
        `[browser] Cached binary unusable (missing, empty or not a file) at ${fromCache.staleHyperframesCachePath} — re-downloading...`,
      );
      return withInstallLock(() => downloadBrowser(options));
    }

    if (!options?.preferManagedChrome) {
      const fromSystem = findSystemBrowser();
      if (fromSystem) {
        warnSystemFallbackOnce(fromSystem.executablePath);
        return fromSystem;
      }
    }
  }

  return withInstallLock(async () => {
    // Re-check after acquiring the lock: a concurrent invocation may have
    // finished installing while we were waiting, in which case reuse its
    // result instead of downloading and extracting a second time. Skipped
    // under --force, which always wants a fresh download.
    if (!options?.force) {
      const afterLock = await (options?.preferManagedChrome
        ? findFromHyperframesCache()
        : findFromCache());
      if (afterLock.result) return afterLock.result;
    }
    return downloadBrowser(options);
  });
}

async function ensureBrowserInOwnedProcess(options: EnsureBrowserOptions): Promise<BrowserResult> {
  const signal = options.signal;
  signal?.throwIfAborted();
  const lockOwner = randomUUID();
  try {
    return await runRenderSetupWorker<BrowserResult>(
      "browser",
      {
        force: options.force,
        preferManagedChrome: options.preferManagedChrome,
        downloadAttempts: options.downloadAttempts,
      },
      {
        signal,
        maxBufferBytes: 4 * 1024 * 1024,
        env: { [INSTALL_LOCK_OWNER_ENV]: lockOwner },
      },
    );
  } finally {
    releaseBrowserInstallLock(lockOwner);
  }
}

/**
 * True when `err` is a corrupt/truncated-archive extraction failure, as opposed
 * to a network error or a genuine platform problem. A partially-downloaded or
 * interrupted browser archive left in the cache makes `install()`'s extraction
 * throw "invalid end-of-central-directory" (a zip whose central directory is
 * missing/truncated). Left unhandled, that hard-blocks every render on the box
 * until the user manually clears the cache — so we detect it and re-download.
 */
export function isCorruptArchiveError(err: unknown): boolean {
  const msg = normalizeErrorMessage(err).toLowerCase();
  return (
    msg.includes("end of central directory") ||
    msg.includes("end-of-central-directory") ||
    msg.includes("invalid or corrupt") ||
    msg.includes("corrupt zip") ||
    msg.includes("not a zip") ||
    msg.includes("unexpected end of") ||
    msg.includes("corrupted")
  );
}

/**
 * Run a browser install; if it fails because the cached archive is corrupt,
 * clear the cache (dropping the bad archive) and retry the download exactly
 * once. Non-corruption errors propagate unchanged, and a second corruption
 * propagates too (no infinite retry).
 */
export async function installWithCorruptArchiveRecovery<T>(
  runInstall: () => Promise<T>,
  clearCache: () => void,
  onRecover?: (err: unknown) => void,
): Promise<T> {
  try {
    return await runInstall();
  } catch (err) {
    if (!isCorruptArchiveError(err)) throw err;
    onRecover?.(err);
    clearCache();
    return await runInstall();
  }
}

/**
 * When `@puppeteer/browsers`' install() rejects for any reason the corrupt-
 * archive recovery path can't handle (all CDN providers rejected — the
 * `All providers failed for chrome-headless-shell <ver>` case reported from the
 * field on darwin/arm64 with CLI 0.7.57; DNS/network failure; a macOS Gatekeeper
 * quarantine that blocks the pinned Dev-channel binary from launching a probe;
 * a second corruption that trips the retry gate), the raw error names none of
 * the escape hatches that would unblock the user. Rewrap it in one that does:
 * `HYPERFRAMES_BROWSER_PATH` wins over both the managed download and system
 * lookup (see `findFromEnv` above), so pointing it at an already-installed
 * Chrome renders successfully via the screenshot fallback while the pinned
 * chrome-headless-shell download is broken. Sibling failure mode: #2078
 * (SIGTRAP at launch), same remediation, different trigger.
 */
function browserPathHintForPlatform(): string {
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  if (process.platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }
  return "/usr/bin/google-chrome";
}

function wrapDownloadFailureWithBrowserPathHint(
  cause: unknown,
  unzipLog: readonly string[],
): Error {
  const original = normalizeErrorMessage(cause);
  const unzipErrors = unzipLog.length > 0 ? ` Unzip errors: ${unzipLog.join("; ")}` : "";
  const example = browserPathHintForPlatform();
  const message =
    `Failed to install chrome-headless-shell ${managedChromeVersion()}: ${original}${unzipErrors}\n\n` +
    `Point hyperframes at an already-installed Chrome/Chromium instead:\n\n` +
    `  export HYPERFRAMES_BROWSER_PATH="${example}"\n\n` +
    `Run \`hyperframes doctor\` to see which Chrome was found. Then re-run your command. Any Chrome build works for the screenshot ` +
    `capture path; install a real chrome-headless-shell later if you need the ` +
    `perf-optimized BeginFrame path. Alternatively, run inside the hyperframes ` +
    `Docker image which ships a compatible headless-shell.`;
  return new Error(message, { cause: cause instanceof Error ? cause : undefined });
}

const DOWNLOAD_STALL_MS = 60_000;
const DOWNLOAD_ATTEMPTS = 3;

export async function retryOnStall<T>(
  run: () => Promise<T>,
  clear: () => void,
  attempts = DOWNLOAD_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (!(err instanceof BrowserDownloadStalledError) || attempt >= attempts) throw err;
      console.warn(`[hyperframes] ${err.message} Retrying (${attempt}/${attempts - 1}).`);
      clear();
    }
  }
}

function downloadHostOf(
  browsers: PuppeteerBrowsers,
  platform: Parameters<PuppeteerBrowsers["getDownloadUrl"]>[1],
  buildId: string,
  baseUrl: string | undefined,
): string {
  try {
    const url = browsers.getDownloadUrl(
      browsers.Browser.CHROMEHEADLESSSHELL,
      platform,
      buildId,
      baseUrl,
    );
    return new URL(url).host;
  } catch {
    return "the Chrome download host";
  }
}

// Callers hold the install lock, so every leftover belongs to an install that was killed mid-way.
function assertRoomToDownload(): void {
  removeInstallLeftovers();
  const freeMb = getFreeDiskMb(CACHE_ROOT_DIR);
  if (freeMb !== null && freeMb < ARCHIVE_PLUS_UNPACKED_SHELL_MB) {
    throw new Error(
      `Low disk space: Chrome Headless Shell needs about ${ARCHIVE_PLUS_UNPACKED_SHELL_MB} MB to download, ` +
        `${freeMb} MB free at ${CACHE_ROOT_DIR}. Free disk space, then retry.`,
    );
  }
}

type BrowserPlatform = NonNullable<ReturnType<PuppeteerBrowsers["detectBrowserPlatform"]>>;

function stagedInstaller(
  browsers: PuppeteerBrowsers,
  platform: BrowserPlatform,
  stagingDir: string,
  options: EnsureBrowserOptions | undefined,
  unzipLog: { lines: string[] },
) {
  const buildId = managedChromeVersion();
  const hooks = {
    stallMs: options?.downloadStallMs ?? DOWNLOAD_STALL_MS,
    host: downloadHostOf(browsers, platform, buildId, options?.downloadBaseUrl),
    onProgress: options?.onProgress,
    onLog: (line: string) => unzipLog.lines.push(line),
  };
  return async () => {
    unzipLog.lines = [];
    const input = {
      cacheDir: stagingDir,
      browser: browsers.Browser.CHROMEHEADLESSSHELL,
      buildId,
      platform,
      baseUrl: options?.downloadBaseUrl,
    };
    const unzipMayAskOnInput = process.platform !== "win32";
    if (unzipMayAskOnInput) {
      const archive = await installInChild({ ...input, unpack: false }, hooks);
      const into = new browsers.Cache(stagingDir).installationDir(input.browser, platform, buildId);
      await unzipArchive(archive, into);
    }
    return installInChild(input, hooks);
  };
}

async function downloadBrowser(options?: EnsureBrowserOptions): Promise<BrowserResult> {
  if (isLinuxArm()) {
    return ensureLinuxArmBrowser(options);
  }
  assertRoomToDownload();
  const browsers = await loadPuppeteerBrowsers();
  const platform = browsers.detectBrowserPlatform();
  if (!platform) {
    throw new Error(`Unsupported platform: ${process.platform} ${process.arch}`);
  }

  // Same filesystem as CACHE_DIR so the final rename is atomic.
  const stagingDir = join(CACHE_ROOT_DIR, `${STAGING_PREFIX}${randomUUID()}`);
  const clearStaging = () => rmSync(stagingDir, { recursive: true, force: true });
  // install() only debug-logs each failed unzip tool before trying the next one; keep those lines.
  const unzipLog = { lines: [] as string[] };
  const runInstall = stagedInstaller(browsers, platform, stagingDir, options, unzipLog);

  try {
    const staged = await retryOnStall(
      () =>
        installWithCorruptArchiveRecovery(runInstall, clearStaging, (err) =>
          console.warn(
            `[hyperframes] Downloaded browser archive was corrupt (${normalizeErrorMessage(err)}); re-downloading.`,
          ),
        ),
      clearStaging,
      options?.downloadAttempts,
    );
    assertExecutableUnpacked(stagingDir, staged.executablePath);
    unzipLog.lines = [];
    return { executablePath: moveStagedInstallIntoCache(stagingDir, staged), source: "download" };
  } catch (err) {
    throw wrapDownloadFailureWithBrowserPathHint(err, unzipLog.lines);
  } finally {
    clearStaging();
  }
}

function executableState(path: string): "usable" | "is missing" | "is empty" | "is not a file" {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return "is missing";
  if (!stat.isFile()) return "is not a file";
  return stat.size > 0 ? "usable" : "is empty";
}

function isUsableExecutable(path: string): boolean {
  try {
    return executableState(path) === "usable";
  } catch {
    return false;
  }
}

// install() returns without checking that the unzip produced the executable.
function assertExecutableUnpacked(stagingDir: string, executablePath: string): void {
  const state = executableState(executablePath);
  if (state === "usable") return;
  throw new Error(
    `the archive downloaded, but ${relative(stagingDir, executablePath)} ${state} after unzipping.`,
  );
}

// Swap one staged version dir into CACHE_DIR by rename, never deleting the cache under live users:
// a running old binary keeps its inode, and a stale partial extract (exe missing) is replaced too.
function moveStagedInstallIntoCache(
  stagingDir: string,
  staged: { path: string; executablePath: string },
): string {
  const target = join(CACHE_DIR, relative(stagingDir, staged.path));
  const aside = join(CACHE_ROOT_DIR, `${REPLACED_PREFIX}${randomUUID()}`);
  mkdirSync(dirname(target), { recursive: true });
  let replaced = false;
  try {
    renameSync(target, aside);
    replaced = true;
  } catch (err) {
    if (!isErrno(err, "ENOENT")) throw err;
  }
  try {
    renameSync(staged.path, target);
  } catch (err) {
    if (replaced) renameSync(aside, target);
    throw err;
  }
  if (replaced) removeLeftover(aside);
  return join(target, relative(staged.path, staged.executablePath));
}

const STAGING_PREFIX = ".chrome-staging-";
const REPLACED_PREFIX = ".chrome-replaced-";

// Staging and set-aside dirs outlive an install killed by a signal, since `finally` never runs.
const isInstallLeftover = (name: string) =>
  name.startsWith(STAGING_PREFIX) || name.startsWith(REPLACED_PREFIX);

function removeInstallLeftovers(tolerateLocked = true): boolean {
  let names: string[];
  try {
    names = readdirSync(CACHE_ROOT_DIR);
  } catch (err) {
    if (isErrno(err, "ENOENT")) return false;
    throw err;
  }
  const leftovers = names.filter(isInstallLeftover);
  for (const name of leftovers) removeLeftover(join(CACHE_ROOT_DIR, name), tolerateLocked);
  return leftovers.length > 0;
}

// A running Chrome keeps its debug.log open and Windows refuses to unlink it; the next sweep retries.
function removeLeftover(path: string, tolerateLocked = true): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (err) {
    if (!tolerateLocked || (!isErrno(err, "EBUSY") && !isErrno(err, "EPERM"))) throw err;
  }
}

export async function sweepKilledInstalls(): Promise<void> {
  const names = existsSync(CACHE_ROOT_DIR) ? readdirSync(CACHE_ROOT_DIR) : [];
  if (!names.some(isInstallLeftover)) return;
  await withInstallLock(async () => removeInstallLeftovers());
}

// Deletes the managed Chrome cache and interrupted-install leftovers; true when any of them existed.
export function clearBrowser(): boolean {
  const removedLeftovers = removeInstallLeftovers(false);
  if (!existsSync(CACHE_DIR)) return removedLeftovers;
  rmSync(CACHE_DIR, { recursive: true, force: true });
  return true;
}

export function isLinuxArm(): boolean {
  return process.platform === "linux" && process.arch === "arm64";
}

export { CACHE_DIR, managedChromeVersion };
