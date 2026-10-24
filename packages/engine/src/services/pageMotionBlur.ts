/**
 * Tells the page's capture motion blur (`data-motion-blur="on"`) to stand down, before any of
 * its scripts run: when the engine blurs (it would average frames that are already blurred) or
 * when the render must match a Studio preview that could not blur (`pageMotionBlur: "off"`).
 */

import {
  PAGE_DEVICE_SCALE_GLOBAL,
  PAGE_MOTION_BLUR_OFF_GLOBAL,
  acceleratedCanvasTrackerSource,
} from "@hyperframes/core";
import type { Page } from "puppeteer-core";
import type { CaptureOptions } from "../types.js";

function pageOffReason(
  options: Pick<CaptureOptions, "motionBlur" | "pageMotionBlur">,
): string | null {
  if (options.motionBlur) return "engine-motion-blur";
  if (options.pageMotionBlur === "off") return "preview-unsupported";
  return options.pageMotionBlur ?? null;
}

export async function installPageMotionBlur(
  page: Pick<Page, "evaluateOnNewDocument">,
  options: Pick<CaptureOptions, "motionBlur" | "pageMotionBlur" | "deviceScaleFactor">,
): Promise<void> {
  await page.evaluateOnNewDocument(acceleratedCanvasTrackerSource());
  const scale = options.deviceScaleFactor ?? 1;
  if (scale > 1) {
    await page.evaluateOnNewDocument(
      (key: string, v: number) => {
        (window as unknown as Record<string, unknown>)[key] = v;
      },
      PAGE_DEVICE_SCALE_GLOBAL,
      scale,
    );
  }
  const off = pageOffReason(options);
  if (!off) return;
  await page.evaluateOnNewDocument(
    (key: string, v: string) => {
      (window as unknown as Record<string, unknown>)[key] = v;
    },
    PAGE_MOTION_BLUR_OFF_GLOBAL,
    off,
  );
}

interface PageMotionBlurState {
  state: string;
  code: string;
  movers: number;
  failedFrames: number;
  tier: string | null;
}

async function readPageMotionBlur(
  page: Pick<Page, "evaluate">,
): Promise<PageMotionBlurState | null> {
  return page.evaluate(() => {
    const api: unknown = Reflect.get(window, "__hfMotionBlur");
    const report: unknown = api && typeof api === "object" ? Reflect.get(api, "report") : null;
    const got: unknown = typeof report === "function" ? report() : null;
    if (!got || typeof got !== "object") return null;
    const tier: unknown = Reflect.get(got, "tier");
    return {
      state: String(Reflect.get(got, "state")),
      code: String(Reflect.get(got, "reasonCode")),
      movers: Number(Reflect.get(got, "movers")),
      failedFrames: Number(Reflect.get(got, "failedFrames")) || 0,
      tier: typeof tier === "string" ? tier : null,
    };
  });
}

const formatPageMotionBlur = (r: PageMotionBlurState): string =>
  `[motion-blur] ${r.state} reasonCode=${r.code} movers=${r.movers} failedFrames=${r.failedFrames}${r.tier ? ` tier=${r.tier}` : ""}`;

/** One line saying what the page's blur did for this session; null when the page never asked for blur. */
export async function describePageMotionBlur(page: Pick<Page, "evaluate">): Promise<string | null> {
  const r = await readPageMotionBlur(page);
  return r && formatPageMotionBlur(r);
}

/** The session's closing line, only when frames fell back to plain DOM: the first-frame line cannot know. */
export async function describePageMotionBlurAtEnd(
  page: Pick<Page, "evaluate">,
  timeoutMs = 1500,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stuck = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const r = await Promise.race([readPageMotionBlur(page), stuck]);
    return r && r.failedFrames > 0 ? `${formatPageMotionBlur(r)} (session end)` : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
