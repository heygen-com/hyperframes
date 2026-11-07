import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { acceleratedCanvasTrackerSource } from "@hyperframes/core";
import { decodePng } from "../../../utils/alphaBlit.js";
import { resolveHeadlessShellPath } from "../../browserManager.js";
import { waitForPendingSeekCompletion } from "../../frameCapture.js";
import { closeTestChrome } from "../loopback.js";
import type { Rgba } from "../blurDifferential.js";

export const RUNTIME = resolve(
  import.meta.dirname,
  "../../../../../core/dist/hyperframe.runtime.iife.js",
);
export const chromePath = resolveHeadlessShellPath();
const chromeRuns = (): boolean =>
  chromePath !== undefined && spawnSync(chromePath, ["--version"]).status === 0;
const mustRun = Boolean(process.env.CI);
export const hasBrowser = mustRun || (chromeRuns() && existsSync(RUNTIME));

export function requireBlurBrowser(supported: boolean): void {
  if (!mustRun) return;
  const missing = [
    !chromeRuns() && `a Chrome that runs (found: ${chromePath ?? "none"})`,
    !existsSync(RUNTIME) && `the core runtime build at ${RUNTIME}`,
    !supported && "CanvasRenderingContext2D.drawElementImage in that Chrome",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`the blur browser tests cannot run on CI: missing ${missing.join(", ")}`);
  }
}

export interface BlurReport {
  state: string;
  tier: string | null;
  reasonCode: string | null;
  movers: number;
  failedFrames: number;
}

export type BlurWindow = Window & {
  __player?: { renderSeek?: (t: number, options?: { subFrameDivisions?: number }) => void };
  __hf_page_composite_pending?: boolean;
  __hf_page_composite_prepare?: () => Promise<boolean>;
  __hf_page_composite_resolve?: () => boolean;
  __hfMotionBlur?: { report: () => BlurReport; probe: () => BlurReport };
};

export async function launch(): Promise<{ browser: Browser; supported: boolean }> {
  requireBlurBrowser(true);
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    // Windows ClearType and Linux fontconfig subpixel text colour DOM glyphs but not the capture canvas;
    // that is a host setting, not blur, so both arms draw grayscale text.
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-features=CanvasDrawElement",
      "--disable-lcd-text",
    ],
  });
  const probe = await browser.newPage();
  const supported = await probe.evaluate(
    () => typeof Reflect.get(CanvasRenderingContext2D.prototype, "drawElementImage") === "function",
  );
  await probe.close();
  try {
    requireBlurBrowser(supported);
  } catch (error) {
    await closeTestChrome(browser);
    throw error;
  }
  return { browser, supported };
}

/** A render-mode page: the engine's seek config and the canvas tracker are in before the runtime boots. */
export async function openFixture(
  browser: Browser,
  html: string,
  dpr: number,
  size: { width: number; height: number },
): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ ...size, deviceScaleFactor: dpr });
  await page.evaluate(acceleratedCanvasTrackerSource());
  await page.setContent(html);
  await page.addScriptTag({ content: `window.__HF_EXPORT_RENDER_SEEK_CONFIG={fps:30};` });
  await page.addScriptTag({ content: readFileSync(RUNTIME, "utf8") });
  await page.waitForFunction(() => {
    const w = window as BlurWindow & { __playerReady?: boolean; __renderReady?: boolean };
    return w.__playerReady === true && w.__renderReady === true;
  });
  return page;
}

/** One frame the way the engine takes it: seek, wait for the page, composite, screenshot. */
export async function captureFrame(
  page: Page,
  t: number,
  options?: { subFrameDivisions?: number },
): Promise<Rgba> {
  const pending = await page.evaluate(
    (time, seekOptions) => {
      const w = window as BlurWindow;
      w.__player?.renderSeek?.(time, seekOptions);
      return w.__hf_page_composite_pending === true;
    },
    t,
    options,
  );
  await waitForPendingSeekCompletion(page);
  if (pending) {
    await page.evaluate(async () => {
      const w = window as BlurWindow;
      await w.__hf_page_composite_prepare?.();
    });
    const cdp = await page.createCDPSession();
    await cdp.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 1,
      clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 },
    });
    await cdp.detach();
    await page.evaluate(() => (window as BlurWindow).__hf_page_composite_resolve?.());
  }
  const png = Buffer.from(await page.screenshot({ type: "png" }));
  const { width, data } = decodePng(png);
  return { width, height: data.length / 4 / width, data };
}
