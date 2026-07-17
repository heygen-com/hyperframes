// Shared Puppeteer browser management and thumbnail generation for Studio dev server.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createStudioDevRenderBodyScripts } from "./vite.studioMotion";
import { seekThumbnailPreview } from "./vite.thumbnail";

// ── Shared Puppeteer browser ─────────────────────────────────────────────────

let _browser: import("puppeteer-core").Browser | null = null;
let _browserLaunchPromise: Promise<import("puppeteer-core").Browser> | null = null;

// Installed system browsers (Chrome/Chromium-family), macOS + Linux.
const CHROME_APP_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

// Chrome-for-Testing downloaded by Puppeteer (or `npx puppeteer browsers install`).
// Layout: <cacheDir>/chrome/<platform>-<version>/chrome-<platform>/<executable>.
// Prefer the highest version so a stale early build doesn't win.
// fallow-ignore-next-line complexity
function findPuppeteerCacheChrome(): string | undefined {
  const cacheRoot = process.env.PUPPETEER_CACHE_DIR || join(homedir(), ".cache", "puppeteer");
  const chromeRoot = join(cacheRoot, "chrome");
  let versionDirs: string[];
  try {
    versionDirs = readdirSync(chromeRoot);
  } catch {
    return undefined; // no cache dir
  }
  const buildOrder = (dir: string): number => {
    const parts = (dir.split("-").pop() ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);
    return parts.reduce((acc, n) => acc * 100000 + n, 0);
  };
  const relCandidates = [
    "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-linux64/chrome",
  ];
  for (const dir of versionDirs.sort((a, b) => buildOrder(b) - buildOrder(a))) {
    for (const rel of relCandidates) {
      const exe = join(chromeRoot, dir, rel);
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

/** Resolve a Chrome/Chromium executable: env override → system install → Puppeteer cache. */
function resolveChromeExecutable(): string | undefined {
  const envOverride = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.CHROME_BIN,
  ].find((p): p is string => !!p && existsSync(p));
  return envOverride ?? CHROME_APP_PATHS.find((p) => existsSync(p)) ?? findPuppeteerCacheChrome();
}

async function getSharedBrowser(): Promise<import("puppeteer-core").Browser | null> {
  if (_browser?.connected) return _browser;
  if (_browserLaunchPromise) return _browserLaunchPromise;
  _browserLaunchPromise = (async () => {
    const puppeteer = await import("puppeteer-core");
    const executablePath = resolveChromeExecutable();
    if (!executablePath) return null;
    _browser = await puppeteer.default.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    });
    _browserLaunchPromise = null;
    return _browser;
  })();
  return _browserLaunchPromise;
}

/** The Chrome/Chromium executable path (undefined if none found). */
export function findSystemChrome(): string | undefined {
  return resolveChromeExecutable();
}

interface ScreenshotClip {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function applyStudioRenderBodyScriptsToThumbnailPage(
  page: import("puppeteer-core").Page,
  projectDir: string,
  activeCompositionPath: string,
): Promise<void> {
  const scripts = createStudioDevRenderBodyScripts(projectDir, {
    activeCompositionPath,
  });
  for (const script of scripts) {
    await page.addScriptTag({ content: script });
  }
}

async function reapplyStudioRenderBodyScriptsToThumbnailPage(
  page: import("puppeteer-core").Page,
): Promise<void> {
  await page.evaluate(() => {
    const runtimeWindow = window as Window & {
      __hfStudioManualEditsApply?: () => number;
      __hfStudioMotionApply?: () => number;
    };
    if (typeof runtimeWindow.__hfStudioManualEditsApply === "function") {
      runtimeWindow.__hfStudioManualEditsApply();
    }
    if (typeof runtimeWindow.__hfStudioMotionApply === "function") {
      runtimeWindow.__hfStudioMotionApply();
    }
  });
}

export interface GenerateThumbnailOptions {
  project: { dir: string };
  compPath: string;
  seekTime: number;
  previewUrl: string;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
  format: "jpeg" | "png";
  selector?: string;
  selectorIndex?: number;
  signal: AbortSignal;
}

export async function generateThumbnail(opts: GenerateThumbnailOptions): Promise<Buffer | null> {
  const browser = await getSharedBrowser();
  if (!browser || opts.signal.aborted) return null;
  let page: Awaited<ReturnType<typeof browser.newPage>> | null = null;
  const closePage = () => void page?.close().catch(() => {});
  opts.signal.addEventListener("abort", closePage, { once: true });
  try {
    page = await browser.newPage();
    if (opts.signal.aborted) return null;
    await page.setViewport({
      width: opts.width,
      height: opts.height,
      deviceScaleFactor: Math.max(
        0.1,
        Math.min(1, opts.outputWidth / opts.width, opts.outputHeight / opts.height),
      ),
    });
    await page.goto(opts.previewUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.evaluate(() => {
      document.documentElement.style.background = "#1c2028";
      document.body.style.background = "#1c2028";
      document.body.style.margin = "0";
      document.body.style.overflow = "hidden";
    });
    await page
      .waitForFunction(`!!(window.__timelines && Object.keys(window.__timelines).length > 0)`, {
        timeout: 5000,
      })
      .catch(() => {});
    await seekThumbnailPreview(page, opts.seekTime);
    await applyStudioRenderBodyScriptsToThumbnailPage(page, opts.project.dir, opts.compPath);
    await page.evaluate("document.fonts?.ready");
    await new Promise((r) => setTimeout(r, 200));
    await reapplyStudioRenderBodyScriptsToThumbnailPage(page);
    let clip: ScreenshotClip | undefined;
    if (opts.selector) {
      clip = await page.evaluate(
        (selector: string, selectorIndex: number | undefined) => {
          const matches = Array.from(document.querySelectorAll(selector)).filter(
            (el): el is HTMLElement => el instanceof HTMLElement,
          );
          const safeIndex = Math.max(
            0,
            Math.min(matches.length - 1, Math.floor(selectorIndex ?? 0)),
          );
          const el = matches[safeIndex] ?? null;
          if (!(el instanceof HTMLElement)) return undefined;
          const rect = el.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4) return undefined;
          const pad = 8;
          const x = Math.max(0, rect.left - pad);
          const y = Math.max(0, rect.top - pad);
          const maxWidth = window.innerWidth - x;
          const maxHeight = window.innerHeight - y;
          return {
            x,
            y,
            width: Math.max(1, Math.min(rect.width + pad * 2, maxWidth)),
            height: Math.max(1, Math.min(rect.height + pad * 2, maxHeight)),
          };
        },
        opts.selector,
        opts.selectorIndex,
      );
    }
    const buf = await page.screenshot(
      opts.format === "png"
        ? { type: "png", ...(clip ? { clip } : {}) }
        : { type: "jpeg", quality: 75, ...(clip ? { clip } : {}) },
    );
    return buf as Buffer;
  } catch (err) {
    if (!opts.signal.aborted) {
      console.warn(
        "[Studio] Thumbnail generation failed:",
        err instanceof Error ? err.message : err,
      );
    }
    return null;
  } finally {
    opts.signal.removeEventListener("abort", closePage);
    await page?.close().catch(() => {});
  }
}
