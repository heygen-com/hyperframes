/**
 * Which frames drawElement capture cannot reproduce, so those frames alone are captured by
 * screenshot and the rest keep the fast path.
 */

import type { Page } from "puppeteer-core";
import { quantizeTimeToFrame } from "@hyperframes/core";

/** Frames per page round trip while scanning; a scan is one in-page loop per chunk. */
const SCAN_CHUNK_FRAMES = 240;

/** Longest the scan may hold back the first frame; above it the whole render captures by screenshot. */
const SCAN_BUDGET_MS = 120_000;

/**
 * Above this share of risk frames the second browser and the switching cost outweigh the fast
 * frames, so the whole render captures by screenshot as it always has.
 */
export const MAX_RISK_FRAME_FRACTION = 0.6;

/** Peak memory per-frame capture adds over a screenshot render at 1080p: 1002 to 2001 MB measured. */
export const RISK_RENDER_ADDED_BYTES = 1_000_000_000;

/** Memory that must still be available once the screenshot browser is open. */
export const RISK_RENDER_HEADROOM_BYTES = 1_500_000_000;

const PIXELS_1080P = 1920 * 1080;

/** Risk ranges closer than this many frames are joined, so capture never alternates modes. */
export const RISK_RANGE_HYSTERESIS_FRAMES = 12;

async function scanChunk(page: Page, times: number[]): Promise<number[]> {
  return page.evaluate(async (ts: number[]): Promise<number[]> => {
    type HfWindow = Window & {
      __hf?: { seek?: (t: number) => void };
      __hfWaitForSeekCompletion?: () => Promise<void>;
      __hfCssFxTargets?: Element[];
    };
    const w = window as HfWindow;
    const targets = w.__hfCssFxTargets ?? [];
    // A hidden element still shows a descendant that sets `visibility: visible` itself.
    const paints = (el: Element): boolean =>
      getComputedStyle(el).visibility !== "hidden" ||
      Array.from(el.querySelectorAll("*")).some(
        (d) => getComputedStyle(d).visibility === "visible",
      );
    const shows = (el: Element): boolean => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === "none" || Number(cs.opacity) === 0) return false;
      }
      return paints(el);
    };
    const out: number[] = [];
    for (let i = 0; i < ts.length; i++) {
      w.__hf?.seek?.(ts[i] as number);
      await w.__hfWaitForSeekCompletion?.();
      if (targets.some(shows)) out.push(i);
    }
    return out;
  }, times);
}

interface ScanOptions {
  budgetMs?: number;
  now?: () => number;
  onProgress?: (scannedFrames: number, totalFrames: number) => void;
}

/**
 * Frames where a recorded effect element shows. Seeks the page forward, so use a throwaway one.
 * Null once more than `maxFrames` frames qualify, or once the whole scan would take over `budgetMs`.
 */
export async function scanCssEffectLiveFrames(
  page: Page,
  fps: number,
  totalFrames: number,
  maxFrames: number,
  { budgetMs = SCAN_BUDGET_MS, now = () => performance.now(), onProgress }: ScanOptions = {},
): Promise<Set<number> | null> {
  const live = new Set<number>();
  const started = now();
  for (let from = 0; from < totalFrames && live.size <= maxFrames; from += SCAN_CHUNK_FRAMES) {
    const to = Math.min(totalFrames, from + SCAN_CHUNK_FRAMES);
    const times: number[] = [];
    for (let f = from; f < to; f++) times.push(quantizeTimeToFrame(f / fps, fps));
    for (const i of await scanChunk(page, times)) live.add(from + i);
    onProgress?.(to, totalFrames);
    const projectedMs = ((now() - started) / to) * totalFrames;
    if (to < totalFrames && projectedMs > budgetMs) {
      console.error(
        `[engine] fast capture: the effect scan of ${totalFrames} frames would take ` +
          `${Math.round(projectedMs / 1000)} s, over its ${budgetMs / 1000} s budget`,
      );
      return null;
    }
  }
  return live.size > maxFrames ? null : live;
}

/**
 * The given frames with a one-frame margin, ranges closer than {@link RISK_RANGE_HYSTERESIS_FRAMES}
 * joined. Null when they cover more than {@link MAX_RISK_FRAME_FRACTION} of the render.
 */
export function planRiskFrames(frames: Iterable<number>, totalFrames: number): Set<number> | null {
  const sorted = [...new Set(frames)].sort((a, b) => a - b);
  const plan = new Set<number>();
  let rangeStart = -1;
  let rangeEnd = -1;
  const flush = () => {
    for (let f = Math.max(0, rangeStart - 1); f <= Math.min(totalFrames - 1, rangeEnd + 1); f++) {
      plan.add(f);
    }
  };
  for (const f of sorted) {
    if (rangeStart >= 0 && f - rangeEnd <= RISK_RANGE_HYSTERESIS_FRAMES) {
      rangeEnd = f;
      continue;
    }
    if (rangeStart >= 0) flush();
    rangeStart = f;
    rangeEnd = f;
  }
  if (rangeStart >= 0) flush();
  return plan.size > totalFrames * MAX_RISK_FRAME_FRACTION ? null : plan;
}

/** `live` plus every frame from just before the first callback to the end of the render. */
export function withFramesAfterCallback(
  live: Set<number>,
  callbackFrom: number | null,
  fps: number,
  totalFrames: number,
): Set<number> {
  if (callbackFrom === null) return live;
  for (let f = Math.max(0, Math.floor(callbackFrom * fps) - 1); f < totalFrames; f++) live.add(f);
  return live;
}

/** Whether the render fits: what it adds, scaled by output pixels, leaves the headroom. */
export function riskSessionFits(availableMb: number, outputPixels: number): boolean {
  const rss = RISK_RENDER_ADDED_BYTES * Math.max(1, outputPixels / PIXELS_1080P);
  return availableMb * 1024 * 1024 - rss >= RISK_RENDER_HEADROOM_BYTES;
}
