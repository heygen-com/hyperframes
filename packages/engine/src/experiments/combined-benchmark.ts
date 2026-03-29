#!/usr/bin/env npx tsx
/**
 * Combined Benchmark: All 4 Winning Optimizations Stacked
 *
 * Combines:
 *   Exp 4: N parallel Chrome processes for true parallelism
 *   Exp 1: Pipelined CDP — fire seek + beginFrame without awaiting seek
 *   Exp 5: Inline damage detection — skip screenshot for no-damage frames
 *   Exp 2: Streaming encode — pipe frames to FFmpeg stdin, no disk I/O
 *
 * Architecture:
 *   - Launch N Chrome processes (true OS-level parallelism)
 *   - Each worker captures its contiguous frame range using pipelined CDP
 *   - beginFrame returns hasDamage; when false, reuse previous buffer (zero-copy)
 *   - All buffers collected in memory, then streamed to FFmpeg in order
 */

import type { Browser, Page, CDPSession } from "puppeteer-core";
import { mkdtempSync, rmSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

import { createFileServer, type FileServerHandle } from "../services/fileServer.js";
import {
  acquireBrowser,
  releaseBrowser,
  buildChromeArgs,
  resolveHeadlessShellPath,
  type CaptureMode,
} from "../services/browserManager.js";
import { getCdpSession } from "../services/screenshotService.js";
import {
  spawnStreamingEncoder,
  type StreamingEncoderOptions,
} from "../services/streamingEncoder.js";

// ── Configuration ────────────────────────────────────────────────────────────

const THIS_DIR = typeof import.meta.dirname === "string"
  ? import.meta.dirname
  : dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = THIS_DIR;

const FPS = 30;
const DURATION_S = 15;
const TOTAL_FRAMES = DURATION_S * FPS; // 450
const WIDTH = 1080;
const HEIGHT = 1920;
const QUALITY = 80;

const OFFICIAL_BASELINE_MS = 8540; // 3-run average from official benchmark

// ── Helpers ──────────────────────────────────────────────────────────────────

function quantize(timeSeconds: number, fps: number): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const safeTime = Number.isFinite(timeSeconds) && timeSeconds > 0 ? timeSeconds : 0;
  const frameIndex = Math.floor(safeTime * safeFps + 1e-9);
  return frameIndex / safeFps;
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

// ── File Server ──────────────────────────────────────────────────────────────

async function startFileServer(): Promise<FileServerHandle> {
  console.log(`[Combined] Starting file server for: ${FIXTURE_DIR}`);
  const server = await createFileServer({
    projectDir: FIXTURE_DIR,
    port: 0,
    headScripts: [],
    bodyScripts: [],
    stripEmbeddedRuntime: false,
  });
  console.log(`[Combined] File server running at ${server.url}`);
  return server;
}

// ── Browser + Page Setup ─────────────────────────────────────────────────────

async function launchOneBrowser(): Promise<{
  browser: Browser;
  captureMode: CaptureMode;
}> {
  const headlessShell = resolveHeadlessShellPath();
  const isLinux = process.platform === "linux";
  const preMode: CaptureMode = headlessShell && isLinux ? "beginframe" : "screenshot";

  const chromeArgs = buildChromeArgs({
    width: WIDTH,
    height: HEIGHT,
    captureMode: preMode,
  });

  const { browser, captureMode } = await acquireBrowser(chromeArgs, {
    enableBrowserPool: false,
  });

  return { browser, captureMode };
}

interface WorkerInfo {
  workerId: number;
  browser: Browser;
  page: Page;
  cdp: CDPSession;
  baseFrameTimeTicks: number;
}

async function setupWorker(
  browser: Browser,
  workerId: number,
  serverUrl: string,
): Promise<WorkerInfo> {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

  // Warmup loop for beginFrame mode
  let warmupRunning = true;
  let warmupTicks = 0;
  let warmupFrameTime = 0;
  const warmupIntervalMs = 33;
  let warmupClient: CDPSession | null = null;

  const warmupLoop = async () => {
    try {
      warmupClient = await getCdpSession(page);
      await warmupClient.send("HeadlessExperimental.enable");
    } catch { /* page not ready */ }
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
        } catch { /* ignore */ }
      }
      await new Promise((r) => setTimeout(r, warmupIntervalMs));
    }
  };
  warmupLoop().catch(() => {});

  const url = `${serverUrl}/fixture.html`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Poll for __hf readiness
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
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
    throw new Error(`[Combined] Worker ${workerId}: window.__hf not ready after 30s`);
  }

  await page.evaluate(`document.fonts?.ready`);
  warmupRunning = false;
  // Brief pause to let any in-flight warmup beginFrame complete
  await new Promise((r) => setTimeout(r, 20));

  const cdp = await getCdpSession(page);
  await cdp.send("HeadlessExperimental.enable");

  const baseFrameTimeTicks = (warmupTicks + 10) * warmupIntervalMs;

  return { workerId, browser, page, cdp, baseFrameTimeTicks };
}

// ── Combined Pipeline Results ────────────────────────────────────────────────

interface CombinedResult {
  totalMs: number;
  captureMs: number;
  encodeMs: number;
  initMs: number;
  browserLaunchMs: number;
  streamMs: number;
  totalFrames: number;
  damagedFrames: number;
  staticFrames: number;
  outputFileSize: number;
  outputPath: string;
  numWorkers: number;
  perWorkerStats: Array<{
    workerId: number;
    framesTotal: number;
    framesCaptured: number;
    framesSkipped: number;
    captureMs: number;
    avgPerFrameMs: number;
  }>;
}

// ── Combined Pipeline ────────────────────────────────────────────────────────

async function runCombinedPipeline(
  serverUrl: string,
  outputPath: string,
  numWorkers: number,
): Promise<CombinedResult> {
  const totalStart = Date.now();
  const intervalMs = 1000 / FPS;

  // ── Step 1: Launch N Chrome processes ────────────────────────────
  const browserLaunchStart = Date.now();
  const browsers: Array<{ browser: Browser; captureMode: CaptureMode }> = [];
  // Launch in parallel for faster startup
  const launchPromises = Array.from({ length: numWorkers }, () => launchOneBrowser());
  const launchResults = await Promise.all(launchPromises);
  browsers.push(...launchResults);
  const browserLaunchMs = Date.now() - browserLaunchStart;
  console.log(`[Combined] ${numWorkers} browsers launched in ${browserLaunchMs}ms`);

  if (browsers[0]!.captureMode !== "beginframe") {
    for (const b of browsers) await b.browser.close();
    throw new Error("BeginFrame mode required");
  }

  try {
    // ── Step 2: Initialize workers (parallel page setup) ────────────
    const initStart = Date.now();
    const workerPromises = browsers.map((b, i) => setupWorker(b.browser, i, serverUrl));
    const workers = await Promise.all(workerPromises);
    const initMs = Date.now() - initStart;
    console.log(`[Combined] ${numWorkers} workers initialized in ${initMs}ms`);

    // ── Step 3: Assign contiguous frame ranges ──────────────────────
    const framesPerWorker = Math.ceil(TOTAL_FRAMES / numWorkers);
    const workerRanges: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < numWorkers; i++) {
      const start = i * framesPerWorker;
      const end = Math.min((i + 1) * framesPerWorker, TOTAL_FRAMES);
      workerRanges.push({ start, end });
    }

    // ── Step 4: Spawn FFmpeg + parallel capture with inline streaming ──
    // Spawn FFmpeg BEFORE capture starts (Exp 2).
    // Workers produce frames into slots; a concurrent feeder writes them
    // to FFmpeg stdin in sequential order as they become available.
    // This overlaps capture with encoding: total time ~= max(capture, encode).
    const encoderOpts: StreamingEncoderOptions = {
      fps: FPS,
      width: WIDTH,
      height: HEIGHT,
      codec: "h264",
      preset: "ultrafast",
      quality: 23,
      imageFormat: "jpeg",
    };
    const encoder = await spawnStreamingEncoder(outputPath, encoderOpts);

    // Frame slots and readiness flags for feeder coordination
    const frameSlots: (Buffer | null)[] = new Array(TOTAL_FRAMES).fill(null);
    const frameReady: boolean[] = new Array(TOTAL_FRAMES).fill(false);

    const captureStart = Date.now();
    const perWorkerStats: CombinedResult["perWorkerStats"] = [];

    async function captureWorkerRange(
      worker: WorkerInfo,
      rangeStart: number,
      rangeEnd: number,
    ): Promise<void> {
      const workerStart = Date.now();
      let lastBuffer: Buffer | null = null;
      let captured = 0;
      let skipped = 0;

      for (let frameIdx = rangeStart; frameIdx < rangeEnd; frameIdx++) {
        const time = quantize(frameIdx / FPS, FPS);
        const frameTimeTicks = worker.baseFrameTimeTicks + frameIdx * intervalMs;

        // Pipelined CDP (Exp 1): fire seek as fire-and-forget, immediately beginFrame
        const seekExpr = `window.__hf && window.__hf.seek(${time})`;
        const seekPromise = worker.cdp.send("Runtime.evaluate" as any, {
          expression: seekExpr,
          returnByValue: false,
          awaitPromise: false,
        } as any);

        // Always request screenshot -- Chrome returns no data when no damage
        const bfPromise = worker.cdp.send("HeadlessExperimental.beginFrame", {
          frameTimeTicks,
          interval: intervalMs,
          screenshot: {
            format: "jpeg",
            quality: QUALITY,
            optimizeForSpeed: true,
          },
        });

        const [, result] = await Promise.all([seekPromise, bfPromise]);

        if (result.screenshotData) {
          const buffer = Buffer.from(result.screenshotData, "base64");
          lastBuffer = buffer;
          frameSlots[frameIdx] = buffer;
          captured++;
        } else {
          // No damage -- reuse previous buffer (Exp 5 inline)
          frameSlots[frameIdx] = lastBuffer;
          skipped++;
        }
        frameReady[frameIdx] = true;
      }

      const total = rangeEnd - rangeStart;
      perWorkerStats.push({
        workerId: worker.workerId,
        framesTotal: total,
        framesCaptured: captured,
        framesSkipped: skipped,
        captureMs: Date.now() - workerStart,
        avgPerFrameMs: Math.round((Date.now() - workerStart) / Math.max(1, total)),
      });
    }

    // Feeder coroutine: writes frames to FFmpeg in order as they become ready.
    // Runs concurrently with capture workers.
    let framesWritten = 0;
    const feederPromise = (async () => {
      let lastStreamBuf: Buffer | null = null;
      for (let i = 0; i < TOTAL_FRAMES; i++) {
        // Spin-wait for frame to be ready (micro-sleeps via setImmediate)
        while (!frameReady[i]) {
          await new Promise<void>((r) => setImmediate(r));
        }
        const buf = frameSlots[i];
        if (buf && buf.length > 0) lastStreamBuf = buf;
        if (lastStreamBuf && lastStreamBuf.length > 0) {
          const ok = encoder.writeFrame(lastStreamBuf);
          if (!ok) {
            await new Promise<void>((r) => setTimeout(r, 1));
            encoder.writeFrame(lastStreamBuf);
          }
          framesWritten++;
        }
        // Free the buffer reference to reduce memory pressure
        frameSlots[i] = null;
      }
    })();

    // Run workers + feeder concurrently
    await Promise.all([
      ...workers.map((worker, i) => {
        const range = workerRanges[i]!;
        return captureWorkerRange(worker, range.start, range.end);
      }),
      feederPromise,
    ]);
    const captureMs = Date.now() - captureStart;

    // Count stats
    let damagedFrames = 0;
    let staticFrames = 0;
    for (const ws of perWorkerStats) {
      damagedFrames += ws.framesCaptured;
      staticFrames += ws.framesSkipped;
    }
    console.log(`[Combined] Capture+stream: ${captureMs}ms | ${damagedFrames} captured, ${staticFrames} skipped, ${framesWritten} streamed`);

    // Close FFmpeg (flush remaining frames)
    const drainStart = Date.now();
    const encodeResult = await encoder.close();
    const streamMs = captureMs + (Date.now() - drainStart); // capture overlapped with streaming

    if (!encodeResult.success) {
      throw new Error(`FFmpeg encode failed: ${encodeResult.error}`);
    }

    const totalMs = Date.now() - totalStart;

    return {
      totalMs,
      captureMs,
      encodeMs: encodeResult.durationMs,
      initMs,
      browserLaunchMs,
      streamMs,
      totalFrames: TOTAL_FRAMES,
      damagedFrames,
      staticFrames,
      outputFileSize: encodeResult.fileSize,
      outputPath,
      numWorkers,
      perWorkerStats,
    };
  } finally {
    for (const b of browsers) {
      await b.browser.close().catch(() => {});
    }
  }
}

// ── Single-Worker Baseline ───────────────────────────────────────────────────

interface BaselineResult {
  totalMs: number;
  captureMs: number;
  encodeMs: number;
  browserLaunchMs: number;
  totalFrames: number;
  hasDamageCount: number;
  outputFileSize: number;
}

async function runSingleWorkerBaseline(
  serverUrl: string,
  outputPath: string,
): Promise<BaselineResult> {
  const totalStart = Date.now();
  const intervalMs = 1000 / FPS;

  const browserLaunchStart = Date.now();
  const { browser, captureMode } = await launchOneBrowser();
  const browserLaunchMs = Date.now() - browserLaunchStart;

  if (captureMode !== "beginframe") {
    await browser.close();
    throw new Error("BeginFrame mode required");
  }

  try {
    const worker = await setupWorker(browser, 0, serverUrl);

    const captureStart = Date.now();
    const buffers: Buffer[] = [];
    let hasDamageCount = 0;
    let lastBuffer: Buffer | null = null;

    for (let i = 0; i < TOTAL_FRAMES; i++) {
      const time = quantize(i / FPS, FPS);
      const frameTimeTicks = worker.baseFrameTimeTicks + i * intervalMs;

      // Baseline: 2 sequential CDP round-trips (await seek, await beginFrame)
      await worker.page.evaluate((t: number) => {
        if (window.__hf && typeof window.__hf.seek === "function") {
          window.__hf.seek(t);
        }
      }, time);

      const result = await worker.cdp.send("HeadlessExperimental.beginFrame", {
        frameTimeTicks,
        interval: intervalMs,
        screenshot: {
          format: "jpeg",
          quality: QUALITY,
          optimizeForSpeed: true,
        },
      });

      if (result.screenshotData) {
        const buffer = Buffer.from(result.screenshotData, "base64");
        lastBuffer = buffer;
        buffers.push(buffer);
        hasDamageCount++;
      } else {
        buffers.push(lastBuffer || Buffer.alloc(0));
      }

      if ((i + 1) % 100 === 0) {
        process.stdout.write(`\r  [Baseline] ${i + 1}/${TOTAL_FRAMES} frames...`);
      }
    }
    console.log("");
    const captureMs = Date.now() - captureStart;

    // Encode
    const encoderOpts: StreamingEncoderOptions = {
      fps: FPS, width: WIDTH, height: HEIGHT,
      codec: "h264", preset: "ultrafast", quality: 23, imageFormat: "jpeg",
    };
    const encoder = await spawnStreamingEncoder(outputPath, encoderOpts);
    for (const buf of buffers) {
      if (buf.length > 0) encoder.writeFrame(buf);
    }
    const encodeResult = await encoder.close();
    const totalMs = Date.now() - totalStart;

    return {
      totalMs, captureMs, encodeMs: encodeResult.durationMs, browserLaunchMs,
      totalFrames: TOTAL_FRAMES, hasDamageCount, outputFileSize: encodeResult.fileSize,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("");
  console.log("=".repeat(72));
  console.log("  COMBINED EXPERIMENT: 4 Optimizations Stacked");
  console.log("=".repeat(72));
  console.log(`  Exp 4: N parallel Chrome processes`);
  console.log(`  Exp 1: Pipelined CDP (fire-and-forget seek)`);
  console.log(`  Exp 5: Inline damage detection (skip unchanged frames)`);
  console.log(`  Exp 2: Streaming encode (pipe to FFmpeg stdin)`);
  console.log(`  ${TOTAL_FRAMES} frames (${DURATION_S}s @ ${FPS}fps) | ${WIDTH}x${HEIGHT} | jpeg q=${QUALITY}`);
  console.log("=".repeat(72));
  console.log("");

  const server = await startFileServer();
  const workDir = mkdtempSync(join(tmpdir(), "combined-exp-"));

  try {
    // ── Run 1: Single-worker baseline ──────────────────────────────
    console.log("[Run 1] Single-worker baseline (sequential CDP)...");
    const baseline = await runSingleWorkerBaseline(server.url, join(workDir, "baseline.mp4"));
    console.log(`  Total: ${baseline.totalMs}ms | Capture: ${baseline.captureMs}ms | Encode: ${baseline.encodeMs}ms`);

    // ── Run 2: Combined 4 workers ──────────────────────────────────
    console.log("\n[Run 2] COMBINED 4 workers...");
    const c4 = await runCombinedPipeline(server.url, join(workDir, "c4.mp4"), 4);

    // ── Run 3: Combined 6 workers ──────────────────────────────────
    console.log("\n[Run 3] COMBINED 6 workers...");
    const c6 = await runCombinedPipeline(server.url, join(workDir, "c6.mp4"), 6);

    // ── Run 4: Combined 4 workers (warm) ───────────────────────────
    console.log("\n[Run 4] COMBINED 4 workers (warm)...");
    const c4w = await runCombinedPipeline(server.url, join(workDir, "c4w.mp4"), 4);

    // ── Run 5: Combined 6 workers (warm) ───────────────────────────
    console.log("\n[Run 5] COMBINED 6 workers (warm)...");
    const c6w = await runCombinedPipeline(server.url, join(workDir, "c6w.mp4"), 6);

    // ── Run 6: Combined 8 workers ──────────────────────────────────
    console.log("\n[Run 6] COMBINED 8 workers...");
    const c8 = await runCombinedPipeline(server.url, join(workDir, "c8.mp4"), 8);

    // ── Run 7: Combined 8 workers (warm) ───────────────────────────
    console.log("\n[Run 7] COMBINED 8 workers (warm)...");
    const c8w = await runCombinedPipeline(server.url, join(workDir, "c8w.mp4"), 8);

    // ── Summary ─────────────────────────────────────────────────────
    const allRuns = [c4, c6, c4w, c6w, c8, c8w];
    const best = allRuns.reduce((a, b) => a.totalMs <= b.totalMs ? a : b);

    console.log("\n\n" + "=".repeat(82));
    console.log("  RESULTS SUMMARY");
    console.log("=".repeat(82));
    console.log("");
    console.log(
      padRight("Configuration", 40) +
      padRight("Total", 10) +
      padRight("Capture", 10) +
      padRight("Stream", 10) +
      padRight("vs Official", 12)
    );
    console.log("-".repeat(82));

    interface Row { label: string; total: number; capture: string; stream: string }
    const rows: Row[] = [
      { label: "Official baseline (6 workers)", total: OFFICIAL_BASELINE_MS, capture: "n/a", stream: "n/a" },
      { label: "1-worker sequential baseline", total: baseline.totalMs, capture: `${baseline.captureMs}ms`, stream: `${baseline.encodeMs}ms` },
      { label: `COMBINED 4 workers`, total: c4.totalMs, capture: `${c4.captureMs}ms`, stream: `${c4.streamMs}ms` },
      { label: `COMBINED 6 workers`, total: c6.totalMs, capture: `${c6.captureMs}ms`, stream: `${c6.streamMs}ms` },
      { label: `COMBINED 4 workers (warm)`, total: c4w.totalMs, capture: `${c4w.captureMs}ms`, stream: `${c4w.streamMs}ms` },
      { label: `COMBINED 6 workers (warm)`, total: c6w.totalMs, capture: `${c6w.captureMs}ms`, stream: `${c6w.streamMs}ms` },
      { label: `COMBINED 8 workers`, total: c8.totalMs, capture: `${c8.captureMs}ms`, stream: `${c8.streamMs}ms` },
      { label: `COMBINED 8 workers (warm)`, total: c8w.totalMs, capture: `${c8w.captureMs}ms`, stream: `${c8w.streamMs}ms` },
    ];

    for (const row of rows) {
      const speedup = (OFFICIAL_BASELINE_MS / row.total).toFixed(2);
      console.log(
        padRight(row.label, 40) +
        padRight(`${row.total}ms`, 10) +
        padRight(row.capture, 10) +
        padRight(row.stream, 10) +
        padRight(`${speedup}x`, 12)
      );
    }

    console.log("");
    console.log("=".repeat(82));
    console.log(`  BEST (${best.numWorkers}w) vs official baseline: ${(OFFICIAL_BASELINE_MS / best.totalMs).toFixed(2)}x`);
    console.log(`  BEST vs 1-worker baseline:        ${(baseline.totalMs / best.totalMs).toFixed(2)}x`);
    console.log("=".repeat(82));

    // ── Timing Breakdown ────────────────────────────────────────────
    console.log(`\n  Best Run Breakdown (${best.numWorkers} workers):`);
    console.log(`    Browser launch:   ${best.browserLaunchMs}ms  (${best.numWorkers} processes, parallel)`);
    console.log(`    Worker init:      ${best.initMs}ms  (parallel page setup)`);
    console.log(`    Capture:          ${best.captureMs}ms  (${best.damagedFrames} captured + ${best.staticFrames} skipped)`);
    console.log(`    Stream+Encode:    ${best.streamMs}ms`);
    console.log(`    Total wall-clock: ${best.totalMs}ms`);
    console.log("");

    // Sort by captureMs for display
    const sortedStats = [...best.perWorkerStats].sort((a, b) => a.captureMs - b.captureMs);
    for (const ws of sortedStats) {
      console.log(
        `    Worker ${ws.workerId}: ${ws.framesTotal} frames ` +
        `(${ws.framesCaptured} captured, ${ws.framesSkipped} skipped) ` +
        `in ${ws.captureMs}ms (${ws.avgPerFrameMs}ms/frame)`
      );
    }

    console.log("");
    console.log(`    Skip rate:            ${best.staticFrames}/${TOTAL_FRAMES} (${Math.round(best.staticFrames / TOTAL_FRAMES * 100)}%)`);
    console.log(`    Effective frames/sec: ${Math.round(TOTAL_FRAMES / (best.totalMs / 1000))}`);
    console.log(`    Output: ${Math.round(best.outputFileSize / 1024)}KB (baseline: ${Math.round(baseline.outputFileSize / 1024)}KB)`);
    console.log("");

  } catch (err) {
    console.error("[Combined] Error:", err);
    process.exit(1);
  } finally {
    server.close();
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch((err) => {
  console.error("[Combined] Unhandled error:", err);
  process.exit(1);
});
