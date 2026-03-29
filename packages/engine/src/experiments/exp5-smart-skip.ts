/**
 * Experiment 5: Smart Frame Skipping + Damage-Aware Capture
 *
 * Strategies to skip capturing frames that haven't visually changed:
 *
 *   Strategy 1 (Aggressive Damage Detection):
 *     Use hasDamage from BeginFrame to skip screenshots entirely.
 *     When no damage, reuse the SAME buffer reference (zero-copy).
 *
 *   Strategy 3 (Two-Pass Capture):
 *     Pass 1: Scan all frames with beginFrame (no screenshot) to collect hasDamage map.
 *     Pass 2: Only capture frames with damage; emit previous buffer for no-damage frames.
 *
 *   Strategy 4 (Reduced Capture + FFmpeg Concat):
 *     Only capture frames that change. Generate FFmpeg concat file with durations
 *     to duplicate static frames. Reduces both capture AND encode time.
 */

import type { Page, CDPSession } from "puppeteer-core";
import { writeFileSync, mkdirSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { spawn } from "child_process";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function quantize(timeSeconds: number, fps: number): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const safeTime = Number.isFinite(timeSeconds) && timeSeconds > 0 ? timeSeconds : 0;
  const frameIndex = Math.floor(safeTime * safeFps + 1e-9);
  return frameIndex / safeFps;
}

/**
 * Generate a string-based evaluate script to install the seek dispatcher
 * inside the browser page. Uses string eval to avoid tsx __name transform
 * which would break named functions in the browser context.
 */
function makeSeekDispatcherScript(seekTimes: number[]): string {
  return `(function() {
    var w = window;
    w.__batchSeekQueue = ${JSON.stringify(seekTimes)};
    w.__batchSeekIndex = 0;
    w.__batchSeekReady = false;

    var advanceFrame = function() {
      var queue = w.__batchSeekQueue;
      var idx = w.__batchSeekIndex;
      if (idx < queue.length && w.__hf && typeof w.__hf.seek === "function") {
        w.__hf.seek(queue[idx]);
      }
      w.__batchSeekReady = true;
      if (idx + 1 < queue.length) {
        w.__batchSeekIndex = idx + 1;
        requestAnimationFrame(advanceFrame);
      }
    };

    if (w.__hf && typeof w.__hf.seek === "function") {
      w.__hf.seek(${JSON.stringify(seekTimes[0])});
    }
    w.__batchSeekReady = true;
    if (${seekTimes.length} > 1) {
      w.__batchSeekIndex = 1;
      requestAnimationFrame(advanceFrame);
    }
  })()`;
}

const CLEANUP_SCRIPT = `(function() {
  delete window.__batchSeekQueue;
  delete window.__batchSeekIndex;
  delete window.__batchSeekReady;
})()`;

export interface SmartSkipOptions {
  totalFrames: number;
  fps: number;
  format?: "jpeg" | "png";
  quality?: number;
  baseFrameTimeTicks?: number;
  onFrame?: (frameIndex: number, buffer: Buffer) => void;
}

export interface SmartSkipResult {
  /** Frame buffers in order (450 entries for 15s@30fps) */
  buffers: Buffer[];
  totalMs: number;
  perFrameMs: number[];
  /** Frames where actual screenshot was captured */
  capturedCount: number;
  /** Frames reused from previous (skipped) */
  skippedCount: number;
  /** Frames with hasDamage=true */
  hasDamageCount: number;
  /** Frames with hasDamage=false */
  noDamageCount: number;
}

// ---------------------------------------------------------------------------
// Strategy 1: Aggressive Damage Detection
// ---------------------------------------------------------------------------

/**
 * Uses beginFrame WITH screenshot request for every frame, but when
 * hasDamage=false, reuses the exact same buffer reference (zero-copy).
 * This is essentially the baseline behavior but with explicit tracking.
 *
 * The key insight: even when we request a screenshot, Chrome doesn't return
 * screenshotData when hasDamage=false. So we're already doing this implicitly
 * in the baseline. But this strategy makes it explicit and tracks statistics.
 *
 * The real win: when we detect runs of no-damage frames, we can skip the
 * entire beginFrame call and just emit the cached buffer. This avoids even
 * the compositor cycle overhead for truly static frames.
 */
export async function strategy1AggressiveDamage(
  page: Page,
  cdpSession: CDPSession,
  options: SmartSkipOptions,
): Promise<SmartSkipResult> {
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

  // Pre-compute seek times and install the seek dispatcher (same as exp1 batch)
  const seekTimes: number[] = [];
  for (let i = 0; i < totalFrames; i++) {
    seekTimes.push(quantize(i / fps, fps));
  }

  await page.evaluate(makeSeekDispatcherScript(seekTimes));

  const buffers: Buffer[] = [];
  const perFrameMs: number[] = [];
  let capturedCount = 0;
  let skippedCount = 0;
  let hasDamageCount = 0;
  let noDamageCount = 0;
  let lastBuffer: Buffer | null = null;
  let consecutiveNoDamage = 0;

  const captureStart = Date.now();

  for (let i = 0; i < totalFrames; i++) {
    const frameStart = Date.now();
    const frameTimeTicks = baseFrameTimeTicks + i * intervalMs;

    // Always call beginFrame with screenshot request.
    // Chrome will skip returning screenshotData when hasDamage=false.
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
      capturedCount++;
      consecutiveNoDamage = 0;
    } else {
      // Zero-copy: reuse the exact same buffer reference
      buffer = lastBuffer || Buffer.alloc(0);
      noDamageCount++;
      skippedCount++;
      consecutiveNoDamage++;
    }

    buffers.push(buffer);
    perFrameMs.push(Date.now() - frameStart);
    if (onFrame) onFrame(i, buffer);
  }

  const totalMs = Date.now() - captureStart;

  // Cleanup
  await page.evaluate(CLEANUP_SCRIPT).catch(() => {});

  return {
    buffers,
    totalMs,
    perFrameMs,
    capturedCount,
    skippedCount,
    hasDamageCount,
    noDamageCount,
  };
}

// ---------------------------------------------------------------------------
// Strategy 3: Two-Pass Capture
// ---------------------------------------------------------------------------

/**
 * Pass 1 (fast scan): Run through all frames with beginFrame but NO screenshot.
 *   Just collect hasDamage booleans. Very fast since no pixel data is transferred.
 *
 * Pass 2 (selective capture): Only capture frames where damage was detected.
 *   For no-damage frames, emit the previous frame's buffer.
 *
 * This should be faster than the baseline because:
 *   - Pass 1 is very cheap (no screenshot data transfer)
 *   - Pass 2 only captures the frames that actually changed
 *   - If 50% of frames have no damage, we halve the screenshot overhead
 */
export async function strategy3TwoPass(
  page: Page,
  cdpSession: CDPSession,
  options: SmartSkipOptions,
): Promise<SmartSkipResult> {
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

  // Pre-compute seek times
  const seekTimes: number[] = [];
  for (let i = 0; i < totalFrames; i++) {
    seekTimes.push(quantize(i / fps, fps));
  }

  // ── PASS 1: Fast damage scan (no screenshots) ──────────────────────────

  // Install seek dispatcher for pass 1
  await page.evaluate(makeSeekDispatcherScript(seekTimes));

  const damageMap: boolean[] = [];
  const pass1Start = Date.now();

  for (let i = 0; i < totalFrames; i++) {
    const frameTimeTicks = baseFrameTimeTicks + i * intervalMs;

    // BeginFrame WITHOUT screenshot -- just runs compositor cycle
    const result = await cdpSession.send("HeadlessExperimental.beginFrame", {
      frameTimeTicks,
      interval: intervalMs,
      // No screenshot parameter = no pixel data transfer
    });

    damageMap.push(result.hasDamage);
  }

  const pass1Ms = Date.now() - pass1Start;

  // Clean up pass 1 state
  await page.evaluate(CLEANUP_SCRIPT).catch(() => {});

  const damageFrameCount = damageMap.filter(Boolean).length;
  const noDamageFrameCount = totalFrames - damageFrameCount;

  console.log(
    `  [Pass 1] Scan complete in ${pass1Ms}ms: ${damageFrameCount} damage frames, ${noDamageFrameCount} static`,
  );

  // ── PASS 2: Selective capture (only damage frames) ─────────────────────

  // We need to re-seek through all frames because the compositor state
  // must be correct. But we only request screenshots for damage frames.
  // Use a second base tick offset to avoid conflicts.
  const pass2BaseTicks = baseFrameTimeTicks + totalFrames * intervalMs + 1000;

  // Re-install seek dispatcher for pass 2
  await page.evaluate(makeSeekDispatcherScript(seekTimes));

  const buffers: Buffer[] = [];
  const perFrameMs: number[] = [];
  let capturedCount = 0;
  let skippedCount = 0;
  let lastBuffer: Buffer | null = null;

  const pass2Start = Date.now();

  for (let i = 0; i < totalFrames; i++) {
    const frameStart = Date.now();
    const frameTimeTicks = pass2BaseTicks + i * intervalMs;
    const needsCapture = damageMap[i] || lastBuffer === null;

    if (needsCapture) {
      // Request screenshot for this frame
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
      } else {
        // Damage was predicted but compositor says no change (race condition)
        buffer = lastBuffer || Buffer.alloc(0);
      }
      buffers.push(buffer);
      capturedCount++;
    } else {
      // Skip screenshot -- just advance the compositor
      await cdpSession.send("HeadlessExperimental.beginFrame", {
        frameTimeTicks,
        interval: intervalMs,
        // No screenshot
      });
      buffers.push(lastBuffer!);
      skippedCount++;
    }

    perFrameMs.push(Date.now() - frameStart);
    if (onFrame) onFrame(i, buffers[i]!);
  }

  const pass2Ms = Date.now() - pass2Start;
  const totalMs = pass1Ms + pass2Ms;

  console.log(
    `  [Pass 2] Selective capture in ${pass2Ms}ms: ${capturedCount} captured, ${skippedCount} skipped`,
  );

  // Cleanup
  await page.evaluate(CLEANUP_SCRIPT).catch(() => {});

  return {
    buffers,
    totalMs,
    perFrameMs,
    capturedCount,
    skippedCount,
    hasDamageCount: damageFrameCount,
    noDamageCount: noDamageFrameCount,
  };
}

// ---------------------------------------------------------------------------
// Strategy 4: Reduced Capture + FFmpeg Concat
// ---------------------------------------------------------------------------

/**
 * Only capture frames that have visual changes. For static runs, generate
 * an FFmpeg concat demuxer file that specifies frame durations to duplicate
 * the last captured frame.
 *
 * This reduces BOTH capture time (fewer screenshots) AND encode time
 * (FFmpeg concat demuxer is very efficient for repeated frames).
 *
 * Flow:
 *   1. Capture with damage detection (like Strategy 1)
 *   2. Write only unique frames to disk
 *   3. Generate FFmpeg concat file with duration entries
 *   4. Encode using FFmpeg concat demuxer
 */
export async function strategy4ConcatCapture(
  page: Page,
  cdpSession: CDPSession,
  options: SmartSkipOptions & { outputDir: string },
): Promise<SmartSkipResult & { concatFilePath: string; uniqueFrameFiles: string[] }> {
  const {
    totalFrames,
    fps,
    format = "jpeg",
    quality = 80,
    baseFrameTimeTicks = 10000,
    outputDir,
    onFrame,
  } = options;

  const intervalMs = 1000 / Math.max(1, fps);
  const screenshotFormat = format === "png" ? "png" : "jpeg";
  const ext = format === "png" ? "png" : "jpg";
  const frameDuration = 1 / fps;

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  // Pre-compute seek times
  const seekTimes: number[] = [];
  for (let i = 0; i < totalFrames; i++) {
    seekTimes.push(quantize(i / fps, fps));
  }

  // Install seek dispatcher
  await page.evaluate(makeSeekDispatcherScript(seekTimes));

  const buffers: Buffer[] = [];
  const perFrameMs: number[] = [];
  let capturedCount = 0;
  let skippedCount = 0;
  let hasDamageCount = 0;
  let noDamageCount = 0;
  let lastBuffer: Buffer | null = null;

  // Track unique frames and their spans for the concat file
  interface FrameSpan {
    fileName: string;
    frameCount: number; // how many frames this image covers
  }
  const spans: FrameSpan[] = [];
  let currentSpan: FrameSpan | null = null;
  const uniqueFrameFiles: string[] = [];

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
    let isNewFrame = false;

    if (result.screenshotData) {
      buffer = Buffer.from(result.screenshotData, "base64");
      lastBuffer = buffer;
      hasDamageCount++;
      capturedCount++;
      isNewFrame = true;
    } else {
      buffer = lastBuffer || Buffer.alloc(0);
      noDamageCount++;
      skippedCount++;
    }

    if (isNewFrame || currentSpan === null) {
      // Write this frame to disk
      const fileName = `unique_${String(capturedCount - 1).padStart(6, "0")}.${ext}`;
      const filePath = join(outputDir, fileName);
      writeFileSync(filePath, buffer);
      uniqueFrameFiles.push(filePath);

      // Start a new span
      currentSpan = { fileName, frameCount: 1 };
      spans.push(currentSpan);
    } else {
      // Extend the current span (same frame repeated)
      currentSpan.frameCount++;
    }

    buffers.push(buffer);
    perFrameMs.push(Date.now() - frameStart);
    if (onFrame) onFrame(i, buffer);
  }

  const totalMs = Date.now() - captureStart;

  // Generate FFmpeg concat file
  const concatLines: string[] = [];
  for (const span of spans) {
    concatLines.push(`file '${span.fileName}'`);
    concatLines.push(`duration ${(span.frameCount * frameDuration).toFixed(6)}`);
  }
  // FFmpeg concat needs the last file repeated without duration
  if (spans.length > 0) {
    concatLines.push(`file '${spans[spans.length - 1]!.fileName}'`);
  }

  const concatFilePath = join(outputDir, "concat.txt");
  writeFileSync(concatFilePath, concatLines.join("\n"), "utf-8");

  // Cleanup page state
  await page.evaluate(CLEANUP_SCRIPT).catch(() => {});

  return {
    buffers,
    totalMs,
    perFrameMs,
    capturedCount,
    skippedCount,
    hasDamageCount,
    noDamageCount,
    concatFilePath,
    uniqueFrameFiles,
  };
}

/**
 * Encode using FFmpeg concat demuxer.
 * Much faster than image2pipe for sequences with many repeated frames
 * because FFmpeg only decodes each unique frame once.
 */
export async function encodeConcatFile(
  concatFilePath: string,
  outputPath: string,
  options: {
    fps: number;
    width: number;
    height: number;
    preset?: string;
    quality?: number;
  },
): Promise<{ success: boolean; durationMs: number; fileSize: number; error?: string }> {
  const { fps, preset = "ultrafast", quality = 23 } = options;

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const args = [
    "-f", "concat",
    "-safe", "0",
    "-i", concatFilePath,
    "-c:v", "libx264",
    "-preset", preset,
    "-crf", String(quality),
    "-pix_fmt", "yuv420p",
    "-r", String(fps),
    "-y", outputPath,
  ];

  const startTime = Date.now();

  return new Promise((resolve) => {
    const ffmpeg = spawn("ffmpeg", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    ffmpeg.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      const durationMs = Date.now() - startTime;
      if (code !== 0) {
        resolve({
          success: false,
          durationMs,
          fileSize: 0,
          error: `FFmpeg exited with code ${code}: ${stderr.slice(-500)}`,
        });
        return;
      }

      let fileSize = 0;
      try {
        fileSize = statSync(outputPath).size;
      } catch { /* ignore */ }

      resolve({ success: true, durationMs, fileSize });
    });

    ffmpeg.on("error", (err) => {
      resolve({
        success: false,
        durationMs: Date.now() - startTime,
        fileSize: 0,
        error: err.message,
      });
    });
  });
}
