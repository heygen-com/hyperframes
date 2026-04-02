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
import { quantizeTimeToFrame } from "@hyperframes/core";

// ── Extracted modules ───────────────────────────────────────────────────────
import {
  acquireBrowser,
  releaseBrowser,
  buildChromeArgs,
  resolveHeadlessShellPath,
  type CaptureMode,
} from "./browserManager.js";
import { beginFrameCapture, getCdpSession, pageScreenshotCapture } from "./screenshotService.js";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";
import type {
  CaptureOptions,
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

export async function createCaptureSession(
  serverUrl: string,
  outputDir: string,
  options: CaptureOptions,
  onBeforeCapture: BeforeCaptureHook | null = null,
  config?: Partial<EngineConfig>,
): Promise<CaptureSession> {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  // Determine capture mode before building args — BeginFrame flags only apply on Linux
  const headlessShell = resolveHeadlessShellPath(config);
  const isLinux = process.platform === "linux";
  const forceScreenshot = config?.forceScreenshot ?? DEFAULT_CONFIG.forceScreenshot;
  const preMode: CaptureMode =
    headlessShell && isLinux && !forceScreenshot ? "beginframe" : "screenshot";
  const chromeArgs = buildChromeArgs(
    { width: options.width, height: options.height, captureMode: preMode },
    config,
  );

  const { browser, captureMode } = await acquireBrowser(chromeArgs, config);

  const page = await browser.newPage();
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

  // For PNG capture (used by WebM/transparency), make the page background transparent
  // so Chrome's screenshot captures alpha channel data. Must use the same CDP session
  // that the screenshot service uses (getCdpSession caches per page).
  if (options.format === "png") {
    const cdp = await getCdpSession(page);
    await cdp.send("Emulation.setDefaultBackgroundColorOverride", {
      color: { r: 0, g: 0, b: 0, a: 0 },
    });
  }

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
    beginFrameIntervalMs: 1000 / Math.max(1, options.fps),
    beginFrameHasDamageCount: 0,
    beginFrameNoDamageCount: 0,
    config,
  };
}

export async function initializeSession(session: CaptureSession): Promise<void> {
  const { page, serverUrl } = session;

  // Forward browser console to host with [Browser] prefix
  page.on("console", (msg: ConsoleMessage) => {
    const type = msg.type();
    const text = msg.text();

    // Suppress font-loading 404s only. These are expected when deterministic
    // font injection replaces Google Fonts @import URLs with embedded base64.
    // Narrowed to font CDN domains and font file extensions to avoid hiding
    // real asset failures (images, scripts, videos).
    const isFontLoadError =
      type === "error" &&
      text.startsWith("Failed to load resource") &&
      /fonts\.googleapis|fonts\.gstatic|\.woff2?(\b|$)/i.test(text);

    const prefix =
      type === "error" ? "[Browser:ERROR]" : type === "warn" ? "[Browser:WARN]" : "[Browser]";
    if (!isFontLoadError) {
      console.log(`${prefix} ${text}`);
    }

    session.browserConsoleBuffer.push(`${prefix} ${text}`);
    if (session.browserConsoleBuffer.length > BROWSER_CONSOLE_BUFFER_SIZE) {
      session.browserConsoleBuffer.shift();
    }
  });

  page.on("pageerror", (err) => {
    const text = `[Browser:PAGEERROR] ${err instanceof Error ? err.message : String(err)}`;
    console.error(text);
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
    await page.waitForFunction(
      `!!(window.__hf && typeof window.__hf.seek === "function" && window.__hf.duration > 0)`,
      { timeout: pageReadyTimeout },
    );

    // Wait for all video elements to have loaded metadata (dimensions + duration)
    // Without this, frame 0 captures videos at their 300x150 default size
    await page.waitForFunction(
      `document.querySelectorAll("video").length === 0 || Array.from(document.querySelectorAll("video")).every(v => v.readyState >= 1)`,
      { timeout: pageReadyTimeout },
    );

    await page.evaluate(`document.fonts?.ready`);

    session.isInitialized = true;
    return;
  }

  // In BeginFrame mode, Chrome's event loop is paused until we issue frames.
  // Start a warmup loop to drive rAF/setTimeout callbacks during page load.
  let warmupRunning = true;
  let warmupTicks = 0;
  let warmupFrameTime = 0;
  const warmupIntervalMs = 33; // ~30fps
  let warmupClient: import("puppeteer-core").CDPSession | null = null;

  const warmupLoop = async () => {
    try {
      warmupClient = await getCdpSession(page);
      await warmupClient.send("HeadlessExperimental.enable");
    } catch {
      /* page not ready yet */
    }

    while (warmupRunning) {
      if (warmupClient) {
        try {
          await warmupClient.send("HeadlessExperimental.beginFrame", {
            frameTimeTicks: warmupFrameTime,
            interval: warmupIntervalMs,
            noDisplayUpdates: true,
          });
          warmupFrameTime += warmupIntervalMs;
          warmupTicks++;
        } catch {
          /* ignore warmup errors */
        }
      }
      await new Promise((r) => setTimeout(r, warmupIntervalMs));
    }
  };
  warmupLoop().catch(() => {});

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
    warmupRunning = false;
    throw new Error(
      `[FrameCapture] window.__hf not ready after ${pageReadyTimeout}ms. Page must expose window.__hf = { duration, seek }.`,
    );
  }

  // Wait for all video elements to have loaded metadata (dimensions + duration).
  // Without this, frame 0 captures videos at their 300x150 default size.
  const videoDeadline =
    Date.now() + (session.config?.playerReadyTimeout ?? DEFAULT_CONFIG.playerReadyTimeout);
  while (Date.now() < videoDeadline) {
    const videosReady = await page.evaluate(
      `document.querySelectorAll("video").length === 0 || Array.from(document.querySelectorAll("video")).every(v => v.readyState >= 1)`,
    );
    if (videosReady) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  // Font check (no rAF dependency — uses fonts.ready API directly)
  await page.evaluate(`document.fonts?.ready`);

  // Stop warmup
  warmupRunning = false;

  // Set base frame time ticks past warmup range
  session.beginFrameTimeTicks = (warmupTicks + 10) * session.beginFrameIntervalMs;

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

  const quantizedTime = quantizeTimeToFrame(time, options.fps);

  const seekStart = Date.now();
  // Seek via the __hf protocol. The page's seek() implementation handles
  // all framework-specific logic (GSAP stepping, CSS animation sync, etc.)
  await page.evaluate((t: number) => {
    if (window.__hf && typeof window.__hf.seek === "function") {
      window.__hf.seek(t);
    }
  }, quantizedTime);
  const seekMs = Date.now() - seekStart;

  // Before-capture hook (e.g. video frame injection)
  const beforeCaptureStart = Date.now();
  if (session.onBeforeCapture) {
    await session.onBeforeCapture(page, quantizedTime);
  }
  const beforeCaptureMs = Date.now() - beforeCaptureStart;

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

export async function closeCaptureSession(session: CaptureSession): Promise<void> {
  if (session.page) await session.page.close().catch(() => {});
  if (session.browser) await releaseBrowser(session.browser, session.config);
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
