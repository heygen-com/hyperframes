import { execSync, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Browser, detectBrowserPlatform, getInstalledBrowsers, install } from "@puppeteer/browsers";

const CHROME_VERSION = "131.0.6778.85";
const CACHE_DIR = join(homedir(), ".cache", "hyperframes", "chrome");

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
  if (!existsSync(CACHE_DIR)) {
    return undefined;
  }

  const installed = await getInstalledBrowsers({ cacheDir: CACHE_DIR });
  const match = installed.find((b) => b.browser === Browser.CHROMEHEADLESSSHELL);
  if (match) {
    return { executablePath: match.executablePath, source: "cache" };
  }

  return undefined;
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

  return findFromSystem();
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
