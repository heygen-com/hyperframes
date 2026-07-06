// fallow-ignore-file code-duplication
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeErrorMessage } from "../utils/errorMessage.js";

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

const CHROME_VERSION = "131.0.6778.85";
const CACHE_ROOT_DIR = join(homedir(), ".cache", "hyperframes");
const CACHE_DIR = join(homedir(), ".cache", "hyperframes", "chrome");
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
const INSTALL_LOCK_TIMEOUT_MS = 120_000; // generous: a real download+extract can take a while
const INSTALL_LOCK_POLL_MS = 200;

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

// timeoutMs/pollMs are parameters (not just the module constants) so tests can
// exercise the reclaim-on-timeout branch with real but tiny waits instead of
// mocking Date.now()/setTimeout through the full ensureBrowser call graph.
export async function withInstallLock<T>(
  fn: () => Promise<T>,
  timeoutMs = INSTALL_LOCK_TIMEOUT_MS,
  pollMs = INSTALL_LOCK_POLL_MS,
): Promise<T> {
  // recursive:false below needs the parent to already exist (unlike `mkdir -p`).
  // Keep lock dirs outside CACHE_DIR so force-clearing the Chrome cache cannot
  // delete another installer's in-flight lock.
  if (!existsSync(CACHE_ROOT_DIR)) mkdirSync(CACHE_ROOT_DIR, { recursive: true });
  let deadline = Date.now() + timeoutMs;
  for (;;) {
    if (existsSync(INSTALL_RECLAIM_LOCK_DIR)) {
      await sleep(pollMs);
      continue;
    }
    if (tryAcquireDirLock(INSTALL_LOCK_DIR)) {
      rmSync(INSTALL_RECLAIM_LOCK_DIR, { recursive: true, force: true });
      break;
    }
    if (Date.now() > deadline) {
      // The reclaim gate matters when multiple waiters cross the timeout at
      // once: without it, waiter A can delete the stale lock and acquire a
      // fresh one, then waiter B (whose old deadline also expired) can delete
      // A's fresh lock. The gate serializes reclaimers, and the mtime re-check
      // after the gate prevents deleting a fresh lock another waiter just won.
      reclaimStaleInstallLock(timeoutMs);
      deadline = Date.now() + timeoutMs;
      continue;
    }
    await sleep(pollMs);
  }
  try {
    return await fn();
  } finally {
    rmSync(INSTALL_LOCK_DIR, { recursive: true, force: true });
  }
}

export type BrowserSource = "env" | "cache" | "system" | "download";

export interface BrowserResult {
  executablePath: string;
  source: BrowserSource;
}

export interface EnsureBrowserOptions {
  onProgress?: (downloadedBytes: number, totalBytes: number) => void;
  // Purge any cached HF-managed download before resolving, so a stale or
  // partially-extracted install can't make the retry look like a no-op.
  force?: boolean;
}

interface CacheLookupResult {
  result?: BrowserResult;
  staleHyperframesCachePath?: string;
  // Root install-folder path for the stale entry (InstalledBrowser#path), NOT
  // the missing executablePath above — this is what actually needs deleting.
  staleInstallPath?: string;
}

/**
 * Remove one browser version's install directory (not the whole CACHE_DIR).
 * @puppeteer/browsers' install() treats an existing-but-incomplete directory
 * as already installed and throws "folder exists but executable is missing"
 * rather than re-extracting — so an extraction interrupted by a Windows AV
 * lock, a sleep/wake cycle, or ctrl-C (left with only alphabetically-early
 * files like ABOUT/LICENSE, no exe) wedges every subsequent ensure/render
 * with the same error until someone manually deletes the directory. Purging
 * it first makes the retry actually retry.
 */
function purgeStaleInstall(installPath: string): void {
  rmSync(installPath, { recursive: true, force: true });
}

// --- Internal helpers -------------------------------------------------------

const SYSTEM_CHROME_PATHS: ReadonlyArray<string> =
  process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
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

function findFromEnv(): BrowserResult | undefined {
  const envPath = process.env["HYPERFRAMES_BROWSER_PATH"];
  if (envPath && existsSync(envPath)) {
    return { executablePath: envPath, source: "env" };
  }
  return undefined;
}

async function findFromCache(): Promise<CacheLookupResult> {
  // 1) Puppeteer's managed cache — where `npx @puppeteer/browsers install
  // chrome-headless-shell` lands, and where `puppeteer install` from a project
  // depending on full `puppeteer` (not `puppeteer-core`) lands. The engine's
  // `resolveHeadlessShellPath` reads from here and selects newest-version-
  // first; the CLI must match that semantic or it will silently hand the
  // engine an older binary than the engine itself would pick.
  //
  // We intentionally check puppeteer BEFORE the hyperframes-managed cache:
  // the HF cache is pinned to `CHROME_VERSION` (above) which lags behind
  // upstream Chrome by many releases. If a user installed chrome-headless-shell
  // separately (via `@puppeteer/browsers install`) we want to use that
  // newer binary, not the pinned-stale fallback.
  const fromPuppeteer = findFromPuppeteerCache();
  if (fromPuppeteer) {
    return { result: fromPuppeteer };
  }

  // 2) Hyperframes-managed cache (populated by `ensureBrowser` below as a
  // download-of-last-resort). This is the fallback path: only reached when
  // no puppeteer-cache binary exists.
  if (existsSync(CACHE_DIR)) {
    const { Browser, getInstalledBrowsers } = await loadPuppeteerBrowsers();
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
    const match = installed.find((b) => b.browser === Browser.CHROMEHEADLESSSHELL);
    if (match && existsSync(match.executablePath)) {
      return { result: { executablePath: match.executablePath, source: "cache" } };
    }
    if (match) {
      return { staleHyperframesCachePath: match.executablePath, staleInstallPath: match.path };
    }
  }

  return {};
}

/**
 * Parse a puppeteer-cache version directory name (`linux-148.0.7778.97`,
 * `mac_arm-131.0.6778.85`, etc.) into a numeric tuple for ordering.
 *
 * Lexicographic sort on these strings is buggy because `"99"` > `"148"` (the
 * `9` outranks the `1` character-wise), so a 99-era binary would beat a
 * 148-era binary in `.sort().reverse()`. We split on `-` to drop the platform
 * prefix, then on `.` to get integer segments. Returns `undefined` for names
 * that don't have at least one parseable numeric segment so they sort last.
 */
function parseVersionSegments(versionDir: string): number[] | undefined {
  const dashIdx = versionDir.indexOf("-");
  const versionPart = dashIdx >= 0 ? versionDir.slice(dashIdx + 1) : versionDir;
  const segments = versionPart.split(".");
  const parsed: number[] = [];
  for (const seg of segments) {
    const n = parseInt(seg, 10);
    if (!Number.isFinite(n)) {
      // Stop at the first non-numeric segment but keep what we've collected.
      break;
    }
    parsed.push(n);
  }
  return parsed.length > 0 ? parsed : undefined;
}

/** Numeric semver-style descending comparator for puppeteer cache dirs. */
function compareVersionDirsDescending(a: string, b: string): number {
  const pa = parseVersionSegments(a);
  const pb = parseVersionSegments(b);
  // Unparseable names sort after parseable ones (so we still try them, just last).
  if (!pa && !pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av !== bv) return bv - av; // descending (newest first)
  }
  return 0;
}

function findFromPuppeteerCache(): BrowserResult | undefined {
  if (!existsSync(PUPPETEER_CACHE_DIR)) return undefined;
  let versions: string[];
  try {
    // Numeric semver-style sort, newest first. Lexicographic `.sort().reverse()`
    // (the previous implementation, still in engine `resolveHeadlessShellPath`)
    // mis-orders `linux-99...` ahead of `linux-148...` because character `'9'`
    // outranks `'1'`. See `parseVersionSegments` above.
    versions = [...readdirSync(PUPPETEER_CACHE_DIR)].sort(compareVersionDirsDescending);
  } catch {
    return undefined;
  }
  for (const version of versions) {
    // Same shape as `resolveHeadlessShellPath` in engine/browserManager.ts —
    // keep them aligned. If puppeteer ever changes the on-disk layout the two
    // need to move together.
    const candidates = [
      join(PUPPETEER_CACHE_DIR, version, "chrome-headless-shell-linux64", "chrome-headless-shell"),
      join(
        PUPPETEER_CACHE_DIR,
        version,
        "chrome-headless-shell-mac-arm64",
        "chrome-headless-shell",
      ),
      join(PUPPETEER_CACHE_DIR, version, "chrome-headless-shell-mac-x64", "chrome-headless-shell"),
      join(
        PUPPETEER_CACHE_DIR,
        version,
        "chrome-headless-shell-win64",
        "chrome-headless-shell.exe",
      ),
    ];
    for (const binary of candidates) {
      if (existsSync(binary)) {
        return { executablePath: binary, source: "cache" };
      }
    }
  }
  return undefined;
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

function findFromSystem(): BrowserResult | undefined {
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
      `[browser] Cached binary missing at ${fromCache.staleHyperframesCachePath} — re-downloading...`,
    );
    try {
      return await withInstallLock(async () => {
        if (fromCache.staleInstallPath) purgeStaleInstall(fromCache.staleInstallPath);
        return downloadBrowser();
      });
    } catch (err) {
      const cause = normalizeErrorMessage(err);
      throw new Error(
        `Cached Chrome binary was missing at ${fromCache.staleHyperframesCachePath}, and re-download failed: ${cause}\n` +
          `Run \`hyperframes browser ensure --force\` to re-download.`,
      );
    }
  }

  const fromSystem = findFromSystem();
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
 */
export async function ensureBrowser(options?: EnsureBrowserOptions): Promise<BrowserResult> {
  const fromEnv = findFromEnv();
  if (fromEnv) return fromEnv;

  if (!options?.force) {
    const fromCache = await findFromCache();
    if (fromCache.result) return fromCache.result;
    if (fromCache.staleHyperframesCachePath) {
      console.warn(
        `[browser] Cached binary missing at ${fromCache.staleHyperframesCachePath} — re-downloading...`,
      );
      return withInstallLock(async () => {
        if (fromCache.staleInstallPath) purgeStaleInstall(fromCache.staleInstallPath);
        return downloadBrowser(options);
      });
    }

    const fromSystem = findFromSystem();
    if (fromSystem) {
      warnSystemFallbackOnce(fromSystem.executablePath);
      return fromSystem;
    }
  }

  return withInstallLock(async () => {
    if (options?.force) {
      // `--force` means "always get a fresh managed download" — purging the
      // whole HF-managed cache after acquiring the install lock keeps two
      // concurrent force retries from deleting each other's in-flight lock or
      // partially extracted install.
      clearBrowser();
    }

    // Re-check after acquiring the lock: a concurrent invocation may have
    // finished installing while we were waiting, in which case reuse its
    // result instead of downloading and extracting a second time. Skipped
    // under --force, which already purged and always wants a fresh download.
    if (!options?.force) {
      const afterLock = await findFromCache();
      if (afterLock.result) return afterLock.result;
      if (afterLock.staleInstallPath) purgeStaleInstall(afterLock.staleInstallPath);
    }
    return downloadBrowser(options);
  });
}

async function downloadBrowser(options?: EnsureBrowserOptions): Promise<BrowserResult> {
  if (isLinuxArm()) {
    return ensureLinuxArmBrowser(options);
  }

  const { Browser, detectBrowserPlatform, install } = await loadPuppeteerBrowsers();

  const platform = detectBrowserPlatform();
  if (!platform) {
    throw new Error(`Unsupported platform: ${process.platform} ${process.arch}`);
  }

  const installed = await install({
    cacheDir: CACHE_DIR,
    browser: Browser.CHROMEHEADLESSSHELL,
    buildId: CHROME_VERSION,
    platform,
    downloadProgressCallback: options?.onProgress,
  });

  return { executablePath: installed.executablePath, source: "download" };
}

/**
 * Remove the cached Chrome download directory.
 * Returns true if anything was removed.
 */
export function clearBrowser(): boolean {
  if (!existsSync(CACHE_DIR)) {
    return false;
  }
  rmSync(CACHE_DIR, { recursive: true, force: true });
  return true;
}

export function isLinuxArm(): boolean {
  return process.platform === "linux" && process.arch === "arm64";
}

export { CHROME_VERSION, CACHE_DIR };
