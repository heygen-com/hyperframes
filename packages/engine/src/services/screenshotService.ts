// fallow-ignore-file code-duplication complexity
/**
 * Screenshot Service
 *
 * BeginFrame-based deterministic screenshot capture and video frame injection.
 */

// fallow-ignore-file code-duplication
import { type Page } from "puppeteer-core";
import { type CaptureOptions } from "../types.js";
import {
  HF_COLOR_GRADING_CANVAS_ID_PREFIX,
  MEDIA_VISUAL_STYLE_PROPERTIES,
} from "@hyperframes/core";

export const cdpSessionCache = new WeakMap<Page, import("puppeteer-core").CDPSession>();
const COLOR_GRADING_SOURCE_HIDDEN_ATTR = "data-hf-color-grading-source-hidden";

export async function getCdpSession(page: Page): Promise<import("puppeteer-core").CDPSession> {
  let client = cdpSessionCache.get(page);
  if (!client) {
    client = await page.createCDPSession();
    cdpSessionCache.set(page, client);
  }
  return client;
}

export function shouldDefaultCaptureBeyondViewport(
  browserVersion: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  // Regular Chrome's viewport-bound screenshot path can expose a compositor
  // surface shorter than the page viewport on affected macOS builds. In that
  // case Chrome fills the clipped area with the page background. Headless shell
  // reports as HeadlessChrome and keeps the faster viewport-bound path.
  return platform === "darwin" && browserVersion.startsWith("Chrome/");
}

/**
 * BeginFrame result with screenshot data and damage detection.
 */
export interface BeginFrameResult {
  buffer: Buffer;
  hasDamage: boolean;
}

/**
 * Issue a single no-output BeginFrame and race it against `timeoutMs`.
 *
 * On SwiftShader, compositions with many promoted layers (multi-group nested
 * opacity caption animations) can stall the FIRST BeginFrame indefinitely —
 * tested to 30 minutes without completion (style-7/8/10/15-prod). The
 * auto-worker calibration path catches this with its own capped protocol
 * timeout, but renders with an explicit `--workers N` skip calibration and
 * would hang for the full protocol timeout (and never succeed). This probe
 * gives the producer a cheap liveness signal right after session init:
 * `false` means route the render through screenshot capture instead.
 *
 * Healthy comps complete the probe in well under a second on GPU and within
 * a few seconds on SwiftShader. A protocol error also resolves `false` —
 * the safe direction (screenshot capture always works).
 */
export async function probeBeginFrameLiveness(
  page: Page,
  timeoutMs: number,
  // BeginFrame frameTimeTicks must be monotonic per session. The capture loop
  // sends `session.beginFrameTimeTicks + frameIndex * interval`, where the
  // base carries a 10-interval cushion above the warmup loop's last tick —
  // callers probing an initialized session should pass a tick INSIDE that
  // cushion (e.g. base − 5·interval) so warmup < probe < first capture stays
  // monotonic. Omit both params only for a session that will not issue
  // further BeginFrames.
  frameTimeTicks?: number,
  intervalMs?: number,
): Promise<boolean> {
  const client = await getCdpSession(page);
  const params: { frameTimeTicks?: number; interval?: number } = {};
  if (typeof frameTimeTicks === "number") params.frameTimeTicks = frameTimeTicks;
  if (typeof intervalMs === "number") params.interval = intervalMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      client
        .send("HeadlessExperimental.beginFrame", params)
        .then(() => true)
        .catch(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
 *
 * For `format: "png"` captures we disable Chrome's `optimizeForSpeed` fast
 * path. The fast path uses a zero-alpha-aware codec that crushes real alpha
 * values to 0 or 255 (verified empirically; CDP docs don't document this) —
 * exactly the same caveat called out on `captureScreenshotWithAlpha` /
 * `captureAlphaPng`. Keeping the fast path for opaque jpeg captures is fine.
 */
export async function pageScreenshotCapture(page: Page, options: CaptureOptions): Promise<Buffer> {
  const client = await getCdpSession(page);
  const isPng = options.format === "png";
  const dpr = options.deviceScaleFactor ?? 1;
  const clip = { x: 0, y: 0, width: options.width, height: options.height, scale: dpr };
  const result = await client.send("Page.captureScreenshot", {
    format: isPng ? "png" : "jpeg",
    quality: isPng ? undefined : (options.quality ?? 80),
    fromSurface: true,
    // Use Chrome's faster viewport-bound screenshot path by default. Callers
    // opt into the beyond-viewport path only for known compositor edge cases,
    // such as native video surfaces in tall portrait renders.
    captureBeyondViewport: options.captureBeyondViewport ?? false,
    optimizeForSpeed: !isPng,
    clip,
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
      // Preserve the #1094 tall-portrait edge-clipping guard on HDR alpha captures.
      captureBeyondViewport: true,
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
const TRANSPARENT_BG_STYLE_ID = "__hf_transparent_bg__";

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
    // Preserve the #1094 tall-portrait edge-clipping guard on HDR alpha captures.
    captureBeyondViewport: true,
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
const DOM_LAYER_MASK_HIDDEN_ATTR = "data-hf-dom-layer-mask-hidden";
const DOM_LAYER_MASK_PREV_VISIBILITY_ATTR = "data-hf-dom-layer-mask-prev-visibility";
const DOM_LAYER_MASK_PREV_PRIORITY_ATTR = "data-hf-dom-layer-mask-prev-priority";

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
 *    elements (and their descendants, injected `__render_frame_*` siblings,
 *    and media color-grading canvases) via `visibility: visible !important`. CSS `visibility: visible`
 *    on a descendant overrides an ancestor's `visibility: hidden`, so deep
 *    layer elements remain visible even though intermediate parents are
 *    hidden by the mass-hide rule.
 * 2. Inline-hide each `extraHideId` (and its render-frame/color-grading siblings) with
 *    `visibility: hidden !important`, while first recording its previous
 *    inline visibility. Inline `!important` beats stylesheet `!important`,
 *    so this overrides the show rule for elements that fall under a show
 *    selector but should NOT paint — typically other-layer elements that are
 *    descendants of a container layer (for example HDR videos and other-layer
 *    SDR videos are descendants of `#root` when we capture the root DOM layer).
 * 3. Inline-hide timed descendants of shown elements that were hidden before
 *    the mask was installed. This covers idless child clips and same-layer
 *    descendants that the `extraHideIds` id list cannot represent.
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
    // fallow-ignore-next-line complexity
    (args: {
      show: string[];
      hide: string[];
      styleId: string;
      hiddenAttr: string;
      prevVisibilityAttr: string;
      prevPriorityAttr: string;
      canvasIdPrefix: string;
    }) => {
      const existing = document.getElementById(args.styleId);
      if (existing) existing.remove();

      const restoreMaskedElements = () => {
        const masked = document.querySelectorAll(`[${args.hiddenAttr}="1"]`);
        for (const node of masked) {
          if (!(node instanceof HTMLElement)) continue;
          const prevVisibility = node.getAttribute(args.prevVisibilityAttr);
          const prevPriority = node.getAttribute(args.prevPriorityAttr);
          if (prevVisibility === null) {
            node.style.removeProperty("visibility");
          } else {
            node.style.setProperty("visibility", prevVisibility, prevPriority ?? "");
          }
          node.removeAttribute(args.hiddenAttr);
          node.removeAttribute(args.prevVisibilityAttr);
          node.removeAttribute(args.prevPriorityAttr);
        }
      };
      restoreMaskedElements();

      const rememberAndHideElement = (el: HTMLElement) => {
        if (el.getAttribute(args.hiddenAttr) !== "1") {
          const prevVisibility = el.style.getPropertyValue("visibility");
          const prevPriority =
            typeof el.style.getPropertyPriority === "function"
              ? el.style.getPropertyPriority("visibility")
              : "";
          if (prevVisibility) {
            el.setAttribute(args.prevVisibilityAttr, prevVisibility);
          } else {
            el.removeAttribute(args.prevVisibilityAttr);
          }
          if (prevPriority) {
            el.setAttribute(args.prevPriorityAttr, prevPriority);
          } else {
            el.removeAttribute(args.prevPriorityAttr);
          }
          el.setAttribute(args.hiddenAttr, "1");
        }
        el.style.setProperty("visibility", "hidden", "important");
      };

      const hiddenTimedDescendants: HTMLElement[] = [];
      const rememberHiddenTimedDescendants = (root: Element) => {
        for (const node of root.querySelectorAll("[data-start]")) {
          if (!(node instanceof HTMLElement)) continue;
          const computed = window.getComputedStyle(node);
          if (computed.visibility !== "hidden" && computed.display !== "none") continue;
          hiddenTimedDescendants.push(node);
        }
      };

      const showSelectors: string[] = [];
      for (const id of args.show) {
        const el = document.getElementById(id);
        if (el) rememberHiddenTimedDescendants(el);
        const escaped = CSS.escape(id);
        showSelectors.push(`#${escaped}`, `#${escaped} *`);
        const renderEscaped = CSS.escape(`__render_frame_${id}__`);
        showSelectors.push(`#${renderEscaped}`, `#${renderEscaped} *`);
        const colorGradingEscaped = CSS.escape(`${args.canvasIdPrefix}${id}`);
        showSelectors.push(`#${colorGradingEscaped}`, `#${colorGradingEscaped} *`);
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

      for (const el of hiddenTimedDescendants) {
        rememberAndHideElement(el);
      }

      for (const id of args.hide) {
        const el = document.getElementById(id);
        if (el) {
          rememberAndHideElement(el);
        }
        const img = document.getElementById(`__render_frame_${id}__`);
        if (img) {
          rememberAndHideElement(img);
        }
        const colorGradingCanvas = document.getElementById(`${args.canvasIdPrefix}${id}`);
        if (colorGradingCanvas instanceof HTMLElement) {
          rememberAndHideElement(colorGradingCanvas);
        }
      }
    },
    {
      show: showIds,
      hide: extraHideIds,
      styleId: DOM_LAYER_MASK_STYLE_ID,
      hiddenAttr: DOM_LAYER_MASK_HIDDEN_ATTR,
      prevVisibilityAttr: DOM_LAYER_MASK_PREV_VISIBILITY_ATTR,
      prevPriorityAttr: DOM_LAYER_MASK_PREV_PRIORITY_ATTR,
      canvasIdPrefix: HF_COLOR_GRADING_CANVAS_ID_PREFIX,
    },
  );
}

/**
 * Tear down the mask installed by applyDomLayerMask.
 *
 * Removes the mask stylesheet and restores the inline `visibility` values
 * temporarily overwritten for hidden timed descendants, `extraHideIds`, and
 * their render-frame/color-grading siblings.
 *
 * IMPORTANT: We do NOT strip inline `opacity` here. applyDomLayerMask only
 * ever sets `visibility` (never `opacity`), so any inline opacity present on
 * a wrapper was put there by user animation code (typically GSAP) and must
 * survive across per-layer captures. GSAP's seek with suppress-events does
 * not re-apply tweens when the timeline is already at the target time, so if
 * we strip opacity here and then seek to the same time for the next layer,
 * GSAP won't put it back and the wrapper will render fully opaque.
 */
export async function removeDomLayerMask(page: Page, _extraHideIds: string[]): Promise<void> {
  await page.evaluate(
    (args: {
      styleId: string;
      hiddenAttr: string;
      prevVisibilityAttr: string;
      prevPriorityAttr: string;
    }) => {
      const style = document.getElementById(args.styleId);
      if (style) style.remove();
      const masked = document.querySelectorAll(`[${args.hiddenAttr}="1"]`);
      for (const node of masked) {
        if (!(node instanceof HTMLElement)) continue;
        const prevVisibility = node.getAttribute(args.prevVisibilityAttr);
        const prevPriority = node.getAttribute(args.prevPriorityAttr);
        if (prevVisibility === null) {
          node.style.removeProperty("visibility");
        } else {
          node.style.setProperty("visibility", prevVisibility, prevPriority ?? "");
        }
        node.removeAttribute(args.hiddenAttr);
        node.removeAttribute(args.prevVisibilityAttr);
        node.removeAttribute(args.prevPriorityAttr);
      }
    },
    {
      styleId: DOM_LAYER_MASK_STYLE_ID,
      hiddenAttr: DOM_LAYER_MASK_HIDDEN_ATTR,
      prevVisibilityAttr: DOM_LAYER_MASK_PREV_VISIBILITY_ATTR,
      prevPriorityAttr: DOM_LAYER_MASK_PREV_PRIORITY_ATTR,
    },
  );
}

/**
 * Pre-create hidden `__render_frame__` sibling `<img>`s for every
 * `video[data-start]` in the page. Idempotent — videos that already
 * have a sibling are skipped.
 *
 * `injectVideoFramesBatch` creates the sibling on the fly the first time
 * it paints a given videoId (the `isNewImage = !hasImg` branch below).
 * Under chrome-headless-shell's deterministic + `HeadlessExperimental.
 * BeginFrame` mode, the immediately-next BeginFrame captures before the
 * freshly-inserted `<img>` layer lands in the compositor's layer tree;
 * the layer arrives a frame later. That single frame paints only the
 * body background + previously-composed overlays.
 *
 * Called from `initializeSession`: in the screenshot path at the end (that
 * capture path flushes paint, so timing doesn't matter), and in the BeginFrame
 * path followed by one explicit visual `HeadlessExperimental.beginFrame`
 * (`noDisplayUpdates: false`) that composites the new layers before the first
 * capture — the warmup ticks are `noDisplayUpdates: true` and don't paint.
 * Every subsequent `injectVideoFramesBatch` then takes the `hasImg = true` path
 * (just an `img.src` update). The `isNewImage` branch stays as a fallback for
 * callers that don't run through `initializeSession`.
 */
export async function ensureRenderFrameSiblings(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const video of Array.from(
      document.querySelectorAll<HTMLVideoElement>("video[data-start]"),
    )) {
      const next = video.nextElementSibling;
      if (next !== null && next.classList.contains("__render_frame__")) continue;
      const img = document.createElement("img");
      img.classList.add("__render_frame__");
      img.id = `__render_frame_${video.id}__`;
      img.style.pointerEvents = "none";
      img.style.position = "absolute";
      img.style.visibility = "hidden";
      video.parentNode?.insertBefore(img, video.nextSibling);
    }
  });
}

/**
 * Returns the subset of `updates.videoId`s that were actually painted in
 * this call. Videos skipped because of a hidden visual ancestor are NOT
 * included — the caller relies on this to avoid recording a `lastInjected`
 * cache entry for a frame that never reached the page, which would otherwise
 * short-circuit the next inject at the same frameIndex and leave the host's
 * first visible frame blank.
 */
export async function injectVideoFramesBatch(
  page: Page,
  updates: Array<{ videoId: string; dataUri: string }>,
): Promise<string[]> {
  if (updates.length === 0) return [];
  return await page.evaluate(
    // fallow-ignore-next-line complexity
    async (
      items: Array<{ videoId: string; dataUri: string }>,
      visualProperties: string[],
      colorGradingSourceHiddenAttr: string,
    ) => {
      const injectedIds: string[] = [];
      const pendingDecodes: Array<Promise<void>> = [];
      const replacementLayoutProperties = new Set([
        "width",
        "height",
        "top",
        "left",
        "right",
        "bottom",
        "inset",
      ]);
      // Walk ancestors looking for a host that the page has hidden. The
      // runtime hides `[data-composition-src]` and `[data-start]` hosts that
      // fall outside their time window; a nested `<video data-start>` inside
      // such a host still appears "active" in the raw time-window check (its
      // own `data-start`/`data-end` cover the whole clip), so without this
      // guard we would paint a full-bleed replacement frame over a sibling
      // host that *is* visible.
      //
      // `display: none` is always a skip signal — a `display: none` ancestor
      // takes its whole subtree out of layout, and a child `<img>` cannot
      // escape that. `visibility: hidden`, by contrast, is escapable: a
      // descendant with `visibility: visible` overrides an ancestor's
      // `visibility: hidden` per the CSS spec, and the replacement `<img>`
      // intentionally sets `visibility: visible`. We therefore only treat
      // `visibility: hidden` as a skip signal on sub-composition hosts
      // (`[data-composition-src]` / `[data-composition-file]`), which is the
      // scenario this guard exists for. Plain `[data-start]` containers may
      // be hidden with `visibility: hidden` while still wanting their inner
      // video's final-state frame to paint through (e.g. a GSAP timeline
      // shorter than the host's authored data-duration, where the runtime
      // truncates visibility but the replacement <img> must hold its last
      // frame) — those must NOT be skipped here.
      // fallow-ignore-next-line code-duplication
      const isVisualAncestorHidden = (el: HTMLElement): boolean => {
        let parent = el.parentElement;
        while (parent !== null && parent !== document.documentElement) {
          const computed = window.getComputedStyle(parent);
          if (computed.display === "none") return true;
          if (
            computed.visibility === "hidden" &&
            (parent.hasAttribute("data-composition-src") ||
              parent.hasAttribute("data-composition-file"))
          ) {
            return true;
          }
          parent = parent.parentElement;
        }
        return false;
      };
      for (const item of items) {
        const video = document.getElementById(item.videoId) as HTMLVideoElement | null;
        if (!video) continue;

        let img = video.nextElementSibling as HTMLImageElement | null;
        const hasImg = img !== null && img.classList.contains("__render_frame__");

        if (isVisualAncestorHidden(video)) {
          // Don't paint a frame over a hidden host — if an existing replacement
          // <img> is still around from when the host was visible, hide it so it
          // doesn't bleed through a sibling host that *is* visible on this seek.
          //
          // Use `!important` so the inline hide survives `applyDomLayerMask`'s
          // stylesheet `#${showId} *{visibility:visible !important}` when the
          // sub-comp host happens to land in the active layer's `show` set —
          // important stylesheet beats non-important inline, but important
          // inline beats important stylesheet.
          if (hasImg && img) img.style.setProperty("visibility", "hidden", "important");
          continue;
        }

        const isNewImage = !hasImg;
        const computedStyle = window.getComputedStyle(video);
        // Read the GSAP-controlled opacity directly from the native <video>.
        // We hide the <video> below with `visibility: hidden` only (never
        // `opacity: 0`), so its computed opacity is preserved across seeks
        // and accurately reflects the user's intent on every frame.
        const opacityParsed = parseFloat(computedStyle.opacity);
        const computedOpacity = video.hasAttribute(colorGradingSourceHiddenAttr)
          ? 1
          : Number.isNaN(opacityParsed)
            ? 1
            : opacityParsed;

        if (isNewImage) {
          img = document.createElement("img");
          img.classList.add("__render_frame__");
          img.id = `__render_frame_${item.videoId}__`;
          img.style.pointerEvents = "none";
          video.parentNode?.insertBefore(img, video.nextSibling);
        }
        if (!img) continue;

        for (const property of visualProperties) {
          // Opacity is handled explicitly via `computedOpacity` below — copying
          // via the generic loop would race against the opacity:0 hide applied
          // to the <video> at the end of this function. GSAP may animate
          // opacity either on a wrapper (the <img> inherits via the stacking
          // context) or directly on the <video> (we must copy it to the <img>
          // since they are siblings). Reading computedStyle.opacity before
          // hiding the <video> handles both cases correctly.
          if (property === "opacity") continue;
          // Layout is set from the video's used box below. Copying authored
          // opposing constraints such as `inset: 0` / `right: 0` onto the
          // replacement <img> can overconstrain replaced-image sizing and make
          // some Chrome capture paths resample the frame anisotropically.
          if (replacementLayoutProperties.has(property)) {
            continue;
          }
          const value = computedStyle.getPropertyValue(property);
          if (value) {
            img.style.setProperty(property, value);
          }
        }

        // Always use absolute positioning so the <img> overlays the <video>
        // instead of flowing below it. With position:relative, both elements
        // stack vertically — the <img> lands below the video and gets clipped
        // by any overflow:hidden ancestor (e.g., border-radius wrappers).
        //
        // Apply this after visual style copying so the measured used box is
        // the final authority for replacement frame geometry.
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

        img.decoding = "sync";
        if (img.getAttribute("src") !== item.dataUri) {
          img.src = item.dataUri;
          pendingDecodes.push(
            img
              .decode()
              .catch(() => undefined)
              .then(() => undefined),
          );
        }
        img.style.opacity = String(computedOpacity);
        img.style.visibility = "visible";
        // Hide the native <video> with visibility only — never clobber inline
        // opacity, so subsequent reads (and queryElementStacking) see the real
        // GSAP-controlled value.
        video.style.setProperty("visibility", "hidden", "important");
        video.style.setProperty("pointer-events", "none", "important");
        injectedIds.push(item.videoId);
      }
      if (pendingDecodes.length > 0) {
        await Promise.all(pendingDecodes);
      }
      return injectedIds;
    },
    updates,
    [...MEDIA_VISUAL_STYLE_PROPERTIES],
    COLOR_GRADING_SOURCE_HIDDEN_ATTR,
  );
}

export async function syncVideoFrameVisibility(
  page: Page,
  activeVideoIds: string[],
): Promise<void> {
  await page.evaluate(
    // fallow-ignore-next-line complexity
    (ids: string[], colorGradingSourceHiddenAttr: string) => {
      // Mirror the ancestor-visibility guard from `injectVideoFramesBatch`.
      // See that copy for the full rationale on why `visibility: hidden` is
      // narrowed to sub-composition hosts only — keep these two functions in
      // sync so the inactive-arm decision matches the inject-time decision.
      const isVisualAncestorHidden = (el: HTMLElement): boolean => {
        let parent = el.parentElement;
        while (parent !== null && parent !== document.documentElement) {
          const computed = window.getComputedStyle(parent);
          if (computed.display === "none") return true;
          if (
            computed.visibility === "hidden" &&
            (parent.hasAttribute("data-composition-src") ||
              parent.hasAttribute("data-composition-file"))
          ) {
            return true;
          }
          parent = parent.parentElement;
        }
        return false;
      };
      const active = new Set(ids);
      const videos = Array.from(
        document.querySelectorAll("video[data-start]"),
      ) as HTMLVideoElement[];
      for (const video of videos) {
        const img = video.nextElementSibling as HTMLElement | null;
        const hasImg = img && img.classList.contains("__render_frame__");
        const ancestorHidden = isVisualAncestorHidden(video);
        if (active.has(video.id) && !ancestorHidden) {
          // Active video: show injected <img>, hide native <video>.
          // Do NOT clobber inline opacity here — GSAP-controlled opacity must
          // survive until injectVideoFramesBatch reads it via getComputedStyle.
          // visibility:hidden alone hides the native element without affecting
          // its computed opacity.
          video.style.setProperty("visibility", "hidden", "important");
          video.style.setProperty("pointer-events", "none", "important");
          if (hasImg) {
            if (video.hasAttribute(colorGradingSourceHiddenAttr)) img.style.opacity = "1";
            img.style.visibility = "visible";
          }
        } else {
          // Inactive (or ancestor-hidden) video: hide both. Use visibility only
          // (never opacity) so we never clobber GSAP-controlled inline opacity.
          // Use `!important` on the <img> hide so `applyDomLayerMask`'s
          // important stylesheet rule (`#${showId} *{visibility:visible !important}`)
          // cannot revive a stale frame when the sub-comp host lands in the
          // active layer's `show` set — same mask-defense reasoning as the
          // `isVisualAncestorHidden` branch in `injectVideoFramesBatch`.
          video.style.removeProperty("display");
          video.style.setProperty("visibility", "hidden", "important");
          video.style.setProperty("pointer-events", "none", "important");
          if (hasImg) {
            img.style.setProperty("visibility", "hidden", "important");
          }
        }
      }
    },
    activeVideoIds,
    COLOR_GRADING_SOURCE_HIDDEN_ATTR,
  );
}
