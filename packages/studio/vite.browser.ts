// Shared Puppeteer browser management and thumbnail generation for Studio dev server.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, win32 as pathWin32 } from "node:path";
import { thumbnailDeviceScaleFactor } from "@hyperframes/studio-server";
import { createStudioDevRenderBodyScripts } from "./vite.studioMotion";
import { seekThumbnailPreview } from "./vite.thumbnail";

let browser: import("puppeteer-core").Browser | null = null;
let browserLaunch: Promise<import("puppeteer-core").Browser | null> | null = null;

function systemChromePaths(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (platform === "win32") {
    const programFiles = env["PROGRAMFILES"] ?? "C:\\Program Files";
    const programFilesX86 = env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
    const localAppData = env["LOCALAPPDATA"];
    return [
      pathWin32.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      pathWin32.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      ...(localAppData
        ? [pathWin32.join(localAppData, "Google", "Chrome", "Application", "chrome.exe")]
        : []),
    ];
  }
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
}

function findPuppeteerCacheChrome(
  env: NodeJS.ProcessEnv,
  pathExists: (path: string) => boolean,
): string | undefined {
  const chromeRoot = join(
    env["PUPPETEER_CACHE_DIR"] ?? join(homedir(), ".cache", "puppeteer"),
    "chrome",
  );
  let versionDirs: string[];
  try {
    versionDirs = readdirSync(chromeRoot);
  } catch {
    return undefined;
  }
  const buildOrder = (directory: string): number =>
    (directory.split("-").pop() ?? "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0)
      .reduce((order, part) => order * 100000 + part, 0);
  const relativeCandidates = [
    "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-linux64/chrome",
    "chrome-win64/chrome.exe",
  ];
  for (const directory of versionDirs.sort((left, right) => buildOrder(right) - buildOrder(left))) {
    for (const relativePath of relativeCandidates) {
      const executable = join(chromeRoot, directory, relativePath);
      if (pathExists(executable)) return executable;
    }
  }
  return undefined;
}

/** Resolve explicit CLI overrides before system installs and Puppeteer's cache. */
export function findSystemChrome(
  env: NodeJS.ProcessEnv = process.env,
  pathExists: (path: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const override = [
    env["HYPERFRAMES_BROWSER_PATH"],
    env["PRODUCER_HEADLESS_SHELL_PATH"],
    env["PUPPETEER_EXECUTABLE_PATH"],
    env["CHROME_PATH"],
    env["CHROME_BIN"],
  ].find((candidate): candidate is string => Boolean(candidate) && pathExists(candidate));
  return (
    override ??
    systemChromePaths(env, platform).find(pathExists) ??
    findPuppeteerCacheChrome(env, pathExists)
  );
}

async function getSharedBrowser(): Promise<import("puppeteer-core").Browser | null> {
  if (browser?.connected) return browser;
  if (browserLaunch) return browserLaunch;
  const launch = (async () => {
    const puppeteer = await import("puppeteer-core");
    const executablePath = findSystemChrome();
    if (!executablePath) return null;
    browser = await puppeteer.default.launch({
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
    return browser;
  })();
  browserLaunch = launch;
  try {
    return await launch;
  } finally {
    if (browserLaunch === launch) browserLaunch = null;
  }
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
  const scripts = createStudioDevRenderBodyScripts(projectDir, { activeCompositionPath });
  for (const script of scripts) await page.addScriptTag({ content: script });
}

async function reapplyStudioRenderBodyScriptsToThumbnailPage(
  page: import("puppeteer-core").Page,
): Promise<void> {
  await page.evaluate(() => {
    const runtimeWindow = window as Window & {
      __hfStudioManualEditsApply?: () => number;
      __hfStudioMotionApply?: () => number;
    };
    runtimeWindow.__hfStudioManualEditsApply?.();
    runtimeWindow.__hfStudioMotionApply?.();
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
  format?: "jpeg" | "png";
  selector?: string;
  selectorIndex?: number;
  signal: AbortSignal;
}

async function prepareThumbnailPage(
  page: import("puppeteer-core").Page,
  opts: GenerateThumbnailOptions,
): Promise<void> {
  await page.setViewport({
    width: opts.width,
    height: opts.height,
    deviceScaleFactor: thumbnailDeviceScaleFactor(opts),
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
  await new Promise((resolve) => setTimeout(resolve, 200));
  await reapplyStudioRenderBodyScriptsToThumbnailPage(page);
}

async function resolveScreenshotClip(
  page: import("puppeteer-core").Page,
  selector: string | undefined,
  selectorIndex: number | undefined,
): Promise<ScreenshotClip | undefined> {
  if (!selector) return undefined;
  return page.evaluate(
    (targetSelector: string, targetIndex: number | undefined) => {
      const matches = Array.from(document.querySelectorAll(targetSelector)).filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );
      const safeIndex = Math.max(0, Math.min(matches.length - 1, Math.floor(targetIndex ?? 0)));
      const element = matches[safeIndex] ?? null;
      if (!(element instanceof HTMLElement)) return undefined;
      const rect = element.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return undefined;
      const padding = 8;
      const x = Math.max(0, rect.left - padding);
      const y = Math.max(0, rect.top - padding);
      return {
        x,
        y,
        width: Math.max(1, Math.min(rect.width + padding * 2, window.innerWidth - x)),
        height: Math.max(1, Math.min(rect.height + padding * 2, window.innerHeight - y)),
      };
    },
    selector,
    selectorIndex,
  );
}

async function captureThumbnail(
  page: import("puppeteer-core").Page,
  format: GenerateThumbnailOptions["format"],
  clip: ScreenshotClip | undefined,
): Promise<Buffer> {
  const clipOption = clip ? { clip } : {};
  const screenshot = await page.screenshot(
    format === "png"
      ? { type: "png", ...clipOption }
      : { type: "jpeg", quality: 75, ...clipOption },
  );
  return Buffer.from(screenshot);
}

export async function generateThumbnail(opts: GenerateThumbnailOptions): Promise<Buffer | null> {
  if (opts.signal.aborted) return null;
  let page: import("puppeteer-core").Page | null = null;
  const closePage = () => void page?.close().catch(() => {});
  opts.signal.addEventListener("abort", closePage, { once: true });
  try {
    const sharedBrowser = await getSharedBrowser();
    if (!sharedBrowser || opts.signal.aborted) return null;
    page = await sharedBrowser.newPage();
    if (opts.signal.aborted) return null;
    await prepareThumbnailPage(page, opts);
    const clip = await resolveScreenshotClip(page, opts.selector, opts.selectorIndex);
    if (opts.signal.aborted) return null;
    return await captureThumbnail(page, opts.format, clip);
  } catch (error) {
    if (!opts.signal.aborted) {
      console.warn(
        "[Studio] Thumbnail generation failed:",
        error instanceof Error ? error.message : error,
      );
    }
    return null;
  } finally {
    opts.signal.removeEventListener("abort", closePage);
    await page?.close().catch(() => {});
  }
}
