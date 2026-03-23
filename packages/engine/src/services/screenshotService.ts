/**
 * Screenshot Service
 *
 * BeginFrame-based deterministic screenshot capture and video frame injection.
 */

import { type Page } from "puppeteer-core";
import { type CaptureOptions } from "../types.js";
import { MEDIA_VISUAL_STYLE_PROPERTIES } from "@hyperframes/core";

export const cdpSessionCache = new WeakMap<Page, import("puppeteer-core").CDPSession>();

export async function getCdpSession(page: Page): Promise<import("puppeteer-core").CDPSession> {
  let client = cdpSessionCache.get(page);
  if (!client) {
    client = await page.createCDPSession();
    cdpSessionCache.set(page, client);
  }
  return client;
}

/**
 * BeginFrame result with screenshot data and damage detection.
 */
export interface BeginFrameResult {
  buffer: Buffer;
  hasDamage: boolean;
}

/**
 * Capture a frame using HeadlessExperimental.beginFrame.
 *
 * This is an atomic operation: one CDP call runs a single layout-paint-composite
 * cycle and returns the screenshot + hasDamage boolean. Replaces the separate
 * settle → screenshot pipeline with a single deterministic render cycle.
 *
 * Requires chrome-headless-shell with --enable-begin-frame-control and
 * --deterministic-mode flags.
 */
// Cache the last valid screenshot buffer per page for hasDamage=false frames.
// When Chrome reports no visual change, we reuse the previous frame rather than
// attempting Page.captureScreenshot (which times out in beginFrame mode since
// the compositor is paused).
const lastFrameCache = new WeakMap<Page, Buffer>();

export async function beginFrameCapture(
  page: Page,
  options: CaptureOptions,
  frameTimeTicks: number,
  interval: number,
): Promise<BeginFrameResult> {
  const client = await getCdpSession(page);

  const format = options.format === "png" ? "png" : "jpeg";
  const result = await client.send("HeadlessExperimental.beginFrame", {
    frameTimeTicks,
    interval,
    screenshot: {
      format,
      quality: format === "jpeg" ? (options.quality ?? 80) : undefined,
      optimizeForSpeed: true,
    },
  });

  let buffer: Buffer;
  if (result.screenshotData) {
    buffer = Buffer.from(result.screenshotData, "base64");
    lastFrameCache.set(page, buffer);
  } else {
    // hasDamage=false — nothing changed visually. Reuse the last frame.
    const cached = lastFrameCache.get(page);
    if (cached) {
      buffer = cached;
    } else {
      // No cached frame yet (shouldn't happen — frame 0 always has damage).
      // Issue another beginFrame with a tiny time advance to force a composite.
      const retry = await client.send("HeadlessExperimental.beginFrame", {
        frameTimeTicks: frameTimeTicks + 0.001,
        interval,
        screenshot: {
          format,
          quality: format === "jpeg" ? (options.quality ?? 80) : undefined,
          optimizeForSpeed: true,
        },
      });
      buffer = retry.screenshotData ? Buffer.from(retry.screenshotData, "base64") : Buffer.alloc(0);
      if (buffer.length > 0) lastFrameCache.set(page, buffer);
    }
  }

  return {
    buffer,
    hasDamage: result.hasDamage,
  };
}

/**
 * Capture a screenshot using standard Page.captureScreenshot CDP call.
 * Fallback for environments where BeginFrame is unavailable (macOS, Windows).
 */
export async function pageScreenshotCapture(page: Page, options: CaptureOptions): Promise<Buffer> {
  const client = await getCdpSession(page);
  const format = options.format === "png" ? "png" : "jpeg";
  const result = await client.send("Page.captureScreenshot", {
    format,
    quality: format === "jpeg" ? (options.quality ?? 80) : undefined,
    optimizeForSpeed: true,
  });
  return Buffer.from(result.data, "base64");
}

export async function injectVideoFramesBatch(
  page: Page,
  updates: Array<{ videoId: string; dataUri: string }>,
): Promise<void> {
  if (updates.length === 0) return;
  await page.evaluate(
    async (items: Array<{ videoId: string; dataUri: string }>, visualProperties: string[]) => {
      const pendingDecodes: Array<Promise<void>> = [];
      for (const item of items) {
        const video = document.getElementById(item.videoId) as HTMLVideoElement | null;
        if (!video) continue;

        let img = video.nextElementSibling as HTMLImageElement | null;
        const isNewImage = !img || !img.classList.contains("__render_frame__");
        const computedStyle = window.getComputedStyle(video);
        const computedOpacity = parseFloat(computedStyle.opacity) || 1;
        const sourceIsStatic = !computedStyle.position || computedStyle.position === "static";

        if (isNewImage) {
          img = document.createElement("img");
          img.classList.add("__render_frame__");
          img.id = `__render_frame_${item.videoId}__`;
          img.style.pointerEvents = "none";
          video.parentNode?.insertBefore(img, video.nextSibling);
        }
        if (!img) continue;

        if (!sourceIsStatic) {
          img.style.position = computedStyle.position;
          img.style.width = computedStyle.width;
          img.style.height = computedStyle.height;
          img.style.top = computedStyle.top;
          img.style.left = computedStyle.left;
          img.style.right = computedStyle.right;
          img.style.bottom = computedStyle.bottom;
          img.style.inset = computedStyle.inset;
        } else {
          const videoRect = video.getBoundingClientRect();
          const offsetLeft = Number.isFinite(video.offsetLeft) ? video.offsetLeft : 0;
          const offsetTop = Number.isFinite(video.offsetTop) ? video.offsetTop : 0;
          const offsetWidth = video.offsetWidth > 0 ? video.offsetWidth : videoRect.width;
          const offsetHeight = video.offsetHeight > 0 ? video.offsetHeight : videoRect.height;
          img.style.position = "absolute";
          img.style.inset = "auto";
          img.style.left = `${offsetLeft}px`;
          img.style.top = `${offsetTop}px`;
          img.style.right = "auto";
          img.style.bottom = "auto";
          img.style.width = `${offsetWidth}px`;
          img.style.height = `${offsetHeight}px`;
        }
        img.style.objectFit = computedStyle.objectFit;
        img.style.objectPosition = computedStyle.objectPosition;
        img.style.zIndex = computedStyle.zIndex;

        for (const property of visualProperties) {
          if (
            sourceIsStatic &&
            (property === "top" ||
              property === "left" ||
              property === "right" ||
              property === "bottom" ||
              property === "inset")
          ) {
            continue;
          }
          const value = computedStyle.getPropertyValue(property);
          if (value) {
            img.style.setProperty(property, value);
          }
        }
        img.decoding = "sync";
        img.src = item.dataUri;
        pendingDecodes.push(
          img
            .decode()
            .catch(() => undefined)
            .then(() => undefined),
        );
        img.style.opacity = String(computedOpacity);
        img.style.visibility = "visible";
        video.style.setProperty("visibility", "hidden", "important");
        video.style.setProperty("opacity", "0", "important");
        video.style.setProperty("pointer-events", "none", "important");
      }
      if (pendingDecodes.length > 0) {
        await Promise.all(pendingDecodes);
      }
    },
    updates,
    [...MEDIA_VISUAL_STYLE_PROPERTIES],
  );
}

export async function syncVideoFrameVisibility(
  page: Page,
  activeVideoIds: string[],
): Promise<void> {
  await page.evaluate((ids: string[]) => {
    const active = new Set(ids);
    const videos = Array.from(document.querySelectorAll("video[data-start]")) as HTMLVideoElement[];
    for (const video of videos) {
      if (active.has(video.id)) continue;
      video.style.removeProperty("display");
      video.style.setProperty("visibility", "hidden", "important");
      video.style.setProperty("opacity", "0", "important");
      video.style.setProperty("pointer-events", "none", "important");
      const img = video.nextElementSibling as HTMLElement | null;
      if (img && img.classList.contains("__render_frame__")) {
        img.style.visibility = "hidden";
      }
    }
  }, activeVideoIds);
}
