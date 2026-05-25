/**
 * Frame Capture Service
 *
 * Uses Puppeteer to capture frames from any web page implementing the
 * window.__hf seek protocol. Navigates to a file server URL, waits for
 * the page to expose window.__hf, then captures frames deterministically
 * via Chrome's BeginFrame API or Page.captureScreenshot fallback.
 */

import { type Browser, type Page, type Viewport, type ConsoleMessage } from "puppeteer-core";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { quantizeTimeToFrame, fpsToNumber } from "@hyperframes/core";

// ── Extracted modules ───────────────────────────────────────────────────────
import {
  acquireBrowser,
  releaseBrowser,
  forceReleaseBrowser,
  buildChromeArgs,
  resolveBrowserGpuMode,
  resolveHeadlessShellPath,
  type CaptureMode,
} from "./browserManager.js";
import {
  beginFrameCapture,
  getCdpSession,
  pageScreenshotCapture,
  initTransparentBackground,
} from "./screenshotService.js";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";
import type {
  CaptureOptions,
  CaptureVideoMetadataHint,
  CaptureResult,
  CaptureBufferResult,
  CapturePerfSummary,
} from "../types.js";

export type { CaptureOptions, CaptureResult, CaptureBufferResult, CapturePerfSummary };

/** Called after seeking, before screenshot. Use for video frame injection or other pre-capture work. */
export type BeforeCaptureHook = (page: Page, time: number) => Promise<void>;

export interface CaptureSession {
  browser: Browser;
  page: Page;
  options: CaptureOptions;
  serverUrl: string;
  outputDir: string;
  onBeforeCapture: BeforeCaptureHook | null;
  isInitialized: boolean;
  // Tracks whether the page/browser handles have already been released by
  // closeCaptureSession. Used to make closeCaptureSession idempotent under
  // browser-pool semantics (see the function body for the full invariant).
  pageReleased?: boolean;
  browserReleased?: boolean;
  browserConsoleBuffer: string[];
  capturePerf: {
    frames: number;
    seekMs: number;
    beforeCaptureMs: number;
    screenshotMs: number;
    totalMs: number;
  };
  captureMode: CaptureMode;
  // BeginFrame state
  beginFrameTimeTicks: number;
  beginFrameIntervalMs: number;
  beginFrameHasDamageCount: number;
  beginFrameNoDamageCount: number;
  /** Optional producer config — when set, overrides module-level env var constants. */
  config?: Partial<EngineConfig>;
}

// Circular buffer for browser console messages dumped on render failure diagnostics.
// Complex compositions produce 100+ messages; 50 was too small to capture relevant errors.
const BROWSER_CONSOLE_BUFFER_SIZE = 200;
const CAPTURE_SESSION_CLOSE_TIMEOUT_MS = 5_000;

/**
 * Fixed warmup-loop iteration count used when `CaptureOptions.lockWarmupTicks`
 * is `true`. Picked to roughly match the median tick count observed by the
 * unlocked wall-clock loop during a typical 2s page load at 30fps — so
 * `beginFrameTimeTicks` lands in a similar range regardless of host speed.
 */
export const LOCKED_WARMUP_TICKS = 60;

/**
 * Internal driver for the BeginFrame warmup loop.
 *
 *   - Unlocked: exits as soon as `state.running` flips to `false`. Tick count
 *     varies with wall-clock page-load time.
 *   - Locked: ignores `state.running` entirely and exits once it has driven
 *     exactly `LOCKED_WARMUP_TICKS` iterations. Caller awaits this promise
 *     after page-readiness so `session.beginFrameTimeTicks` is identical
 *     across hosts.
 *   - `tick` errors are swallowed (Chrome's `beginFrame` is best-effort
 *     during page load — the page hasn't installed CDP listeners yet). When
 *     `tick` throws, the iteration count does NOT advance.
 *
 * `intervalMs` is the BeginFrame interval (≈33ms at 30fps).
 *
 * `frameTimeTicks` is derived as `ticks * intervalMs` and exposed via
 * {@link warmupFrameTimeTicks} — not stored on the state, to keep `ticks`
 * the single source of truth.
 */
export interface WarmupTickState {
  running: boolean;
  ticks: number;
}

export interface WarmupTickOptions {
  intervalMs: number;
  lockWarmupTicks: boolean;
  tick: (frameTimeTicks: number, intervalMs: number) => Promise<void>;
  /** Injectable so tests can advance "time" without real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Derive the current simulated frame time from a warmup state. Single source
 * of truth so tests and callers stay in sync.
 */
export function warmupFrameTimeTicks(state: WarmupTickState, intervalMs: number): number {
  return state.ticks * intervalMs;
}

export async function driveWarmupTicks(
  options: WarmupTickOptions,
  state: WarmupTickState,
): Promise<void> {
  const sleep = options.sleep ?? realSleep;
  while (true) {
    if (options.lockWarmupTicks) {
      // Locked mode exits on the iteration count, ignoring `state.running` —
      // the caller flips `running=false` after page-readiness but we keep
      // ticking until LOCKED_WARMUP_TICKS so the count is host-independent.
      if (state.ticks >= LOCKED_WARMUP_TICKS) return;
    } else {
      // Unlocked mode is wall-clock-bounded.
      if (!state.running) return;
    }
    try {
      await options.tick(state.ticks * options.intervalMs, options.intervalMs);
      state.ticks += 1;
    } catch {
      // Page not ready yet; keep spinning.
    }
    await sleep(options.intervalMs);
  }
}

async function waitForCloseWithTimeout(promise: Promise<unknown>): Promise<boolean> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    promise.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, CAPTURE_SESSION_CLOSE_TIMEOUT_MS);
    }),
  ]);
  if (timer) clearTimeout(timer);
  return !timedOut;
}

export async function createCaptureSession(
  serverUrl: string,
  outputDir: string,
  options: CaptureOptions,
  onBeforeCapture: BeforeCaptureHook | null = null,
  config?: Partial<EngineConfig>,
): Promise<CaptureSession> {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  // Determine capture mode before building args — BeginFrame flags only apply on Linux.
  // BeginFrame's compositor does not preserve alpha; callers that pass
  // `options.format === "png"` for transparent capture should also set
  // `config.forceScreenshot = true` (the producer's renderOrchestrator does this
  // automatically when `RenderConfig.format` is an alpha-capable value).
  const headlessShell = resolveHeadlessShellPath(config);
  const isLinux = process.platform === "linux";
  const forceScreenshot = config?.forceScreenshot ?? DEFAULT_CONFIG.forceScreenshot;
  // BeginFrame's screenshot does not honor a viewport `deviceScaleFactor`
  // (the captured surface is sized by the OS window in CSS pixels regardless
  // of `Emulation.setDeviceMetricsOverride`'s DPR). When supersampling we
  // need explicit clip+scale on `Page.captureScreenshot`, so fall back to
  // the screenshot path for any DPR > 1.
  const supersampling = (options.deviceScaleFactor ?? 1) > 1;
  const preMode: CaptureMode =
    headlessShell && isLinux && !forceScreenshot && !supersampling ? "beginframe" : "screenshot";
  const requestedGpuMode = config?.browserGpuMode ?? DEFAULT_CONFIG.browserGpuMode;
  const resolvedGpuMode = await resolveBrowserGpuMode(requestedGpuMode, {
    chromePath: headlessShell ?? undefined,
    browserTimeout: config?.browserTimeout,
  });
  const chromeArgs = buildChromeArgs(
    { width: options.width, height: options.height, captureMode: preMode },
    { ...config, browserGpuMode: resolvedGpuMode },
  );

  const { browser, captureMode } = await acquireBrowser(chromeArgs, config);

  const page = await browser.newPage();
  // Polyfill esbuild's keepNames helper inside the page.
  //
  // The engine is published as raw TypeScript (`packages/engine/package.json`
  // points `main`/`exports` at `./src/index.ts`) and downstream consumers
  // execute it through transpilers that may inject `__name(fn, "name")`
  // wrappers around named functions. Empirically, this happens with:
  //   - tsx (its esbuild loader runs with keepNames=true), used by the
  //     producer's parity-harness, ad-hoc dev scripts, and the
  //     `bun run --filter @hyperframes/engine test` Vitest path.
  //   - any tsup/esbuild build that explicitly enables keepNames.
  //
  // The HeyGen CLI (`packages/cli`) bundles this engine via tsup with
  // keepNames left at its default (false) — verified by grepping
  // `packages/cli/dist/cli.js`, where `__name(...)` call sites are absent.
  // Bun's TS loader also does not currently inject `__name`. Even so,
  // anything that calls `page.evaluate(fn)` with a nested named function
  // under tsx (most local development and tests) will serialize bodies
  // like `__name(nested,"nested")` and crash with `__name is not defined`
  // in the browser. The shim makes such calls a no-op.
  //
  // An alternative is to load browser-side code as raw text and inject it
  // via `page.addScriptTag({ content: ... })` — see
  // `packages/cli/src/commands/contrast-audit.browser.js` for that pattern.
  // Until every `page.evaluate(fn)` call site migrates, this polyfill is
  // the single line of defense. The companion regression test in
  // `frameCapture-namePolyfill.test.ts` verifies the shim stays wired up.
  await page.evaluateOnNewDocument(() => {
    const w = window as unknown as { __name?: <T>(fn: T, _name: string) => T };
    if (typeof w.__name !== "function") {
      w.__name = <T>(fn: T, _name: string): T => fn;
    }
  });
  // Inject render-time variable overrides before any page script runs, so the
  // runtime helper `getVariables()` returns the merged result on its first
  // call. Pass the JSON string and parse inside the page so we don't require
  // any JSON-incompatible value to round-trip through Puppeteer's serializer.
  if (options.variables && Object.keys(options.variables).length > 0) {
    const variablesJson = JSON.stringify(options.variables);
    await page.evaluateOnNewDocument((json: string) => {
      type WindowWithVariables = Window & { __hfVariables?: Record<string, unknown> };
      try {
        (window as WindowWithVariables).__hfVariables = JSON.parse(json);
      } catch {
        // The CLI validated the JSON before this point — a parse failure here
        // means the page swapped JSON.parse, which is the page's problem.
      }
    }, variablesJson);
  }
  const browserVersion = await browser.version();
  const expectedMajor = config?.expectedChromiumMajor;
  if (Number.isFinite(expectedMajor)) {
    const actualChromiumMajor = Number.parseInt(
      (browserVersion.match(/(\d+)\./) || [])[1] || "",
      10,
    );
    if (Number.isFinite(actualChromiumMajor) && actualChromiumMajor !== expectedMajor) {
      throw new Error(
        `[FrameCapture] Chromium major mismatch expected=${expectedMajor} actual=${actualChromiumMajor} raw=${browserVersion}`,
      );
    }
  }
  const viewport: Viewport = {
    width: options.width,
    height: options.height,
    deviceScaleFactor: options.deviceScaleFactor || 1,
  };
  await page.setViewport(viewport);

  // Transparent-background setup is intentionally NOT done here. Chrome resets
  // the default-background-color override on navigation, and the
  // `[data-composition-id]{background:transparent}` stylesheet that
  // `initTransparentBackground` injects must land in a real `document.head`.
  // See `initializeSession()` below — it calls `initTransparentBackground` for
  // PNG captures after `page.goto(...)` and the `window.__hf` readiness poll.

  return {
    browser,
    page,
    options,
    serverUrl,
    outputDir,
    onBeforeCapture,
    isInitialized: false,
    browserConsoleBuffer: [],
    capturePerf: {
      frames: 0,
      seekMs: 0,
      beforeCaptureMs: 0,
      screenshotMs: 0,
      totalMs: 0,
    },
    captureMode,
    beginFrameTimeTicks: 0,
    // Frame interval in ms: 1000 * den / num. For 30/1 → 33.333…, for
    // 30000/1001 (NTSC) → 33.366…. JavaScript number precision is fine at
    // these scales — no rounding required.
    beginFrameIntervalMs: (1000 * options.fps.den) / Math.max(1, options.fps.num),
    beginFrameHasDamageCount: 0,
    beginFrameNoDamageCount: 0,
    config,
  };
}

/**
 * Classify a console "Failed to load resource" error as a font-load failure.
 *
 * These are expected when deterministic font injection replaces Google Fonts
 * @import URLs with embedded base64 — or when the render environment has no
 * network access to Google Fonts. Suppressing them reduces noise in render
 * output without hiding real asset failures (images, videos, scripts, etc.).
 *
 * Chrome's `msg.text()` for a failed resource is typically just
 * `"Failed to load resource: net::ERR_FAILED"` — the URL is only on
 * `msg.location().url`. We match against both so the filter works regardless
 * of which form Chrome emits.
 */
export function isFontResourceError(type: string, text: string, locationUrl: string): boolean {
  if (type !== "error") return false;
  if (!text.startsWith("Failed to load resource")) return false;
  return /fonts\.googleapis|fonts\.gstatic|\.(woff2?|ttf|otf)(\b|$)/i.test(
    `${locationUrl} ${text}`,
  );
}

async function pollPageExpression(
  page: Page,
  expression: string,
  timeoutMs: number,
  intervalMs: number = 100,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = Boolean(await page.evaluate(expression));
    if (ready) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return Boolean(await page.evaluate(expression));
}

async function pollSubCompositionTimelines(
  page: Page,
  timeoutMs: number,
  intervalMs: number = 150,
): Promise<void> {
  const expression = `(function() {
    var hosts = document.querySelectorAll("[data-composition-id]");
    if (hosts.length === 0) return true;
    var timelines = window.__timelines || {};
    for (var i = 0; i < hosts.length; i++) {
      var id = hosts[i].getAttribute("data-composition-id");
      if (!id) continue;
      if (!timelines[id]) return false;
    }
    return true;
  })()`;
  const ready = await pollPageExpression(page, expression, timeoutMs, intervalMs);
  // Always force a timeline rebind once sub-composition timelines are
  // confirmed present. The previous implementation only called rebind
  // when the timeline count grew during the poll, which missed the case
  // where all sub-comp scripts had already executed before the poll
  // started — leaving child timelines un-nested in the root and causing
  // the earliest sub-composition (data-start near 0) to render without
  // its GSAP animations.
  if (ready) {
    await page.evaluate(`(function() {
      if (typeof window.__hfForceTimelineRebind === "function") {
        window.__hfForceTimelineRebind();
      }
    })()`);
  }
  if (!ready) {
    const missing = await page.evaluate(`(function() {
      var hosts = document.querySelectorAll("[data-composition-id]");
      var timelines = window.__timelines || {};
      var m = [];
      for (var i = 0; i < hosts.length; i++) {
        var id = hosts[i].getAttribute("data-composition-id");
        if (id && !timelines[id]) m.push(id);
      }
      return m.join(", ");
    })()`);
    console.warn(
      `[FrameCapture] Sub-composition timelines not registered after ${timeoutMs}ms: ${missing}. ` +
        `Compositions that load data asynchronously (e.g. fetch) must register window.__timelines[id] after setup completes.`,
    );
  }
}

async function pollVideosReady(
  page: Page,
  skipIds: readonly string[],
  timeoutMs: number,
  intervalMs: number = 100,
): Promise<boolean> {
  const check = async (): Promise<boolean> => {
    return Boolean(
      await page.evaluate((skipIdList: readonly string[]) => {
        const skip = new Set(skipIdList);
        const vids = Array.from(document.querySelectorAll("video")).filter((v) => !skip.has(v.id));
        return (
          vids.length === 0 ||
          vids.every((v) => {
            const ve = v as HTMLVideoElement;
            if (ve.readyState >= 2) return true;
            if (ve.error) return true;
            if (ve.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) return true;
            return false;
          })
        );
      }, skipIds),
    );
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return check();
}

async function applyVideoMetadataHints(
  page: Page,
  hints: readonly CaptureVideoMetadataHint[] | undefined,
): Promise<void> {
  if (!hints || hints.length === 0) return;

  await page.evaluate(
    (metadataHints: CaptureVideoMetadataHint[]) => {
      for (const hint of metadataHints) {
        if (
          !hint.id ||
          !Number.isFinite(hint.width) ||
          !Number.isFinite(hint.height) ||
          hint.width <= 0 ||
          hint.height <= 0
        ) {
          continue;
        }

        const video = document.getElementById(hint.id) as HTMLVideoElement | null;
        if (!video) continue;

        if (!video.hasAttribute("width")) video.setAttribute("width", String(hint.width));
        if (!video.hasAttribute("height")) video.setAttribute("height", String(hint.height));

        const computed = window.getComputedStyle(video);
        if (
          !video.style.aspectRatio &&
          (!computed.aspectRatio || computed.aspectRatio === "auto")
        ) {
          video.style.aspectRatio = `${hint.width} / ${hint.height}`;
        }
      }
    },
    [...hints],
  );
}

async function waitForOptionalTailwindReady(page: Page, timeoutMs: number): Promise<void> {
  const hasTailwindReady = await page.evaluate(
    `(() => { const ready = window.__tailwindReady; return !!ready && typeof ready.then === "function"; })()`,
  );
  if (!hasTailwindReady) return;

  const ready = await Promise.race([
    page.evaluate(
      `Promise.resolve(window.__tailwindReady).then(() => true, () => false)`,
    ) as Promise<boolean>,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);

  if (!ready) {
    throw new Error(
      `[FrameCapture] window.__tailwindReady not resolved after ${timeoutMs}ms. Tailwind browser runtime must finish before frame capture starts.`,
    );
  }
}

export async function initializeSession(session: CaptureSession): Promise<void> {
  const { page, serverUrl } = session;

  // Forward browser console to host with [Browser] prefix
  page.on("console", (msg: ConsoleMessage) => {
    const type = msg.type();
    const text = msg.text();
    const locationUrl = msg.location()?.url ?? "";
    const isFontLoadError = isFontResourceError(type, text, locationUrl);

    // Other "Failed to load resource" 404s are typically non-blocking (e.g.
    // favicon, sourcemaps, optional assets). Prefix them so users know they
    // are harmless and don't confuse them with real render errors.
    const isResourceLoadError =
      type === "error" && text.startsWith("Failed to load resource") && !isFontLoadError;

    const prefix = isResourceLoadError
      ? "[non-blocking]"
      : type === "error"
        ? "[Browser:ERROR]"
        : type === "warn"
          ? "[Browser:WARN]"
          : "[Browser]";
    if (!isFontLoadError) {
      console.log(`${prefix} ${text}`);
    }

    session.browserConsoleBuffer.push(`${prefix} ${text}`);
    if (session.browserConsoleBuffer.length > BROWSER_CONSOLE_BUFFER_SIZE) {
      session.browserConsoleBuffer.shift();
    }
  });

  page.on("pageerror", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    const text = `[Browser:PAGEERROR] ${message}`;

    // Benign play/pause race during frame capture — suppress terminal noise, keep in buffer.
    const isPlayAbort =
      /^AbortError:/.test(message) && message.includes("play()") && message.includes("pause()");
    if (!isPlayAbort) {
      console.error(text);
    }

    session.browserConsoleBuffer.push(text);
    if (session.browserConsoleBuffer.length > BROWSER_CONSOLE_BUFFER_SIZE) {
      session.browserConsoleBuffer.shift();
    }
  });

  // Navigate to the file server
  const url = `${serverUrl}/index.html`;
  if (session.captureMode === "screenshot") {
    // Screenshot mode: standard navigation, rAF works normally
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    const pageReadyTimeout =
      session.config?.playerReadyTimeout ?? DEFAULT_CONFIG.playerReadyTimeout;
    const pageReady = await pollPageExpression(
      page,
      `!!(window.__hf && typeof window.__hf.seek === "function" && window.__hf.duration > 0)`,
      pageReadyTimeout,
    );
    if (!pageReady) {
      throw new Error(
        `[FrameCapture] window.__hf not ready after ${pageReadyTimeout}ms. Page must expose window.__hf = { duration, seek }.`,
      );
    }

    await pollSubCompositionTimelines(page, pageReadyTimeout);

    await applyVideoMetadataHints(page, session.options.videoMetadataHints);

    // Wait for all video elements to have decoded their CURRENT frame, not
    // just metadata. readyState >= 2 (HAVE_CURRENT_DATA) means a frame is
    // actually rasterized and ready to paint — at >= 1 (HAVE_METADATA) we
    // only know the dimensions, and the first <video> screenshot can come
    // back as a black/blank rectangle. This bites compositions with two
    // <video> elements of different codecs (h264 mp4 + VP9 webm) where the
    // faster decoder lets the readiness check pass while the slower one
    // hasn't painted, producing a black "first frame" for the slower clip.
    // skipReadinessVideoIds excludes natively-extracted videos (e.g. HDR HEVC
    // sources) whose frames come from ffmpeg out-of-band. videoMetadataHints
    // supply intrinsic dimensions for skipped videos whose layout depends on
    // aspect ratio, while Chromium may still fail to decode/load metadata.
    const videosReady = await pollVideosReady(
      page,
      session.options.skipReadinessVideoIds ?? [],
      pageReadyTimeout,
    );
    if (!videosReady) {
      const failedVideos = await page.evaluate((skipIdList: readonly string[]) => {
        const skip = new Set(skipIdList);
        return Array.from(document.querySelectorAll("video"))
          .filter((v) => !skip.has(v.id))
          .filter((v) => (v as HTMLVideoElement).readyState < 2 && !(v as HTMLVideoElement).error)
          .map((v) => (v as HTMLVideoElement).src || v.getAttribute("src") || "(no src)")
          .join(", ");
      }, session.options.skipReadinessVideoIds ?? []);
      console.warn(
        `[FrameCapture] Some video elements did not decode within ${pageReadyTimeout}ms: ${failedVideos}. ` +
          `Continuing render — affected videos will appear as blank/black frames.`,
      );
    }

    await page.evaluate(`document.fonts?.ready`);
    await waitForOptionalTailwindReady(page, pageReadyTimeout);

    // For PNG captures, force the page background fully transparent so the
    // captured screenshots carry a real alpha channel. Must run AFTER
    // navigation (Chrome resets the override on every goto) and AFTER the
    // page is loaded (the injected stylesheet needs a real document.head).
    // The override is overridden by `body { background: ... }` and
    // `#root { background: ... }` rules — the helper handles that with a
    // `[data-composition-id]{background:transparent !important}` injection.
    if (session.options.format === "png") {
      await initTransparentBackground(session.page);
    }

    session.isInitialized = true;
    return;
  }

  // In BeginFrame mode, Chrome's event loop is paused until we issue frames.
  // Start a warmup loop to drive rAF/setTimeout callbacks during page load.
  //
  // The unlocked path runs while `warmupState.running` stays true — wall-
  // clock-bounded. The locked path (`options.lockWarmupTicks`) additionally
  // exits at exactly `LOCKED_WARMUP_TICKS` iterations so `beginFrameTimeTicks`
  // is deterministic across hosts with different page-load latencies.
  const warmupIntervalMs = 33; // ~30fps
  const warmupState: WarmupTickState = {
    running: true,
    ticks: 0,
  };
  const lockWarmupTicks = session.options.lockWarmupTicks === true;
  let warmupClient: import("puppeteer-core").CDPSession | null = null;

  const acquireWarmupClient = async (): Promise<void> => {
    try {
      warmupClient = await getCdpSession(page);
      await warmupClient.send("HeadlessExperimental.enable");
    } catch {
      /* page not ready yet */
    }
  };

  const warmupLoopPromise = (async () => {
    await acquireWarmupClient();
    await driveWarmupTicks(
      {
        intervalMs: warmupIntervalMs,
        lockWarmupTicks,
        tick: async (frameTimeTicks, interval) => {
          if (!warmupClient) {
            // No CDP yet — let driveWarmupTicks count the tick anyway so the
            // locked iteration count is reached deterministically. Throwing
            // would skip the ticks++ increment, leaking host-load variance
            // back into the count.
            return;
          }
          await warmupClient.send("HeadlessExperimental.beginFrame", {
            frameTimeTicks,
            interval,
            noDisplayUpdates: true,
          });
        },
      },
      warmupState,
    );
  })();
  warmupLoopPromise.catch(() => {});

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Poll for window.__hf readiness using manual evaluate loop (waitForFunction
  // uses rAF polling internally, which won't fire in beginFrame mode).
  const pageReadyTimeout = session.config?.playerReadyTimeout ?? DEFAULT_CONFIG.playerReadyTimeout;
  const pollDeadline = Date.now() + pageReadyTimeout;
  while (Date.now() < pollDeadline) {
    const ready = await page.evaluate(
      `!!(window.__hf && typeof window.__hf.seek === "function" && window.__hf.duration > 0)`,
    );
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const pageReady = await page.evaluate(
    `!!(window.__hf && typeof window.__hf.seek === "function" && window.__hf.duration > 0)`,
  );
  if (!pageReady) {
    warmupState.running = false;
    throw new Error(
      `[FrameCapture] window.__hf not ready after ${pageReadyTimeout}ms. Page must expose window.__hf = { duration, seek }.`,
    );
  }

  await pollSubCompositionTimelines(page, pageReadyTimeout);

  await applyVideoMetadataHints(page, session.options.videoMetadataHints);

  // Same readyState contract as the screenshot path above (>= 2 / HAVE_CURRENT_DATA).
  const bfVideosReady = await pollVideosReady(
    page,
    session.options.skipReadinessVideoIds ?? [],
    session.config?.playerReadyTimeout ?? DEFAULT_CONFIG.playerReadyTimeout,
  );
  if (!bfVideosReady) {
    const failedVideos = await page.evaluate((skipIdList: readonly string[]) => {
      const skip = new Set(skipIdList);
      return Array.from(document.querySelectorAll("video"))
        .filter((v) => !skip.has(v.id))
        .filter((v) => (v as HTMLVideoElement).readyState < 2 && !(v as HTMLVideoElement).error)
        .map((v) => (v as HTMLVideoElement).src || v.getAttribute("src") || "(no src)")
        .join(", ");
    }, session.options.skipReadinessVideoIds ?? []);
    console.warn(
      `[FrameCapture] Some video elements did not decode within ${pageReadyTimeout}ms: ${failedVideos}. ` +
        `Continuing render — affected videos will appear as blank/black frames.`,
    );
  }

  // Font check (no rAF dependency — uses fonts.ready API directly)
  await page.evaluate(`document.fonts?.ready`);
  await waitForOptionalTailwindReady(page, pageReadyTimeout);

  // Stop warmup. Unlocked mode exits on this flag; locked mode keeps ticking
  // until LOCKED_WARMUP_TICKS, so we await its promise to ensure the count is
  // exact before deriving the baseline.
  warmupState.running = false;
  if (lockWarmupTicks) {
    await warmupLoopPromise.catch(() => {});
  }

  // Set base frame time ticks past warmup range. Locked mode pins to the
  // constant so chunk workers on different hosts compute the same baseline.
  const baseTickCount = lockWarmupTicks ? LOCKED_WARMUP_TICKS : warmupState.ticks;
  session.beginFrameTimeTicks = (baseTickCount + 10) * session.beginFrameIntervalMs;

  // For PNG captures, inject the transparent-background override + stylesheet
  // (see the screenshot-mode branch above for the rationale). BeginFrame mode
  // does not actually preserve alpha through its compositor — callers that
  // need transparent output should set `forceScreenshot: true` so this branch
  // is bypassed entirely. The call is left here as defense-in-depth for any
  // future BeginFrame alpha support.
  if (session.options.format === "png") {
    await initTransparentBackground(session.page);
  }

  session.isInitialized = true;
}

async function captureFrameErrorDiagnostics(
  session: CaptureSession,
  frameIndex: number,
  time: number,
  error: Error,
): Promise<string | null> {
  try {
    const diagnosticsDir = join(session.outputDir, "diagnostics");
    if (!existsSync(diagnosticsDir)) mkdirSync(diagnosticsDir, { recursive: true });
    const base = join(diagnosticsDir, `frame-error-${frameIndex}`);
    await session.page.screenshot({ path: `${base}.png`, type: "png", fullPage: true });
    const html = await session.page.content();
    writeFileSync(`${base}.html`, html, "utf-8");
    writeFileSync(
      `${base}.json`,
      JSON.stringify(
        {
          frameIndex,
          time,
          error: error.message,
          stack: error.stack,
          browserConsoleTail: session.browserConsoleBuffer.slice(-30),
        },
        null,
        2,
      ),
      "utf-8",
    );
    return `${base}.json`;
  } catch {
    return null;
  }
}

/**
 * Internal helper: seek timeline and inject video frames.
 * Shared by captureFrame (disk) and captureFrameToBuffer (buffer).
 * Returns timing breakdown for perf tracking.
 */
async function prepareFrameForCapture(
  session: CaptureSession,
  frameIndex: number,
  time: number,
): Promise<{
  quantizedTime: number;
  seekMs: number;
  beforeCaptureMs: number;
}> {
  const { page, options } = session;

  if (!session.isInitialized) {
    throw new Error("[FrameCapture] Session not initialized");
  }

  const quantizedTime = quantizeTimeToFrame(time, fpsToNumber(options.fps));

  const seekStart = Date.now();
  // Seek via the __hf protocol. The page's seek() implementation handles
  // all framework-specific logic (GSAP stepping, CSS animation sync, etc.)
  // Seek + check page-side composite pending flag in one round-trip.
  const hasPendingComposite = await page.evaluate((t: number) => {
    if (window.__hf && typeof window.__hf.seek === "function") {
      window.__hf.seek(t);
    }
    return !!(window as unknown as { __hf_page_composite_pending?: boolean })
      .__hf_page_composite_pending;
  }, quantizedTime);

  const seekMs = Date.now() - seekStart;

  // Before-capture hook (e.g. video frame injection) — runs before
  // page-side compositor clones so cloneNode picks up injected <img>
  // replacements for <video> elements.
  const beforeCaptureStart = Date.now();
  if (session.onBeforeCapture) {
    await session.onBeforeCapture(page, quantizedTime);
  }
  const beforeCaptureMs = Date.now() - beforeCaptureStart;

  // Page-side compositing three-phase protocol:
  //  1. prepare — clone scenes (now containing injected video <img>s)
  //  2. micro-screenshot — force browser to paint cloned elements
  //  3. resolve — drawElementImage reads paint records, shader composites
  if (hasPendingComposite && session.captureMode !== "beginframe") {
    await page.evaluate(async () => {
      const w = window as unknown as { __hf_page_composite_prepare?: () => Promise<boolean> };
      if (typeof w.__hf_page_composite_prepare === "function") {
        await w.__hf_page_composite_prepare();
      }
    });
    const cdp = await getCdpSession(page);
    await cdp.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 1,
      clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 },
    });
    await page.evaluate(() => {
      const w = window as unknown as { __hf_page_composite_resolve?: () => boolean };
      if (typeof w.__hf_page_composite_resolve === "function") {
        w.__hf_page_composite_resolve();
      }
    });
  }

  return { quantizedTime, seekMs, beforeCaptureMs };
}

/**
 * Internal core: prepare, screenshot, and track perf.
 * Shared by captureFrame (disk) and captureFrameToBuffer (buffer).
 * Returns the screenshot buffer, quantized time, and total capture time.
 */
async function captureFrameCore(
  session: CaptureSession,
  frameIndex: number,
  time: number,
): Promise<{ buffer: Buffer; quantizedTime: number; captureTimeMs: number }> {
  const { page, options } = session;
  const startTime = Date.now();

  try {
    const { quantizedTime, seekMs, beforeCaptureMs } = await prepareFrameForCapture(
      session,
      frameIndex,
      time,
    );

    const screenshotStart = Date.now();
    let screenshotBuffer: Buffer;

    if (session.captureMode === "beginframe") {
      const frameTimeTicks =
        session.beginFrameTimeTicks + frameIndex * session.beginFrameIntervalMs;
      const result = await beginFrameCapture(
        page,
        options,
        frameTimeTicks,
        session.beginFrameIntervalMs,
      );
      if (result.hasDamage) session.beginFrameHasDamageCount++;
      else session.beginFrameNoDamageCount++;
      screenshotBuffer = result.buffer;
    } else {
      screenshotBuffer = await pageScreenshotCapture(page, options);
    }

    const screenshotMs = Date.now() - screenshotStart;
    const captureTimeMs = Date.now() - startTime;

    session.capturePerf.frames += 1;
    session.capturePerf.seekMs += seekMs;
    session.capturePerf.beforeCaptureMs += beforeCaptureMs;
    session.capturePerf.screenshotMs += screenshotMs;
    session.capturePerf.totalMs += captureTimeMs;

    return { buffer: screenshotBuffer, quantizedTime, captureTimeMs };
  } catch (captureError) {
    if (session.isInitialized) {
      await captureFrameErrorDiagnostics(
        session,
        frameIndex,
        time,
        captureError instanceof Error ? captureError : new Error(String(captureError)),
      );
    }
    throw captureError;
  }
}

export async function captureFrame(
  session: CaptureSession,
  frameIndex: number,
  time: number,
): Promise<CaptureResult> {
  const { options, outputDir } = session;
  const { buffer, quantizedTime, captureTimeMs } = await captureFrameCore(
    session,
    frameIndex,
    time,
  );

  const ext = options.format === "png" ? "png" : "jpg";
  const frameName = `frame_${String(frameIndex).padStart(6, "0")}.${ext}`;
  const framePath = join(outputDir, frameName);
  writeFileSync(framePath, buffer);

  return { frameIndex, time: quantizedTime, path: framePath, captureTimeMs };
}

/**
 * Capture a frame and return the screenshot as a Buffer instead of writing to disk.
 * Used by the streaming encode pipeline to pipe frames directly to FFmpeg stdin.
 */
export async function captureFrameToBuffer(
  session: CaptureSession,
  frameIndex: number,
  time: number,
): Promise<CaptureBufferResult> {
  const { buffer, captureTimeMs } = await captureFrameCore(session, frameIndex, time);

  return { buffer, captureTimeMs };
}

/**
 * Type of the "inner capture" function consumed by
 * {@link discardWarmupCapture}. Matches the real `captureFrameCore` signature
 * with the buffer-bearing result trimmed to what the caller actually uses
 * (the wrapper never inspects the buffer). Exposed so unit tests can inject
 * a stub instead of driving Chrome end-to-end.
 */
export type DiscardWarmupInnerCapture = (
  session: CaptureSession,
  frameIndex: number,
  time: number,
) => Promise<{ buffer: Buffer; quantizedTime: number; captureTimeMs: number }>;

/**
 * Perform one capture, throw away the buffer, and restore any session
 * side-effects (perf counters, BeginFrame damage tallies) so downstream
 * captures see state identical to a fresh session.
 *
 * Distributed chunk workers need this because Chrome's BeginFrame screenshot
 * pipeline maintains a per-process `lastFrameCache`: when a captured frame's
 * `hasDamage` reports `false`, the screenshot path returns the previously
 * captured buffer. For chunk N (N > 0) the worker has no prior frame in its
 * cache, so the very first capture's `hasDamage` reporting diverges from
 * what an in-process render at the same absolute frame index would see (the
 * in-process renderer always has frame N-1 cached). One discard capture
 * before the first real capture primes the cache.
 *
 * The function intentionally restores perf state so the warmup capture does
 * NOT bias `getCapturePerfSummary()`'s per-frame averages.
 *
 * No file is written; the buffer is discarded.
 *
 * @param session — initialized capture session
 * @param frameIndex — frame index to warm up with (default 0). Chunk
 *   workers typically pass their chunk's first absolute frame index.
 * @param time — time in seconds (default 0). Chunk workers typically pass
 *   the corresponding `frameIndex / fps`.
 * @param innerCapture — injectable for tests; defaults to the real
 *   `captureFrameCore`.
 */
export async function discardWarmupCapture(
  session: CaptureSession,
  frameIndex: number = 0,
  time: number = 0,
  innerCapture: DiscardWarmupInnerCapture = captureFrameCore,
): Promise<void> {
  // Snapshot the side-effect counters captureFrameCore mutates. We use a
  // shallow `{...}` for capturePerf because all five fields are primitive
  // numbers — no nested state to deep-copy.
  const perfBefore = { ...session.capturePerf };
  const hasDamageBefore = session.beginFrameHasDamageCount;
  const noDamageBefore = session.beginFrameNoDamageCount;
  try {
    await innerCapture(session, frameIndex, time);
  } finally {
    // Always restore — even on error. A failed warmup capture should not
    // leak inflated perf counters into the real capture summary.
    session.capturePerf = perfBefore;
    session.beginFrameHasDamageCount = hasDamageBefore;
    session.beginFrameNoDamageCount = noDamageBefore;
  }
}

export async function closeCaptureSession(session: CaptureSession): Promise<void> {
  // INVARIANT: closeCaptureSession is idempotent. The renderOrchestrator HDR
  // cleanup path tracks a `domSessionClosed` flag and may still re-call this
  // in the outer finally if the inner cleanup raised before the flag flipped.
  //
  // Naive idempotency would be unsafe under pool semantics: releaseBrowser
  // decrements pooledBrowserRefCount, so calling it twice for the same
  // acquire could close a browser that another session still holds. We make
  // it safe by gating each release behind a per-session "released" flag —
  // the second call sees the flag already set and skips the release.
  //
  // We set the flag AFTER (not before) the await so that if a release throws
  // midway, the unreleased resource is retried by the outer defensive call.
  // Example: page release succeeds, browser release throws → pageReleased=true
  // but browserReleased=false → second call no-ops on page and retries browser.
  // This matches the orchestrator's intent for HDR cleanup.
  if (!session.pageReleased && session.page) {
    const pageClosed = await waitForCloseWithTimeout(session.page.close());
    if (!pageClosed) {
      console.warn("[FrameCapture] Timed out closing page; forcing browser process shutdown");
      forceReleaseBrowser(session.browser);
      session.browserReleased = true;
    }
    session.pageReleased = true;
  }
  if (!session.browserReleased && session.browser) {
    const browserClosed = await waitForCloseWithTimeout(
      releaseBrowser(session.browser, session.config),
    );
    if (!browserClosed) {
      console.warn("[FrameCapture] Timed out closing browser; forcing browser process shutdown");
      forceReleaseBrowser(session.browser);
    }
    session.browserReleased = true;
  }
  session.isInitialized = false;
}

export function prepareCaptureSessionForReuse(
  session: CaptureSession,
  outputDir: string,
  onBeforeCapture: BeforeCaptureHook | null,
): void {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  session.outputDir = outputDir;
  session.onBeforeCapture = onBeforeCapture;
  session.capturePerf = {
    frames: 0,
    seekMs: 0,
    beforeCaptureMs: 0,
    screenshotMs: 0,
    totalMs: 0,
  };
  session.beginFrameHasDamageCount = 0;
  session.beginFrameNoDamageCount = 0;
}

export async function getCompositionDuration(session: CaptureSession): Promise<number> {
  if (!session.isInitialized) throw new Error("[FrameCapture] Session not initialized");

  return session.page.evaluate(() => {
    return window.__hf?.duration ?? 0;
  });
}

export function getCapturePerfSummary(session: CaptureSession): CapturePerfSummary {
  const frames = Math.max(1, session.capturePerf.frames);
  return {
    frames: session.capturePerf.frames,
    avgTotalMs: Math.round(session.capturePerf.totalMs / frames),
    avgSeekMs: Math.round(session.capturePerf.seekMs / frames),
    avgBeforeCaptureMs: Math.round(session.capturePerf.beforeCaptureMs / frames),
    avgScreenshotMs: Math.round(session.capturePerf.screenshotMs / frames),
  };
}
