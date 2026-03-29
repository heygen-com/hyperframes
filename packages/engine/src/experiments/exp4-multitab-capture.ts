/**
 * Experiment 4: Single Chrome Instance, Multiple Tabs
 *
 * Instead of spawning N separate Chrome processes (one per worker),
 * this approach launches ONE Chrome instance and creates N pages (tabs).
 *
 * Benefits:
 * - Shared SwiftShader/GPU context across all tabs
 * - Eliminate duplicate browser startup costs
 * - Reduce memory from ~1.5GB (6 x 256MB) to ~400MB (1 browser + N lightweight pages)
 * - Faster tab switching vs process switching
 *
 * Key insight: In the current code (parallelCoordinator.ts), executeParallelCapture
 * creates N separate browsers (via createCaptureSession which calls acquireBrowser).
 * We want to create N pages in ONE browser.
 */

import type { Browser, Page, Viewport } from "puppeteer-core";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { quantizeTimeToFrame } from "@hyperframes/core";

import {
  acquireBrowser,
  releaseBrowser,
  buildChromeArgs,
  resolveHeadlessShellPath,
  type CaptureMode,
} from "../services/browserManager.js";
import {
  beginFrameCapture,
  getCdpSession,
  pageScreenshotCapture,
} from "../services/screenshotService.js";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";
import type { CaptureOptions, CapturePerfSummary } from "../types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TabSession {
  tabId: number;
  page: Page;
  captureMode: CaptureMode;
  isInitialized: boolean;
  beginFrameTimeTicks: number;
  beginFrameIntervalMs: number;
  capturePerf: {
    frames: number;
    seekMs: number;
    screenshotMs: number;
    totalMs: number;
  };
}

export interface MultiTabConfig {
  numTabs: number;
  serverUrl: string;
  outputDir: string;
  captureOptions: CaptureOptions;
  engineConfig?: Partial<EngineConfig>;
}

export interface MultiTabResult {
  totalFrames: number;
  totalCaptureMs: number;
  avgFrameMs: number;
  tabResults: TabResult[];
  browserLaunchMs: number;
  tabInitMs: number;
  peakMemoryMB: number;
}

export interface TabResult {
  tabId: number;
  framesCaptured: number;
  startFrame: number;
  endFrame: number;
  durationMs: number;
  perf: CapturePerfSummary;
}

// ── Capture Mode Detection ────────────────────────────────────────────────────

/**
 * Detect capture mode consistently with acquireBrowser.
 * This uses the same logic as browserManager.ts to ensure Chrome args match.
 */
function detectCaptureMode(config?: Partial<EngineConfig>): CaptureMode {
  const headlessShell = resolveHeadlessShellPath(config);
  const isLinux = process.platform === "linux";
  const forceScreenshot = config?.forceScreenshot ?? DEFAULT_CONFIG.forceScreenshot;
  if (headlessShell && isLinux && !forceScreenshot) return "beginframe";
  return "screenshot";
}

// ── Tab Session Management ────────────────────────────────────────────────────

async function createTabSession(
  browser: Browser,
  tabId: number,
  captureMode: CaptureMode,
  captureOptions: CaptureOptions,
): Promise<TabSession> {
  const page = await browser.newPage();

  const viewport: Viewport = {
    width: captureOptions.width,
    height: captureOptions.height,
    deviceScaleFactor: captureOptions.deviceScaleFactor || 1,
  };
  await page.setViewport(viewport);

  // For PNG capture, make background transparent
  if (captureOptions.format === "png") {
    const cdp = await getCdpSession(page);
    await cdp.send("Emulation.setDefaultBackgroundColorOverride", {
      color: { r: 0, g: 0, b: 0, a: 0 },
    });
  }

  return {
    tabId,
    page,
    captureMode,
    isInitialized: false,
    beginFrameTimeTicks: 0,
    beginFrameIntervalMs: 1000 / Math.max(1, captureOptions.fps),
    capturePerf: {
      frames: 0,
      seekMs: 0,
      screenshotMs: 0,
      totalMs: 0,
    },
  };
}

async function initializeTab(
  tab: TabSession,
  serverUrl: string,
  config?: Partial<EngineConfig>,
): Promise<void> {
  const { page } = tab;
  const url = `${serverUrl}/index.html`;
  const pageReadyTimeout = config?.playerReadyTimeout ?? DEFAULT_CONFIG.playerReadyTimeout;

  if (tab.captureMode === "screenshot") {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    await page.waitForFunction(
      `!!(window.__hf && typeof window.__hf.seek === "function" && window.__hf.duration > 0)`,
      { timeout: pageReadyTimeout },
    );

    // Wait for all video elements to have loaded metadata
    await page.waitForFunction(
      `document.querySelectorAll("video").length === 0 || Array.from(document.querySelectorAll("video")).every(v => v.readyState >= 1)`,
      { timeout: pageReadyTimeout },
    );

    await page.evaluate(`document.fonts?.ready`);
    tab.isInitialized = true;
    return;
  }

  // BeginFrame mode: need warmup loop to drive rAF
  let warmupRunning = true;
  let warmupTicks = 0;
  let warmupFrameTime = 0;
  const warmupIntervalMs = 33;
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

  // Poll for window.__hf readiness
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
      `[Exp4] Tab ${tab.tabId}: window.__hf not ready after ${pageReadyTimeout}ms`,
    );
  }

  // Wait for videos
  const videoDeadline = Date.now() + pageReadyTimeout;
  while (Date.now() < videoDeadline) {
    const videosReady = await page.evaluate(
      `document.querySelectorAll("video").length === 0 || Array.from(document.querySelectorAll("video")).every(v => v.readyState >= 1)`,
    );
    if (videosReady) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  await page.evaluate(`document.fonts?.ready`);

  warmupRunning = false;
  tab.beginFrameTimeTicks = (warmupTicks + 10) * tab.beginFrameIntervalMs;
  tab.isInitialized = true;
}

// ── Frame Capture ─────────────────────────────────────────────────────────────

async function captureTabFrame(
  tab: TabSession,
  frameIndex: number,
  time: number,
  captureOptions: CaptureOptions,
): Promise<Buffer> {
  const { page } = tab;
  const startTime = Date.now();

  const quantizedTime = quantizeTimeToFrame(time, captureOptions.fps);

  // Seek
  const seekStart = Date.now();
  await page.evaluate((t: number) => {
    if (window.__hf && typeof window.__hf.seek === "function") {
      window.__hf.seek(t);
    }
  }, quantizedTime);
  const seekMs = Date.now() - seekStart;

  // Screenshot
  const screenshotStart = Date.now();
  let buffer: Buffer;

  if (tab.captureMode === "beginframe") {
    const frameTimeTicks =
      tab.beginFrameTimeTicks + frameIndex * tab.beginFrameIntervalMs;
    const result = await beginFrameCapture(
      page,
      captureOptions,
      frameTimeTicks,
      tab.beginFrameIntervalMs,
    );
    buffer = result.buffer;
  } else {
    buffer = await pageScreenshotCapture(page, captureOptions);
  }
  const screenshotMs = Date.now() - screenshotStart;

  const totalMs = Date.now() - startTime;
  tab.capturePerf.frames += 1;
  tab.capturePerf.seekMs += seekMs;
  tab.capturePerf.screenshotMs += screenshotMs;
  tab.capturePerf.totalMs += totalMs;

  return buffer;
}

// ── Distribution ──────────────────────────────────────────────────────────────

interface TabTask {
  tabId: number;
  startFrame: number;
  endFrame: number;
}

function distributeFramesToTabs(totalFrames: number, numTabs: number): TabTask[] {
  const tasks: TabTask[] = [];
  const framesPerTab = Math.ceil(totalFrames / numTabs);

  for (let i = 0; i < numTabs; i++) {
    const startFrame = i * framesPerTab;
    const endFrame = Math.min((i + 1) * framesPerTab, totalFrames);
    if (startFrame >= totalFrames) break;

    tasks.push({
      tabId: i,
      startFrame,
      endFrame,
    });
  }

  return tasks;
}

// ── Main Entry Point ──────────────────────────────────────────────────────────

/**
 * Execute multi-tab capture: single Chrome, N tabs, parallel frame capture.
 *
 * Each tab navigates to the same composition and captures a range of frames.
 * Tabs run their capture loops in parallel via Promise.all.
 */
export async function executeMultiTabCapture(
  config: MultiTabConfig,
  onProgress?: (captured: number, total: number) => void,
): Promise<MultiTabResult> {
  const {
    numTabs,
    serverUrl,
    outputDir,
    captureOptions,
    engineConfig,
  } = config;

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  // 1. Launch single Chrome instance
  const browserLaunchStart = Date.now();

  const captureMode = detectCaptureMode(engineConfig);
  const chromeArgs = buildChromeArgs(
    { width: captureOptions.width, height: captureOptions.height, captureMode },
    engineConfig,
  );

  // Disable browser pool so we get a fresh dedicated instance
  const { browser, captureMode: actualCaptureMode } = await acquireBrowser(chromeArgs, {
    ...engineConfig,
    enableBrowserPool: false,
  });
  const browserLaunchMs = Date.now() - browserLaunchStart;

  try {
    // 2. Create N tab sessions in the single browser
    const tabInitStart = Date.now();
    const tabs: TabSession[] = [];

    for (let i = 0; i < numTabs; i++) {
      const tab = await createTabSession(browser, i, actualCaptureMode, captureOptions);
      tabs.push(tab);
    }

    // Initialize all tabs (navigate and wait for __hf)
    // Do this sequentially to avoid overwhelming the single browser during page loads
    for (const tab of tabs) {
      await initializeTab(tab, serverUrl, engineConfig);
    }
    const tabInitMs = Date.now() - tabInitStart;

    // 3. Get total frames from first tab
    const duration = await tabs[0]!.page.evaluate(() => window.__hf?.duration ?? 0);
    const totalFrames = Math.ceil(duration * captureOptions.fps);

    // 4. Distribute frames across tabs
    const tasks = distributeFramesToTabs(totalFrames, tabs.length);

    // 5. Capture frames in parallel across all tabs
    let capturedCount = 0;
    const captureStart = Date.now();

    const tabPromises = tasks.map(async (task) => {
      const tab = tabs[task.tabId]!;
      const tabOutputDir = join(outputDir, `tab-${task.tabId}`);
      if (!existsSync(tabOutputDir)) mkdirSync(tabOutputDir, { recursive: true });

      const taskStart = Date.now();

      for (let frameIdx = task.startFrame; frameIdx < task.endFrame; frameIdx++) {
        const time = frameIdx / captureOptions.fps;
        const buffer = await captureTabFrame(tab, frameIdx, time, captureOptions);

        // Write frame to disk
        const ext = captureOptions.format === "png" ? "png" : "jpg";
        const frameName = `frame_${String(frameIdx).padStart(6, "0")}.${ext}`;
        writeFileSync(join(tabOutputDir, frameName), buffer);

        capturedCount++;
        if (onProgress) onProgress(capturedCount, totalFrames);
      }

      const frames = Math.max(1, tab.capturePerf.frames);
      return {
        tabId: task.tabId,
        framesCaptured: tab.capturePerf.frames,
        startFrame: task.startFrame,
        endFrame: task.endFrame,
        durationMs: Date.now() - taskStart,
        perf: {
          frames: tab.capturePerf.frames,
          avgTotalMs: Math.round(tab.capturePerf.totalMs / frames),
          avgSeekMs: Math.round(tab.capturePerf.seekMs / frames),
          avgBeforeCaptureMs: 0,
          avgScreenshotMs: Math.round(tab.capturePerf.screenshotMs / frames),
        },
      } satisfies TabResult;
    });

    const tabResults = await Promise.all(tabPromises);
    const totalCaptureMs = Date.now() - captureStart;

    // Memory measurement
    const memUsage = process.memoryUsage();
    const peakMemoryMB = Math.round(memUsage.rss / (1024 * 1024));

    return {
      totalFrames,
      totalCaptureMs,
      avgFrameMs: Math.round(totalCaptureMs / Math.max(1, totalFrames)),
      tabResults,
      browserLaunchMs,
      tabInitMs,
      peakMemoryMB,
    };
  } finally {
    // Close all pages, then browser
    const pages = await browser.pages();
    for (const page of pages) {
      await page.close().catch(() => {});
    }
    await releaseBrowser(browser, { enableBrowserPool: false });
  }
}

/**
 * Execute baseline capture: N separate Chrome processes (current approach).
 * Each worker gets its own browser, same as parallelCoordinator.ts.
 */
export async function executeBaselineCapture(
  numWorkers: number,
  serverUrl: string,
  outputDir: string,
  captureOptions: CaptureOptions,
  engineConfig?: Partial<EngineConfig>,
  onProgress?: (captured: number, total: number) => void,
): Promise<MultiTabResult> {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const browserLaunchStart = Date.now();

  const captureMode = detectCaptureMode(engineConfig);
  const chromeArgs = buildChromeArgs(
    { width: captureOptions.width, height: captureOptions.height, captureMode },
    engineConfig,
  );

  // Launch N separate browsers (baseline approach)
  const browsers: { browser: Browser; captureMode: CaptureMode }[] = [];
  for (let i = 0; i < numWorkers; i++) {
    const result = await acquireBrowser(chromeArgs, {
      ...engineConfig,
      enableBrowserPool: false,
    });
    browsers.push(result);
  }
  const browserLaunchMs = Date.now() - browserLaunchStart;

  try {
    // Create tabs and initialize
    const tabInitStart = Date.now();
    const tabs: TabSession[] = [];

    for (let i = 0; i < browsers.length; i++) {
      const { browser, captureMode: cm } = browsers[i]!;
      const tab = await createTabSession(browser, i, cm, captureOptions);
      tabs.push(tab);
    }

    for (const tab of tabs) {
      await initializeTab(tab, serverUrl, engineConfig);
    }
    const tabInitMs = Date.now() - tabInitStart;

    // Get total frames
    const duration = await tabs[0]!.page.evaluate(() => window.__hf?.duration ?? 0);
    const totalFrames = Math.ceil(duration * captureOptions.fps);

    // Distribute and capture
    const tasks = distributeFramesToTabs(totalFrames, tabs.length);
    let capturedCount = 0;
    const captureStart = Date.now();

    const tabPromises = tasks.map(async (task) => {
      const tab = tabs[task.tabId]!;
      const tabOutputDir = join(outputDir, `worker-${task.tabId}`);
      if (!existsSync(tabOutputDir)) mkdirSync(tabOutputDir, { recursive: true });

      const taskStart = Date.now();

      for (let frameIdx = task.startFrame; frameIdx < task.endFrame; frameIdx++) {
        const time = frameIdx / captureOptions.fps;
        const buffer = await captureTabFrame(tab, frameIdx, time, captureOptions);

        const ext = captureOptions.format === "png" ? "png" : "jpg";
        const frameName = `frame_${String(frameIdx).padStart(6, "0")}.${ext}`;
        writeFileSync(join(tabOutputDir, frameName), buffer);

        capturedCount++;
        if (onProgress) onProgress(capturedCount, totalFrames);
      }

      const frames = Math.max(1, tab.capturePerf.frames);
      return {
        tabId: task.tabId,
        framesCaptured: tab.capturePerf.frames,
        startFrame: task.startFrame,
        endFrame: task.endFrame,
        durationMs: Date.now() - taskStart,
        perf: {
          frames: tab.capturePerf.frames,
          avgTotalMs: Math.round(tab.capturePerf.totalMs / frames),
          avgSeekMs: Math.round(tab.capturePerf.seekMs / frames),
          avgBeforeCaptureMs: 0,
          avgScreenshotMs: Math.round(tab.capturePerf.screenshotMs / frames),
        },
      } satisfies TabResult;
    });

    const tabResults = await Promise.all(tabPromises);
    const totalCaptureMs = Date.now() - captureStart;

    const memUsage = process.memoryUsage();
    const peakMemoryMB = Math.round(memUsage.rss / (1024 * 1024));

    return {
      totalFrames,
      totalCaptureMs,
      avgFrameMs: Math.round(totalCaptureMs / Math.max(1, totalFrames)),
      tabResults,
      browserLaunchMs,
      tabInitMs,
      peakMemoryMB,
    };
  } finally {
    for (const { browser } of browsers) {
      await browser.close().catch(() => {});
    }
  }
}
