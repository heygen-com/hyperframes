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
  ensureRenderFrameSiblings,
  getCdpSession,
  pageScreenshotCapture,
  initTransparentBackground,
  shouldDefaultCaptureBeyondViewport,
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
  produceDrawElementFrameBatch,
} from "./drawElementService.js";
import { initThreeDProjection, detectCssEffectRisk } from "./threeDProjection.js";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";
import type {
  CaptureOptions,
  CaptureVideoMetadataHint,
  CaptureResult,
  CaptureBufferResult,
  CapturePerfSummary,
  SubTimelineWaitOutcome,
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
  /**
   * Script resources that failed to load (request failure or HTTP >= 400).
   * pollSubCompositionTimelines fail-fasts on these: a comp whose timeline
   * script 404'd can never register window.__timelines[id], so waiting the
   * full playerReadyTimeout (45s) buys nothing (~1% of wild local renders
   * were hitting that wall — a 705-render spike at the 45s setup bucket).
   */
  scriptLoadFailures: string[];
  /** Outcome of the sub-composition timeline wait: ready | timeout | script_failure. */
  subTimelineWaitOutcome?: SubTimelineWaitOutcome;
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
    /** Per-frame capture durations (batch frames get the batch mean). Basis for
     * the warmup-robust p50 in the perf summary. */
    frameMs: number[];
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
  /**
   * Frame indices that must be captured via screenshot rather than drawElement.
   * Populated at init by the clip-cut boundary predictor (Lim 6): frames where
   * the outgoing clip is dropped a frame before the incoming clip's paint record
   * is ready → black frame. Controlled by `HF_FAST_CAPTURE_BOUNDARY_SS=false`.
   * Empty/undefined when the predictor produces no frames.
   */
  clipBoundaryFrames?: Set<number>;
  /** Rolling drawElement frame byte-sizes (last ~60), for silent-blank-drop detection:
   * drawElement intermittently returns an anomalously small (blank) frame with no
   * throw; a frame far below the running median is re-captured via screenshot. */
  deFrameSizes?: number[];
  /** Last non-deduped encode result, reused for a static frame on the drawElement
   * worker-encode path (mirrors `lastFrameBuffer` on the screenshot path). Only set
   * when static-frame dedup is armed on the drawElement path. */
  lastEncodeResult?: Promise<Buffer>;
  /** Frame index lastEncodeResult belongs to — static-dedup reuse must verify
   * every frame in (lastEncodeResultFrame, i] is predicted-static (under the
   * interleaved parallel stride the "previous" produced frame is i−N, and
   * reusing it for frame i is only valid when the whole gap is static). */
  lastEncodeResultFrame?: number;
  /** Per-render self-verification ground truth (ungated-release safety net):
   * K screenshot frames captured at init BEFORE the drawElement canvas is
   * injected (the only window where a page screenshot shows the live DOM, not
   * the capture canvas's stale bitmap). The producer drain compares the DE
   * frame at each index against these; a breach aborts the render with
   * DrawElementVerificationError and the orchestrator re-renders via the
   * screenshot path. */
  deVerifyFrames?: Map<number, Buffer>;
  /** Low-cardinality init-gate reason when drawElement routed to baseline (telemetry). */
  deGateReason?: string;
  /** Wall-clock ms spent capturing self-verification ground truth at init (telemetry). */
  deVerifyInitMs?: number;
  /** Count of per-frame "No cached paint record" screenshot fallbacks (telemetry). */
  deNcprFallbacks?: number;
  /**
   * drawElement init passed every gate but stopped before verification +
   * canvas injection: the session has no video-frame injector yet (probe
   * sessions initialize before extraction) and the comp has <video> elements,
   * so ground-truth screenshots would capture black video boxes. The capture
   * stage completes the init via completeDeferredDrawElementInit once
   * prepareCaptureSessionForReuse attaches the injector.
   */
  deInitDeferred?: boolean;
}

/**
 * drawElement self-verification failure — a captured DE frame diverged from its
 * pre-injection screenshot ground truth (or a blank frame survived a retry).
 * The orchestrator catches this and re-renders the whole job with
 * forceScreenshot. Discriminant-based guard (not instanceof) so it survives
 * duplicated module instances across package boundaries.
 */
export class DrawElementVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrawElementVerificationError";
    // Discriminant property, assigned dynamically: isDrawElementVerificationError
    // reads it structurally so detection survives duplicated module instances
    // across package boundaries (where instanceof fails).
    (this as unknown as { deVerificationFailure: boolean }).deVerificationFailure = true;
  }
}

export function isDrawElementVerificationError(err: unknown): boolean {
  // Walk the cause chain — the producer wraps capture errors (CaptureStageError).
  let e: unknown = err;
  for (let depth = 0; depth < 5 && typeof e === "object" && e !== null; depth++) {
    if ((e as { deVerificationFailure?: boolean }).deVerificationFailure === true) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
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
  // DIAGNOSTIC ONLY — HF_FORCE_DRAWELEMENT=1 forces the drawElement path,
  // bypassing every compile/init gate AND the compatibility hints (it overrides
  // forceScreenshot). Exists for upstream-Chromium repro work (isolating gate
  // behavior from drawElementImage behavior, e.g. the crbug 521861819 149-vs-151
  // comparison) and for R&D on gated effect classes. Renders under this flag may
  // be DAMAGED by design — the gates it skips exist because measured damage
  // (blur/backdrop ~18-49dB, 3D backface, SwiftShader sub-layer drops) is real.
  // Never set it in production; it is intentionally not documented in user-facing
  // help, and the safety-net blank guard also stands down under it so diagnostic
  // frames arrive unmodified.
  const forceDE = process.env.HF_FORCE_DRAWELEMENT === "1";
  const useDrawElement =
    ((session.config?.useDrawElement ?? false) || forceDE) &&
    !supersampling &&
    (!forceScreenshot || forceDE);
  if ((session.config?.useDrawElement ?? false) && supersampling) {
    session.deGateReason = "supersampling";
    console.log(
      "[engine] --experimental-fast-capture disabled for this render: drawElementImage " +
        "ignores deviceScaleFactor, so supersampled (DPR > 1) output uses screenshot capture.",
    );
  }
  if ((session.config?.useDrawElement ?? false) && !supersampling && forceScreenshot) {
    session.deGateReason = "render_mode_hint";
    console.log(
      "[engine] fast capture: falling back to screenshot — render-mode compatibility " +
        "hint forced screenshot capture (e.g. raw requestAnimationFrame composition).",
    );
  }
  if (useDrawElement) {
    session.isSwiftShader = await detectSwiftShader(page);
    const transparent = session.options.format === "png";
    async function routeToFallback(): Promise<void> {
      session.captureMode = session.launchCaptureMode;
      if (transparent) {
        await initTransparentBackground(session.page);
      }
      // Static-frame dedup is capture-mode-independent (the serial path reuses
      // lastFrameBuffer regardless of how the frame was captured) and lossless
      // (anchor-verified). A comp only reaches THIS fallback with useDrawElement=true
      // AND forceScreenshot=false — i.e. it is deterministic: raw-rAF / iframe /
      // htmlInCanvas comps are forced to screenshot upstream (forceScreenshot=true) and
      // never enter this block, so they never arm dedup. The comps that DO fall back here
      // (blur / backdrop / 3D / at-risk) carry only a compositor
      // EFFECT drawElement can't paint, not nondeterminism, so their predicted-static set
      // is sound. Verification seeks via Page.captureScreenshot, which hangs on a
      // BeginFrame-launched browser — gate on the launch mode (macOS fast-capture launches
      // screenshot-mode; Linux/Docker launches beginframe and is skipped).
      if (session.launchCaptureMode === "screenshot") {
        await armStaticDedup(session, page, logInitPhase);
      }
    }
    // Capability gate: `canvas.drawElementImage` is an unlaunched Blink feature
    // that only exists on recent Dev/Canary Chrome builds (~151+); it is absent
    // from Stable and from most pinned/system Chrome installs. The
    // `--enable-features=CanvasDrawElement` flag no-ops silently on a build that
    // doesn't implement it, so without this probe the first drawElementImage()
    // call throws `TypeError: ... is not a function` deep inside the capture
    // loop and takes the whole render down instead of falling back (HF#2060).
    // Cheap (no paint-wait) and must run before any other drawElement work.
    // Not gated by forceDE (HF_FORCE_DRAWELEMENT, an R&D knob that bypasses the
    // quality gates below to measure raw damage) — there's no "forced but
    // degraded" mode for a method that doesn't exist, only a crash, so this
    // always routes to the fallback instead.
    const supportsDrawElement = await page.evaluate(() => {
      const c = document.createElement("canvas");
      const ctx = c.getContext("2d");
      return (
        typeof (ctx as unknown as { drawElementImage?: unknown })?.drawElementImage === "function"
      );
    });
    if (!supportsDrawElement) {
      session.deGateReason = "unsupported_chrome";
      console.log(
        `[engine] fast capture: falling back to ${session.launchCaptureMode} capture — ` +
          "this Chrome build does not implement canvas.drawElementImage (Dev/Canary-only " +
          "feature, ~151+); run `hyperframes browser ensure --force` to fetch a supported " +
          "build, or set HYPERFRAMES_BROWSER_PATH to one.",
      );
      await routeToFallback();
      return;
    }
    // SwiftShader gate: drawElement's only advantage is skipping the GPU→CPU
    // screenshot-readback IPC. On a software rasterizer (Docker/CI, no GPU) both
    // paths block on identical software raster, so drawElement is parity-or-slower
    // — route to the platform baseline.
    //
    // Two gates were REMOVED here once Chrome 151 fixed crbug 521861819
    // (drawElementImage dropped compositor-promoted opacity layers mid-fade):
    //   - the <video> gate (a proxy for the word-by-word caption opacity pattern,
    //     Lim 2), and
    //   - the stacked-fade gate (>=2 overlapping viewport-scale opacity-fade targets).
    // Both reproduced on Chrome <=150 (video+caption-fade ~12 dB; stacked fade
    // 24.5 dB) and both render correctly on 151 (verified: video+nested-fade repro
    // PSNR=inf; efb59c5b 24.5→47.4 dB, 0 damaged frames). 151 is the pinned floor.
    const mode = resolveDrawElementCaptureMode(session.isSwiftShader, transparent);
    if (mode === "screenshot") {
      session.deGateReason = "swiftshader";
      // Fall back to the browser's LAUNCH mode, not unconditionally to
      // "screenshot": on a BeginFrame-launched browser (Linux fast capture)
      // Page.captureScreenshot hangs for the full protocol timeout, while
      // beginFrameCapture is the platform's normal baseline path.
      console.log(
        `[engine] fast capture: falling back to ${session.launchCaptureMode} capture — ` +
          "SwiftShader (software rasterizer — no GPU egress to skip, drawElement is " +
          "parity-or-slower; see fast-capture-limitations.md)",
      );
      await routeToFallback();
    } else {
      // CSS-effect gate: backdrop-filter samples the compositor backdrop and
      // filter:blur/drop-shadow render differently through the paint-record
      // path — drawElementImage can't reproduce either, producing 18–49 dB
      // damaged frames (community eval). Fall back to the platform baseline.
      // HF_FAST_CAPTURE_CSSFX=true bypasses for R&D.
      if (!forceDE && process.env.HF_FAST_CAPTURE_CSSFX !== "true") {
        const cssFx = await detectCssEffectRisk(page);
        if (cssFx) {
          session.deGateReason = `css_effect:${(cssFx.split(":")[0] ?? "").replace(/[^a-z-]/gi, "")}`;
          console.log(
            `[engine] fast capture: falling back to ${session.launchCaptureMode} capture — ` +
              `${cssFx} detected (drawElementImage cannot reproduce it; see fast-capture-limitations.md)`,
          );
          await routeToFallback();
          return;
        }
      }
      // Lim 7: timeline-interval at-risk predictor. Walk window.__timelines and
      // find tweens animating compositor-incompatible props (opacity, filter,
      // blend-mode, 3D transform, clip-path, mask). drawElementImage drops these
      // mid-animation (crbug 521861819 et al), and whether it drops a given one
      // cannot be told reliably without rendering (jump-seek != sequential render,
      // proven 2026-06-16) nor from geometry (size is a proxy, not the mechanism).
      // The only deterministic + reliable route to 0 damage is to gate on the
      // PRESENCE of any such tween — a pure fact of the declared timeline, the same
      // every run. Conservative by design: comps whose risky tweens drawElement
      // would have handled also fall back, but correctness is never at risk and the
      // fast path stays open for static + plain-2D-transform comps (x/y/scale are
      // NOT in the at-risk set). Tune the gate's frame-fraction floor with
      // HF_FAST_CAPTURE_INTERVAL_FRACTION (default 0 = any at-risk frame gates).
      // Must run BEFORE canvas injection so a whole-comp fallback doesn't leave the
      // drawElement canvas wrapping the composition root. Disable with
      // HF_FAST_CAPTURE_INTERVAL_SS=false.
      if (!forceDE && process.env.HF_FAST_CAPTURE_INTERVAL_SS !== "false") {
        const fps = fpsToNumber(session.options.fps);
        const { frames: atRisk, totalFrames } = await computeTimelineAtRiskFrames(page, fps);
        const atRiskFraction = atRisk.size / totalFrames;
        const fractionFloor = Number(process.env.HF_FAST_CAPTURE_INTERVAL_FRACTION ?? "0");
        logInitPhase(
          `timeline at-risk predictor: ${atRisk.size}/${totalFrames} frames (${Math.round(atRiskFraction * 100)}%)`,
        );
        if (atRisk.size > 0 && atRiskFraction > fractionFloor) {
          session.deGateReason = "at_risk_timeline";
          console.log(
            `[engine] fast capture: falling back to ${session.launchCaptureMode} capture — ` +
              `${atRisk.size}/${totalFrames} frames animate a compositor-incompatible prop ` +
              `(blend/3D/clip/mask); drawElementImage drops these mid-animation ` +
              `(deterministic timeline gate; see fast-capture-limitations.md Lim 7)`,
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
      if (!forceDE && !threeD.ok) {
        session.deGateReason = "3d_init_failed";
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
      // Task B: arm static-frame dedup here — drawElement is confirmed (all gates
      // passed) and the DOM is still normal (canvas not yet injected, so the
      // verification screenshots are valid). drawElement-path only; see armStaticDedup.
      await armStaticDedup(session, page, logInitPhase);
      // Video comps on injector-less sessions (probe sessions initialize before
      // video extraction) DEFER the rest of the drawElement init: ground-truth
      // screenshots would capture black <video> boxes, and once the canvas is
      // injected they can never be retaken. The capture stage completes the
      // init after prepareCaptureSessionForReuse attaches the injector.
      if (!session.onBeforeCapture && !forceDE) {
        const hasVideos = await page.evaluate(() => document.querySelector("video") !== null);
        if (hasVideos) {
          session.deInitDeferred = true;
          logInitPhase("drawElement init deferred: video comp awaiting frame injector");
          return;
        }
      }
      await finalizeDrawElementInit(session, page, logInitPhase, { transparent, forceDE });
    }
  } else if (session.options.format === "png") {
    await initTransparentBackground(session.page);
  }
}

/**
 * The tail of drawElement init: self-verification ground truth (pre-injection),
 * canvas injection, capture-mode flip, clip-boundary predictor, worker-encode.
 * Runs inline when the session already has its video-frame injector (or the
 * comp has no videos); runs deferred via completeDeferredDrawElementInit for
 * probe-initialized video comps.
 */
async function finalizeDrawElementInit(
  session: CaptureSession,
  page: Page,
  logInitPhase: (phase: string) => void,
  opts: { transparent: boolean; forceDE: boolean },
): Promise<void> {
  const { transparent, forceDE } = opts;
  // Self-verification ground truth: must run pre-injection — after the canvas
  // wraps the root, a page screenshot shows the canvas's last-drawn bitmap,
  // not the live DOM (see the Lim 6 boundary-screenshot note).
  {
    const verifyStart = Date.now();
    await captureDeVerificationFrames(session, page, logInitPhase);
    session.deVerifyInitMs = Date.now() - verifyStart;
  }
  await injectDrawElementCanvas(page, session.options.width, session.options.height);
  if (transparent) {
    await initTransparentBackground(session.page);
  }
  session.captureMode = "drawelement";
  session.drawElementReady = true;
  logInitPhase("drawElement canvas injected");
  // Lim 6: clip-cut boundary frames — screenshot these instead of drawElement.
  if (process.env.HF_FAST_CAPTURE_BOUNDARY_SS !== "false" && !forceDE) {
    const fps = fpsToNumber(session.options.fps);
    const boundaryFrames = await computeClipBoundaryFrames(page, fps);
    if (boundaryFrames.size > 0) {
      session.clipBoundaryFrames = boundaryFrames;
      logInitPhase(`screenshot fallback: ${boundaryFrames.size} clip-boundary frame(s)`);
    }
  }
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

/**
 * Complete a deferred drawElement init (see CaptureSession.deInitDeferred).
 * Call after prepareCaptureSessionForReuse has attached the video-frame
 * injector; no-op when the session is not deferred or still has no injector.
 */
export async function completeDeferredDrawElementInit(session: CaptureSession): Promise<void> {
  if (!session.deInitDeferred || !session.onBeforeCapture) return;
  const page = session.page;
  const logInitPhase = (phase: string) =>
    console.log(`[initSession:${session.captureMode}] ${phase} (deferred drawElement init)`);
  await finalizeDrawElementInit(session, page, logInitPhase, {
    transparent: session.options.format === "png",
    forceDE: process.env.HF_FORCE_DRAWELEMENT === "1",
  });
  session.deInitDeferred = false;
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
  // The opacity → autoAlpha tween rewrite was RETIRED with the requestPaint
  // contract adoption (crbug 529829538 closed WAI): a requestPaint-driven
  // paint refreshes nested opacity layers natively, and the rewrite itself
  // measured ~28 dB of damage on comps whose fades it touched. Warn instead
  // of silently ignoring the old escape hatch.
  if (process.env.HF_FAST_CAPTURE_AUTOALPHA !== undefined) {
    console.warn(
      "[engine] HF_FAST_CAPTURE_AUTOALPHA is retired and ignored — the requestPaint " +
        "paint contract captures animated opacity natively (see drawElementService.ts).",
    );
  }
  // Re-apply the captured root's own compositor-applied props to the 2D
  // context where the snapshot does not carry them (see the correction
  // comment in drawElementService.ts drawAndEncode: transform always —
  // never baked, verified under the requestPaint contract 2026-07-07;
  // opacity ratio only on non-requestPaint paints, where the snapshot holds
  // the load-time value). On by default; disable with
  // HF_FAST_CAPTURE_ROOT_PROPS=false.
  if (useDrawElement && process.env.HF_FAST_CAPTURE_ROOT_PROPS !== "false") {
    await page.evaluateOnNewDocument(() => {
      (window as unknown as { __HF_ROOT_PROPS__?: boolean }).__HF_ROOT_PROPS__ = true;
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
    scriptLoadFailures: [],
    capturePerf: {
      frames: 0,
      seekMs: 0,
      beforeCaptureMs: 0,
      screenshotMs: 0,
      totalMs: 0,
      frameMs: [],
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

export async function pollSubCompositionTimelines(
  page: Page,
  timeoutMs: number,
  intervalMs: number = 150,
  // Fail-fast hook: when a SCRIPT resource failed to load (404 / request
  // failure), the timeline registration it carried can never arrive — the
  // full-timeout wait buys nothing (measured: a 705-render spike at the 45s
  // setup bucket in 30 days of wild local renders, ~1% of renders, each also
  // shipping silently-broken animations). Once failures are present the poll
  // is cut to `scriptFailureGraceMs` from its start.
  getScriptLoadFailures?: () => readonly string[],
  scriptFailureGraceMs: number = 2_000,
): Promise<SubTimelineWaitOutcome> {
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
  const start = Date.now();
  const deadline = start + timeoutMs;
  let ready = false;
  let scriptFailureBail = false;
  for (;;) {
    ready = Boolean(await page.evaluate(expression));
    if (ready) break;
    const now = Date.now();
    if (now >= deadline) break;
    const failures = getScriptLoadFailures?.() ?? [];
    if (failures.length > 0 && now - start >= scriptFailureGraceMs) {
      scriptFailureBail = true;
      console.warn(
        `[FrameCapture] Sub-composition timeline wait cut short after ${now - start}ms: ` +
          `script resource(s) failed to load (${failures.join(", ")}) — ` +
          `the timeline registration they carry can never arrive. ` +
          `Fix the script reference; the render proceeds without those animations.`,
      );
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
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
    return "ready";
  }
  // Enumerate the still-unregistered composition ids regardless of bail
  // reason — a script-failure bail used to skip this entirely, so a render
  // with multiple sub-compositions only named the failed script URL(s), not
  // which composition(s) it was still waiting on (review).
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
  if (scriptFailureBail) {
    console.warn(`[FrameCapture] Composition(s) still waiting on the failed script: ${missing}.`);
  } else {
    console.warn(
      `[FrameCapture] Sub-composition timelines not registered after ${timeoutMs}ms: ${missing}. ` +
        `Compositions that load data asynchronously (e.g. fetch) must register window.__timelines[id] after setup completes. ` +
        `Compositions intentionally driven without GSAP timelines (CSS animations / rAF) can mark the host with data-no-timeline to skip this wait.`,
    );
  }
  return scriptFailureBail ? "script_failure" : "timeout";
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

// A 4xx `response` and a `requestfailed` can both fire for the same script
// (e.g. a `requestfailed` following the 4xx), and repeated <script> tags for
// the same URL duplicate it further — dedupe so the fail-fast warning names
// each failed URL once.
function recordScriptLoadFailure(session: CaptureSession, url: string): void {
  if (!session.scriptLoadFailures.includes(url)) {
    session.scriptLoadFailures.push(url);
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
    if (request.resourceType() === "script") {
      recordScriptLoadFailure(session, request.url());
    }
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
    if (request.resourceType() === "script") {
      recordScriptLoadFailure(session, response.url());
    }
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

    session.subTimelineWaitOutcome = await pollSubCompositionTimelines(
      page,
      pageReadyTimeout,
      undefined,
      () => session.scriptLoadFailures,
    );
    logInitPhase(`pollSubCompositionTimelines complete (${session.subTimelineWaitOutcome})`);

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

    // drawElement or transparent-background init — runs after page is fully ready.
    await initDrawElementOrTransparentBackground(session, page, logInitPhase);

    await armStaticDedup(session, session.page, logInitPhase);
    await ensureRenderFrameSiblings(session.page);
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

  session.subTimelineWaitOutcome = await pollSubCompositionTimelines(
    page,
    pageReadyTimeout,
    undefined,
    () => session.scriptLoadFailures,
  );
  logInitPhase(`pollSubCompositionTimelines complete (${session.subTimelineWaitOutcome})`);

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

  // Stop warmup, then drain the loop in BOTH modes before any further
  // BeginFrame on this session (drawElement init, the render-frame commit tick
  // at the end of init, and frame 0). Clearing the flag only stops new
  // iterations — a warmup `HeadlessExperimental.beginFrame` may still be in
  // flight, and a second beginFrame on the same session while one is pending
  // fails with "Another frame is pending". Locked mode additionally needs the
  // await to reach the exact LOCKED_WARMUP_TICKS count before deriving the
  // baseline below.
  warmupState.running = false;
  await warmupLoopPromise.catch(() => {});

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

  await armStaticDedup(session, session.page, logInitPhase);

  // Pre-create the hidden `__render_frame__` siblings so the first per-session
  // `injectVideoFramesBatch` takes the `hasImg = true` (src-update) path instead
  // of inserting a fresh `<img>` mid-capture. Then drive ONE non-capture,
  // *visual* BeginFrame (`noDisplayUpdates: false`) to actually composite the
  // new layers before the first real capture. The warmup ticks above are
  // `noDisplayUpdates: true` (they advance the clock but don't paint), and the
  // seek in `prepareFrameForCapture` doesn't tick, so without this commit tick
  // the first *display-producing* BeginFrame would be the capture itself — and
  // the freshly-inserted layers would miss it (the per-session worker-boundary
  // near-black flash). The tick time sits in the gap between the last warmup
  // tick and frame 0 (`beginFrameTimeTicks` carries +10 intervals of headroom),
  // so ticks stay monotonic and no render frame is consumed.
  //
  // It must land BELOW the producer's BeginFrame liveness probe, which fires
  // from probeStage right after init at `beginFrameTimeTicks - 5·interval`
  // (screenshotService.probeBeginFrameLiveness). This commit tick is sent during
  // init — temporally before the probe — so if its tick were above the probe's,
  // the probe would run backwards in BeginFrame time (non-monotonic) and
  // chrome-headless-shell stalls it indefinitely (surfaced as a "SwiftShader
  // heavy-layer" probe timeout, then routed to screenshot capture). At the
  // original `-1·interval` that stalled every comp reaching the probe; at
  // `-6·interval` the order stays warmup < commit < probe < capture.
  await ensureRenderFrameSiblings(page);
  const commitCdp = await getCdpSession(page);
  await commitCdp.send("HeadlessExperimental.beginFrame", {
    frameTimeTicks: session.beginFrameTimeTicks - 6 * session.beginFrameIntervalMs,
    interval: session.beginFrameIntervalMs,
    noDisplayUpdates: false,
  });

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
export async function computeStaticFrameSet(
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
      vars?: Record<string, unknown>;
    };
    const intervals: Array<{ start: number; end: number }> = [];
    let tweenCount = 0;
    // totalDuration() (NOT duration()): a repeat/yoyo tween animates past one iteration;
    // a repeating timeline is marked opaque over its whole span (conservative).
    // A GSAP tl.call() is a zero-duration tween whose vars wire the callback as
    // onComplete (and onReverseComplete, fired on backward crossing — GSAP has
    // no separate "undo" callback, so both directions invoke the SAME forward
    // side effect). A one-shot DOM mutation driven this way (e.g. a counter's
    // textContent) is not seek-idempotent: crossing it during the static-dedup
    // verifier's own arm-time seeking permanently mutates the page, and that
    // corruption can leak into a LATER, unrelated static run's real capture
    // (the verifier's mismatch check only catches drift within the run being
    // checked, not contamination from a run checked afterward). No reliable
    // way to tell a DOM-mutating call() from a harmless one (analytics ping,
    // class toggle with no visual effect) without executing it, so disqualify
    // the whole comp on ANY call() rather than risk shipping wrong pixels.
    let hasTimelineCall = false;
    function walk(tl: AnyTween, offset: number): void {
      if (typeof tl.getChildren !== "function") return;
      for (const child of tl.getChildren(false, true, true)) {
        const start = offset + (typeof child.startTime === "function" ? child.startTime() : 0);
        const single = typeof child.duration === "function" ? child.duration() : 0;
        const total = typeof child.totalDuration === "function" ? child.totalDuration() : single;
        if (typeof child.getChildren === "function") {
          if (total > single + 1e-6) {
            intervals.push({ start, end: start + total });
            // Still descend for hasTimelineCall even though the repeating
            // span is already opaque (its frames are excluded from dedup
            // regardless): a call() inside it is a review-flagged detection
            // gap otherwise — the arm-time verifier can still forward-seek
            // through this span while checking a LATER static run, firing
            // the call() and corrupting the page (review).
            walk(child, start);
          } else {
            walk(child, start);
          }
        } else {
          tweenCount++;
          intervals.push({ start, end: start + total });
          if (
            total <= 1e-6 &&
            (typeof child.vars?.onComplete === "function" ||
              typeof child.vars?.onReverseComplete === "function")
          ) {
            hasTimelineCall = true;
          }
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
      hasTimelineCall,
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
    hasTimelineCall,
  } = result as {
    intervals: Array<{ start: number; end: number }>;
    tweenCount: number;
    duration: number;
    hasVideo: boolean;
    hasCanvas: boolean;
    hasNonGsapAnim: boolean;
    hasUnresolvableClipStart: boolean;
    hasTimelineCall: boolean;
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
  // tl.call() side effects are not seek-idempotent (see hasTimelineCall detection
  // above) — the arm-time verifier's own forward-seeking can permanently fire
  // one, corrupting the page for a later, unrelated static run's real capture
  // even though each run's own verification passes in isolation (HF static-
  // dedup content-drift report, tools-onboarding FR render).
  if (hasTimelineCall) reasons.push("tl.call() side effect (not seek-safe)");
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

// Fixed density target for verification checks: never leave a gap wider than this
// many frames within a run, independent of the user-tunable sampleCount. This is
// what fixes long runs going nearly unverified — deliberately NOT derived from
// sampleCount, so that knob's effect on density stays monotonic (see below).
const STATIC_VERIFY_REFERENCE_STRIDE = 24;

/**
 * Interior verification points for a run [a..b], plus the always-included end `b`.
 * Density used to be a flat point-count cap (min(sampleCount, 8)), so a run's
 * stride grew with its span — on a long run (many merged static frames), two
 * checks could land hundreds of frames apart. A genuine content change in
 * between (e.g. text swapped by a mechanism computeStaticFrameSet's GSAP-only
 * tween walk can't see) then hides between samples and the whole run gets
 * wrongly trusted as static.
 *
 * `sampleCount` (HF_STATIC_DEDUP_SAMPLES) is a per-run point-count FLOOR, not a
 * stride cap — raising it always increases density, never decreases it. (An
 * earlier revision of this fix bounded the stride BY sampleCount directly, which
 * inverted that: raising sampleCount widened the allowed gap instead of shrinking
 * it, and the "raise HF_STATIC_DEDUP_SAMPLES to verify more" log guidance became
 * backwards for exactly the long runs it's meant to help.) The length-scaling
 * fix itself comes from STATIC_VERIFY_REFERENCE_STRIDE, which is independent of
 * sampleCount, so density scales with run length regardless of how that knob is
 * set; sampleCount only ever raises density further above that floor.
 *
 * Pure and exported so its scaling behavior is unit-testable without a real
 * page/browser.
 */
export function computeStaticVerificationPoints(
  a: number,
  b: number,
  sampleCount: number,
): number[] {
  const span = b - a;
  const lengthScaledPoints = span > 0 ? Math.ceil(span / STATIC_VERIFY_REFERENCE_STRIDE) + 1 : 1;
  const perRun = Math.max(3, sampleCount, lengthScaledPoints);
  const stride = span > 0 ? Math.max(1, Math.floor(span / (perRun - 1))) : 1;
  const pts = new Set<number>();
  for (let f = a; f <= b; f += stride) pts.add(f);
  pts.add(b);
  return [...pts].sort((x, y) => x - y);
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
export async function verifyStaticFramesSafe(
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
  const seekToFrame = async (frameIdx: number): Promise<void> => {
    const t = quantizeTimeToFrame(frameIdx / fps, fps);
    await page.evaluate((tt: number) => {
      const hf = (
        window as unknown as {
          __hf?: { seek?: (t: number, options?: { suppressEvents?: boolean }) => void };
        }
      ).__hf;
      if (hf && typeof hf.seek === "function") hf.seek(tt, { suppressEvents: true });
    }, t);
  };
  const seekCapture = async (frameIdx: number): Promise<Buffer> => {
    await seekToFrame(frameIdx);
    return pageScreenshotCapture(page, session.options);
  };
  // Verify EVERY run in order (no longest-first truncation that would leave runs armed
  // but unverified). Per run, compare the FIRST reused frame `a`, the END `b` (max
  // accumulated drift), and interior points at a stride (see computeStaticVerificationPoints)
  // — against the anchor the run actually reuses.
  //
  // hardCap bounds pathological cases and hitting it DISABLES dedup (conservative:
  // never trust an unverified set). It must scale with the new density model:
  // each run now costs roughly span/STATIC_VERIFY_REFERENCE_STRIDE + 1 checks (plus
  // one anchor), not the ~8 the old flat point cap cost — sizing the budget only off
  // sampleCount (which no longer drives density for long runs) would make a
  // genuinely-static long composition spuriously disarm under the new, more
  // thorough checking. `frames.length` approximates total interior checks; a 3x
  // margin absorbs per-run anchor overhead and the 3-point floor on short runs.
  const hardCap = Math.max(
    sampleCount * 8,
    400,
    Math.ceil(frames.length / STATIC_VERIFY_REFERENCE_STRIDE) * 3 + runs.length,
  );
  try {
    let spent = 0;
    for (const { a, b } of runs) {
      const anchor = a - 1;
      if (anchor < 0) continue;
      const anchorBuf = await seekCapture(anchor);
      spent++;
      for (const f of computeStaticVerificationPoints(a, b, sampleCount)) {
        const cur = await seekCapture(f);
        spent++;
        if (!anchorBuf.equals(cur)) return { badFrame: f, budgetExhausted: false };
      }
      // Budget exhausted → can't fully verify → disarm, distinct from real drift so a
      // `verification_budget` spike in telemetry reads as "this composition has a lot
      // of static material to verify," not "compositions are non-static."
      if (spent > hardCap) return { badFrame: a, budgetExhausted: true };
    }
    return null;
  } finally {
    await seekToFrame(0).catch(() => {});
  }
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
  // Idempotent: the drawElement init path arms dedup BEFORE canvas injection
  // (verification screenshots need the un-injected DOM), and initializeSession
  // calls this again unconditionally afterwards. Once staticFrames is
  // populated, re-running would overwrite the armed state with
  // skipReason="capture_mode" (captureMode is "drawelement" by then) —
  // contradictory telemetry — and re-run the verification seeks. No-op instead.
  if (session.staticFrames || session.staticDedupSkipReason) return;
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
            `too much predicted-static material to fully verify — this is the safe fallback, not an error)`
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
 * Walk window.__timelines and collect frame intervals where GSAP tweens animate
 * compositor-incompatible properties (blend-mode, 3D transforms, clip-path, mask).
 * drawElement cannot reproduce these effects mid-tween → capture those frames via
 * screenshot instead. opacity/filter fades were dropped from the set once Chrome 151
 * fixed crbug 521861819. See docs/fast-capture-limitations.md Lim 7.
 *
 * Returns the union of at-risk frame indices (±1 margin around each tween interval)
 * and totalFrames (for fraction computation by the caller).
 */
async function computeTimelineAtRiskFrames(
  page: Page,
  fps: number,
): Promise<{ frames: Set<number>; totalFrames: number }> {
  const result = await page.evaluate(() => {
    // opacity/autoAlpha/filter fades were removed from this set once Chrome 151
    // fixed crbug 521861819 (drawElementImage dropped promoted opacity layers
    // mid-fade) — those now render correctly on the drawElement path. backdrop-filter
    // and filter:blur stay gated by detectCssEffectRisk (architectural single-element
    // capture limit, not 521861819). What remains here is the per-tween backstop for
    // effects drawElementImage still cannot reproduce mid-animation: mix-blend-mode,
    // CSS 3D transforms (crbug 522872457), clip-path, and mask.
    const AT_RISK_PROPS = new Set([
      "backdropFilter",
      "backdrop-filter",
      "mixBlendMode",
      "mix-blend-mode",
      "rotationX",
      "rotationY",
      "rotateX",
      "rotateY",
      "z",
      "translateZ",
      "clipPath",
      "clip-path",
      "maskImage",
      "mask",
    ]);

    type AnyTween = {
      startTime(): number;
      duration(): number;
      vars?: Record<string, unknown>;
      getChildren?(nested: boolean, tweens: boolean, timelines: boolean): AnyTween[];
    };

    function walkTimeline(
      tl: AnyTween,
      offset: number,
      out: Array<{ start: number; end: number }>,
    ): void {
      if (typeof tl.getChildren !== "function") return;
      for (const child of tl.getChildren(false, true, true)) {
        const childStart = offset + (typeof child.startTime === "function" ? child.startTime() : 0);
        const childDur = typeof child.duration === "function" ? child.duration() : 0;
        if (typeof child.getChildren === "function") {
          walkTimeline(child, childStart, out);
        } else {
          const vars = child.vars || {};
          if (Object.keys(vars).some((k) => AT_RISK_PROPS.has(k))) {
            out.push({ start: childStart, end: childStart + childDur });
          }
        }
      }
    }

    const w = window as unknown as {
      __timelines?: Record<string, AnyTween>;
      __hf?: { duration?: number };
    };
    const timelines = w.__timelines || {};
    const intervals: Array<{ start: number; end: number }> = [];
    for (const tl of Object.values(timelines)) {
      if (tl && typeof tl.getChildren === "function") {
        walkTimeline(tl, 0, intervals);
      }
    }
    const duration = w.__hf?.duration ?? 0;
    return { intervals, duration };
  });

  const { intervals, duration } = result as {
    intervals: Array<{ start: number; end: number }>;
    duration: number;
  };
  const frames = new Set<number>();
  for (const { start, end } of intervals) {
    const lo = Math.floor(start * fps) - 1;
    const hi = Math.ceil(end * fps) + 1;
    for (let f = Math.max(0, lo); f <= hi; f++) {
      frames.add(f);
    }
  }
  const totalFrames = Math.max(1, Math.ceil(duration * fps));
  return { frames, totalFrames };
}
/**
 * True for the drawElement `InvalidStateError: No cached paint record for element`
 * thrown when a subtree element has no paint record for the current frame (display
 * toggled / detached / freshly-shown at a clip-cut boundary). Per-frame, not
 * whole-comp — callers fall back to screenshot for the single frame.
 */
function isNoCachedPaintRecordError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("No cached paint record");
}

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
    } else if (
      session.captureMode === "drawelement" &&
      session.clipBoundaryFrames?.has(frameIndex) &&
      process.env.HF_FAST_CAPTURE_BOUNDARY_SS === "true"
    ) {
      // Lim 6 (serial path): proactively screenshotting clip-boundary frames is now
      // OPT-IN (was default-on). It is net-harmful: drawElement renders most boundary
      // frames correctly, but Page.captureScreenshot in drawElement mode captures the
      // injected canvas (unpainted at render start → white; mid-render → ~1-frame
      // stale), so the "fallback" REPLACES good frames with damaged ones (validated:
      // 35e8fa9f 462→0 damaged frames, 4001da8e 11→0, when this is off). The two real
      // boundary failure modes are now caught reactively below — the throw case by
      // isNoCachedPaintRecordError, the silent-solid-black case by the small-frame
      // blank-guard (a solid frame is a tiny JPEG) — without touching frames drawElement
      // handles. Force the old behavior with HF_FAST_CAPTURE_BOUNDARY_SS=true. The worker
      // path keeps proactive boundary-SS (it has no blank-guard); see
      // captureFrameToBufferPipelined and docs/fast-capture-limitations.md.
      screenshotBuffer = await pageScreenshotCapture(page, options);
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
      try {
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
        // Silent-blank-drop guard: drawElement occasionally returns a blank/dropped
        // frame WITHOUT throwing (paint-record miss; the throw case is handled below).
        // Such a frame's JPEG is anomalously tiny vs the comp's running median (a blank
        // 1080p frame ~5-9 KB; content frames 50 KB-1 MB). Re-capture via screenshot
        // (ground truth) — harmless for legitimately simple frames (screenshot matches).
        // Catches scattered intermittent drops (e.g. 4001da8e: 11 blanks in 9300 frames,
        // 9.7 dB) that no static gate can see. PNG/transparent excluded (alpha sizing
        // differs and that path is its own).
        if ((options.format ?? "jpeg") !== "png" && process.env.HF_FORCE_DRAWELEMENT !== "1") {
          const sizes = (session.deFrameSizes ??= []);
          const sorted = sizes.length >= 12 ? [...sizes].sort((a, b) => a - b) : null;
          const median = sorted ? (sorted[sorted.length >> 1] ?? 0) : 0;
          const floor = Math.max(20000, median * 0.12);
          if (screenshotBuffer.length < floor) {
            console.log(
              `[engine] fast capture: frame ${frameIndex} — drawElement frame anomalously ` +
                `small (${screenshotBuffer.length}B < ${Math.round(floor)}B, likely a silent ` +
                `paint-record drop); screenshot fallback (see fast-capture-limitations.md)`,
            );
            screenshotBuffer = await pageScreenshotCapture(page, options);
          } else {
            if (sizes.length >= 60) sizes.shift();
            sizes.push(screenshotBuffer.length);
          }
        }
      } catch (err) {
        // drawElementImage throws `InvalidStateError: No cached paint record for
        // element` when an element in the subtree has no paint record this frame
        // (display toggled / detached / freshly-shown at a clip-cut boundary). This
        // is a per-frame condition, not a whole-comp one — fall back to screenshot
        // for THIS frame instead of aborting the render. See fast-capture-limitations.md.
        if (isNoCachedPaintRecordError(err)) {
          session.deNcprFallbacks = (session.deNcprFallbacks ?? 0) + 1;
          console.log(
            `[engine] fast capture: frame ${frameIndex} — No cached paint record; ` +
              `screenshot fallback for this frame (see fast-capture-limitations.md)`,
          );
          screenshotBuffer = await pageScreenshotCapture(page, options);
        } else {
          throw err;
        }
      }
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
    session.capturePerf.frameMs.push(captureTimeMs);

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
  const { buffer, quantizedTime, captureTimeMs } = await captureFrameCore(
    session,
    frameIndex,
    time,
  );
  const framePath = writeCapturedFrame(session, frameIndex, buffer);
  return { frameIndex, time: quantizedTime, path: framePath, captureTimeMs };
}

/**
 * Write an already-captured frame buffer to the session's output dir using the
 * canonical `frame_NNNNNN.{jpg,png}` naming. `fileIndex` is the ENCODER-facing
 * index (0-based within the captured range), which may differ from the absolute
 * composition frame index used for seeking/boundary lookups. Extracted so the
 * disk worker-encode pipeline can write a buffer produced by
 * `captureFrameToBufferPipelined` without duplicating the naming convention.
 */
export function writeCapturedFrame(
  session: CaptureSession,
  fileIndex: number,
  buffer: Buffer,
): string {
  const ext = session.options.format === "png" ? "png" : "jpg";
  const framePath = join(session.outputDir, `frame_${String(fileIndex).padStart(6, "0")}.${ext}`);
  writeFileSync(framePath, buffer);
  return framePath;
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

  // Task B: static-frame dedup (worker path). Reuse the prior frame's encode result
  // and skip the seek + drawElement + encode entirely. Same predicate as the serial
  // path; clip-cut frames are excluded from staticFrames so they always capture.
  if (session.staticFrames?.has(frameIndex) && session.lastEncodeResult) {
    // Reuse is valid only when EVERY frame in (lastEncodeResultFrame, i] is
    // predicted-static — then all of them (and the reused buffer) share the
    // same pixels. Sequential capture reduces to has(i) (gap = {i}); the
    // interleaved parallel stride makes the gap N frames wide.
    const lastIdx = session.lastEncodeResultFrame ?? frameIndex - 1;
    let gapStatic = true;
    for (let j = lastIdx + 1; j <= frameIndex; j++) {
      if (!session.staticFrames.has(j)) {
        gapStatic = false;
        break;
      }
    }
    if (gapStatic) {
      session.staticDedupCount = (session.staticDedupCount ?? 0) + 1;
      session.capturePerf.frames += 1;
      // Advance the watermark on reuse too, not just on real captures — the
      // gap-check above starts from lastEncodeResultFrame, so leaving it
      // pinned to the last REAL capture makes every consecutive reuse rescan
      // an ever-widening window instead of just the one new frame (review).
      session.lastEncodeResultFrame = frameIndex;
      return { encodeResult: session.lastEncodeResult, captureTimeMs: Date.now() - startTime };
    }
  }

  try {
    const { quantizedTime, seekMs, beforeCaptureMs } = await prepareFrameForCapture(
      session,
      frameIndex,
      time,
    );
    void quantizedTime;

    // Lim 6: clip-cut boundary frame — screenshot ONLY when opt-in, matching the serial
    // path (captureFrameCore). Proactive boundary screenshots in drawElement mode are
    // net-HARMFUL: with `<canvas layoutsubtree>` the child composition root is laid out
    // but not painted to screen — only the canvas 2D bitmap is visible — so
    // Page.captureScreenshot captures the injected canvas holding the LAST drawElement
    // frame (stale by ≥1 scene at a hard cut), REPLACING a good frame with a stale one.
    // Measured on 0531c45f: worker boundary frames showed the previous scene's video.
    // Default OFF → boundary frames fall through to produceDrawElementFrame, which draws
    // the CURRENT frame into the canvas. (Force old behavior with
    // HF_FAST_CAPTURE_BOUNDARY_SS=true.) See captureFrameCore for the serial rationale.
    if (
      session.clipBoundaryFrames?.has(frameIndex) &&
      process.env.HF_FAST_CAPTURE_BOUNDARY_SS === "true"
    ) {
      const buffer = await pageScreenshotCapture(page, options);
      session.capturePerf.frames += 1;
      session.capturePerf.seekMs += seekMs;
      session.capturePerf.beforeCaptureMs += beforeCaptureMs;
      {
        const boundaryMs = Date.now() - startTime;
        session.capturePerf.totalMs += boundaryMs;
        session.capturePerf.frameMs.push(boundaryMs);
      }
      const boundaryResult = Promise.resolve(buffer);
      if (session.staticFrames) {
        session.lastEncodeResult = boundaryResult;
        session.lastEncodeResultFrame = frameIndex;
      }
      return { encodeResult: boundaryResult, captureTimeMs: Date.now() - startTime };
    }

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
    session.capturePerf.frameMs.push(captureTimeMs);

    // Task B: retain this encode result so a following static frame can reuse it.
    if (session.staticFrames) {
      session.lastEncodeResult = encodeResult;
      session.lastEncodeResultFrame = frameIndex;
    }

    return { encodeResult, captureTimeMs };
  } catch (captureError) {
    // Per-frame `No cached paint record`: fall back to screenshot for THIS frame
    // instead of aborting the render (clip-cut boundary / freshly-shown element).
    // The worker isn't involved for this frame; return a resolved encodeResult so
    // the pipeline loop writes it like any other. See fast-capture-limitations.md.
    if (isNoCachedPaintRecordError(captureError)) {
      session.deNcprFallbacks = (session.deNcprFallbacks ?? 0) + 1;
      console.log(
        `[engine] fast capture: frame ${frameIndex} — No cached paint record; ` +
          `screenshot fallback for this frame (see fast-capture-limitations.md)`,
      );
      const buffer = await pageScreenshotCapture(page, options);
      return { encodeResult: Promise.resolve(buffer), captureTimeMs: Date.now() - startTime };
    }
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
 * Verification-grade single-frame recapture for the producer's blank-frame
 * guard. Unlike {@link captureFrameToBufferPipelined} it takes NO shortcuts
 * and has NO fallbacks, both of which can return the WRONG FRAME's pixels at
 * drain time:
 *  - the static-dedup fast path returns session.lastEncodeResult, which by
 *    drain time can hold a frame several indices AHEAD of the suspect frame;
 *  - the per-frame "No cached paint record" screenshot fallback captures the
 *    injected canvas — i.e. the LAST drawn drawElement frame, not this one.
 * Any failure here throws; the caller treats that as verification failure and
 * falls back the whole render (correct, never wrong-frame).
 */
export async function recaptureDrawElementFrameForVerify(
  session: CaptureSession,
  frameIndex: number,
  time: number,
): Promise<Buffer> {
  const { page, options } = session;
  if (!session.isInitialized) {
    throw new Error("[FrameCapture] Session not initialized");
  }
  await prepareFrameForCapture(session, frameIndex, time);
  const { encodeResult } = await produceDrawElementFrame(
    page,
    options.width,
    options.height,
    options.quality ?? 80,
    true,
  );
  return encodeResult;
}

/**
 * P6 prototype (HF_DE_BATCH): capture N consecutive frames in one CDP
 * round-trip via {@link produceDrawElementFrameBatch}. The caller pre-plans the
 * batch (consecutive frame indices, none static-dedup'd, none opt-in
 * boundary-screenshot). On a mid-batch in-page failure the remaining frames are
 * re-captured through {@link captureFrameToBufferPipelined}, which owns the
 * per-frame screenshot-fallback semantics — so failure behavior is identical to
 * the unbatched path, just discovered at batch granularity.
 */
export async function captureFramesBatchPipelined(
  session: CaptureSession,
  frameIndices: number[],
  times: number[],
): Promise<Array<{ frameIndex: number; encodeResult: Promise<Buffer> }>> {
  const { page, options } = session;
  if (!session.isInitialized) {
    throw new Error("[FrameCapture] Session not initialized");
  }
  const startTime = Date.now();
  const fps = fpsToNumber(options.fps);
  const quantized = times.map((t) => quantizeTimeToFrame(t, fps));

  const { encodeResults, failedAt, error } = await produceDrawElementFrameBatch(
    page,
    quantized,
    options.width,
    options.height,
    options.quality ?? 80,
  );

  const okCount = failedAt === null ? frameIndices.length : failedAt;
  const elapsed = Date.now() - startTime;
  session.capturePerf.frames += okCount;
  // Round-trips are fused — attribute the whole batch to produce time; each
  // frame gets the batch mean for the per-frame sample series.
  session.capturePerf.screenshotMs += elapsed;
  session.capturePerf.totalMs += elapsed;
  if (okCount > 0) {
    const perFrame = elapsed / okCount;
    for (let s2 = 0; s2 < okCount; s2++) session.capturePerf.frameMs.push(perFrame);
  }

  const results: Array<{ frameIndex: number; encodeResult: Promise<Buffer> }> = [];
  for (let i = 0; i < okCount; i++) {
    const frameIndex = frameIndices[i];
    const encodeResult = encodeResults[i];
    if (frameIndex === undefined || !encodeResult) break;
    results.push({ frameIndex, encodeResult });
  }

  if (failedAt !== null) {
    console.log(
      `[engine] fast capture: batch produce failed at frame ` +
        `${frameIndices[failedAt] ?? "?"} (${error ?? "?"}); ` +
        `re-capturing ${frameIndices.length - failedAt} frame(s) per-frame`,
    );
    for (let i = failedAt; i < frameIndices.length; i++) {
      const frameIndex = frameIndices[i];
      const time = times[i];
      if (frameIndex === undefined || time === undefined) break;
      const { encodeResult } = await captureFrameToBufferPipelined(session, frameIndex, time);
      results.push({ frameIndex, encodeResult });
    }
  }

  // Task B: retain the last encode result so a following static frame can reuse it.
  const last = results[results.length - 1];
  if (session.staticFrames && last) session.lastEncodeResult = last.encodeResult;

  return results;
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
    frameMs: [],
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

/**
 * Ungated-release safety net, part 1: capture K screenshot ground-truth frames
 * BEFORE the drawElement canvas is injected (the only window where a page
 * screenshot shows the live DOM). The producer's drain compares each DE frame
 * at these indices against its screenshot; a breach (or a blank frame that
 * survives one retry) throws DrawElementVerificationError, and the orchestrator
 * re-renders the whole job via the screenshot path.
 *
 * Env: HF_DE_VERIFY = sample count (default 4, clamp 0..8; 0 disables).
 * Deterministic index selection: fixed fractions of the timeline, nudged off
 * clip-cut boundaries (screenshot-vs-DE is legitimately ±1-frame desynced
 * there — Lim 6). Skipped for tiny comps (<10 frames) and under
 * HF_FORCE_DRAWELEMENT (debug escape hatch).
 *
 * False-positive bias is intentional: a nondeterministic comp may mismatch its
 * init-time screenshot → the render falls back to the screenshot path (slower,
 * never wrong). Cost when passing: ~K×(seek+screenshot) ≈ 150–300ms at init.
 */
/**
 * Timeline fractions the self-verify samples. First k-1 evenly spaced, last
 * pinned at 95%: late-onset damage (an end-of-comp reveal exposing pixels DE
 * paints wrong) was invisible to the old (i+1)/(k+1) grid, whose final sample
 * sat at 80% — measured miss: a body-gradient drop starting at ~79% of the
 * timeline passed verification while the drained output bottomed at 30.9 dB.
 */
export function computeDeVerifySampleFractions(k: number): number[] {
  if (k <= 0) return [];
  if (k === 1) return [0.95];
  return [...Array.from({ length: k - 1 }, (_, i) => (i + 1) / k), 0.95];
}

async function captureDeVerificationFrames(
  session: CaptureSession,
  page: Page,
  logInitPhase: (phase: string) => void,
): Promise<void> {
  const kRaw = Number(process.env.HF_DE_VERIFY ?? "4");
  const k = Number.isFinite(kRaw) ? Math.max(0, Math.min(8, Math.floor(kRaw))) : 4;
  if (k === 0 || process.env.HF_FORCE_DRAWELEMENT === "1") return;
  if (session.options.format === "png") return; // worker-encode drain (the consumer) is jpeg-only
  const fps = fpsToNumber(session.options.fps);
  // Prefer the producer-resolved duration (the range that will actually be
  // drained). The page's raw __hf.duration can exceed it — timelines outrun
  // their data-duration, and infinite-repeat GSAP reports a huge sentinel —
  // and indices derived from it would never be drained, silently disarming
  // verification for exactly the comps that need it.
  const duration =
    session.options.compositionDurationSeconds ??
    (await page.evaluate(
      () => (window as unknown as { __hf?: { duration?: number } }).__hf?.duration ?? 0,
    ));
  const totalFrames = Math.floor(duration * fps);
  if (totalFrames < 10) return;
  if (duration > 3600) {
    // No producer duration and the page reports an implausible one.
    logInitPhase(`drawElement self-verify skipped: implausible duration ${duration}s`);
    return;
  }
  // Ground truth must show what the real capture paths would show: <video>
  // pixels come from the onBeforeCapture injector. When this session has no
  // injector (e.g. a probe session initialized before the render wires one
  // up) a video comp's truth would screenshot black boxes and every sample
  // would false-positive into the screenshot fallback — skip instead.
  if (!session.onBeforeCapture) {
    const hasVideos = await page.evaluate(() => document.querySelector("video") !== null);
    if (hasVideos) {
      logInitPhase("drawElement self-verify skipped: video comp without frame injector");
      return;
    }
  }
  const boundary = await computeClipBoundaryFrames(page, fps);
  // Ascending order, and seek frame 0 first: GSAP .from()/overlapping tweens
  // lazily record their start values on FIRST seek — scrubbing mid-timeline
  // before the render's frame-0 seek corrupts those caches for the whole
  // render (the detectCssEffectRisk lesson), and because DE frames and truth
  // would share the corruption, PSNR would pass on the damaged output.
  // Seeking 0 → ascending reproduces the render's own seek order.
  const fractions = computeDeVerifySampleFractions(k);
  const seekTo = async (t: number): Promise<void> => {
    await page.evaluate((tt: number) => {
      const hf = (
        window as unknown as {
          __hf?: { seek?: (x: number, options?: { suppressEvents?: boolean }) => void };
        }
      ).__hf;
      if (hf && typeof hf.seek === "function") hf.seek(tt, { suppressEvents: true });
    }, t);
  };
  await seekTo(quantizeTimeToFrame(0, fps));
  // Force one frame so lazy tween initialization paints at t=0 state.
  await pageScreenshotCapture(page, session.options);
  const frames = new Map<number, Buffer>();
  for (const f of fractions) {
    let idx = Math.min(totalFrames - 1, Math.max(1, Math.round(totalFrames * f)));
    // Nudge off clip-cut boundaries (±1-frame desync is legitimate there);
    // if the nudge saturates on a boundary index, skip the sample entirely.
    let guard = 0;
    while (boundary.has(idx) && guard++ < 6) idx = Math.min(totalFrames - 1, idx + 2);
    if (boundary.has(idx)) continue;
    if (frames.has(idx)) continue;
    const t = quantizeTimeToFrame(idx / fps, fps);
    await seekTo(t);
    // Video frame injection (same hook the real capture paths run) — without
    // it, <video> elements screenshot black and every video comp would
    // false-positive into the screenshot fallback.
    if (session.onBeforeCapture) await session.onBeforeCapture(page, t);
    // Double-capture: the first screenshot forces a frame, which is what runs
    // rAF-driven callbacks (count-up text counters land a tick after seek()
    // returns — a single immediate screenshot captures stale text and
    // false-positives the verify: 3bea8c73 28.7dB vs a truth missing its stat
    // values while the DE frame was correct). NOTE: waiting on rAF via
    // evaluate instead deadlocks — headless only fires rAF when a frame is
    // produced, and nothing produces one until a screenshot asks.
    await pageScreenshotCapture(page, session.options);
    frames.set(idx, await pageScreenshotCapture(page, session.options));
  }
  // Leave the page at frame 0 so the render's first seek starts from the
  // same state as an unverified render.
  await seekTo(quantizeTimeToFrame(0, fps));
  session.deVerifyFrames = frames;
  logInitPhase(
    `drawElement self-verify armed: ${frames.size} ground-truth frame(s) @ [${[...frames.keys()].join(", ")}] of ${totalFrames}`,
  );
}

function medianOf(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0);
}

export function getCapturePerfSummary(session: CaptureSession): CapturePerfSummary {
  const frames = Math.max(1, session.capturePerf.frames);
  return {
    frames: session.capturePerf.frames,
    avgTotalMs: Math.round(session.capturePerf.totalMs / frames),
    avgSeekMs: Math.round(session.capturePerf.seekMs / frames),
    avgBeforeCaptureMs: Math.round(session.capturePerf.beforeCaptureMs / frames),
    avgScreenshotMs: Math.round(session.capturePerf.screenshotMs / frames),
    p50TotalMs: medianOf(session.capturePerf.frameMs),
    subTimelineWaitOutcome: session.subTimelineWaitOutcome,
    staticDedupReused: session.staticDedupCount ?? 0,
    staticDedupEnabled: session.staticDedupEnabled ?? false,
    // armed ⟺ a non-empty static set survived verification; predicted === its size.
    staticDedupArmed: (session.staticFrames?.size ?? 0) > 0,
    staticDedupPredicted: session.staticFrames?.size ?? 0,
    staticDedupSkipReason: session.staticDedupSkipReason,
    captureMode: session.captureMode,
    deGateReason: session.deGateReason,
    deWorkerEncode: session.workerEncodeEnabled ?? false,
    deVerifyArmed: session.deVerifyFrames?.size ?? 0,
    deVerifyInitMs: session.deVerifyInitMs ?? 0,
    deBoundaryFrames: session.clipBoundaryFrames?.size ?? 0,
    deNcprFallbacks: session.deNcprFallbacks ?? 0,
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

// The producer's deployed runtime is Bun (JavaScriptCore), not Node (V8) —
// see `packages/gcp-cloud-run/Dockerfile`'s `CMD ["bun", "dist/server.js"]`.
// JSC's own allocation-failure message for the equivalent single-oversized-
// allocation RangeErrors above is the bare string "Out of memory" (verified:
// `new Uint8Array(Number.MAX_SAFE_INTEGER)`, an unbounded `Set`, and
// `"x".repeat(2**53)` all throw exactly this under Bun) — none of the V8
// patterns above match it. This is exactly the substring the comment above
// says NOT to match anywhere in the message (benign browser-console noise
// like a WebGL `CONTEXT_LOST … out of memory` carries that phrase too), so
// this checks the ENTIRE (trimmed) message equals it, not merely contains
// it — a compound message with other text around the phrase still misses.
const BUN_MEMORY_EXHAUSTION_EXACT_MESSAGE = /^out of memory\.?$/i;

// The parallel-DE capture path — the exact cohort the OOM-aware retry in
// renderOrchestrator.ts targets — never reaches isMemoryExhaustionError with
// a bare message: `executeParallelCapture`/`formatWorkerFailure`
// (parallelCoordinator.ts) always wrap a worker's error as
// "Worker N: <message>", optionally suffixed "; diagnostics: ..." and joined
// with other failed workers' segments via "; ", all prefixed
// "[Parallel] Capture failed: ". The exact-match check above is defeated by
// that wrapping entirely (verified) — this pattern recovers the Bun OOM
// signal by requiring "out of memory" appear immediately after "Worker N: "
// and immediately before end-of-string, ";", or ".", i.e. as the WHOLE
// worker-segment content, not merely somewhere inside it. This preserves the
// exact-match property (no bare "out of memory" substring inside otherwise-
// unrelated worker text, e.g. "Worker 2: WebGL context lost, out of memory
// reported by driver" does NOT match) while surviving this codebase's own
// error-flattening.
const BUN_MEMORY_EXHAUSTION_WRAPPED_WORKER_MESSAGE = /\bworker \d+: out of memory\.?(?:;|$)/i;

export function isMemoryExhaustionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (BUN_MEMORY_EXHAUSTION_EXACT_MESSAGE.test(message.trim())) return true;
  if (BUN_MEMORY_EXHAUSTION_WRAPPED_WORKER_MESSAGE.test(message)) return true;
  return MEMORY_EXHAUSTION_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}
