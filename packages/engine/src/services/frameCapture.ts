// fallow-ignore-file complexity code-duplication
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
import {
  detectSwiftShader,
  injectDrawElementCanvas,
  captureDrawElementFrame,
  resolveDrawElementCaptureMode,
  instrumentAcceleratedCanvases,
  initDrawElementWorkerEncode,
  cleanupDrawElementWorkerEncode,
  produceDrawElementFrame,
} from "./drawElementService.js";
import {
  initThreeDProjection,
  detectStackedFadeRisk,
  detectCssEffectRisk,
} from "./threeDProjection.js";
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
  /**
   * Browser LAUNCH mode, immutable after createCaptureSession. `captureMode`
   * is reassigned by initializeSession (e.g. to "drawelement"), so callers
   * that need to know whether this browser actually drives BeginFrame (the
   * SwiftShader liveness probe) read this field instead.
   */
  launchCaptureMode: CaptureMode;
  // BeginFrame state
  beginFrameTimeTicks: number;
  beginFrameIntervalMs: number;
  beginFrameHasDamageCount: number;
  beginFrameNoDamageCount: number;
  /** Optional producer config — when set, overrides module-level env var constants. */
  config?: Partial<EngineConfig>;
  /** True if running on SwiftShader (detected at init). Undefined before init. */
  isSwiftShader?: boolean;
  /** drawElementImage canvas was injected and is ready for capture. */
  drawElementReady?: boolean;
  /**
   * Worker-encode pipeline is active for this session. Set by
   * `initDrawElementOrTransparentBackground` when `enableDrawElementWorkerEncode`
   * is true and capture mode resolved to "drawelement".
   */
  workerEncodeEnabled?: boolean;
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

/**
 * Post-readiness capture-surface init, shared by the screenshot and BeginFrame
 * init paths (called after the page is fully ready). When `useDrawElement` is
 * set, detect SwiftShader and route: transparent+SwiftShader falls back to
 * screenshot capture (the drawElement transparent path is broken on SwiftShader),
 * everything else injects the drawElement canvas and switches to "drawelement"
 * mode. Otherwise, for PNG output, force a transparent page background so the
 * screenshots carry a real alpha channel (Chrome resets the override on every
 * navigation, so this must run after page load).
 *
 * drawElement is also skipped when supersampling (deviceScaleFactor > 1):
 * `drawElementImage` reads the canvas at CSS pixels and has no equivalent of
 * `Page.captureScreenshot`'s clip+scale, so it would silently capture at 1x and
 * drop the requested supersample. Such renders fall through to the screenshot
 * path (preMode already forces "screenshot" for DPR > 1).
 */
async function initDrawElementOrTransparentBackground(
  session: CaptureSession,
  page: Page,
  logInitPhase: (phase: string) => void,
): Promise<void> {
  const supersampling = (session.options.deviceScaleFactor ?? 1) > 1;
  // forceScreenshot is an explicit routing decision made upstream (render-mode
  // compat hints like raw requestAnimationFrame, alpha formats, low-memory) —
  // drawElement must not override it. Concretely: an rAF-compat comp on
  // SwiftShader gets a screenshot-launched (free-running) browser, where
  // drawElement runs in paint-event-sync mode; SwiftShader never refreshes a
  // 2d canvas bitmap inside a cached paint record there, so every canvas
  // captures frozen-blank (raf-ball rendered fully black). On a GPU the same
  // path happens to work, but the hint asked for screenshot — honor it.
  const forceScreenshot = session.config?.forceScreenshot ?? false;
  const useDrawElement =
    (session.config?.useDrawElement ?? false) && !supersampling && !forceScreenshot;
  if ((session.config?.useDrawElement ?? false) && supersampling) {
    console.log(
      "[engine] --experimental-fast-capture disabled for this render: drawElementImage " +
        "ignores deviceScaleFactor, so supersampled (DPR > 1) output uses screenshot capture.",
    );
  }
  if ((session.config?.useDrawElement ?? false) && !supersampling && forceScreenshot) {
    console.log(
      "[engine] fast capture: falling back to screenshot — render-mode compatibility " +
        "hint forced screenshot capture (e.g. raw requestAnimationFrame composition).",
    );
  }
  // Retract the per-page autoAlpha rewrite flag when a runtime gate routes the
  // session to screenshot mode. evaluateOnNewDocument already fired; a follow-up
  // evaluate overrides it in the live page context so hideTransparentAutoAlpha-
  // Targets does not hide elements on the fallback screenshot render
  // (up to 21 dB damage if not retracted, A/B proven 2026-06-12).
  async function retractAutoAlphaFlag(): Promise<void> {
    await page.evaluate(() => {
      (
        window as Window & { __HF_FAST_CAPTURE_AUTOALPHA__?: boolean }
      ).__HF_FAST_CAPTURE_AUTOALPHA__ = false;
    });
  }
  if (useDrawElement) {
    session.isSwiftShader = await detectSwiftShader(page);
    const transparent = session.options.format === "png";
    async function routeToFallback(): Promise<void> {
      session.captureMode = session.launchCaptureMode;
      if (transparent) {
        await initTransparentBackground(session.page);
      }
      await retractAutoAlphaFlag();
    }
    // Video compositions fall back to screenshot capture. <video> is a PROXY
    // signal: the actual trigger (bisect + standalone repro, 2026-06-09) is the
    // word-by-word caption opacity pattern — per-frame JS opacity writes on >=2
    // stacked containers with fully-transparent children, inside a transformed
    // container that overflows the capture canvas, read back via toDataURL.
    // drawElementImage then captures fully-transparent frames (~12 dB
    // fast-vs-baseline on macOS GPU and native amd64 Linux alike). Video itself
    // captures fine — a caption-free bg-video probe scores 54 dB — but real
    // video comps almost always carry captions, so the gate keys on <video>.
    // Chromium-side, same family as crbug 521434899 but reproduces on real
    // GPUs; see docs/fast-capture-limitations.md Lim 2 for the ablation table.
    // HF_FAST_CAPTURE_VIDEO=true bypasses the gate for future R&D probing.
    const hasVideo =
      process.env.HF_FAST_CAPTURE_VIDEO === "true"
        ? false
        : await page.evaluate(() => document.querySelector("video") !== null);
    const mode = resolveDrawElementCaptureMode(session.isSwiftShader, transparent, hasVideo);
    if (mode === "screenshot") {
      const reason = session.isSwiftShader
        ? "SwiftShader (software rasterizer — no GPU egress to skip, drawElement is parity-or-slower; see fast-capture-limitations.md)"
        : "composition contains <video> (proxy for the caption-pattern capture bug — see fast-capture-limitations.md Lim 2)";
      // Fall back to the browser's LAUNCH mode, not unconditionally to
      // "screenshot": on a BeginFrame-launched browser (Linux fast capture)
      // Page.captureScreenshot hangs for the full protocol timeout, while
      // beginFrameCapture is the platform's normal baseline path. The
      // transparent+SwiftShader case always arrives on a screenshot-launched
      // browser (drawElementTransparent forces that at launch), so alpha
      // still routes through captureScreenshot.
      console.log(
        `[engine] fast capture: falling back to ${session.launchCaptureMode} capture — ${reason}`,
      );
      await routeToFallback();
    } else {
      // Stacked-fade gate: >=2 overlapping viewport-scale fade targets
      // reproduce the drawElementImage mid-fade blackout (crbug 521861819).
      // Mechanism-based — resolved from the producer stub's recorded fade
      // tween targets, independent of any authoring convention. Falls back
      // to the platform's baseline route, same contract as the video gate.
      // HF_FAST_CAPTURE_CROSSFADE=true bypasses for R&D.
      if (process.env.HF_FAST_CAPTURE_CROSSFADE !== "true" && (await detectStackedFadeRisk(page))) {
        console.log(
          `[engine] fast capture: falling back to ${session.launchCaptureMode} capture — ` +
            "stacked viewport-scale fade targets detected (drawElementImage drops " +
            "mid-fade content, crbug 521861819)",
        );
        await routeToFallback();
        return;
      }
      // CSS-effect gate: backdrop-filter samples the compositor backdrop and
      // filter:blur/drop-shadow render differently through the paint-record
      // path — drawElementImage can't reproduce either, producing 18–49 dB
      // damaged frames (community eval). Fall back to the platform baseline.
      // HF_FAST_CAPTURE_CSSFX=true bypasses for R&D.
      if (process.env.HF_FAST_CAPTURE_CSSFX !== "true") {
        const cssFx = await detectCssEffectRisk(page);
        if (cssFx) {
          console.log(
            `[engine] fast capture: falling back to ${session.launchCaptureMode} capture — ` +
              `${cssFx} detected (drawElementImage cannot reproduce it; see fast-capture-limitations.md)`,
          );
          await routeToFallback();
          return;
        }
      }
      // Rewrite CSS 3D contexts into WebGL-projected canvases BEFORE the
      // layoutsubtree canvas goes in (rects are measured in normal layout).
      // drawElementImage cannot paint 3D rendering contexts — see
      // threeDProjection.ts. No-op for compositions without 3D content.
      const threeD = await initThreeDProjection(page);
      if (!threeD.ok) {
        console.log(
          `[engine] fast capture: falling back to ${session.launchCaptureMode} capture — ` +
            `3D projection init failed (${threeD.reason ?? "unknown"})`,
        );
        await routeToFallback();
        return;
      }
      if (threeD.groups > 0) {
        logInitPhase(
          `3D projection active: ${threeD.groups} context(s), ${threeD.quads} quad(s), ` +
            `${threeD.selfQuads ?? 0} self-quad el(s), ${threeD.stubTargets ?? 0} stub target(s)`,
        );
      }
      await injectDrawElementCanvas(page, session.options.width, session.options.height);
      if (transparent) {
        await initTransparentBackground(session.page);
      }
      session.captureMode = "drawelement";
      session.drawElementReady = true;
      logInitPhase("drawElement canvas injected");
      // Worker-encode pipeline: macOS hardware GPU path only (syncToPaintEvent=true,
      // beginFrameTimeTicks=0). Skip for BeginFrame (Linux/Docker) and transparent
      // (PNG) output — those use the existing synchronous path unchanged.
      const workerEncodeEnabled =
        (session.config?.enableDrawElementWorkerEncode ?? false) &&
        !transparent &&
        session.beginFrameTimeTicks === 0;
      if (workerEncodeEnabled) {
        await initDrawElementWorkerEncode(page);
        session.workerEncodeEnabled = true;
        logInitPhase("drawElement worker encode initialized");
      }
    }
  } else if (session.options.format === "png") {
    await initTransparentBackground(session.page);
  }
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
  // Exception: `useDrawElement=true` with png self-manages the screenshot-browser
  // requirement (both the SwiftShader fallback and the GPU transparent path need
  // a screenshot-launched browser — the SwiftShader path calls Page.captureScreenshot
  // which hangs on a BeginFrame browser, and the GPU path doesn't need BeginFrame
  // because the compositor runs freely on a screenshot-launched browser).
  const headlessShell = resolveHeadlessShellPath(config);
  const isLinux = process.platform === "linux";
  const forceScreenshot = config?.forceScreenshot ?? DEFAULT_CONFIG.forceScreenshot;
  const useDrawElement = config?.useDrawElement ?? false;
  const drawElementTransparent = useDrawElement && options.format === "png";
  // drawElement and page-side shader compositing are mutually incompatible
  // capture strategies: drawElement reads the composition root's paint records
  // directly and skips the prepare→micro-screenshot→resolve protocol (the
  // micro-screenshot would also hang on an opaque/beginframe-launched browser).
  // `resolveConfig` forces page-side compositing off whenever useDrawElement is
  // set, so this only trips for a direct caller that bypassed resolveConfig and
  // passed both flags — warn once and treat page-side as disabled.
  if (
    useDrawElement &&
    (config?.enablePageSideCompositing ?? DEFAULT_CONFIG.enablePageSideCompositing)
  ) {
    console.warn(
      "[engine] useDrawElement is incompatible with page-side shader compositing — " +
        "ignoring enablePageSideCompositing for this render. Prefer resolveConfig, " +
        "which disables page-side compositing automatically for fast-capture renders.",
    );
  }
  // BeginFrame's screenshot does not honor a viewport `deviceScaleFactor`
  // (the captured surface is sized by the OS window in CSS pixels regardless
  // of `Emulation.setDeviceMetricsOverride`'s DPR). When supersampling we
  // need explicit clip+scale on `Page.captureScreenshot`, so fall back to
  // the screenshot path for any DPR > 1.
  const supersampling = (options.deviceScaleFactor ?? 1) > 1;
  const preMode: CaptureMode =
    headlessShell && isLinux && !forceScreenshot && !supersampling && !drawElementTransparent
      ? "beginframe"
      : "screenshot";
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
  // Fast capture: record accelerated canvases (webgl/webgl2/webgpu) and force
  // preserveDrawingBuffer before any page script can create a context — their
  // paint records freeze at the first frame, so captureDrawElementFrame
  // composites their live content via drawImage instead (see
  // instrumentAcceleratedCanvases). Must be registered before navigation.
  if (useDrawElement) {
    await page.evaluateOnNewDocument(instrumentAcceleratedCanvases);
  }
  // Signal the producer's GSAP stub to rewrite `opacity` → `autoAlpha` in
  // tween vars: stacked opacity-0 containers (the caption pattern) keep
  // painting as transparent promoted layers, which breaks drawElementImage
  // capture. Keyed on per-render useDrawElement (not the global fast-capture
  // env) — compile-time-gated renders (video, 3D) set useDrawElement=false
  // in compileStage and must NOT receive the rewrite; applying it to a
  // screenshot render causes up to 21 dB min damage (A/B proven 2026-06-12
  // on gos-pro-promo, 3D-gated). The stub records __hfFadeTargets regardless
  // of this flag (see convertTweenArgs in hf-early-stub.ts) so the
  // stacked-fade gate is always armed even when the rewrite is off.
  // Opt out with HF_FAST_CAPTURE_AUTOALPHA=false.
  if (useDrawElement && process.env.HF_FAST_CAPTURE_AUTOALPHA !== "false") {
    await page.evaluateOnNewDocument(() => {
      (
        window as Window & { __HF_FAST_CAPTURE_AUTOALPHA__?: boolean }
      ).__HF_FAST_CAPTURE_AUTOALPHA__ = true;
    });
  }
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
    launchCaptureMode: captureMode,
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
        "If using CSS/WAAPI/Lottie/Three.js animations, add data-duration to the root element.",
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
        // Only fast-fail when BOTH signals are permanently zero:
        //   1. No GSAP timeline registered (GSAP sets duration synchronously
        //      before __renderReady, so a missing timeline won't self-correct).
        //   2. No data-duration declared on the root element.
        // A composition with a GSAP timeline but no data-duration is still
        // valid — GSAP drives duration via __timelines, not data-duration.
        if (diag.renderReady && diag.hasSeek && !diag.hasTimeline && diag.declaredDuration <= 0) {
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
  // Hosts may opt out of the timeline wait with `data-no-timeline` —
  // compositions driven purely by CSS animations / rAF (the render-compat
  // contract) never register window.__timelines[id], and without the opt-out
  // they stall here for the full playerReadyTimeout (45 s) on every render.
  const expression = `(function() {
    var hosts = document.querySelectorAll("[data-composition-id]");
    if (hosts.length === 0) return true;
    var timelines = window.__timelines || {};
    for (var i = 0; i < hosts.length; i++) {
      if (hosts[i].hasAttribute("data-no-timeline")) continue;
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
        if (hosts[i].hasAttribute("data-no-timeline")) continue;
        var id = hosts[i].getAttribute("data-composition-id");
        if (id && !timelines[id]) m.push(id);
      }
      return m.join(", ");
    })()`);
    console.warn(
      `[FrameCapture] Sub-composition timelines not registered after ${timeoutMs}ms: ${missing}. ` +
        `Compositions that load data asynchronously (e.g. fetch) must register window.__timelines[id] after setup completes. ` +
        `Compositions intentionally driven without GSAP timelines (CSS animations / rAF) can mark the host with data-no-timeline to skip this wait.`,
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

  // Forward browser console to host with [Browser] prefix
  // fallow-ignore-next-line complexity
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

    appendBrowserDiagnostic(session, `${prefix} ${text}`);
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

    const pageReadyTimeout =
      session.config?.playerReadyTimeout ?? DEFAULT_CONFIG.playerReadyTimeout;
    await pollHfReady(page, pageReadyTimeout);
    logInitPhase("pollHfReady complete");

    await pollSubCompositionTimelines(page, pageReadyTimeout);
    logInitPhase("pollSubCompositionTimelines complete");

    await applyVideoMetadataHints(page, session.options.videoMetadataHints);
    logInitPhase("applyVideoMetadataHints complete");

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
    logInitPhase("pollVideosReady complete");
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

    const imagesReady = await pollImagesReady(page, pageReadyTimeout);
    if (!imagesReady) {
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
    logInitPhase("images ready + decoded");

    await page.evaluate(`document.fonts?.ready`);
    logInitPhase("fonts ready");
    await waitForOptionalTailwindReady(page, pageReadyTimeout);
    logInitPhase("tailwind ready");
    await recordSessionInitTelemetry(session, initStart);

    // drawElement or transparent-background init — runs after page is fully ready.
    await initDrawElementOrTransparentBackground(session, page, logInitPhase);

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
  logInitPhase("pollVideosReady complete");

  // Image readiness — parity with pollVideosReady. Defense against remote
  // <img> URLs that bypass the htmlCompiler localize step.
  const bfImagesReady = await pollImagesReady(page, pageReadyTimeout);
  if (!bfImagesReady) {
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
  logInitPhase("images ready + decoded");

  await page.evaluate(`document.fonts?.ready`);
  logInitPhase("fonts ready");
  await waitForOptionalTailwindReady(page, pageReadyTimeout);
  logInitPhase("tailwind ready");
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

  // drawElement or transparent-background init — runs after page is fully ready.
  // IMPORTANT: must stay after beginFrameTimeTicks is set above. The per-frame
  // drawelement branch gates its BeginFrame call on `beginFrameTimeTicks > 0`;
  // if this ran first, ticks would be 0 and the paused compositor would never
  // advance for opaque drawElement on Linux. (In beginframe-launched mode,
  // transparent is always false — useDrawElement+png forces preMode="screenshot"
  // upstream — so the SwiftShader fallback inside the helper is dead-but-harmless
  // defense-in-depth here.)
  await initDrawElementOrTransparentBackground(session, page, logInitPhase);

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
  if (
    hasPendingComposite &&
    session.captureMode !== "beginframe" &&
    session.captureMode !== "drawelement"
  ) {
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
    } else if (session.captureMode === "drawelement") {
      // Advance compositor state via BeginFrame when available (Linux headless-shell);
      // on macOS the compositor advances naturally without BeginFrame.
      if (session.beginFrameTimeTicks > 0) {
        const client = await getCdpSession(page);
        await client.send("HeadlessExperimental.beginFrame", {
          frameTimeTicks: session.beginFrameTimeTicks + frameIndex * session.beginFrameIntervalMs,
          interval: session.beginFrameIntervalMs,
          noDisplayUpdates: false,
          // no screenshot param — we capture via canvas
        });
      }
      screenshotBuffer = await captureDrawElementFrame(
        page,
        options.width,
        options.height,
        options.format ?? "jpeg",
        options.quality ?? 80,
        // Paint-event sync only without BeginFrame (macOS / screenshot-launched):
        // under BeginFrame control the per-frame beginFrame above already painted
        // a fresh snapshot, and no further paint would arrive during a wait.
        session.beginFrameTimeTicks === 0,
      );
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
 * Pipelined drawElement frame capture for the worker-encode path.
 *
 * Performs seek prep + paint-wait + drawElementImage + composite +
 * `createImageBitmap` + transfers the bitmap to the in-page encode worker.
 * Returns `encodeResult` immediately (before the worker finishes encoding).
 * The caller overlaps frame N's encode with frame N+1's produce phase.
 *
 * Requirements:
 *  - `session.workerEncodeEnabled` must be true (set by initializeSession when
 *    `config.enableDrawElementWorkerEncode` is true and mode resolved to drawelement).
 *  - JPEG format only. PNG falls back to `captureFrameToBuffer`.
 *  - macOS hardware GPU path (syncToPaintEvent=true, beginFrameTimeTicks=0).
 *    BeginFrame (Linux) uses the standard synchronous path unchanged.
 */
export async function captureFrameToBufferPipelined(
  session: CaptureSession,
  frameIndex: number,
  time: number,
): Promise<{ encodeResult: Promise<Buffer>; captureTimeMs: number }> {
  const { page, options } = session;
  const startTime = Date.now();

  try {
    const { quantizedTime, seekMs, beforeCaptureMs } = await prepareFrameForCapture(
      session,
      frameIndex,
      time,
    );
    void quantizedTime;

    // Worker-encode is gated to the macOS GPU path (beginFrameTimeTicks === 0,
    // syncToPaintEvent = true); see initDrawElementOrTransparentBackground. The
    // BeginFrame branch present in the synchronous captureFrameCore is therefore
    // unreachable here and intentionally omitted.
    const { encodeResult } = await produceDrawElementFrame(
      page,
      options.width,
      options.height,
      options.quality ?? 80,
      true,
    );

    const captureTimeMs = Date.now() - startTime;

    session.capturePerf.frames += 1;
    session.capturePerf.seekMs += seekMs;
    session.capturePerf.beforeCaptureMs += beforeCaptureMs;
    // screenshotMs reflects produce time only (encode is async, not tracked here)
    session.capturePerf.screenshotMs += captureTimeMs - seekMs - beforeCaptureMs;
    session.capturePerf.totalMs += captureTimeMs;

    return { encodeResult, captureTimeMs };
  } catch (captureError) {
    // Mirror captureFrameCore: capture per-frame diagnostics (frame-error
    // PNG/HTML/JSON + console tail) before rethrowing so pipelined-path
    // failures are debuggable like the serial path.
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
  if (session.workerEncodeEnabled && session.page && !session.pageReleased) {
    cleanupDrawElementWorkerEncode(session.page);
  }
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
