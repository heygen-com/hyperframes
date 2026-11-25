// Shared Puppeteer browser management and thumbnail generation for Studio dev server.

import {
  getElementScreenshotClip,
  grantCaptureLoads,
  thumbnailDeviceScaleFactor,
  thumbnailSeekReadyInBrowser,
  type ScreenshotClip,
} from "@hyperframes/studio-server";
import { createStudioDevRenderBodyScripts } from "./vite.studioMotion";
import { browserVersion, findSystemChrome } from "./vite.chrome";
import { seekThumbnailPreview } from "./vite.thumbnail";

export { browserVersion, findSystemChrome };

let browser: import("puppeteer-core").Browser | null = null;
let browserLaunch: Promise<import("puppeteer-core").Browser | null> | null = null;
let describeBrowser = () => "unknown browser";

/** Reading the version blocks the server (a PowerShell start on Windows), so only a failure's wording pays for it. */
function versionWhenAsked(executable: string): () => string {
  let description: string | undefined;
  return () =>
    (description ??= `${executable}, ${browserVersion(executable) ?? "unknown version"}`);
}

async function getSharedBrowser(): Promise<import("puppeteer-core").Browser | null> {
  if (browser?.connected) return browser;
  if (browserLaunch) return browserLaunch;
  const launch = (async () => {
    const puppeteer = await import("puppeteer-core");
    const executablePath = findSystemChrome();
    if (!executablePath) return null;
    describeBrowser = versionWhenAsked(executablePath);
    try {
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
    } catch (error) {
      console.warn(
        `[Studio] Thumbnail browser launch failed (${describeBrowser()}):`,
        error instanceof Error ? error.message : error,
      );
      throw error;
    }
    return browser;
  })();
  browserLaunch = launch;
  try {
    return await launch;
  } finally {
    if (browserLaunch === launch) browserLaunch = null;
  }
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
  await grantCaptureLoads(await page.createCDPSession(), opts.previewUrl);
  await page.goto(opts.previewUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
  await page.evaluate(() => {
    document.documentElement.style.background = "#1c2028";
    document.body.style.background = "#1c2028";
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";
  });
  await page.waitForFunction(thumbnailSeekReadyInBrowser, { timeout: 5000 }).catch(() => {});
  await seekThumbnailPreview(page, opts.seekTime);
  await page.evaluate("window.__hfWaitForSeekCompletion?.()");
  await applyStudioRenderBodyScriptsToThumbnailPage(page, opts.project.dir, opts.compPath);
  await page.evaluate("document.fonts?.ready");
  await new Promise((resolve) => setTimeout(resolve, 200));
  await reapplyStudioRenderBodyScriptsToThumbnailPage(page);
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
    const clip = opts.selector
      ? await page.evaluate(getElementScreenshotClip, opts.selector, opts.selectorIndex)
      : undefined;
    if (opts.signal.aborted) return null;
    return await captureThumbnail(page, opts.format, clip);
  } catch (error) {
    if (!opts.signal.aborted) {
      console.warn(
        `[Studio] Thumbnail generation failed (${describeBrowser()}):`,
        error instanceof Error ? error.message : error,
      );
    }
    return null;
  } finally {
    opts.signal.removeEventListener("abort", closePage);
    await page?.close().catch(() => {});
  }
}
