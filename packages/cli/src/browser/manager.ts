import { execSync } from "node:child_process";
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

export { CHROME_VERSION, CACHE_DIR };
