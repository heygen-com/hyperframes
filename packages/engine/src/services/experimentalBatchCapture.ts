/**
 * Experimental Batch Capture Service (Experiment 1)
 *
 * Eliminates per-frame IPC round-trips by pipelining CDP commands.
 *
 * Baseline approach does 2 sequential CDP round-trips per frame:
 *   await page.evaluate(seek)     // CDP round-trip #1 (wait for response)
 *   await beginFrame(screenshot)  // CDP round-trip #2 (wait for response)
 *
 * Experiment A - "Pipelined Seek": Fire seek via Runtime.evaluate without
 *   awaiting the response, then immediately issue beginFrame. The seek JS
 *   executes synchronously inside Chrome before beginFrame processes, so the
 *   visual state is correct. We overlap the IPC return of the seek with the
 *   beginFrame processing.
 *
 * Experiment B - "rAF Batched Seek": Pre-register all seek times in the page,
 *   use rAF callbacks triggered by beginFrame to advance the seek queue.
 *   Only 1 CDP call per frame (beginFrame), zero seek calls.
 */

import type { Page, CDPSession } from "puppeteer-core";

export interface BatchCaptureOptions {
  /** Total number of frames to capture */
  totalFrames: number;
  /** Frames per second */
  fps: number;
  /** Screenshot format */
  format?: "jpeg" | "png";
  /** JPEG quality (1-100) */
  quality?: number;
  /** Base frameTimeTicks to start from (must be past any warmup range) */
  baseFrameTimeTicks?: number;
  /** Callback invoked with each captured frame buffer. Return value is ignored. */
  onFrame?: (frameIndex: number, buffer: Buffer) => void;
}

export interface BatchCaptureResult {
  /** Captured frame buffers in order */
  buffers: Buffer[];
  /** Total capture time in milliseconds */
  totalMs: number;
  /** Per-frame timing breakdown */
  perFrameMs: number[];
  /** Count of frames where Chrome reported visual damage */
  hasDamageCount: number;
  /** Count of frames with no damage (reused previous) */
  noDamageCount: number;
}

/**
 * Quantize time to frame boundary (matches engine's quantizeTimeToFrame).
 * Inlined here to avoid import dependency issues in the benchmark runner.
 */
function quantize(timeSeconds: number, fps: number): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const safeTime = Number.isFinite(timeSeconds) && timeSeconds > 0 ? timeSeconds : 0;
  const frameIndex = Math.floor(safeTime * safeFps + 1e-9);
  return frameIndex / safeFps;
}

/**
 * Experiment A: Pipelined seek + beginFrame.
 *
 * Instead of awaiting the seek response before issuing beginFrame,
 * we fire the seek via Runtime.evaluate (fire-and-forget) and
 * immediately issue beginFrame. Since the seek is synchronous JS
 * that completes within Chrome's single-threaded JS execution,
 * beginFrame will see the updated DOM state.
 *
 * The key insight: Runtime.evaluate and HeadlessExperimental.beginFrame
 * are processed sequentially by Chrome's message loop. So firing seek
 * then beginFrame without awaiting seek's response still guarantees
 * the seek completes before beginFrame runs - we just don't wait for
 * the seek's IPC response to come back to Node before sending beginFrame.
 */
export async function pipelinedCaptureFrames(
  page: Page,
  cdpSession: CDPSession,
  options: BatchCaptureOptions,
): Promise<BatchCaptureResult> {
  const {
    totalFrames,
    fps,
    format = "jpeg",
    quality = 80,
    baseFrameTimeTicks = 10000,
    onFrame,
  } = options;

  const intervalMs = 1000 / Math.max(1, fps);
  const screenshotFormat = format === "png" ? "png" : "jpeg";

  const buffers: Buffer[] = [];
  const perFrameMs: number[] = [];
  let hasDamageCount = 0;
  let noDamageCount = 0;
  let lastBuffer: Buffer | null = null;

  const captureStart = Date.now();

  for (let i = 0; i < totalFrames; i++) {
    const frameStart = Date.now();
    const time = quantize(i / fps, fps);
    const frameTimeTicks = baseFrameTimeTicks + i * intervalMs;

    // Fire seek as fire-and-forget (don't await the response).
    // Chrome processes CDP messages in order, so the seek JS will
    // execute before beginFrame processes.
    const seekExpr = `window.__hf && window.__hf.seek(${time})`;
    const seekPromise = cdpSession.send("Runtime.evaluate" as any, {
      expression: seekExpr,
      returnByValue: false,
      awaitPromise: false,
    } as any);

    // Immediately fire beginFrame - it will be queued after the seek
    // in Chrome's message loop, so the DOM will be in the seeked state.
    const beginFramePromise = cdpSession.send("HeadlessExperimental.beginFrame", {
      frameTimeTicks,
      interval: intervalMs,
      screenshot: {
        format: screenshotFormat,
        quality: screenshotFormat === "jpeg" ? quality : undefined,
        optimizeForSpeed: true,
      },
    });

    // Wait for both to complete (beginFrame is the slower one)
    const [, result] = await Promise.all([seekPromise, beginFramePromise]);

    let buffer: Buffer;
    if (result.screenshotData) {
      buffer = Buffer.from(result.screenshotData, "base64");
      lastBuffer = buffer;
      hasDamageCount++;
    } else {
      buffer = lastBuffer || Buffer.alloc(0);
      noDamageCount++;
    }

    buffers.push(buffer);
    perFrameMs.push(Date.now() - frameStart);

    if (onFrame) {
      onFrame(i, buffer);
    }
  }

  const totalMs = Date.now() - captureStart;

  return {
    buffers,
    totalMs,
    perFrameMs,
    hasDamageCount,
    noDamageCount,
  };
}

/**
 * Experiment B: rAF-batched seek via beginFrame.
 *
 * Pre-registers all seek times in the page. Each beginFrame triggers
 * a rAF callback that advances the seek queue. Only 1 CDP call per frame.
 */
export async function batchCaptureFrames(
  page: Page,
  cdpSession: CDPSession,
  options: BatchCaptureOptions,
): Promise<BatchCaptureResult> {
  const {
    totalFrames,
    fps,
    format = "jpeg",
    quality = 80,
    baseFrameTimeTicks = 10000,
    onFrame,
  } = options;

  const intervalMs = 1000 / Math.max(1, fps);

  // Pre-compute all quantized seek times
  const seekTimes: number[] = [];
  for (let i = 0; i < totalFrames; i++) {
    const time = i / fps;
    seekTimes.push(quantize(time, fps));
  }

  // Install the seek dispatcher inside the page using a string eval
  // to avoid tsx __name() decoration issues.
  await page.evaluate(`
    (function() {
      var w = window;
      w.__batchSeekQueue = ${JSON.stringify(seekTimes)};
      w.__batchSeekIndex = 0;

      var advanceFrame = function() {
        var queue = w.__batchSeekQueue;
        var idx = w.__batchSeekIndex;
        if (idx < queue.length && w.__hf && typeof w.__hf.seek === "function") {
          w.__hf.seek(queue[idx]);
        }
        if (idx + 1 < queue.length) {
          w.__batchSeekIndex = idx + 1;
          requestAnimationFrame(advanceFrame);
        }
      };

      // Seek frame 0 immediately
      if (w.__hf && typeof w.__hf.seek === "function") {
        w.__hf.seek(w.__batchSeekQueue[0]);
      }
      // Schedule frame 1+ via rAF chain
      if (w.__batchSeekQueue.length > 1) {
        w.__batchSeekIndex = 1;
        requestAnimationFrame(advanceFrame);
      }
    })();
  `);

  const buffers: Buffer[] = [];
  const perFrameMs: number[] = [];
  let hasDamageCount = 0;
  let noDamageCount = 0;
  let lastBuffer: Buffer | null = null;

  const screenshotFormat = format === "png" ? "png" : "jpeg";
  const captureStart = Date.now();

  for (let i = 0; i < totalFrames; i++) {
    const frameStart = Date.now();
    const frameTimeTicks = baseFrameTimeTicks + i * intervalMs;

    const result = await cdpSession.send("HeadlessExperimental.beginFrame", {
      frameTimeTicks,
      interval: intervalMs,
      screenshot: {
        format: screenshotFormat,
        quality: screenshotFormat === "jpeg" ? quality : undefined,
        optimizeForSpeed: true,
      },
    });

    let buffer: Buffer;
    if (result.screenshotData) {
      buffer = Buffer.from(result.screenshotData, "base64");
      lastBuffer = buffer;
      hasDamageCount++;
    } else {
      buffer = lastBuffer || Buffer.alloc(0);
      noDamageCount++;
    }

    buffers.push(buffer);
    perFrameMs.push(Date.now() - frameStart);

    if (onFrame) {
      onFrame(i, buffer);
    }
  }

  const totalMs = Date.now() - captureStart;

  // Clean up
  await page.evaluate(`
    delete window.__batchSeekQueue;
    delete window.__batchSeekIndex;
  `).catch(() => {});

  return {
    buffers,
    totalMs,
    perFrameMs,
    hasDamageCount,
    noDamageCount,
  };
}

/**
 * Baseline capture: matches the current production approach.
 * Two CDP round-trips per frame: page.evaluate(seek) + beginFrame(screenshot).
 * Used as the control in benchmarks.
 */
export async function baselineCaptureFrames(
  page: Page,
  cdpSession: CDPSession,
  options: BatchCaptureOptions,
): Promise<BatchCaptureResult> {
  const {
    totalFrames,
    fps,
    format = "jpeg",
    quality = 80,
    baseFrameTimeTicks = 10000,
    onFrame,
  } = options;

  const intervalMs = 1000 / Math.max(1, fps);
  const screenshotFormat = format === "png" ? "png" : "jpeg";

  const buffers: Buffer[] = [];
  const perFrameMs: number[] = [];
  let hasDamageCount = 0;
  let noDamageCount = 0;
  let lastBuffer: Buffer | null = null;

  const captureStart = Date.now();

  for (let i = 0; i < totalFrames; i++) {
    const frameStart = Date.now();
    const time = quantize(i / fps, fps);

    // CDP round-trip #1: seek via page.evaluate (awaits response)
    await page.evaluate((t: number) => {
      if (window.__hf && typeof window.__hf.seek === "function") {
        window.__hf.seek(t);
      }
    }, time);

    // CDP round-trip #2: beginFrame with screenshot
    const frameTimeTicks = baseFrameTimeTicks + i * intervalMs;
    const result = await cdpSession.send("HeadlessExperimental.beginFrame", {
      frameTimeTicks,
      interval: intervalMs,
      screenshot: {
        format: screenshotFormat,
        quality: screenshotFormat === "jpeg" ? quality : undefined,
        optimizeForSpeed: true,
      },
    });

    let buffer: Buffer;
    if (result.screenshotData) {
      buffer = Buffer.from(result.screenshotData, "base64");
      lastBuffer = buffer;
      hasDamageCount++;
    } else {
      buffer = lastBuffer || Buffer.alloc(0);
      noDamageCount++;
    }

    buffers.push(buffer);
    perFrameMs.push(Date.now() - frameStart);

    if (onFrame) {
      onFrame(i, buffer);
    }
  }

  const totalMs = Date.now() - captureStart;

  return {
    buffers,
    totalMs,
    perFrameMs,
    hasDamageCount,
    noDamageCount,
  };
}
