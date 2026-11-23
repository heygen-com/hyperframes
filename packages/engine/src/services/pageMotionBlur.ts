/**
 * Tells the page's capture motion blur (`data-motion-blur="on"`) to stand down, before any of
 * its scripts run: when the engine blurs (it would average frames that are already blurred) or
 * when the render must match a Studio preview that could not blur (`pageMotionBlur: "off"`).
 */

import {
  MOTION_BLUR_FINGERPRINT_FIELDS,
  PAGE_DEVICE_SCALE_GLOBAL,
  PAGE_MOTION_BLUR_OFF_GLOBAL,
  acceleratedCanvasTrackerSource,
  type MotionBlurFingerprint,
} from "@hyperframes/core";
import type { Page } from "puppeteer-core";
import type { CaptureOptions, PageMotionBlurSummary } from "../types.js";

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
  reasonCode: string | null;
  movers: number;
  failedFrames: number;
  tier: string | null;
  readEvents: boolean;
  fingerprint: MotionBlurFingerprint | null;
}

function parseFingerprint(raw: unknown): MotionBlurFingerprint | null {
  if (!raw || typeof raw !== "object") return null;
  const count = (field: string): number => Number(Reflect.get(raw, field)) || 0;
  return Object.fromEntries(
    MOTION_BLUR_FINGERPRINT_FIELDS.map((field) => [field, count(field)]),
  ) as MotionBlurFingerprint;
}

async function readPageMotionBlur(
  page: Pick<Page, "evaluate">,
): Promise<PageMotionBlurState | null> {
  const read = await page.evaluate(() => {
    const api: unknown = Reflect.get(window, "__hfMotionBlur");
    const report: unknown = api && typeof api === "object" ? Reflect.get(api, "report") : null;
    const got: unknown = typeof report === "function" ? report() : null;
    if (!got || typeof got !== "object") return null;
    const tier: unknown = Reflect.get(got, "tier");
    const reasonCode: unknown = Reflect.get(got, "reasonCode");
    return {
      state: String(Reflect.get(got, "state")),
      reasonCode: typeof reasonCode === "string" ? reasonCode : null,
      movers: Number(Reflect.get(got, "movers")),
      failedFrames: Number(Reflect.get(got, "failedFrames")) || 0,
      tier: typeof tier === "string" ? tier : null,
      readEvents: Reflect.get(got, "readEvents") === true,
      fingerprint: Reflect.get(got, "fingerprint") as unknown,
    };
  });
  return read && { ...read, fingerprint: parseFingerprint(read.fingerprint) };
}

function fingerprintCounts(fingerprint: MotionBlurFingerprint | null): string {
  if (!fingerprint) return "";
  return MOTION_BLUR_FINGERPRINT_FIELDS.filter((field) => fingerprint[field] > 0)
    .map((field) => `${field}:${fingerprint[field]}`)
    .join(",");
}

const formatPageMotionBlur = (r: PageMotionBlurState): string => {
  const counts = fingerprintCounts(r.fingerprint);
  return (
    `[motion-blur] ${r.state} reasonCode=${r.reasonCode} movers=${r.movers} failedFrames=${r.failedFrames}` +
    `${r.tier ? ` tier=${r.tier}` : ""}${r.readEvents ? " readEvents=true" : ""}${counts ? ` fp=${counts}` : ""}`
  );
};

const summarize = (r: PageMotionBlurState): PageMotionBlurSummary => ({
  tier: r.tier === "capture" || r.tier === "filter" ? r.tier : null,
  reasonCode: r.reasonCode,
  movers: r.movers,
  failedFrames: r.failedFrames,
  readEvents: r.readEvents,
  fingerprint: r.fingerprint,
});

export type RecordPageMotionBlur = (summary: PageMotionBlurSummary) => void;

/** Keeps one summary object per session, updated in place, so a perf summary that holds it sees the session's last read. */
export function pageMotionBlurRecorder(session: {
  pageMotionBlur?: PageMotionBlurSummary;
}): RecordPageMotionBlur {
  return (next) => {
    const held = session.pageMotionBlur;
    if (!held) {
      session.pageMotionBlur = next;
      return;
    }
    Object.assign(held, next, {
      tier: next.tier ?? held.tier,
      fingerprint: next.fingerprint ?? held.fingerprint,
    });
  };
}

/** One line saying what the page's blur did for this session; null when the page never asked for blur. */
export async function describePageMotionBlur(
  page: Pick<Page, "evaluate">,
  record?: RecordPageMotionBlur,
): Promise<string | null> {
  const r = await readPageMotionBlur(page);
  if (r) record?.(summarize(r));
  return r && formatPageMotionBlur(r);
}

/** The session's closing line, only when frames fell back to plain DOM: the first-frame line cannot know. */
export async function describePageMotionBlurAtEnd(
  page: Pick<Page, "evaluate">,
  timeoutMs = 1500,
  record?: RecordPageMotionBlur,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stuck = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const r = await Promise.race([readPageMotionBlur(page), stuck]);
    if (r) record?.(summarize(r));
    return r && r.failedFrames > 0 ? `${formatPageMotionBlur(r)} (session end)` : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
