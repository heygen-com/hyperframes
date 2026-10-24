import {
  rethrowAfterBrowserCleanup,
  launchManagedBrowser,
  resolveManagedGpuMode,
} from "../browser/launch.js";
import { oneProcessOverPipe } from "../browser/sandboxDenied.js";
import { spawn } from "node:child_process";
import type { Browser, Page } from "puppeteer-core";
import type { InProcessRequest, InProcessResponse } from "../utils/staticProjectServer.js";
import { c } from "../ui/colors.js";
import {
  assertWebGpuAdapterAvailable,
  compositionRequiresWebGpu,
  resolveLocalBrowserGpuMode,
  resolveLocalWebGpu,
  type BrowserGpuMode,
} from "../browser/gpuPolicy.js";
import { windowsChromeCrashRemediation } from "../browser/windowsCrash.js";
import { resolveCompositionViewportFromHtml } from "../utils/compositionViewport.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { pageNavigationTimeoutMs } from "../utils/renderArgs.js";
import { gotoWhenSent } from "./navigateForCapture.js";

const SHADER_TRANSITIONS_TIMEOUT_MS = 90_000;
const CAPTURE_SETTLE_MS = 1500;
const NETWORK_IDLE_MS = 100;
const PREFERRED_SEEK_TARGET_WAIT_MS = 500;
const DEFAULT_POST_SEEK_FONT_WAIT_MS = 500;

// The audit-grade seek tuning shared by check and the deprecated inspect/layout:
// bridge+timeline fallback, ordered double-rAF settle, bounded font wait.
export const AUDIT_SEEK_OPTIONS = {
  fallbackToBridgeAndTimelines: true,
  animationFrameSettle: "double",
  waitForFontsMs: 500,
} as const;

export const SCREENSHOT_IMAGE_WAIT_MS = 3_000;

export const SCREENSHOT_SEEK_OPTIONS = {
  ...AUDIT_SEEK_OPTIONS,
  waitForImagesMs: SCREENSHOT_IMAGE_WAIT_MS,
} as const;

export interface UnsettledImages {
  pending: string[];
  failed: string[];
}

const ALL_IMAGES_SETTLED: UnsettledImages = { pending: [], failed: [] };

// Geometry-only seek for the dense content_overlap grid: getBoundingClientRect is valid synchronously after setTime, so drop all post-seek waits (rAF/font/sleep) that would multiply across the dense grid.
export const DENSE_GEOMETRY_SEEK_OPTIONS = {
  ...AUDIT_SEEK_OPTIONS,
  animationFrameSettle: "none",
  waitForFontsMs: 0,
  settleMs: 0,
  waitForVideoFrames: false,
  skipWebglDraws: true,
} as const;

export interface SeekCompositionTimelineOptions {
  fallbackToBridgeAndTimelines?: boolean;
  exactTime?: boolean;
  waitForPreferredSeekTargetMs?: number;
  animationFrameSettle?: "race" | "double" | "none";
  waitForFontsMs?: number;
  settleMs?: number;
  waitForImagesMs?: number;
  waitForVideoFrames?: boolean;
  // Box-only reads: software GL spends about a second per frame on draws nothing here looks at.
  skipWebglDraws?: boolean;
}

type SeekBarrierOptions = { videoFrames: boolean };
type FontWaitOptions = { ms: number; frames: number };

type CompositionPageFunction =
  | string
  | (() => unknown)
  | ((value: number) => unknown)
  | ((barrier: SeekBarrierOptions) => unknown)
  | ((wait: FontWaitOptions) => unknown)
  | ((
      value: number,
      fallbackToBridgeAndTimelines: boolean,
      exactTime: boolean,
      skipWebglDraws: boolean,
    ) => unknown);

export interface CompositionEvaluationPage {
  evaluate(
    pageFunction: CompositionPageFunction,
    value?: number | SeekBarrierOptions | FontWaitOptions,
    fallbackToBridgeAndTimelines?: boolean,
    exactTime?: boolean,
    skipWebglDraws?: boolean,
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
  // Separate from the post-navigation render-ready budget; can only lengthen render's page-load budget.
  navigationTimeoutMs?: number;
  renderReadyTimeoutMs: number;
  renderReadyWarningSuffix: string;
  lateSubresourceTimeoutMs?: number;
  browserGpuMode?: BrowserGpuMode;
  signal?: AbortSignal;
  onBrowser?: (browser: Browser) => void;
  // Connected composition browser, before page creation or authored scripts.
  onBrowserReady?: () => void;
  // Runs after the page exists but before page.goto, so console/pageerror/
  // request listeners can attach without missing load-time events.
  beforeNavigate?: (page: Page) => void | Promise<void>;
  onLoaded?: () => void;
  // Started before the project was bundled; used only if it was launched with the same arguments.
  prelaunched?: PrelaunchedBrowser;
}

interface LaunchedBrowser {
  browser: Browser;
  softwareWebGpu: boolean;
}

export interface PrelaunchedBrowser {
  launched: Promise<LaunchedBrowser | undefined>;
  take(key: string): Promise<LaunchedBrowser | undefined>;
  discard(): Promise<void>;
}

type LaunchOptions = Pick<
  OpenSettledCompositionPageOptions,
  "browserGpuMode" | "signal" | "onBrowser"
>;

function launchKey(html: string, noListen: boolean, options: LaunchOptions): string {
  const viewport = resolveCompositionViewportFromHtml(html);
  const gpuMode = options.browserGpuMode ?? resolveCliChromeGpuMode();
  return JSON.stringify([viewport, compositionRequiresWebGpu(html), noListen, gpuMode]);
}

export function prelaunchCompositionBrowser(
  html: string,
  browserGpuMode?: BrowserGpuMode,
): PrelaunchedBrowser {
  const abort = new AbortController();
  const options = { browserGpuMode, signal: abort.signal };
  const key = launchKey(html, false, options);
  const launched = launchCompositionBrowser(html, false, options).catch(() => undefined);
  let taken = false;
  const discard = async () => {
    if (taken) return;
    taken = true;
    abort.abort();
    await (await launched)?.browser.close().catch(() => undefined);
  };
  return {
    launched,
    take: async (wanted) => {
      if (wanted !== key) return discard().then(() => undefined);
      taken = true;
      const result = await launched;
      if (result?.browser.connected) return result;
      await result?.browser.close().catch(() => undefined);
      return undefined;
    },
    discard,
  };
}

export interface FfmpegRunResult {
  code: number | null;
  stderr: string;
  timedOut: boolean;
}

export function resolveCliChromeGpuMode(
  envMode = process.env.PRODUCER_BROWSER_GPU_MODE,
): BrowserGpuMode {
  return resolveLocalBrowserGpuMode(undefined, envMode);
}

function compositionRuntimeReadyInBrowser(): boolean {
  return (
    Boolean(Reflect.get(window, "__renderReady")) ||
    typeof Reflect.get(window, "__hfStartupError") === "string"
  );
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

export async function waitForRuntimeReady(
  page: Required<Pick<CompositionSeekPage, "waitForFunction" | "evaluate">>,
  timeoutMs: number,
): Promise<boolean> {
  const settled = await page
    .waitForFunction(compositionRuntimeReadyInBrowser, { timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  const startupError = await page
    .evaluate(() => Reflect.get(window, "__hfStartupError"))
    .catch(() => undefined);
  if (typeof startupError === "string") throw new Error(startupError);
  return settled;
}

async function waitForCompositionSettle(
  page: Page,
  options: OpenSettledCompositionPageOptions,
): Promise<boolean> {
  const runtimeReady = await waitForRuntimeReady(page, options.renderReadyTimeoutMs);

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

  await waitForLateSubresources(page, options.lateSubresourceTimeoutMs ?? CAPTURE_SETTLE_MS);
  const { resolveConfig, waitForImagesReady } = await import("@hyperframes/engine");
  const imageTimeoutMs = resolveConfig().playerReadyTimeout;
  await waitForImagesReady(page, imageTimeoutMs, (sources) =>
    console.warn(
      `   ${c.warn("⚠")} Some images did not load within ${imageTimeoutMs}ms: ${sources}. They may show blank.`,
    ),
  );
  return runtimeReady;
}

async function waitForLateSubresources(page: Page, timeoutMs: number): Promise<void> {
  let cap: ReturnType<typeof setTimeout> | undefined;
  const deadline = Date.now() + timeoutMs;
  const ready = (async () => {
    await page.waitForFunction(() => document.readyState === "complete", {
      timeout: timeoutMs,
    });
    await page.waitForNetworkIdle({
      idleTime: NETWORK_IDLE_MS,
      timeout: Math.max(1, deadline - Date.now()),
    });
    await page.evaluate(async () => {
      await Promise.all(Array.from(document.images, (image) => image.decode().catch(() => {})));
      await document.fonts.ready;
    });
  })();
  try {
    await Promise.race([
      ready,
      new Promise((resolveCap) => {
        cap = setTimeout(resolveCap, timeoutMs);
      }),
    ]);
  } catch {
    await new Promise((resolveCap) => setTimeout(resolveCap, Math.max(0, deadline - Date.now())));
  } finally {
    clearTimeout(cap);
    ready.catch(() => {});
  }
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
  const requiresWebGpu = compositionRequiresWebGpu(html);
  // Nothing may listen (a sandbox refused it): DevTools over a pipe, one process, pages answered in-process.
  const answer = (await import("../utils/staticProjectServer.js")).inProcessAnswer(url);
  const noListen = answer !== undefined;
  let chromeBrowser: Browser | undefined;
  try {
    const launched =
      (await options.prelaunched?.take(launchKey(html, noListen, options))) ??
      (await launchCompositionBrowser(html, noListen, options));
    chromeBrowser = launched.browser;
    const softwareWebGpu = launched.softwareWebGpu;
    options.onBrowser?.(chromeBrowser);
    options.onBrowserReady?.();
    const page = await chromeBrowser.newPage();
    await installPageFunctionGuard(page);
    const { installMediaRenderIdBridge } = await import("@hyperframes/engine");
    await installMediaRenderIdBridge(page);
    await page.setViewport(viewport);
    if (answer) await answerPageInProcess(page, url, answer);
    await options.beforeNavigate?.(page);
    await gotoWhenSent(page, url, pageNavigationTimeoutMs(options.navigationTimeoutMs));
    await assertWebGpuAdapterAvailable(page, requiresWebGpu, softwareWebGpu);
    options.onLoaded?.();
    const renderReadyTimedOut = !(await waitForCompositionSettle(page, options));
    return { browser: chromeBrowser, page, renderReadyTimedOut };
  } catch (err) {
    return rethrowAfterBrowserCleanup(chromeBrowser, err);
  }
}

async function launchCompositionBrowser(
  html: string,
  noListen: boolean,
  options: LaunchOptions,
): Promise<LaunchedBrowser> {
  const viewport = resolveCompositionViewportFromHtml(html);
  const { ensureBrowser, findSystemBrowser } = await import("../browser/manager.js");
  const browser = await ensureBrowser({ signal: options.signal });
  const puppeteer = await import("puppeteer-core");
  const { buildChromeArgs } = await import("@hyperframes/engine");
  const requestedGpuMode = options.browserGpuMode ?? resolveCliChromeGpuMode();
  const requiresWebGpu = compositionRequiresWebGpu(html);
  let softwareWebGpu = false;
  const launch = async (executablePath: string): Promise<Browser> => {
    options.signal?.throwIfAborted();
    const resolvedGpuMode = await resolveManagedGpuMode(requestedGpuMode, executablePath, {
      signal: options.signal,
      onBrowser: options.onBrowser,
      noListen,
    });
    options.signal?.throwIfAborted();
    const webGpu = resolveLocalWebGpu(resolvedGpuMode, requiresWebGpu);
    softwareWebGpu = webGpu.softwareWebGpu;
    const args = buildChromeArgs(
      { ...viewport, captureMode: "screenshot", requiresWebGpu },
      webGpu.gpuConfig,
    );
    return launchManagedBrowser(puppeteer.default, {
      headless: true,
      signal: options.signal,
      executablePath,
      ...(noListen ? oneProcessOverPipe({ args }) : { args }),
    });
  };

  let chromeBrowser: Browser;
  try {
    chromeBrowser = await launch(browser.executablePath);
  } catch (launchError) {
    const message = normalizeErrorMessage(launchError);
    const remediation = windowsChromeCrashRemediation(message);
    if (!remediation) throw launchError;

    const systemBrowser =
      browser.source === "cache" || browser.source === "download" ? findSystemBrowser() : undefined;
    if (!systemBrowser || systemBrowser.executablePath === browser.executablePath) {
      throw new Error(`${message}\n\n${remediation}`, { cause: launchError });
    }

    console.warn(
      `[hyperframes] Managed chrome-headless-shell crashed at launch; retrying once with system Chrome at ${systemBrowser.executablePath}.`,
    );
    try {
      chromeBrowser = await launch(systemBrowser.executablePath);
    } catch (fallbackError) {
      throw new Error(
        `System Chrome fallback also failed: ${normalizeErrorMessage(fallbackError)}\n\n${remediation}`,
        { cause: fallbackError },
      );
    }
  }
  return { browser: chromeBrowser, softwareWebGpu };
}

// Serialized into the page; the seek-target cascade must stay one function.
// fallow-ignore-next-line complexity
export function seekInPage(
  t: number,
  fallbackToBridgeAndTimelines: boolean,
  exactTime: boolean,
  skipDraws: boolean,
): void {
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
  const gsap = Reflect.get(window, "gsap");
  const ticker = getProperty(gsap, "ticker");

  // fallow-ignore-next-line complexity
  const seekTo = (time: number): void => {
    // Prefer renderSeek because it also runs the runtime's data-start/data-duration
    // visibility sync; raw timeline seeks leave off-window clips visible to audits.
    if (call(renderSeek, player, exactTime ? [time, { exact: true }] : [time])) {
      // Preferred runtime target handled the seek.
    } else if (fallbackToBridgeAndTimelines && call(bridgeSeek, hf, [time])) {
      // Producer bridge handled the seek.
    } else if (call(playerSeek, player, [time])) {
      // Legacy player target handled the seek.
    } else if (fallbackToBridgeAndTimelines) {
      const timelines = Reflect.get(window, "__timelines");
      if (typeof timelines === "object" && timelines !== null) {
        for (const key of Object.keys(timelines)) {
          const timeline = Reflect.get(timelines, key);
          call(getProperty(timeline, "pause"), timeline, []);
          call(getProperty(timeline, "seek"), timeline, [time]);
        }
      }
    }
    call(getProperty(ticker, "tick"), ticker, []);
  };

  const gateSlot = Symbol.for("hyperframes.webglDrawGate");
  let gate = Reflect.get(window, gateSlot) as { skip: boolean; skipped: boolean } | undefined;
  if (skipDraws && !gate) {
    const installed = { skip: false, skipped: false };
    for (const name of ["WebGLRenderingContext", "WebGL2RenderingContext"]) {
      const proto = getProperty(Reflect.get(window, name), "prototype");
      if (!proto) continue;
      for (const method of [
        "clear",
        "drawArrays",
        "drawElements",
        "drawArraysInstanced",
        "drawElementsInstanced",
        "drawRangeElements",
        "blitFramebuffer",
      ]) {
        const draw = getProperty(proto, method);
        if (typeof draw !== "function") continue;
        Reflect.set(proto, method, function (this: unknown, ...args: unknown[]) {
          if (!installed.skip) return Reflect.apply(draw, this, args);
          installed.skipped = true;
          return undefined;
        });
      }
    }
    Reflect.set(window, gateSlot, installed);
    gate = installed;
  }
  const seekWithoutDraws = (time: number): void => {
    if (!gate) return seekTo(time);
    gate.skip = true;
    try {
      seekTo(time);
    } finally {
      gate.skip = false;
    }
  };

  if (skipDraws) {
    seekWithoutDraws(safe);
    return;
  }
  // A skipped draw left the canvas stale and a same-time seek redraws nothing: step off first.
  if (gate?.skipped) {
    seekWithoutDraws(safe >= 0.001 ? safe - 0.001 : safe + 0.001);
    gate.skipped = false;
  }
  seekTo(safe);
}

export async function seekCompositionTimeline(
  page: CompositionSeekPage,
  timeSeconds: number,
  options: SeekCompositionTimelineOptions = {},
): Promise<void> {
  await seekCompositionTimelineOnly(page, timeSeconds, options);
  await settleCompositionSeek(page, options);
}

/** The seek alone; `settleCompositionSeek` must follow, which is what finishes a blurred frame. */
export async function seekCompositionTimelineOnly(
  page: CompositionSeekPage,
  timeSeconds: number,
  options: SeekCompositionTimelineOptions = {},
): Promise<void> {
  if (options.waitForPreferredSeekTargetMs !== undefined) {
    await waitForPreferredSeekTarget(page, options.waitForPreferredSeekTargetMs);
  }

  await page.evaluate(
    seekInPage,
    timeSeconds,
    options.fallbackToBridgeAndTimelines === true,
    options.exactTime === true,
    options.skipWebglDraws === true,
  );
}

export async function settleCompositionSeek(
  page: CompositionSeekPage,
  options: SeekCompositionTimelineOptions = {},
): Promise<UnsettledImages> {
  await page.evaluate(
    async (barrier: SeekBarrierOptions) => {
      const waitForCompletion = Reflect.get(window, "__hfWaitForSeekCompletion");
      if (typeof waitForCompletion === "function") {
        await Reflect.apply(waitForCompletion, window, [barrier]);
      }
    },
    { videoFrames: options.waitForVideoFrames !== false },
  );

  const animationFrameSettle = options.animationFrameSettle ?? "race";
  const waitForFontsMs = options.waitForFontsMs ?? DEFAULT_POST_SEEK_FONT_WAIT_MS;
  if (animationFrameSettle === "race") {
    await page.evaluate(`new Promise(function(r) {
      var settled = false;
      function finish() { if (settled) return; settled = true; r(); }
      window.setTimeout(finish, 100);
      requestAnimationFrame(function() { requestAnimationFrame(finish); });
    })`);
  } else if (animationFrameSettle === "double" && !(waitForFontsMs > 0)) {
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
  if (waitForFontsMs > 0) {
    await waitForCompositionFonts(page, waitForFontsMs, animationFrameSettle === "double" ? 2 : 1);
  }
  const images = options.waitForImagesMs
    ? await waitForCompositionImages(page, options.waitForImagesMs)
    : ALL_IMAGES_SETTLED;
  if (options.settleMs !== undefined) {
    const settleMs = Math.max(0, options.settleMs);
    await new Promise((resolveSettle) => setTimeout(resolveSettle, settleMs));
  }
  return images;
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

/** Waits, up to `timeoutMs`, for every visible image layer (<img>, SVG <image>, CSS background-image url) to decode. */
async function waitForCompositionImages(
  page: CompositionEvaluationPage,
  timeoutMs: number,
): Promise<UnsettledImages> {
  const unsettled = await page.evaluate(
    // fallow-ignore-next-line complexity
    async (ms: number) => {
      const layers = new Map<string, HTMLImageElement>();
      const add = (src: string, image?: HTMLImageElement): void => {
        if (src && !layers.has(src)) layers.set(src, image ?? Object.assign(new Image(), { src }));
      };
      const absolute = (href: string): string => new URL(href, document.baseURI).href;
      for (const element of document.querySelectorAll("*")) {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (element instanceof HTMLImageElement) add(element.currentSrc || element.src, element);
        if (element instanceof SVGImageElement && element.href.baseVal) {
          add(absolute(element.href.baseVal));
        }
        for (const match of style.backgroundImage.matchAll(
          /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g,
        )) {
          const href = match[1] ?? match[2] ?? match[3];
          if (href) add(absolute(href));
        }
      }
      const state = new Map<string, "pending" | "ready" | "failed">();
      const decodes = [...layers].map(([src, image]) => {
        state.set(src, "pending");
        return image.decode().then(
          () => void state.set(src, "ready"),
          () => void state.set(src, "failed"),
        );
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.all(decodes),
        new Promise((resolveWait) => {
          timer = setTimeout(resolveWait, ms);
        }),
      ]);
      clearTimeout(timer);
      const named = (want: string): string[] =>
        [...state]
          .filter(([, value]) => value === want)
          .map(([src]) => (src.startsWith("data:") ? `${src.slice(0, 40)}...` : src));
      return { pending: named("pending"), failed: named("failed") };
    },
    timeoutMs,
  );
  return unsettled as UnsettledImages;
}

export async function waitForCompositionFonts(
  page: CompositionEvaluationPage,
  timeoutMs: number,
  frames = 1,
): Promise<void> {
  await page
    .evaluate(
      ({ ms, frames: count }: FontWaitOptions) => {
        const fonts = Reflect.get(document, "fonts");
        // A seek can reveal glyphs whose unicode-range font subsets never loaded, and `fonts.ready`
        // resolves before their load starts (blank CJK glyphs in snapshots). Force layout so they start,
        // let the loader flip `fonts.status` over the given frames, then await readiness.
        void document.body?.offsetHeight;
        const afterFrames = (left: number, then: () => void): void => {
          requestAnimationFrame(() => (left > 1 ? afterFrames(left - 1, then) : then()));
        };
        return new Promise<void>((resolveWait) => {
          const deadline = setTimeout(resolveWait, ms);
          afterFrames(count, () => {
            const status = fonts ? Reflect.get(fonts, "status") : undefined;
            const ready = fonts ? Reflect.get(fonts, "ready") : undefined;
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
      },
      { ms: timeoutMs, frames },
    )
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
    const ff = spawn(ffmpegPath, args, { windowsHide: true });
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

/** Requests to the in-process origin are answered here; any other request goes on as usual. */
async function answerPageInProcess(
  page: Page,
  url: string,
  answer: (request: InProcessRequest) => Promise<InProcessResponse>,
): Promise<void> {
  const origin = new URL(url).origin;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.isInterceptResolutionHandled()) return;
    const target = new URL(request.url());
    if (target.origin !== origin) return void request.continue().catch(() => {});
    answer({
      method: request.method(),
      path: target.pathname + target.search,
      headers: request.headers(),
    })
      .then((response) => request.respond(response))
      .catch(() => request.abort("failed").catch(() => {}));
  });
}
