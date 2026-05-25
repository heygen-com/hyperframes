// Shared Puppeteer browser management and thumbnail generation for Studio dev server.

import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  createStudioDevRenderBodyScripts,
  readStudioDevManualEditManifestContent,
  readStudioDevMotionManifestContent,
} from "./vite.studioMotion";
import { seekThumbnailPreview } from "./vite.thumbnail";

// ── Shared Puppeteer browser ─────────────────────────────────────────────────

let _browser: import("puppeteer-core").Browser | null = null;
let _browserLaunchPromise: Promise<import("puppeteer-core").Browser> | null = null;

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
];

async function getSharedBrowser(): Promise<import("puppeteer-core").Browser | null> {
  if (_browser?.connected) return _browser;
  if (_browserLaunchPromise) return _browserLaunchPromise;
  _browserLaunchPromise = (async () => {
    const puppeteer = await import("puppeteer-core");
    const executablePath = CHROME_PATHS.find((p) => existsSync(p));
    if (!executablePath) return null;
    _browser = await puppeteer.default.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });
    _browserLaunchPromise = null;
    return _browser;
  })();
  return _browserLaunchPromise;
}

/** The system Chrome executable path (undefined if not found). */
export function findSystemChrome(): string | undefined {
  return CHROME_PATHS.find((p) => existsSync(p));
}

// In-flight thumbnail dedup
const _thumbnailInflight = new Map<string, Promise<Buffer>>();
const THUMBNAIL_CACHE_VERSION = "v4";

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
  format: "jpeg" | "png";
  selector?: string;
  selectorIndex?: number;
}

export async function generateThumbnail(opts: GenerateThumbnailOptions): Promise<Buffer | null> {
  const selectorKey = opts.selector
    ? `_${opts.selector.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80)}_${opts.selectorIndex ?? 0}`
    : "";
  const manualManifestContent = readStudioDevManualEditManifestContent(opts.project.dir);
  const manualManifestKey = manualManifestContent.trim()
    ? `_${createHash("sha1").update(manualManifestContent).digest("hex").slice(0, 16)}`
    : "";
  const motionManifestContent = readStudioDevMotionManifestContent(opts.project.dir);
  const motionManifestKey = motionManifestContent.trim()
    ? `_${createHash("sha1").update(motionManifestContent).digest("hex").slice(0, 16)}`
    : "";
  const cacheKey = `${THUMBNAIL_CACHE_VERSION}${manualManifestKey}${motionManifestKey}_${opts.compPath.replace(/\//g, "_")}_${opts.seekTime.toFixed(2)}${selectorKey}.${opts.format === "png" ? "png" : "jpg"}`;

  let bufferPromise = _thumbnailInflight.get(cacheKey);
  if (!bufferPromise) {
    bufferPromise = (async () => {
      const browser = await getSharedBrowser();
      if (!browser) return null;
      let page: Awaited<ReturnType<typeof browser.newPage>> | null = null;
      try {
        page = await browser.newPage();
        await page.setViewport({
          width: opts.width,
          height: opts.height,
          deviceScaleFactor: opts.format === "png" ? 1 : 0.5,
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
        await page.close();
        return buf as Buffer;
      } catch (err) {
        if (page) await page.close().catch(() => {});
        console.warn(
          "[Studio] Thumbnail generation failed:",
          err instanceof Error ? err.message : err,
        );
        return null;
      }
    })();
    _thumbnailInflight.set(cacheKey, bufferPromise);
    bufferPromise.finally(() => _thumbnailInflight.delete(cacheKey));
  }
  return bufferPromise;
}
