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

const PENDING_FRAME_RETRIES = 5;

async function sendBeginFrame(
  client: import("puppeteer-core").CDPSession,
  params: Parameters<typeof client.send<"HeadlessExperimental.beginFrame">>[1],
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.send("HeadlessExperimental.beginFrame", params);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isPending = msg.includes("Another frame is pending");
      if (isPending && attempt < PENDING_FRAME_RETRIES) {
        await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
        continue;
      }
      if (isPending) {
        throw new Error(
          `[BeginFrame] Frame still pending after ${PENDING_FRAME_RETRIES} retries — CPU overloaded by parallel renders. ` +
            `Reduce concurrent renders or use --docker for isolation.`,
        );
      }
      throw err;
    }
  }
}

export async function beginFrameCapture(
  page: Page,
  options: CaptureOptions,
  frameTimeTicks: number,
  interval: number,
): Promise<BeginFrameResult> {
  const client = await getCdpSession(page);

  const isPng = options.format === "png";
  const screenshot = {
    format: isPng ? "png" : "jpeg",
    quality: isPng ? undefined : (options.quality ?? 80),
    optimizeForSpeed: true,
  } as const;

  const result = await sendBeginFrame(client, { frameTimeTicks, interval, screenshot });

  let buffer: Buffer;
  if (result.screenshotData) {
    buffer = Buffer.from(result.screenshotData, "base64");
    lastFrameCache.set(page, buffer);
  } else {
    const cached = lastFrameCache.get(page);
    if (cached) {
      buffer = cached;
    } else {
      // Frame 0 always has damage, so this path is near-unreachable.
      // Force a composite with a tiny time advance.
      const fallback = await sendBeginFrame(client, {
        frameTimeTicks: frameTimeTicks + 0.001,
        interval,
        screenshot,
      });
      buffer = fallback.screenshotData
        ? Buffer.from(fallback.screenshotData, "base64")
        : Buffer.alloc(0);
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
    fromSurface: true,
    captureBeyondViewport: false,
    optimizeForSpeed: true,
  });
  return Buffer.from(result.data, "base64");
}

/**
 * Capture a screenshot with transparent background (PNG + alpha channel).
 *
 * Used in the two-pass HDR compositing pipeline — captures DOM content
 * (text, graphics, SDR overlays) with transparency where the background shows,
 * so it can be overlaid on top of native HDR video frames in FFmpeg.
 *
 * Sets and restores the background color override on every call. For sessions
 * that capture many frames, prefer calling initTransparentBackground() once
 * at session init, then captureAlphaPng() per frame to avoid the 2× CDP
 * round-trip overhead.
 */
export async function captureScreenshotWithAlpha(
  page: Page,
  width: number,
  height: number,
): Promise<Buffer> {
  const client = await getCdpSession(page);
  // Force transparent background so the screenshot has a real alpha channel
  await client.send("Emulation.setDefaultBackgroundColorOverride", {
    color: { r: 0, g: 0, b: 0, a: 0 },
  });
  try {
    const result = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
      optimizeForSpeed: false, // `true` uses a zero-alpha-aware fast path that crushes real alpha values — observed empirically, CDP docs don't spell it out
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    return Buffer.from(result.data, "base64");
  } finally {
    // Restore opaque background even if captureScreenshot throws, otherwise
    // subsequent opaque captures keep a transparent background.
    await client.send("Emulation.setDefaultBackgroundColorOverride", {}).catch(() => {});
  }
}

/**
 * Set the page background to transparent once for a dedicated HDR DOM session.
 *
 * Call this once after session initialization. Then use captureAlphaPng() per
 * frame instead of captureScreenshotWithAlpha() to skip the per-frame CDP
 * background override round-trips.
 *
 * Only use on sessions that are exclusively dedicated to transparent capture
 * (e.g., the HDR two-pass DOM layer session) — the background will stay
 * transparent for the lifetime of the session.
 *
 * NOTE on the injected stylesheet: `Emulation.setDefaultBackgroundColorOverride`
 * only replaces the *default* page background. Compositions almost always set
 * `body { background: ... }` and `#root { background: ... }`, which paint over
 * the override and ruin alpha capture for layered HDR compositing — the
 * composition root's full-frame background paints across the entire viewport
 * and wipes out HDR content captured beneath it.
 *
 * We force `html`, `body`, and any element marked as a composition root
 * (`[data-composition-id]`) to transparent. In HDR layered compositing the HDR
 * video itself is the backdrop, so DOM layers must only contribute their
 * foreground UI pixels — never a page-spanning solid backdrop.
 */
export const TRANSPARENT_BG_STYLE_ID = "__hf_transparent_bg__";

export async function initTransparentBackground(page: Page): Promise<void> {
  const client = await getCdpSession(page);
  await client.send("Emulation.setDefaultBackgroundColorOverride", {
    color: { r: 0, g: 0, b: 0, a: 0 },
  });
  await page.evaluate((styleId: string) => {
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent =
      "html,body,[data-composition-id]{background:transparent !important;background-color:transparent !important;background-image:none !important;}";
    document.head.appendChild(style);
  }, TRANSPARENT_BG_STYLE_ID);
}

/**
 * Capture a transparent-background PNG screenshot without setting the
 * background color override. Requires initTransparentBackground() to have
 * been called once on this session.
 *
 * Faster than captureScreenshotWithAlpha() for per-frame use in the HDR
 * two-pass compositing loop.
 */
export async function captureAlphaPng(page: Page, width: number, height: number): Promise<Buffer> {
  const client = await getCdpSession(page);
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    optimizeForSpeed: false, // must be false to preserve alpha
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  return Buffer.from(result.data, "base64");
}

/**
 * Stylesheet ID used by applyDomLayerMask / removeDomLayerMask. Exposed so
 * tests can assert presence/absence of the mask between captures.
 */
export const DOM_LAYER_MASK_STYLE_ID = "__hf_dom_layer_mask__";

/**
 * Mask the DOM so a single layer screenshot captures ONLY the layer's pixels.
 *
 * The HDR layered compositor walks z-ordered layers and blits each one over a
 * shared canvas. DOM layers are full-page screenshots — a naive screenshot
 * captures every painted pixel on the page, which means root background +
 * static overlays + sibling-scene content all overwrite previously composited
 * HDR content beneath. The mask narrows each screenshot to the elements that
 * actually belong to this layer.
 *
 * Strategy:
 *
 * 1. Inject a stylesheet that hides every body descendant
 *    (`body * { visibility: hidden !important }`) and re-shows the layer's
 *    elements (and their descendants and their injected `__render_frame_*`
 *    siblings) via `visibility: visible !important`. CSS `visibility: visible`
 *    on a descendant overrides an ancestor's `visibility: hidden`, so deep
 *    layer elements remain visible even though intermediate parents are
 *    hidden by the mass-hide rule.
 * 2. Inline-hide each `extraHideId` (and its `__render_frame_*` sibling) with
 *    `visibility: hidden !important`. Inline `!important` beats stylesheet
 *    `!important`, so this overrides the show rule for elements that fall
 *    under a show selector but should NOT paint — typically other-layer
 *    elements that are descendants of a container layer (for example HDR
 *    videos and other-layer SDR videos are descendants of `#root` when we
 *    capture the root DOM layer).
 *
 * Only `visibility` is set on extraHideIds — never `opacity`. CSS opacity is
 * multiplicative through the descendant chain and a descendant cannot escape
 * an ancestor's `opacity: 0`. If `#root` is in `extraHideIds` and we set
 * `opacity: 0` on it, every descendant — including `#vid-5-b` and its
 * `__render_frame_vid-5-b__` IMG — becomes invisible even with
 * `visibility: visible !important`. `visibility` does NOT have this problem:
 * a descendant with `visibility: visible` overrides an ancestor's
 * `visibility: hidden`.
 *
 * Layout is preserved (visibility doesn't trigger reflow), so border-radius
 * clipping, overflow:hidden, and absolute positioning continue to apply to
 * the visible layer elements. Opacity is also preserved — an ancestor at
 * `opacity: 0` (e.g. an inactive scene during a transition) still
 * propagates to its descendants, which is the desired behavior during
 * cross-scene blends.
 *
 * Idempotent across calls: an existing mask stylesheet is removed before a
 * new one is installed, so consecutive `applyDomLayerMask` invocations leave
 * exactly one stylesheet attached.
 */
export async function applyDomLayerMask(
  page: Page,
  showIds: string[],
  extraHideIds: string[],
): Promise<void> {
  await page.evaluate(
    (args: { show: string[]; hide: string[]; styleId: string }) => {
      const existing = document.getElementById(args.styleId);
      if (existing) existing.remove();

      const showSelectors: string[] = [];
      for (const id of args.show) {
        const escaped = CSS.escape(id);
        showSelectors.push(`#${escaped}`, `#${escaped} *`);
        const renderEscaped = CSS.escape(`__render_frame_${id}__`);
        showSelectors.push(`#${renderEscaped}`, `#${renderEscaped} *`);
      }

      const massHideRule = "body *{visibility:hidden !important;}";
      const showRule =
        showSelectors.length === 0
          ? ""
          : `${showSelectors.join(",")}{visibility:visible !important;}`;

      const style = document.createElement("style");
      style.id = args.styleId;
      style.textContent = `${massHideRule}\n${showRule}`;
      document.head.appendChild(style);

      for (const id of args.hide) {
        const el = document.getElementById(id);
        if (el) {
          el.style.setProperty("visibility", "hidden", "important");
        }
        const img = document.getElementById(`__render_frame_${id}__`);
        if (img) {
          img.style.setProperty("visibility", "hidden", "important");
        }
      }
    },
    { show: showIds, hide: extraHideIds, styleId: DOM_LAYER_MASK_STYLE_ID },
  );
}

/**
 * Tear down the mask installed by applyDomLayerMask.
 *
 * Removes the mask stylesheet and clears the inline `visibility` properties
 * set on `extraHideIds` (and their `__render_frame_*` siblings).
 *
 * IMPORTANT: We do NOT strip inline `opacity` here. applyDomLayerMask only
 * ever sets `visibility` (never `opacity`), so any inline opacity present on
 * a wrapper was put there by user animation code (typically GSAP) and must
 * survive across per-layer captures. GSAP's seek with suppress-events does
 * not re-apply tweens when the timeline is already at the target time, so if
 * we strip opacity here and then seek to the same time for the next layer,
 * GSAP won't put it back and the wrapper will render fully opaque.
 */
export async function removeDomLayerMask(page: Page, extraHideIds: string[]): Promise<void> {
  await page.evaluate(
    (args: { hide: string[]; styleId: string }) => {
      const style = document.getElementById(args.styleId);
      if (style) style.remove();
      for (const id of args.hide) {
        const el = document.getElementById(id);
        if (el) {
          el.style.removeProperty("visibility");
        }
        const img = document.getElementById(`__render_frame_${id}__`);
        if (img) img.style.removeProperty("visibility");
      }
    },
    { hide: extraHideIds, styleId: DOM_LAYER_MASK_STYLE_ID },
  );
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
        // Read the GSAP-controlled opacity directly from the native <video>.
        // We hide the <video> below with `visibility: hidden` only (never
        // `opacity: 0`), so its computed opacity is preserved across seeks
        // and accurately reflects the user's intent on every frame.
        const opacityParsed = parseFloat(computedStyle.opacity);
        const computedOpacity = Number.isNaN(opacityParsed) ? 1 : opacityParsed;
        const sourceIsStatic = !computedStyle.position || computedStyle.position === "static";

        if (isNewImage) {
          img = document.createElement("img");
          img.classList.add("__render_frame__");
          img.id = `__render_frame_${item.videoId}__`;
          img.style.pointerEvents = "none";
          video.parentNode?.insertBefore(img, video.nextSibling);
        }
        if (!img) continue;

        // Always use absolute positioning so the <img> overlays the <video>
        // instead of flowing below it. With position:relative, both elements
        // stack vertically — the <img> lands below the video and gets clipped
        // by any overflow:hidden ancestor (e.g., border-radius wrappers).
        {
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
          // Opacity is handled explicitly via `computedOpacity` below — copying
          // via the generic loop would race against the opacity:0 hide applied
          // to the <video> at the end of this function. GSAP may animate
          // opacity either on a wrapper (the <img> inherits via the stacking
          // context) or directly on the <video> (we must copy it to the <img>
          // since they are siblings). Reading computedStyle.opacity before
          // hiding the <video> handles both cases correctly.
          if (property === "opacity") continue;
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
        // Hide the native <video> with visibility only — never clobber inline
        // opacity, so subsequent reads (and queryElementStacking) see the real
        // GSAP-controlled value.
        video.style.setProperty("visibility", "hidden", "important");
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
      const img = video.nextElementSibling as HTMLElement | null;
      const hasImg = img && img.classList.contains("__render_frame__");
      if (active.has(video.id)) {
        // Active video: show injected <img>, hide native <video>.
        // Do NOT clobber inline opacity here — GSAP-controlled opacity must
        // survive until injectVideoFramesBatch reads it via getComputedStyle.
        // visibility:hidden alone hides the native element without affecting
        // its computed opacity.
        video.style.setProperty("visibility", "hidden", "important");
        video.style.setProperty("pointer-events", "none", "important");
        if (hasImg) {
          img.style.visibility = "visible";
        }
      } else {
        // Inactive video: hide both. Use visibility only (never opacity) so we
        // never clobber GSAP-controlled inline opacity.
        video.style.removeProperty("display");
        video.style.setProperty("visibility", "hidden", "important");
        video.style.setProperty("pointer-events", "none", "important");
        if (hasImg) {
          img.style.visibility = "hidden";
        }
      }
    }
  }, activeVideoIds);
}
