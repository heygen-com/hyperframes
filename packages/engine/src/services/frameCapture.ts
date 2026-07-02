// fallow-ignore-file complexity
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
  shouldDefaultCaptureBeyondViewport,
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
  /**
   * Static-frame dedup (default-on; opt out with `HF_STATIC_DEDUP=false`): indices of frames byte-identical
   * to their predecessor (no GSAP tween / clip cut active in either), predicted from
   * window.__timelines and empirically anchor-verified. These reuse `lastFrameBuffer`
   * instead of re-seeking + re-screenshotting. Undefined when disabled or ineligible.
   */
  staticFrames?: Set<number>;
  /** Last non-deduped frame buffer, reused for every `staticFrames` index in its run. */
  lastFrameBuffer?: Buffer;
  /** Count of frames served from a reused buffer (dedup telemetry). */
  staticDedupCount?: number;
  // ── Static-dedup observability (set by armStaticDedup; surfaced via
  // getCapturePerfSummary → RenderPerfSummary → the render_complete event) ──
  // NOTE: `armed` and `predicted` are NOT stored — they derive from
  // `staticFrames` (armed ⟺ non-empty set; predicted === size) in
  // getCapturePerfSummary, so they can't desync from the actual reuse set.
  /** Dedup was enabled for this render (default-on; opt out with `HF_STATIC_DEDUP=false`). */
  staticDedupEnabled?: boolean;
  /**
   * Short machine code for WHY dedup did not arm, for a low-cardinality breakdown.
   * One of: `capture_mode` | `video_injection` | `page_composite` |
   * `ineligible` | `verification_failed` | `verification_budget`. Undefined when armed or disabled.
   */
  staticDedupSkipReason?: string;
  // Tracks whether the page/browser handles have already been released by
  // closeCaptureSession. Used to make closeCaptureSession idempotent under
  // browser-pool semantics (see the function body for the full invariant).
  pageReleased?: boolean;
  browserReleased?: boolean;
  browserConsoleBuffer: string[];
  initTelemetry?: {
    initDurationMs: number;
    tweenCount: number;
  };
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

function appendBrowserDiagnostic(session: CaptureSession, text: string): void {
  session.browserConsoleBuffer.push(text);
  if (session.browserConsoleBuffer.length > BROWSER_CONSOLE_BUFFER_SIZE) {
    session.browserConsoleBuffer.shift();
  }
}

async function collectSessionInitTelemetry(
  page: Page,
  initStart: number,
): Promise<{ initDurationMs: number; tweenCount: number }> {
  const initDurationMs = Date.now() - initStart;
  let tweenCount = 0;
  try {
    tweenCount = await page.evaluate(() => {
      const timelines =
        (window as unknown as { __timelines?: Record<string, unknown> }).__timelines || {};
      const seen = new Set<object>();
      let count = 0;
      for (const timeline of Object.values(timelines)) {
        const maybeTimeline = timeline as { getChildren?: unknown };
        if (typeof maybeTimeline?.getChildren !== "function") continue;
        const children = maybeTimeline.getChildren(true, true, false) as unknown[];
        for (const child of children) {
          if (child && typeof child === "object" && !seen.has(child)) {
            seen.add(child);
            count++;
          }
        }
      }
      return count;
    });
  } catch {
    tweenCount = 0;
  }
  return { initDurationMs, tweenCount };
}

async function recordSessionInitTelemetry(
  session: CaptureSession,
  initStart: number,
): Promise<void> {
  const telemetry = await collectSessionInitTelemetry(session.page, initStart);
  session.initTelemetry = telemetry;
  appendBrowserDiagnostic(
    session,
    `[FrameCapture:INIT] complete initDurationMs=${telemetry.initDurationMs} tweenCount=${telemetry.tweenCount}`,
  );
}

export function sanitizeDiagnosticUrl(input: string): string {
  if (!input) return "(empty)";
  if (input.startsWith("data:")) return "data:<redacted>";
  if (input.startsWith("blob:")) return "blob:<redacted>";
  if (input.startsWith("/")) {
    try {
      const url = new URL(input, "http://hyperframes.local");
      return url.pathname;
    } catch {
      return input;
    }
  }

  try {
    const url = new URL(input);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return input;
  }
}

export function formatNavigationFailureDiagnostic(input: {
  captureMode: CaptureMode;
  url: string;
  timeoutMs: number;
  elapsedMs: number;
  error: unknown;
}): string {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  return (
    `[FrameCapture:ERROR] page.goto failed ` +
    `mode=${input.captureMode} timeoutMs=${input.timeoutMs} elapsedMs=${input.elapsedMs} ` +
    `url=${sanitizeDiagnosticUrl(input.url)} error=${message}`
  );
}

export function formatNavigationStartDiagnostic(input: {
  captureMode: CaptureMode;
  url: string;
  timeoutMs: number;
}): string {
  return (
    `[FrameCapture:NAV] page.goto start ` +
    `mode=${input.captureMode} timeoutMs=${input.timeoutMs} ` +
    `url=${sanitizeDiagnosticUrl(input.url)}`
  );
}

export function formatRequestFailureDiagnostic(input: {
  method: string;
  resourceType: string;
  url: string;
  failureText: string;
}): string {
  return (
    `[Browser:REQUESTFAILED] ${input.method} ${sanitizeDiagnosticUrl(input.url)} ` +
    `resource=${input.resourceType} error=${input.failureText}`
  );
}

export function formatHttpErrorDiagnostic(input: {
  method: string;
  resourceType: string;
  url: string;
  status: number;
  statusText: string;
}): string {
  const statusText = input.statusText ? ` ${input.statusText}` : "";
  return (
    `[Browser:HTTP${input.status}] ${input.method} ${sanitizeDiagnosticUrl(input.url)} ` +
    `resource=${input.resourceType}${statusText}`
  );
}

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

export function resolveCaptureSessionOptions(
  options: CaptureOptions,
  browserVersion: string,
  platform: NodeJS.Platform = process.platform,
): CaptureOptions {
  return {
    ...options,
    captureBeyondViewport:
      options.captureBeyondViewport ?? shouldDefaultCaptureBeyondViewport(browserVersion, platform),
  };
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

// fallow-ignore-next-line unit-size
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
  const sessionOptions = resolveCaptureSessionOptions(options, browserVersion);
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
    width: sessionOptions.width,
    height: sessionOptions.height,
    deviceScaleFactor: sessionOptions.deviceScaleFactor || 1,
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
    options: sessionOptions,
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

export function formatConsoleDiagnostic(
  type: string,
  text: string,
  locationUrl: string,
): { text: string; suppressHostLog: boolean } {
  const isFontLoadError = isFontResourceError(type, text, locationUrl);
  if (isFontLoadError) return { text: `[Browser] ${text}`, suppressHostLog: true };

  if (text.startsWith("[hyperframes]")) {
    return {
      text: `[HyperFrames] ${text.slice("[hyperframes]".length).trim()}`,
      suppressHostLog: false,
    };
  }

  // Other "Failed to load resource" 404s are typically non-blocking (e.g.
  // favicon, sourcemaps, optional assets). Prefix them so users know they
  // are harmless and don't confuse them with real render errors.
  const isResourceLoadError = type === "error" && text.startsWith("Failed to load resource");
  const prefix = isResourceLoadError
    ? "[non-blocking]"
    : type === "error"
      ? "[Browser:ERROR]"
      : type === "warn"
        ? "[Browser:WARN]"
        : "[Browser]";

  return { text: `${prefix} ${text}`, suppressHostLog: false };
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

const HF_READY_DIAGNOSTIC_EXPR = `(function() {
  var hf = window.__hf;
  var player = window.__player;
  var renderReady = !!window.__renderReady;
  var hasSeek = !!(hf && typeof hf.seek === "function");
  var duration = hf ? hf.duration : -1;
  var hasTimeline = !!(window.__timelines && Object.keys(window.__timelines).length > 0);
  var root = document.querySelector("[data-composition-id]");
  var declaredDuration = root ? Number(root.getAttribute("data-duration")) : -1;
  return {
    renderReady: renderReady,
    hasHf: !!hf,
    hasSeek: hasSeek,
    hasPlayer: !!player,
    duration: duration,
    hasTimeline: hasTimeline,
    declaredDuration: declaredDuration,
  };
})()`;

// fallow-ignore-next-line complexity
function buildZeroDurationDiagnostic(diag: {
  renderReady: boolean;
  hasHf: boolean;
  hasSeek: boolean;
  hasPlayer: boolean;
  duration: number;
  hasTimeline: boolean;
  declaredDuration: number;
}): string {
  const hints: string[] = [];
  if (!diag.hasPlayer) {
    hints.push("window.__player was never set — the HyperFrames runtime did not initialize.");
  }
  if (!diag.hasTimeline) {
    hints.push(
      "No GSAP timeline registered (window.__timelines is empty). " +
        "CSS/WAAPI/Lottie animations are usually auto-detected (the runtime infers " +
        "duration from the longest running animation) — this composition's duration " +
        "could not be inferred, which usually means an infinite/unbounded animation " +
        "(e.g. animation-iteration-count: infinite, repeat: -1 WAAPI, or a looping Lottie " +
        "clip) or a Three.js scene with no discoverable AnimationClip.",
    );
  }
  if (diag.declaredDuration <= 0 && !diag.hasTimeline) {
    hints.push(
      'Fix: add data-duration="<seconds>" to your root <div data-composition-id="..."> element.',
    );
  }
  if (diag.hasSeek && diag.duration === 0 && diag.renderReady) {
    hints.push("The runtime finished initializing but reported zero duration — this is permanent.");
  }
  return (
    `[FrameCapture] Composition has zero duration.\n` +
    `  Runtime ready: ${diag.renderReady}, __player: ${diag.hasPlayer}, ` +
    `__hf.seek: ${diag.hasSeek}, GSAP timeline: ${diag.hasTimeline}, ` +
    `data-duration: ${diag.declaredDuration > 0 ? diag.declaredDuration + "s" : "not set"}\n` +
    (hints.length > 0 ? hints.map((h) => `  → ${h}`).join("\n") : "")
  );
}

interface HfDiagnostic {
  renderReady: boolean;
  hasHf: boolean;
  hasSeek: boolean;
  hasPlayer: boolean;
  duration: number;
  hasTimeline: boolean;
  declaredDuration: number;
}

async function evaluateHfDiagnostic(page: Page): Promise<HfDiagnostic> {
  return (await page.evaluate(HF_READY_DIAGNOSTIC_EXPR)) as HfDiagnostic;
}

async function pollHfReady(page: Page, timeoutMs: number, intervalMs: number = 100): Promise<void> {
  const readyExpr = `!!(window.__hf && typeof window.__hf.seek === "function" && window.__hf.duration > 0)`;
  const FAST_FAIL_AFTER_MS = 10_000;
  // Throttle diagnostic CDP calls to ~1000ms — running evaluateHfDiagnostic on
  // every 100ms poll tick after the 10s mark generates ~350 unnecessary CDP
  // round-trips per failed render. One diagnostic per second is enough.
  const DIAGNOSTIC_INTERVAL_MS = 1_000;
  const deadline = Date.now() + timeoutMs;
  let lastDiagnosticAt = 0;

  while (Date.now() < deadline) {
    const ready = Boolean(await page.evaluate(readyExpr));
    if (ready) return;

    const elapsed = timeoutMs - (deadline - Date.now());
    if (elapsed >= FAST_FAIL_AFTER_MS) {
      const now = Date.now();
      if (now - lastDiagnosticAt >= DIAGNOSTIC_INTERVAL_MS) {
        lastDiagnosticAt = now;
        const diag = await evaluateHfDiagnostic(page);
        // Only fast-fail when ALL signals are permanently zero:
        //   1. No GSAP timeline registered (GSAP sets duration synchronously
        //      before __renderReady, so a missing timeline won't self-correct).
        //   2. No data-duration declared on the root element.
        //   3. hf.duration is still 0 — this also covers CSS/WAAPI/Lottie
        //      auto-inference (see runtime/init.ts resolveAdapterDurationFloorSeconds):
        //      those runtimes report a non-zero hf.duration once discovery
        //      resolves, without any GSAP timeline or data-duration. Checking
        //      hf.duration directly (rather than only the two authored
        //      signals) avoids fast-failing a composition whose inferred
        //      duration just hasn't landed yet.
        // A composition with a GSAP timeline but no data-duration is still
        // valid — GSAP drives duration via __timelines, not data-duration.
        if (
          diag.renderReady &&
          diag.hasSeek &&
          !diag.hasTimeline &&
          diag.declaredDuration <= 0 &&
          diag.duration <= 0
        ) {
          throw new Error(buildZeroDurationDiagnostic(diag));
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const diag = await evaluateHfDiagnostic(page);
  if (diag.hasSeek && diag.duration === 0) {
    throw new Error(buildZeroDurationDiagnostic(diag));
  }
  throw new Error(
    `[FrameCapture] window.__hf not ready after ${timeoutMs}ms. ` +
      `Page must expose window.__hf = { duration, seek }.\n` +
      `  State: __hf=${diag.hasHf}, seek=${diag.hasSeek}, player=${diag.hasPlayer}, ` +
      `renderReady=${diag.renderReady}, duration=${diag.duration}`,
  );
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

// Wait for every `<img>` with a non-`data:` src to have settled — either
// successfully loaded (`complete && naturalWidth > 0`) or failed with a
// broken-image marker (`complete && naturalWidth === 0`, the HTMLImageElement
// equivalent of HTMLMediaElement.error). htmlCompiler localises remote `<img>`
// URLs to the local file server before this point, so in practice this polls
// for the local fetch to land — but the guard is a defensive net so that any
// future composition path that leaves a remote URL in place won't capture
// frames before the pixels arrive. Mirrors `pollVideosReady` for parity with
// the video-side readiness contract (videos exit-early on `ve.error`; images
// exit-early on `complete && naturalWidth === 0`).
/** @internal exported for unit testing only */
export async function pollImagesReady(
  page: Page,
  timeoutMs: number,
  intervalMs: number = 100,
): Promise<boolean> {
  const check = async (): Promise<boolean> => {
    return Boolean(
      await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll("img"));
        return (
          imgs.length === 0 ||
          imgs.every((img) => {
            const ie = img as HTMLImageElement;
            const src = ie.getAttribute("src") || "";
            if (!src || src.startsWith("data:")) return true;
            // A `complete` image with zero naturalWidth has settled with an
            // error (404 / decode failure / CORS rejection / blocked). Treat
            // as done — waiting won't make it load — and let the render
            // continue with the broken-image marker visible. Mirrors how
            // pollVideosReady treats `ve.error`.
            if (ie.complete && ie.naturalWidth === 0) return true;
            if (ie.complete && ie.naturalWidth > 0) return true;
            return false;
          })
        );
      }),
    );
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return check();
}

// Force every successfully-loaded `<img>` to be GPU-uploaded before the first
// frame capture. `naturalWidth > 0` means the bitmap has been decoded into
// CPU memory, but compositor-side GPU upload can still happen lazily on first
// paint. Calling `img.decode()` returns a Promise that resolves once the image
// is ready for synchronous painting — eliminating the small first-frame race
// between "image is technically loaded" and "the rasterized texture is on the
// GPU and ready to composite".
//
// Note this is purely an init-time guard; it doesn't prevent Chrome from
// evicting decoded pixels mid-render. The producer-side `localizeRemoteImageSources`
// is what bounds the eviction risk (a re-fetch hits the local file server's
// disk-backed paging, not S3 over the network).
//
// Critical: `decode()` on an in-flight image waits for the fetch to resolve.
// If `pollImagesReady` timed out with some images still loading (`!complete`),
// calling `decode()` on them would block here until the network finally
// completes — or until puppeteer's evaluate timeout fires and throws an
// uncaught error that aborts the render. Skip in-flight and broken images;
// only force GPU upload for images that successfully loaded.
async function decodeAllImages(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const imgs = Array.from(document.querySelectorAll("img"));
    await Promise.all(
      imgs.map((img) => {
        const ie = img as HTMLImageElement;
        if (typeof ie.decode !== "function") return Promise.resolve();
        // Skip still-loading images (in-flight decode() would hang) and
        // broken images (decode() rejects, but pre-filtering is clearer
        // than relying on the .catch).
        if (!ie.complete || ie.naturalWidth === 0) return Promise.resolve();
        return ie.decode().catch(() => undefined);
      }),
    );
  });
}

async function applyVideoMetadataHints(
  page: Page,
  hints: readonly CaptureVideoMetadataHint[] | undefined,
): Promise<void> {
  if (!hints || hints.length === 0) return;

  // fallow-ignore-next-line complexity
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

// fallow-ignore-next-line unit-size
export async function initializeSession(session: CaptureSession): Promise<void> {
  const { page, serverUrl } = session;

  // Forward browser console to host. HyperFrames runtime logs get a dedicated
  // prefix so page-context observability is visible in producer stdout.
  page.on("console", (msg: ConsoleMessage) => {
    const type = msg.type();
    const text = msg.text();
    const locationUrl = msg.location()?.url ?? "";
    const diagnostic = formatConsoleDiagnostic(type, text, locationUrl);
    if (!diagnostic.suppressHostLog) console.log(diagnostic.text);
    appendBrowserDiagnostic(session, diagnostic.text);
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

    appendBrowserDiagnostic(session, text);
  });

  page.on("requestfailed", (request) => {
    appendBrowserDiagnostic(
      session,
      formatRequestFailureDiagnostic({
        method: request.method(),
        resourceType: request.resourceType(),
        url: request.url(),
        failureText: request.failure()?.errorText ?? "unknown",
      }),
    );
  });

  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;

    const request = response.request();
    appendBrowserDiagnostic(
      session,
      formatHttpErrorDiagnostic({
        method: request.method(),
        resourceType: request.resourceType(),
        url: response.url(),
        status,
        statusText: response.statusText(),
      }),
    );
  });

  // Navigate to the file server
  const url = `${serverUrl}/index.html`;
  const pageNavigationTimeout =
    session.config?.pageNavigationTimeout ?? DEFAULT_CONFIG.pageNavigationTimeout;
  const initStart = Date.now();
  const logInitPhase = (phase: string) => {
    console.log(`[initSession:${session.captureMode}] ${phase} (${Date.now() - initStart}ms)`);
  };
  const gotoEntryPage = async (): Promise<void> => {
    appendBrowserDiagnostic(
      session,
      formatNavigationStartDiagnostic({
        captureMode: session.captureMode,
        url,
        timeoutMs: pageNavigationTimeout,
      }),
    );
    logInitPhase("page.goto start");
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: pageNavigationTimeout });
    } catch (error) {
      appendBrowserDiagnostic(
        session,
        formatNavigationFailureDiagnostic({
          captureMode: session.captureMode,
          url,
          timeoutMs: pageNavigationTimeout,
          elapsedMs: Date.now() - initStart,
          error,
        }),
      );
      throw error;
    }
  };

  if (session.captureMode === "screenshot") {
    // Screenshot mode: standard navigation, rAF works normally
    await gotoEntryPage();
    logInitPhase("page.goto complete");

    // Flush the GSAP proxy queue synchronously instead of waiting for
    // rAF-based batch ticks (100 ops/tick at ~16ms). In headless mode there's
    // no UI responsiveness concern, so draining instantly eliminates the
    // largest init-time cost for tween-heavy compositions.
    await page.evaluate(`window.__hfFlushSync?.()`);
    logInitPhase("GSAP proxy flush complete");

    const pageReadyTimeout =
      session.config?.playerReadyTimeout ?? DEFAULT_CONFIG.playerReadyTimeout;
    await pollHfReady(page, pageReadyTimeout);
    logInitPhase("pollHfReady complete");

    await pollSubCompositionTimelines(page, pageReadyTimeout);
    logInitPhase("pollSubCompositionTimelines complete");

    await applyVideoMetadataHints(page, session.options.videoMetadataHints);
    logInitPhase("applyVideoMetadataHints complete");

    // Run independent readiness checks in parallel — videos, images, fonts,
    // and Tailwind don't depend on each other's completion.
    const skipVideoIds = session.options.skipReadinessVideoIds ?? [];
    const [videosReady] = await Promise.all([
      pollVideosReady(page, skipVideoIds, pageReadyTimeout),
      pollImagesReady(page, pageReadyTimeout).then(async (ready) => {
        if (!ready) {
          const failedImages = await page.evaluate(() => {
            return Array.from(document.querySelectorAll("img"))
              .filter((img) => {
                const ie = img as HTMLImageElement;
                const src = ie.getAttribute("src") || "";
                if (!src || src.startsWith("data:")) return false;
                return !(ie.complete && ie.naturalWidth > 0);
              })
              .map((img) => (img as HTMLImageElement).src || img.getAttribute("src") || "(no src)")
              .join(", ");
          });
          console.warn(
            `[FrameCapture] Some image elements did not load within ${pageReadyTimeout}ms: ${failedImages}. ` +
              `Continuing render — affected images may appear blank/missing in early frames.`,
          );
        }
        await decodeAllImages(page);
        return ready;
      }),
      page.evaluate(`document.fonts?.ready`),
      waitForOptionalTailwindReady(page, pageReadyTimeout),
    ]);
    logInitPhase("media + fonts + tailwind ready");

    if (!videosReady) {
      const failedVideos = await page.evaluate((skipIdList: readonly string[]) => {
        const skip = new Set(skipIdList);
        return Array.from(document.querySelectorAll("video"))
          .filter((v) => !skip.has(v.id))
          .filter((v) => (v as HTMLVideoElement).readyState < 2 && !(v as HTMLVideoElement).error)
          .map((v) => (v as HTMLVideoElement).src || v.getAttribute("src") || "(no src)")
          .join(", ");
      }, skipVideoIds);
      console.warn(
        `[FrameCapture] Some video elements did not decode within ${pageReadyTimeout}ms: ${failedVideos}. ` +
          `Continuing render — affected videos will appear as blank/black frames.`,
      );
    }

    await recordSessionInitTelemetry(session, initStart);

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

    await armStaticDedup(session, session.page, logInitPhase);
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
  logInitPhase("warmup loop started");

  await gotoEntryPage();
  logInitPhase("page.goto complete");

  // Flush the GSAP proxy queue synchronously. In BeginFrame mode the rAF-based
  // batch drain runs on the warmup loop's 33ms ticks — for tween-heavy
  // compositions this is the dominant init cost. Flushing synchronously
  // eliminates the wait entirely.
  await page.evaluate(`window.__hfFlushSync?.()`);
  logInitPhase("GSAP proxy flush complete");

  // Poll for window.__hf readiness using manual evaluate loop (waitForFunction
  // uses rAF polling internally, which won't fire in beginFrame mode).
  const pageReadyTimeout = session.config?.playerReadyTimeout ?? DEFAULT_CONFIG.playerReadyTimeout;
  try {
    await pollHfReady(page, pageReadyTimeout);
    logInitPhase("pollHfReady complete");
  } catch (err) {
    warmupState.running = false;
    throw err;
  }

  await pollSubCompositionTimelines(page, pageReadyTimeout);
  logInitPhase("pollSubCompositionTimelines complete");

  await applyVideoMetadataHints(page, session.options.videoMetadataHints);
  logInitPhase("applyVideoMetadataHints complete");

  // Run independent readiness checks in parallel — videos, images, fonts,
  // and Tailwind don't depend on each other's completion.
  const bfSkipVideoIds = session.options.skipReadinessVideoIds ?? [];
  const [bfVideosReady] = await Promise.all([
    pollVideosReady(page, bfSkipVideoIds, pageReadyTimeout),
    pollImagesReady(page, pageReadyTimeout).then(async (ready) => {
      if (!ready) {
        const failedImages = await page.evaluate(() => {
          return Array.from(document.querySelectorAll("img"))
            .filter((img) => {
              const ie = img as HTMLImageElement;
              const src = ie.getAttribute("src") || "";
              if (!src || src.startsWith("data:")) return false;
              return !(ie.complete && ie.naturalWidth > 0);
            })
            .map((img) => (img as HTMLImageElement).src || img.getAttribute("src") || "(no src)")
            .join(", ");
        });
        console.warn(
          `[FrameCapture] Some image elements did not load within ${pageReadyTimeout}ms: ${failedImages}. ` +
            `Continuing render — affected images may appear blank/missing in early frames.`,
        );
      }
      await decodeAllImages(page);
      return ready;
    }),
    page.evaluate(`document.fonts?.ready`),
    waitForOptionalTailwindReady(page, pageReadyTimeout),
  ]);
  logInitPhase("media + fonts + tailwind ready");

  if (!bfVideosReady) {
    const failedVideos = await page.evaluate((skipIdList: readonly string[]) => {
      const skip = new Set(skipIdList);
      return Array.from(document.querySelectorAll("video"))
        .filter((v) => !skip.has(v.id))
        .filter((v) => (v as HTMLVideoElement).readyState < 2 && !(v as HTMLVideoElement).error)
        .map((v) => (v as HTMLVideoElement).src || v.getAttribute("src") || "(no src)")
        .join(", ");
    }, bfSkipVideoIds);
    console.warn(
      `[FrameCapture] Some video elements did not decode within ${pageReadyTimeout}ms: ${failedVideos}. ` +
        `Continuing render — affected videos will appear as blank/black frames.`,
    );
  }

  await recordSessionInitTelemetry(session, initStart);

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

  await armStaticDedup(session, session.page, logInitPhase);
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

// ── Static-frame dedup (default-on, opt-out HF_STATIC_DEDUP=false) ─────────────
// Skip re-seeking + re-screenshotting frames that are byte-identical to their
// predecessor. A frame is dedupable iff no GSAP tween or clip cut is active in it or
// its predecessor (predicted from window.__timelines), AND an empirical anchor-compare
// confirms it. Capture-mode-independent (works on screenshot + beginframe), lossless
// (verification disables the whole comp on any drift), default off. Pays on
// static-hold content (title cards, slideshows, data-viz pauses); a no-op on
// continuously-animated comps and disqualified by video/canvas/non-GSAP animation.

/**
 * Clip-cut boundary frames (±1) from the [data-start] schedule. A hard scene swap at a
 * cut changes content with no tween; treat those frames as animated so the post-cut
 * frame is captured fresh and later static frames reuse the correct scene.
 */
async function computeClipBoundaryFrames(page: Page, fps: number): Promise<Set<number>> {
  const schedule = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-start]")).map((el) => ({
      start: parseFloat((el as HTMLElement).dataset.start || ""),
      dur: parseFloat((el as HTMLElement).dataset.duration || ""),
    })),
  );
  const frames = new Set<number>();
  for (const { start, dur } of schedule) {
    if (Number.isNaN(start)) continue;
    const edges = [Math.round(start * fps)];
    if (!Number.isNaN(dur)) edges.push(Math.round((start + dur) * fps));
    for (const e of edges) {
      for (const f of [e - 1, e, e + 1]) {
        if (f >= 0) frames.add(f);
      }
    }
  }
  return frames;
}

/**
 * Predict the dedupable (static) frame set from window.__timelines. A frame f (f>0) is
 * static iff NEITHER f NOR f-1 falls inside any GSAP tween interval — content didn't
 * change f-1→f, so f can reuse f-1's buffer. Requiring BOTH neighbours static under-
 * claims by one frame at each tween edge (the SAFE direction). Disqualifies the whole
 * comp on any signal the tween-walker can't see: video / canvas / webgl (redraw without
 * a tween), zero tweens (non-GSAP animation), or a running CSS/WAAPI animation.
 */
async function computeStaticFrameSet(
  page: Page,
  fps: number,
): Promise<{
  totalFrames: number;
  staticFrameSet: Set<number>;
  hasVideo: boolean;
  hasCanvas: boolean;
  hasNonGsapAnim: boolean;
  tweenCount: number;
  eligible: boolean;
  reason: string;
}> {
  const result = await page.evaluate(() => {
    type AnyTween = {
      startTime(): number;
      duration(): number;
      totalDuration?(): number;
      getChildren?(nested: boolean, tweens: boolean, timelines: boolean): AnyTween[];
    };
    const intervals: Array<{ start: number; end: number }> = [];
    let tweenCount = 0;
    // totalDuration() (NOT duration()): a repeat/yoyo tween animates past one iteration;
    // a repeating timeline is marked opaque over its whole span (conservative).
    function walk(tl: AnyTween, offset: number): void {
      if (typeof tl.getChildren !== "function") return;
      for (const child of tl.getChildren(false, true, true)) {
        const start = offset + (typeof child.startTime === "function" ? child.startTime() : 0);
        const single = typeof child.duration === "function" ? child.duration() : 0;
        const total = typeof child.totalDuration === "function" ? child.totalDuration() : single;
        if (typeof child.getChildren === "function") {
          if (total > single + 1e-6) intervals.push({ start, end: start + total });
          else walk(child, start);
        } else {
          tweenCount++;
          intervals.push({ start, end: start + total });
        }
      }
    }
    const w = window as unknown as {
      __timelines?: Record<string, AnyTween>;
      __hf?: { duration?: number };
    };
    for (const tl of Object.values(w.__timelines || {})) {
      if (tl && typeof tl.getChildren === "function") walk(tl, 0);
    }
    const hasVideo = !!document.querySelector("video");
    const hasCanvas = !!document.querySelector("canvas");
    // A non-numeric data-start (reference expression like "intro+0.5") can't be turned
    // into a clip-cut boundary by computeClipBoundaryFrames' parseFloat, so the cut goes
    // unprotected and could be deduped into the previous scene. Disqualify the comp.
    const hasUnresolvableClipStart = Array.from(document.querySelectorAll("[data-start]")).some(
      (el) => {
        const v = (el as HTMLElement).dataset.start;
        return v != null && v.trim() !== "" && !Number.isFinite(parseFloat(v));
      },
    );
    // Non-GSAP animation (CSS @keyframes / transitions / WAAPI) surfaces via
    // getAnimations(); any running/paused one can change content without a tween.
    let hasNonGsapAnim = false;
    try {
      const docAnims = (document as unknown as { getAnimations?: () => Animation[] }).getAnimations;
      if (typeof docAnims === "function") {
        hasNonGsapAnim = docAnims.call(document).some((a) => {
          const t = a as Animation & { playState?: string };
          return t.playState === "running" || t.playState === "paused";
        });
      }
    } catch {
      hasNonGsapAnim = true;
    }
    return {
      intervals,
      tweenCount,
      duration: w.__hf?.duration ?? 0,
      hasVideo,
      hasCanvas,
      hasNonGsapAnim,
      hasUnresolvableClipStart,
    };
  });

  const {
    intervals,
    tweenCount,
    duration,
    hasVideo,
    hasCanvas,
    hasNonGsapAnim,
    hasUnresolvableClipStart,
  } = result as {
    intervals: Array<{ start: number; end: number }>;
    tweenCount: number;
    duration: number;
    hasVideo: boolean;
    hasCanvas: boolean;
    hasNonGsapAnim: boolean;
    hasUnresolvableClipStart: boolean;
  };
  const totalFrames = Math.max(1, Math.ceil(duration * fps));
  const animated = new Set<number>();
  for (const { start, end } of intervals) {
    const lo = Math.max(0, Math.floor(start * fps));
    const hi = Math.min(totalFrames - 1, Math.ceil(end * fps));
    for (let f = lo; f <= hi; f++) animated.add(f);
  }
  for (const f of await computeClipBoundaryFrames(page, fps)) animated.add(f);
  const reasons: string[] = [];
  if (!(duration > 0)) reasons.push("unknown/zero duration");
  if (hasVideo) reasons.push("video");
  if (hasCanvas) reasons.push("canvas/webgl");
  if (tweenCount === 0) reasons.push("no GSAP tweens (non-GSAP animation)");
  if (hasNonGsapAnim) reasons.push("running CSS/WAAPI animation");
  if (hasUnresolvableClipStart) reasons.push("unresolvable clip start (reference expression)");
  const eligible = reasons.length === 0;
  const staticFrameSet = new Set<number>();
  if (eligible) {
    for (let f = 1; f < totalFrames; f++) {
      if (!animated.has(f) && !animated.has(f - 1)) staticFrameSet.add(f);
    }
  }
  return {
    totalFrames,
    staticFrameSet,
    hasVideo,
    hasCanvas,
    hasNonGsapAnim,
    tweenCount,
    eligible,
    reason: eligible ? "eligible" : reasons.join("+"),
  };
}

/**
 * Empirically verify the predicted-static set before trusting it. Group static frames
 * into runs; each run [a..b] reuses anchor a-1. CRITICAL: compare against the ANCHOR,
 * not the predecessor — a slow drift with sub-quantization per-frame deltas is byte-
 * identical frame-to-frame yet drifts far from the anchor by the run's end (the real
 * frozen error). Capture each run's anchor once, compare END + a midpoint to it; any
 * mismatch ⇒ the run isn't truly static ⇒ disable dedup whole-comp. Capture-mode-
 * independent (seeks + screenshots in normal DOM). Returns the first bad frame, or null.
 */
async function verifyStaticFramesSafe(
  session: CaptureSession,
  page: Page,
  staticFrames: Set<number>,
  fps: number,
  sampleCount: number,
): Promise<{ badFrame: number; budgetExhausted: boolean } | null> {
  const frames = [...staticFrames].sort((a, b) => a - b);
  if (frames.length === 0) return null;
  // Runs are maximal-contiguous (adjacent frames merge), so a run's anchor a-1 is
  // guaranteed NOT static — always a freshly-captured frame.
  const runs: Array<{ a: number; b: number }> = [];
  for (const f of frames) {
    const last = runs[runs.length - 1];
    if (last && f === last.b + 1) last.b = f;
    else runs.push({ a: f, b: f });
  }
  const seekCapture = async (frameIdx: number): Promise<Buffer> => {
    const t = quantizeTimeToFrame(frameIdx / fps, fps);
    await page.evaluate((tt: number) => {
      const hf = (window as unknown as { __hf?: { seek?: (t: number) => void } }).__hf;
      if (hf && typeof hf.seek === "function") hf.seek(tt);
    }, t);
    return pageScreenshotCapture(page, session.options);
  };
  // Verify EVERY run in order (no longest-first truncation that would leave runs armed
  // but unverified). Per run, compare the FIRST reused frame `a`, the END `b` (max
  // accumulated drift), and interior points at a stride — against the anchor the run
  // actually reuses. `sampleCount` sets the interior density (points per run ~ that many
  // for a long run); a hard cap bounds pathological run counts, and hitting it DISABLES
  // dedup (conservative: never trust an unverified set).
  const perRun = Math.max(3, Math.min(sampleCount, 8));
  const hardCap = Math.max(sampleCount * 8, 400);
  let spent = 0;
  for (const { a, b } of runs) {
    const anchor = a - 1;
    if (anchor < 0) continue;
    const anchorBuf = await seekCapture(anchor);
    spent++;
    const span = b - a;
    const stride = span > 0 ? Math.max(1, Math.floor(span / (perRun - 1))) : 1;
    const pts = new Set<number>();
    for (let f = a; f <= b; f += stride) pts.add(f);
    pts.add(b); // always include the end (max drift)
    for (const f of [...pts].sort((x, y) => x - y)) {
      const cur = await seekCapture(f);
      spent++;
      if (!anchorBuf.equals(cur)) return { badFrame: f, budgetExhausted: false };
    }
    // Budget exhausted → can't fully verify → disarm. Reported distinctly from real
    // drift so a `verification_budget` spike in telemetry signals "tune HF_STATIC_DEDUP_SAMPLES",
    // not "compositions are non-static".
    if (spent > hardCap) return { badFrame: a, budgetExhausted: true };
  }
  return null;
}

/**
 * Arm static-frame dedup for this render (default-on; opt out with HF_STATIC_DEDUP=false).
 * Runs at init in normal DOM state so the verification screenshots are valid. Predicts
 * the static set, anchor-verifies it (skip with HF_STATIC_DEDUP_VERIFY=false — unsafe),
 * and on success stores it on the session for captureFrameCore to reuse. Sample budget
 * via HF_STATIC_DEDUP_SAMPLES (default 24).
 */
async function armStaticDedup(
  session: CaptureSession,
  page: Page,
  logInitPhase: (phase: string) => void,
): Promise<void> {
  // Default ON for everyone; opt out via HF_STATIC_DEDUP in {false,0,off} (resolved into
  // EngineConfig.staticFrameDedup by resolveConfig). Verification is the safety net at scale.
  // Default-on: only an explicit `staticFrameDedup === false` (resolved from
  // HF_STATIC_DEDUP) disables; a missing config leaves dedup enabled.
  session.staticDedupEnabled = session.config?.staticFrameDedup !== false;
  if (!session.staticDedupEnabled) return;
  // Conservative gates: dedup is verified against the plain screenshot path, so only arm
  // where the production capture matches what verification measures, and where reuse is
  // sound. Skip when:
  //  - capture mode is not screenshot (BeginFrame advances the compositor clock per
  //    frame; skipping beginFrame for static frames gaps the tick sequence, and the
  //    verifier uses pageScreenshotCapture not beginFrameCapture — its proof wouldn't
  //    transfer);
  //  - a before-capture hook is set (per-frame video-frame injection — those frames are
  //    NOT static even if the GSAP timeline is idle, and the injector is skipped on reuse);
  //  - page-side compositing is active (shader transitions / drawElement composite paint
  //    a frame the plain verification screenshot doesn't reproduce).
  if (session.captureMode !== "screenshot") {
    session.staticDedupSkipReason = "capture_mode";
    logInitPhase(
      `static-frame dedup: disabled (capture mode ${session.captureMode}, not screenshot)`,
    );
    return;
  }
  if (session.onBeforeCapture) {
    session.staticDedupSkipReason = "video_injection";
    logInitPhase("static-frame dedup: disabled (before-capture hook / video injection active)");
    return;
  }
  const pageComposite = await page
    .evaluate(
      () =>
        typeof (window as unknown as { __hf_page_composite_prepare?: unknown })
          .__hf_page_composite_prepare === "function",
    )
    .catch(() => true); // fail CLOSED: if we can't determine, assume compositing → skip dedup
  if (pageComposite) {
    session.staticDedupSkipReason = "page_composite";
    logInitPhase("static-frame dedup: disabled (page-side compositing active)");
    return;
  }
  const fps = fpsToNumber(session.options.fps);
  const stats = await computeStaticFrameSet(page, fps);
  if (!stats.eligible || stats.staticFrameSet.size === 0) {
    session.staticDedupSkipReason = "ineligible";
    logInitPhase(`static-frame dedup: disabled (${stats.reason})`);
    return;
  }
  const rawSamples = Number(process.env.HF_STATIC_DEDUP_SAMPLES ?? "24");
  const samples = Number.isFinite(rawSamples) && rawSamples >= 1 ? rawSamples : 24;
  const verdict =
    process.env.HF_STATIC_DEDUP_VERIFY === "false"
      ? null
      : await verifyStaticFramesSafe(session, page, stats.staticFrameSet, fps, samples);
  if (verdict !== null) {
    session.staticDedupSkipReason = verdict.budgetExhausted
      ? "verification_budget"
      : "verification_failed";
    logInitPhase(
      verdict.budgetExhausted
        ? `static-frame dedup: disabled (verification budget exhausted before frame ${verdict.badFrame}; ` +
            `raise HF_STATIC_DEDUP_SAMPLES to verify more)`
        : `static-frame dedup: disabled (verification failed — content drifts from anchor at ` +
            `predicted-static frame ${verdict.badFrame})`,
    );
    return;
  }
  // armed + predicted are derived from staticFrames in getCapturePerfSummary.
  session.staticFrames = stats.staticFrameSet;
  logInitPhase(
    `static-frame dedup: ${stats.staticFrameSet.size}/${stats.totalFrames} frame(s) reusable ` +
      `(${Math.round((stats.staticFrameSet.size / stats.totalFrames) * 100)}%, verified)`,
  );
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

  // Static-frame dedup: this frame is byte-identical to its predecessor (predicted +
  // anchor-verified at init) → reuse the prior buffer, skip the seek + screenshot.
  // KEY: index by the ABSOLUTE composition frame (derived from `time`), NOT the
  // `frameIndex` arg — chunked/parallel/distributed callers pass a chunk-RELATIVE
  // frameIndex (captureStage passes the loop `i`, parallelCoordinator passes
  // `i-outputFrameOffset`) while staticFrames is keyed in absolute frames. Using `time`
  // is correct on every path (sequential, per-worker range, distributed chunk) because
  // `time` is always the absolute composition time for the frame. Each session captures
  // its range in ascending order, so lastFrameBuffer is the correct in-range anchor (and
  // since a static run is verified identical, reusing the run's first in-range capture
  // equals reusing the global anchor). Telemetry: count reuses separately; do NOT bump
  // capturePerf.frames (that would dilute the per-frame timing averages).
  // Use the SAME floor+epsilon idiom as quantizeTimeToFrame so the dedup lookup agrees
  // with the frame the seek actually lands on, even if `time` ever isn't exactly i/fps.
  const absFrameIndex = Math.floor(time * fpsToNumber(options.fps) + 1e-9);
  if (session.staticFrames?.has(absFrameIndex) && session.lastFrameBuffer) {
    session.staticDedupCount = (session.staticDedupCount ?? 0) + 1;
    return {
      buffer: session.lastFrameBuffer,
      quantizedTime: quantizeTimeToFrame(time, fpsToNumber(options.fps)),
      captureTimeMs: Date.now() - startTime,
    };
  }

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

    // Retain this freshly-captured buffer so the following static frames can reuse it.
    if (session.staticFrames) session.lastFrameBuffer = screenshotBuffer;

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
  const dedupCountBefore = session.staticDedupCount;
  const lastFrameBufferBefore = session.lastFrameBuffer;
  try {
    await innerCapture(session, frameIndex, time);
  } finally {
    // Always restore — even on error. A failed warmup capture should not
    // leak inflated perf counters, a phantom dedup reuse, or a warmup-era
    // lastFrameBuffer anchor into the real capture summary/state.
    session.capturePerf = perfBefore;
    session.beginFrameHasDamageCount = hasDamageBefore;
    session.beginFrameNoDamageCount = noDamageBefore;
    session.staticDedupCount = dedupCountBefore;
    session.lastFrameBuffer = lastFrameBufferBefore;
  }
}

export async function closeCaptureSession(session: CaptureSession): Promise<void> {
  // Realized static-dedup telemetry: how much the cache actually helped this
  // render (vs the prediction logged at arm time). Both capture paths
  // (sequential orchestrator + parallel workers) close their session here, so
  // this is the one uniform emit point. Zero the count afterward so the
  // idempotent re-close (HDR cleanup) doesn't double-log.
  const reused = session.staticDedupCount ?? 0;
  if (session.staticFrames && reused > 0) {
    const captured = session.capturePerf.frames; // excludes reuses by design
    const total = captured + reused;
    const pct = total > 0 ? Math.round((reused / total) * 100) : 0;
    const avgTotalMs = captured > 0 ? Math.round(session.capturePerf.totalMs / captured) : 0;
    console.log(
      `[static-dedup] reused ${reused}/${total} frame(s) (${pct}%), ` +
        `est. ~${reused * avgTotalMs}ms saved (avg ${avgTotalMs}ms/frame)`,
    );
    session.staticDedupCount = 0;
  }
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
  // Reset per-render dedup state so a buffer captured by the prior render/probe can't
  // bleed into this render's first static frame. staticFrames (the armed set) is left
  // intact: it's keyed in absolute frames and stays valid for a same-composition reuse;
  // lastFrameBuffer must be re-seeded by this render's first fresh capture.
  session.lastFrameBuffer = undefined;
  session.staticDedupCount = 0;
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
    staticDedupReused: session.staticDedupCount ?? 0,
    staticDedupEnabled: session.staticDedupEnabled ?? false,
    // armed ⟺ a non-empty static set survived verification; predicted === its size.
    staticDedupArmed: (session.staticFrames?.size ?? 0) > 0,
    staticDedupPredicted: session.staticFrames?.size ?? 0,
    staticDedupSkipReason: session.staticDedupSkipReason,
  };
}

// ── Transient browser error classification ─────────────────────────────────
// Puppeteer/Chrome can fail with transient errors that succeed on retry with a
// fresh browser session. These are infrastructure-level failures (frame
// detachment, connection drop, OOM kill, launch failure) — NOT composition bugs.

const TRANSIENT_BROWSER_ERROR_PATTERNS = [
  /Navigating frame was detached/i,
  /Target closed/i,
  /Session closed/i,
  /browser has disconnected/i,
  /Page crashed/i,
  /Execution context was destroyed/i,
  /Cannot find context with specified id/i,
  /Failed to launch the browser process/i,
  /Navigation timeout of \d+ ms exceeded/i,
  /ECONNREFUSED/i,
  // pollHfReady's own timeout — thrown when window.__renderReady never flips
  // true within playerReadyTimeout. "Runtime ready: false" means init simply
  // didn't finish in time (commonly a slow/contended host, e.g. several
  // concurrent renders), which a fresh session usually clears on retry. This
  // is distinct from the "Runtime ready: true" fast-fail case a few lines up
  // in pollHfReady (no timeline + no data-duration) — that's a genuine
  // authoring bug and intentionally NOT matched here, so it still fails fast.
  /Composition has zero duration[\s\S]*Runtime ready: false/,
];

export function isTransientBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_BROWSER_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

// ── Memory-exhaustion classification ────────────────────────────────────────
// A render can run the Node process (or a page-side allocation) out of memory
// on an oversized composition — huge canvas, thousands of frames, or a very
// large frame cache. These surface as cryptic V8 RangeErrors ("Set maximum
// size exceeded", "Invalid array length"/"string length", "Array buffer
// allocation failed") or a hard V8 heap-limit abort. They are NOT transient
// (a retry re-hits the same ceiling) and NOT composition-logic bugs — they're
// resource limits. Classify them so the caller can surface actionable guidance
// (lower resolution / fps / duration, or enable low-memory mode) instead of a
// raw RangeError.

// Deliberately specific: each pattern is a distinct V8/Node allocation-failure
// signature. We intentionally do NOT match a bare /out of memory/ — that
// substring appears in benign browser-console noise (WebGL `CONTEXT_LOST … out
// of memory`, GPU driver notes) that gets carried into the error path, and
// misclassifying it would replace the real failure message with generic OOM
// guidance.
const MEMORY_EXHAUSTION_ERROR_PATTERNS = [
  /Set maximum size exceeded/i,
  /Map maximum size exceeded/i,
  /Invalid (?:array|string) length/i,
  /Array buffer allocation failed/i,
  /Cannot create a string longer than/i,
  /Reached heap limit/i,
  /JavaScript heap out of memory/i,
];

export function isMemoryExhaustionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return MEMORY_EXHAUSTION_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}
