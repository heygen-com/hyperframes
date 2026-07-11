import { spawn } from "node:child_process";
import type { Browser, Page } from "puppeteer-core";
import { c } from "../ui/colors.js";
import { resolveCompositionViewportFromHtml } from "../utils/compositionViewport.js";
import { resolveDiagnosticNavigationTimeoutMs } from "../utils/renderArgs.js";

const SHADER_TRANSITIONS_TIMEOUT_MS = 90_000;
const CAPTURE_SETTLE_MS = 1500;
const PREFERRED_SEEK_TARGET_WAIT_MS = 500;
const DEFAULT_POST_SEEK_FONT_WAIT_MS = 500;

// The audit-grade seek tuning shared by check and the deprecated inspect/layout:
// bridge+timeline fallback, ordered double-rAF settle, bounded font wait, sleep.
export const AUDIT_SEEK_OPTIONS = {
  fallbackToBridgeAndTimelines: true,
  animationFrameSettle: "double",
  waitForFontsMs: 500,
  settleMs: 120,
} as const;

export interface SeekCompositionTimelineOptions {
  fallbackToBridgeAndTimelines?: boolean;
  waitForPreferredSeekTargetMs?: number;
  animationFrameSettle?: "race" | "double" | "none";
  waitForFontsMs?: number;
  settleMs?: number;
}

type CompositionPageFunction =
  | string
  | (() => unknown)
  | ((value: number) => unknown)
  | ((value: number, fallbackToBridgeAndTimelines: boolean) => unknown);

export interface CompositionEvaluationPage {
  evaluate(
    pageFunction: CompositionPageFunction,
    value?: number,
    fallbackToBridgeAndTimelines?: boolean,
  ): Promise<unknown>;
}

export interface CompositionSeekPage extends CompositionEvaluationPage {
  waitForFunction?(pageFunction: () => boolean, options: { timeout: number }): Promise<unknown>;
}

export interface SettledCompositionPage {
  browser: Browser;
  page: Page;
  // True when the runtime never signaled __renderReady within the timeout — the
  // capture proceeds anyway (possibly mid-animation), so callers can surface it.
  renderReadyTimedOut: boolean;
}

export interface OpenSettledCompositionPageOptions {
  renderReadyTimeoutMs: number;
  renderReadyWarningSuffix: string;
  // Screenshot paths take the engine's software-GPU default; validate/check
  // thread the PRODUCER_BROWSER_GPU_MODE opt-in through here.
  browserGpuMode?: "software" | "hardware";
  // Runs after the page exists but before page.goto, so console/pageerror/
  // request listeners can attach without missing load-time events.
  beforeNavigate?: (page: Page) => void | Promise<void>;
}

export interface FfmpegRunResult {
  code: number | null;
  stderr: string;
  timedOut: boolean;
}

export function resolveCliChromeGpuMode(
  envMode = process.env.PRODUCER_BROWSER_GPU_MODE,
): "software" | "hardware" {
  return envMode === "software" ? "software" : "hardware";
}

function compositionRuntimeReadyInBrowser(): boolean {
  return Boolean(Reflect.get(window, "__renderReady"));
}

function shaderTransitionsReadyInBrowser(): boolean {
  function shaderTransitionRegistryReady(): boolean | undefined {
    const hf = Reflect.get(window, "__hf");
    if (typeof hf !== "object" || hf === null) return undefined;

    const shaderTransitions = Reflect.get(hf, "shaderTransitions");
    if (typeof shaderTransitions !== "object" || shaderTransitions === null) return undefined;

    for (const key of Object.keys(shaderTransitions)) {
      const entry = Reflect.get(shaderTransitions, key);
      if (typeof entry !== "object" || entry === null) return false;
      if (Reflect.get(entry, "ready") !== true) return false;
    }
    return true;
  }

  function shaderLoadingOverlayReady(): boolean {
    const overlay = document.querySelector("[data-hyper-shader-loading]");
    if (!overlay) return true;
    if (!(overlay instanceof HTMLElement)) return true;
    return window.getComputedStyle(overlay).display === "none";
  }

  return shaderTransitionRegistryReady() ?? shaderLoadingOverlayReady();
}

async function waitForCompositionSettle(
  page: Page,
  options: OpenSettledCompositionPageOptions,
): Promise<boolean> {
  const runtimeReady = await page
    .waitForFunction(compositionRuntimeReadyInBrowser, { timeout: options.renderReadyTimeoutMs })
    .then(() => true)
    .catch(() => false);

  if (!runtimeReady) {
    console.warn(
      `\n   ${c.warn("⚠")} Runtime did not become render-ready within ${options.renderReadyTimeoutMs}ms — ${options.renderReadyWarningSuffix}`,
    );
  }

  await page
    .waitForFunction(shaderTransitionsReadyInBrowser, {
      timeout: SHADER_TRANSITIONS_TIMEOUT_MS,
    })
    .catch(() => {
      console.warn(`   ${c.warn("⚠")} Shader transitions did not finish pre-rendering`);
    });

  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await new Promise((resolveSettle) => setTimeout(resolveSettle, CAPTURE_SETTLE_MS));
  return runtimeReady;
}

// tsx/esbuild-style dev transpilers run with keepNames, which rewrites named
// inner functions in serialized page closures into __name(...) calls — a
// helper that exists in the Node bundle but not in the browser realm, so any
// page.evaluate/waitForFunction whose closure defines a named function throws
// "__name is not defined" when the CLI runs from source. Defining a no-op in
// the page before any script runs immunizes every serialized closure, current
// and future, regardless of how the CLI was built.
export async function installPageFunctionGuard(page: {
  evaluateOnNewDocument(source: string): Promise<unknown>;
}): Promise<void> {
  await page.evaluateOnNewDocument("self.__name = self.__name || ((fn) => fn);");
}

export async function openSettledCompositionPage(
  html: string,
  url: string,
  options: OpenSettledCompositionPageOptions,
): Promise<SettledCompositionPage> {
  const viewport = resolveCompositionViewportFromHtml(html);
  const { ensureBrowser } = await import("../browser/manager.js");
  const browser = await ensureBrowser();
  const puppeteer = await import("puppeteer-core");
  const { buildChromeArgs } = await import("@hyperframes/engine");

  let chromeBrowser: Browser | undefined;
  try {
    chromeBrowser = await puppeteer.default.launch({
      headless: true,
      executablePath: browser.executablePath,
      args: buildChromeArgs(
        { ...viewport, captureMode: "screenshot" },
        { browserGpuMode: options.browserGpuMode },
      ),
    });

    const page = await chromeBrowser.newPage();
    await installPageFunctionGuard(page);
    await page.setViewport(viewport);
    await options.beforeNavigate?.(page);
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: resolveDiagnosticNavigationTimeoutMs(),
    });
    const renderReadyTimedOut = !(await waitForCompositionSettle(page, options));
    return { browser: chromeBrowser, page, renderReadyTimedOut };
  } catch (err) {
    await chromeBrowser?.close().catch(() => {});
    throw err;
  }
}

export async function seekCompositionTimeline(
  page: CompositionSeekPage,
  timeSeconds: number,
  options: SeekCompositionTimelineOptions = {},
): Promise<void> {
  if (options.waitForPreferredSeekTargetMs !== undefined) {
    await waitForPreferredSeekTarget(page, options.waitForPreferredSeekTargetMs);
  }

  await page.evaluate(
    // Serialized into the page; the seek-target cascade must stay one function.
    // fallow-ignore-next-line complexity
    (t: number, fallbackToBridgeAndTimelines: boolean) => {
      const getProperty = (target: unknown, key: string): unknown => {
        if ((typeof target !== "object" || target === null) && typeof target !== "function") {
          return undefined;
        }
        return Reflect.get(target, key);
      };
      const call = (fn: unknown, receiver: unknown, args: unknown[]): boolean => {
        if (typeof fn !== "function") return false;
        Reflect.apply(fn, receiver, args);
        return true;
      };

      const player = Reflect.get(window, "__player");
      if (!player && !fallbackToBridgeAndTimelines) return;

      const safe = Math.max(0, Number(t) || 0);
      const renderSeek = getProperty(player, "renderSeek");
      const playerSeek = getProperty(player, "seek");
      const hf = Reflect.get(window, "__hf");
      const bridgeSeek = getProperty(hf, "seek");

      // Prefer renderSeek because it also runs the runtime's data-start/data-duration
      // visibility sync; raw timeline seeks leave off-window clips visible to audits.
      if (call(renderSeek, player, [safe])) {
        // Preferred runtime target handled the seek.
      } else if (fallbackToBridgeAndTimelines && call(bridgeSeek, hf, [safe])) {
        // Producer bridge handled the seek.
      } else if (call(playerSeek, player, [safe])) {
        // Legacy player target handled the seek.
      } else if (fallbackToBridgeAndTimelines) {
        const timelines = Reflect.get(window, "__timelines");
        if (typeof timelines === "object" && timelines !== null) {
          for (const key of Object.keys(timelines)) {
            const timeline = Reflect.get(timelines, key);
            call(getProperty(timeline, "pause"), timeline, []);
            call(getProperty(timeline, "seek"), timeline, [safe]);
          }
        }
      }

      const gsap = Reflect.get(window, "gsap");
      const ticker = getProperty(gsap, "ticker");
      call(getProperty(ticker, "tick"), ticker, []);
    },
    timeSeconds,
    options.fallbackToBridgeAndTimelines === true,
  );

  const animationFrameSettle = options.animationFrameSettle ?? "race";
  if (animationFrameSettle === "race") {
    await page.evaluate(`new Promise(function(r) {
      var settled = false;
      function finish() { if (settled) return; settled = true; r(); }
      window.setTimeout(finish, 100);
      requestAnimationFrame(function() { requestAnimationFrame(finish); });
    })`);
  } else if (animationFrameSettle === "double") {
    await page.evaluate(
      () =>
        new Promise<void>((resolveFrame) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())),
        ),
    );
  }

  // On by default: every seek caller here is a visual-audit path (snapshot,
  // check, compare, validate, layout) and a seek that reveals unrequested
  // glyphs must not screenshot before their font subsets load. Costs one
  // evaluate + one rAF when nothing is loading. Pass 0 to disable.
  const waitForFontsMs = options.waitForFontsMs ?? DEFAULT_POST_SEEK_FONT_WAIT_MS;
  if (waitForFontsMs > 0) {
    await waitForCompositionFonts(page, waitForFontsMs);
  }
  if (options.settleMs !== undefined) {
    const settleMs = Math.max(0, options.settleMs);
    await new Promise((resolveSettle) => setTimeout(resolveSettle, settleMs));
  }
}

export async function waitForPreferredSeekTarget(
  page: Pick<CompositionSeekPage, "waitForFunction">,
  timeoutMs = PREFERRED_SEEK_TARGET_WAIT_MS,
): Promise<void> {
  if (!page.waitForFunction) return;
  try {
    await page.waitForFunction(
      () => {
        const player = Reflect.get(window, "__player");
        const hf = Reflect.get(window, "__hf");
        const renderSeek =
          typeof player === "object" && player !== null
            ? Reflect.get(player, "renderSeek")
            : undefined;
        const bridgeSeek =
          typeof hf === "object" && hf !== null ? Reflect.get(hf, "seek") : undefined;
        return typeof renderSeek === "function" || typeof bridgeSeek === "function";
      },
      { timeout: timeoutMs },
    );
  } catch {
    // Legacy/static pages may only expose raw timelines; keep that fallback available.
  }
}

export async function waitForCompositionFonts(
  page: CompositionEvaluationPage,
  timeoutMs: number,
): Promise<void> {
  await page
    .evaluate((ms: number) => {
      const fonts = Reflect.get(document, "fonts");
      if (typeof fonts !== "object" || fonts === null) return Promise.resolve();
      // A seek can reveal glyphs whose font faces were never requested —
      // CJK @font-face splits into unicode-range subsets that only load when
      // first laid out. `fonts.ready` is already-resolved at that moment, so
      // awaiting it immediately races the load request and screenshots blank
      // glyphs (wild reports: Traditional Chinese / Microsoft YaHei check
      // snapshots). Force a synchronous layout so pending subsets actually
      // start loading, give the loader one frame to flip `fonts.status`,
      // THEN await readiness.
      void document.body?.offsetHeight;
      return new Promise<void>((resolveWait) => {
        const deadline = setTimeout(resolveWait, ms);
        requestAnimationFrame(() => {
          const status = Reflect.get(fonts, "status");
          const ready = Reflect.get(fonts, "ready");
          if (status !== "loading" || !ready) {
            clearTimeout(deadline);
            resolveWait();
            return;
          }
          Promise.resolve(ready).then(() => {
            clearTimeout(deadline);
            resolveWait();
          });
        });
      });
    }, timeoutMs)
    .catch(() => {});
}

export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropCanvas {
  width: number;
  height: number;
}

export type ZoomTarget =
  | { kind: "selector"; selector: string }
  | { kind: "region"; region: CropRegion };

// Four bare comma-separated numbers is unambiguous — no valid CSS selector
// parses as that shape — so it always means "exact pixel region".
const ZOOM_REGION_PATTERN = /^-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?){3}$/;
export const DEFAULT_ZOOM_PADDING_PX = 24;
// One knob for every zoom/crop consumer (snapshot --zoom-scale default, check's
// finding crops): density of the captured pixels relative to CSS pixels.
export const DEFAULT_ZOOM_SCALE = 3;

/** Parse `snapshot --zoom` into either a CSS selector or an exact pixel region "x,y,w,h". */
export function parseZoomTarget(value: string): ZoomTarget {
  const trimmed = value.trim();
  if (ZOOM_REGION_PATTERN.test(trimmed)) {
    const [x, y, width, height] = trimmed.split(",").map(Number) as [
      number,
      number,
      number,
      number,
    ];
    return { kind: "region", region: { x, y, width, height } };
  }
  return { kind: "selector", selector: trimmed };
}

/** Clamp a region to the canvas bounds — Puppeteer's clip screenshot rejects a
 * region that spills outside the viewport. Keeps at least 1px on each side. */
export function clampCropRegion(region: CropRegion, canvas: CropCanvas): CropRegion {
  const x = Math.max(0, Math.min(region.x, canvas.width));
  const y = Math.max(0, Math.min(region.y, canvas.height));
  const x2 = Math.max(x + 1, Math.min(region.x + region.width, canvas.width));
  const y2 = Math.max(y + 1, Math.min(region.y + region.height, canvas.height));
  return { x, y, width: x2 - x, height: y2 - y };
}

/** Pad a region on every side (context around a zoomed element), then clamp. */
export function padCropRegion(
  region: CropRegion,
  canvas: CropCanvas,
  paddingPx: number,
): CropRegion {
  return clampCropRegion(
    {
      x: region.x - paddingPx,
      y: region.y - paddingPx,
      width: region.width + paddingPx * 2,
      height: region.height + paddingPx * 2,
    },
    canvas,
  );
}

export interface ZoomSelectorPage {
  evaluate(
    pageFunction: (selector: string) => CropRegion | null,
    selector: string,
  ): Promise<CropRegion | null>;
}

/**
 * Resolve a `--zoom` target to a concrete crop region. A selector resolves to
 * its live bbox (padded ~24px, then clamped); an explicit region is used
 * as-is (clamped only, never padded — region form crops exactly). A selector
 * matching nothing throws: a loud error beats a silent full-frame fallback.
 */
// A selector can match an element whose visible box is gone at the sampled
// time — collapsed (display:none mid-timeline) or animated off-canvas, where
// clamping leaves a pixel-wide remnant. Either way the crop would be a sliver
// that tells an agent nothing, so the final clamped region is what's guarded
// and callers skip the frame on null. Explicit x,y,w,h regions stay literal.
const MIN_CROP_REGION_PX = 8;

export async function resolveCropRegion(
  page: ZoomSelectorPage,
  target: ZoomTarget,
  canvas: CropCanvas,
  paddingPx = DEFAULT_ZOOM_PADDING_PX,
): Promise<CropRegion | null> {
  if (target.kind === "region") return clampCropRegion(target.region, canvas);
  const bbox = await page.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, target.selector);
  if (!bbox) throw new Error(`--zoom selector matched no element: ${target.selector}`);
  const region = padCropRegion(bbox, canvas, paddingPx);
  if (region.width < MIN_CROP_REGION_PX || region.height < MIN_CROP_REGION_PX) return null;
  return region;
}

export interface CropCapturePage {
  viewport(): { width: number; height: number; deviceScaleFactor?: number } | null;
  setViewport(viewport: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  }): Promise<void>;
  screenshot(options: { clip: CropRegion; type: "png"; omitBackground: true }): Promise<Uint8Array>;
}

/**
 * Capture a high-density crop of `region`: raise `deviceScaleFactor` to
 * `scale`, take a clip screenshot, then restore the original viewport.
 * Deliberately NOT CSS zoom or a viewport resize — DSF only changes how
 * densely Chrome rasterizes the existing CSS-pixel layout, so the
 * composition's layout (and its render determinism) is untouched. The PNG
 * comes out at `region.width * scale` real device pixels, not an upscale.
 */
export async function captureRegionCrop(
  page: CropCapturePage,
  region: CropRegion,
  scale: number,
): Promise<Buffer> {
  const original = page.viewport();
  if (original) await page.setViewport({ ...original, deviceScaleFactor: scale });
  try {
    const shot = await page.screenshot({ clip: region, type: "png", omitBackground: true });
    return Buffer.isBuffer(shot) ? shot : Buffer.from(shot);
  } finally {
    if (original) await page.setViewport(original);
  }
}

export async function runFfmpegOnce(
  ffmpegPath: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<FfmpegRunResult> {
  return await new Promise((resolvePromise) => {
    const ff = spawn(ffmpegPath, args);
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ff.kill("SIGTERM");
    }, timeoutMs);

    ff.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    ff.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stderr, timedOut });
    });
    ff.on("error", () => {
      clearTimeout(timer);
      resolvePromise({ code: null, stderr: "ffmpeg spawn failed", timedOut });
    });
  });
}
