import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type LaunchOptions, type Page } from "puppeteer-core";

/**
 * Puppeteer browser + page helpers shared across all perf scenarios.
 *
 * Browser launch args mirror packages/producer/src/parity-harness.ts so we get
 * the same SwiftShader-backed WebGL output and font hinting between perf runs
 * and visual parity runs. That parity matters for P0-1c (live-playback parity)
 * and is harmless for the load/scrub/drift scenarios.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAYER_PKG = resolve(HERE, "../..");

export type LaunchOpts = {
  width?: number;
  height?: number;
  headless?: boolean;
};

export type LoadOpts = {
  /** Fixture name (must match a directory under tests/perf/fixtures/). */
  fixture: string;
  width?: number;
  height?: number;
  /** Override timeout in ms for the player `ready` event. Default 30s. */
  readyTimeoutMs?: number;
};

export type LoadResult = {
  /** Wall-clock ms from page navigation start to player `ready` event. */
  loadMs: number;
  /** Composition duration as reported by the player (seconds). */
  duration: number;
};

declare global {
  interface Window {
    __playerReady?: boolean;
    __playerReadyAt?: number;
    __playerNavStart?: number;
    __playerDuration?: number;
    __playerError?: string;
  }
}

function findChromeExecutable(): string | undefined {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return undefined;
}

export async function launchBrowser(options: LaunchOpts = {}): Promise<Browser> {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const executablePath = findChromeExecutable();
  if (!executablePath) {
    throw new Error(
      `[player-perf] no chrome executable found. Set CHROME_PATH or install Google Chrome. (looked in: $CHROME_PATH, $PUPPETEER_EXECUTABLE_PATH, /Applications/Google Chrome.app, /usr/bin/google-chrome)`,
    );
  }
  const launchOptions: LaunchOptions = {
    executablePath,
    headless: options.headless ?? true,
    defaultViewport: {
      width,
      height,
      deviceScaleFactor: 1,
    },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--font-render-hinting=none",
      "--force-color-profile=srgb",
      "--autoplay-policy=no-user-gesture-required",
      `--window-size=${width},${height}`,
    ],
  };
  return puppeteer.launch(launchOptions);
}

/**
 * Navigate a page to the host shell and wait for the player's `ready` event.
 * Returns the wall-clock ms between `Page.goto` start and the `ready` event,
 * along with the composition duration the player reported.
 */
export async function loadHostPage(
  page: Page,
  origin: string,
  options: LoadOpts,
): Promise<LoadResult> {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const readyTimeoutMs = options.readyTimeoutMs ?? 30_000;
  const url = `${origin}/host.html?fixture=${encodeURIComponent(options.fixture)}&width=${width}&height=${height}`;

  const t0 = performance.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: readyTimeoutMs });
  await page.waitForFunction(() => window.__playerReady === true || !!window.__playerError, {
    timeout: readyTimeoutMs,
  });
  const error = await page.evaluate(() => window.__playerError ?? null);
  if (error) throw new Error(`[player-perf] player reported error during load: ${error}`);
  const loadMs = performance.now() - t0;
  const duration = (await page.evaluate(() => window.__playerDuration ?? 0)) ?? 0;
  return { loadMs, duration };
}

export function percentile(samples: number[], pct: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

export function repoPlayerDir(): string {
  return PLAYER_PKG;
}
