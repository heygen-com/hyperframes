import { execSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";
import { Browser, detectBrowserPlatform, getInstalledBrowsers, install } from "@puppeteer/browsers";

const CHROME_VERSION = "131.0.6778.85";
const CACHE_DIR = join(homedir(), ".cache", "hyperframes", "chrome");
// Puppeteer's managed cache — where `@puppeteer/browsers install
// chrome-headless-shell` (and `puppeteer install`) drop binaries. The engine's
// `resolveHeadlessShellPath` scans the same directory; the CLI must look here
// too or it silently picks system Chrome over a perfectly good headless-shell.
const PUPPETEER_CACHE_DIR = join(homedir(), ".cache", "puppeteer", "chrome-headless-shell");

/** Override browser path via --browser-path flag. Takes priority over env var. */
let _browserPathOverride: string | undefined;
export function setBrowserPath(path: string): void {
  _browserPathOverride = path;
}

export type BrowserSource = "env" | "cache" | "system" | "download";

export interface BrowserResult {
  executablePath: string;
  source: BrowserSource;
}

export interface EnsureBrowserOptions {
  onProgress?: (downloadedBytes: number, totalBytes: number) => void;
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
  // --browser-path flag takes priority
  if (_browserPathOverride && existsSync(_browserPathOverride)) {
    return { executablePath: _browserPathOverride, source: "env" };
  }
  const envPath = process.env["HYPERFRAMES_BROWSER_PATH"];
  if (envPath && existsSync(envPath)) {
    return { executablePath: envPath, source: "env" };
  }
  return undefined;
}

async function findFromCache(): Promise<BrowserResult | undefined> {
  // 1) Hyperframes-managed cache (populated by `clearBrowser` + `install` below).
  if (existsSync(CACHE_DIR)) {
    const installed = await getInstalledBrowsers({ cacheDir: CACHE_DIR });
    const match = installed.find((b) => b.browser === Browser.CHROMEHEADLESSSHELL);
    if (match) {
      return { executablePath: match.executablePath, source: "cache" };
    }
  }

  // 2) Puppeteer's managed cache — where `npx @puppeteer/browsers install
  // chrome-headless-shell` lands, and where `puppeteer install` from a project
  // that depends on full `puppeteer` (not `puppeteer-core`) lands. The engine
  // already reads from here (`resolveHeadlessShellPath`); without this branch
  // the CLI would skip past a perfectly good chrome-headless-shell and fall
  // through to `findFromSystem()`, picking regular Chrome which has dropped
  // `HeadlessExperimental.enable` and disables the perf-optimized capture
  // path.
  const fromPuppeteer = findFromPuppeteerCache();
  if (fromPuppeteer) {
    return fromPuppeteer;
  }

  return undefined;
}

function findFromPuppeteerCache(): BrowserResult | undefined {
  if (!existsSync(PUPPETEER_CACHE_DIR)) return undefined;
  let versions: string[];
  try {
    versions = readdirSync(PUPPETEER_CACHE_DIR).sort().reverse(); // newest first
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
    `[hyperframes] Using system Chrome at ${executablePath}; HeadlessExperimental.beginFrame is unavailable in regular Chrome builds, so the perf-optimized capture path falls back to screenshot mode. Install chrome-headless-shell for the optimized path:\n  npx @puppeteer/browsers install chrome-headless-shell`,
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
  if (fromCache) return fromCache;

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
  const existing = await findBrowser();
  if (existing) return existing;

  const platform = detectBrowserPlatform();
  if (!platform) {
    throw new Error(`Unsupported platform: ${process.platform} ${process.arch}`);
  }

  // Chrome headless shell has no Linux ARM64 build (e.g. DGX Spark, GB10).
  // Try to auto-install system Chromium via apt, then find it.
  if (isLinuxArm()) {
    return ensureLinuxArmBrowser(options);
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
  return detectBrowserPlatform() === "linux_arm";
}

export { CHROME_VERSION, CACHE_DIR };
