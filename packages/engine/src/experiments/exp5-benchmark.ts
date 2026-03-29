#!/usr/bin/env npx tsx
/**
 * Experiment 5 Benchmark: Smart Frame Skipping + Damage-Aware Capture
 *
 * Compares:
 *   1. Baseline: Capture all 450 frames with screenshot (batch approach from exp1)
 *   2. Strategy 1: Aggressive damage detection (same as baseline but tracks skips)
 *   3. Strategy 3: Two-pass scan + selective capture
 *   4. Strategy 4: Reduced capture + FFmpeg concat with duration
 *
 * Uses the `chat` test fixture (15s @ 30fps = 450 frames).
 *
 * Usage:
 *   cd /home/ubuntu/workspaces/hyperframes-oss
 *   npx tsx packages/engine/src/experiments/exp5-benchmark.ts
 */

import { mkdirSync, existsSync, rmSync, statSync } from "fs";
import { join } from "path";

import {
  acquireBrowser,
  releaseBrowser,
  buildChromeArgs,
  resolveHeadlessShellPath,
  type CaptureMode,
} from "../services/browserManager.js";
import { getCdpSession } from "../services/screenshotService.js";
import {
  batchCaptureFrames,
  type BatchCaptureOptions,
} from "../services/experimentalBatchCapture.js";
import {
  strategy1AggressiveDamage,
  strategy3TwoPass,
  strategy4ConcatCapture,
  encodeConcatFile,
  type SmartSkipOptions,
  type SmartSkipResult,
} from "./exp5-smart-skip.js";
import { spawnStreamingEncoder, type StreamingEncoderOptions } from "../services/streamingEncoder.js";

import type { Browser, Page } from "puppeteer-core";

// Use the producer's file server which injects the Hyperframe runtime + bridge
import { createFileServer, type FileServerHandle } from "../../../producer/src/services/fileServer.js";

// ── Configuration ──────────────────────────────────────────────────────────

const CHAT_FIXTURE_DIR = join(
  process.cwd(),
  "packages/producer/tests/chat/src",
);

const FPS = 30;
const DURATION_S = 15;
const TOTAL_FRAMES = FPS * DURATION_S; // 450
const WIDTH = 1080;
const HEIGHT = 1920;
const FORMAT: "jpeg" = "jpeg";
const QUALITY = 80;

const OUTPUT_DIR = join(process.cwd(), "tmp/exp5-benchmark");

// ── Helpers ────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  return `${ms.toLocaleString()}ms`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)]!;
}

async function setupPage(
  browser: Browser,
  serverUrl: string,
): Promise<{ page: Page; baseFrameTimeTicks: number }> {
  const page = await browser.newPage();
  await page.setViewport({
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
  });

  // Warmup loop for beginFrame mode
  let warmupRunning = true;
  let warmupTicks = 0;
  let warmupFrameTime = 0;
  const warmupIntervalMs = 33;
  let warmupClient: import("puppeteer-core").CDPSession | null = null;

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

  const url = `${serverUrl}/index.html`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Poll for __hf readiness
  const deadline = Date.now() + 45000;
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
    throw new Error("[Benchmark] window.__hf not ready after 45s");
  }

  await page.evaluate(`document.fonts?.ready`);
  warmupRunning = false;

  const baseFrameTimeTicks = (warmupTicks + 10) * warmupIntervalMs;
  return { page, baseFrameTimeTicks };
}

interface BenchmarkResult {
  label: string;
  totalMs: number;
  captureMs: number;
  encodeMs: number;
  framesTotal: number;
  framesCaptured: number;
  framesSkipped: number;
  hasDamage: number;
  noDamage: number;
  avgFrameMs: number;
  p50Ms: number;
  p95Ms: number;
  outputSize: number;
}

function printResult(r: BenchmarkResult): void {
  console.log(`\n${"=".repeat(64)}`);
  console.log(`  ${r.label}`);
  console.log(`${"=".repeat(64)}`);
  console.log(`  Total time:        ${formatMs(r.totalMs)}`);
  console.log(`  Capture time:      ${formatMs(r.captureMs)}`);
  console.log(`  Encode time:       ${formatMs(r.encodeMs)}`);
  console.log(`  Frames total:      ${r.framesTotal}`);
  console.log(`  Frames captured:   ${r.framesCaptured} (${((r.framesCaptured / r.framesTotal) * 100).toFixed(1)}%)`);
  console.log(`  Frames skipped:    ${r.framesSkipped} (${((r.framesSkipped / r.framesTotal) * 100).toFixed(1)}%)`);
  console.log(`  hasDamage:         ${r.hasDamage}`);
  console.log(`  noDamage:          ${r.noDamage}`);
  console.log(`  Avg frame time:    ${r.avgFrameMs.toFixed(2)}ms`);
  console.log(`  P50 frame time:    ${r.p50Ms}ms`);
  console.log(`  P95 frame time:    ${r.p95Ms}ms`);
  if (r.outputSize > 0) {
    console.log(`  Output size:       ${formatBytes(r.outputSize)}`);
  }
}

function printComparison(results: BenchmarkResult[]): void {
  const baseline = results[0]!;

  console.log(`\n${"=".repeat(64)}`);
  console.log(`  COMPARISON SUMMARY`);
  console.log(`${"=".repeat(64)}`);
  console.log("");
  console.log(
    `  ${"Strategy".padEnd(35)} ${"Total".padStart(8)} ${"Capture".padStart(8)} ${"Encode".padStart(8)} ${"Skipped".padStart(8)} ${"Speedup".padStart(8)}`,
  );
  console.log(`  ${"-".repeat(35)} ${"-".repeat(8)} ${"-".repeat(8)} ${"-".repeat(8)} ${"-".repeat(8)} ${"-".repeat(8)}`);

  for (const r of results) {
    const speedup = baseline.totalMs / Math.max(1, r.totalMs);
    const skipPct = ((r.framesSkipped / r.framesTotal) * 100).toFixed(0);
    console.log(
      `  ${r.label.padEnd(35)} ${formatMs(r.totalMs).padStart(8)} ${formatMs(r.captureMs).padStart(8)} ${formatMs(r.encodeMs).padStart(8)} ${(skipPct + "%").padStart(8)} ${speedup.toFixed(2).padStart(7)}x`,
    );
  }

  console.log("");

  // Highlight the best
  const best = results.reduce((a, b) => (a.totalMs < b.totalMs ? a : b));
  const savings = baseline.totalMs - best.totalMs;
  const pctFaster = ((savings / baseline.totalMs) * 100).toFixed(1);
  console.log(`  Best strategy: ${best.label}`);
  console.log(`  Saved ${formatMs(savings)} (${pctFaster}% faster than baseline)`);
  console.log(`  Skipped ${best.framesSkipped}/${best.framesTotal} frames (${((best.framesSkipped / best.framesTotal) * 100).toFixed(1)}% of frames)`);
}

// ── Run helpers ────────────────────────────────────────────────────────────

async function encodeWithStreaming(
  buffers: Buffer[],
  outputPath: string,
): Promise<{ durationMs: number; fileSize: number }> {
  const streamingOpts: StreamingEncoderOptions = {
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    codec: "h264",
    preset: "ultrafast",
    quality: 23,
    imageFormat: "jpeg",
  };

  const encoder = await spawnStreamingEncoder(outputPath, streamingOpts);
  const encodeStart = Date.now();

  for (const buffer of buffers) {
    const ok = encoder.writeFrame(buffer);
    if (!ok) {
      await new Promise<void>((r) => setTimeout(r, 1));
      encoder.writeFrame(buffer);
    }
  }

  const result = await encoder.close();
  const durationMs = Date.now() - encodeStart;

  if (!result.success) {
    throw new Error(`Encode failed: ${result.error}`);
  }

  return { durationMs, fileSize: result.fileSize };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n" + "=".repeat(64));
  console.log("  Experiment 5: Smart Frame Skipping + Damage-Aware Capture");
  console.log("=".repeat(64));
  console.log(`  Fixture:    ${CHAT_FIXTURE_DIR}`);
  console.log(`  Frames:     ${TOTAL_FRAMES} (${DURATION_S}s @ ${FPS}fps)`);
  console.log(`  Resolution: ${WIDTH}x${HEIGHT}`);
  console.log(`  Format:     ${FORMAT} q=${QUALITY}`);
  console.log("");

  if (!existsSync(CHAT_FIXTURE_DIR)) {
    console.error(`ERROR: Chat fixture not found at ${CHAT_FIXTURE_DIR}`);
    process.exit(1);
  }

  // Clean output dir
  if (existsSync(OUTPUT_DIR)) {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Start file server (producer version with runtime injection)
  console.log("[Benchmark] Starting file server...");
  const server = await createFileServer({
    projectDir: CHAT_FIXTURE_DIR,
    port: 0,
  });
  console.log(`[Benchmark] File server at ${server.url}`);

  // Launch browser
  const headlessShell = resolveHeadlessShellPath();
  const isLinux = process.platform === "linux";
  const preMode: CaptureMode = headlessShell && isLinux ? "beginframe" : "screenshot";

  const chromeArgs = buildChromeArgs({
    width: WIDTH,
    height: HEIGHT,
    captureMode: preMode,
  });

  console.log(`[Benchmark] Launching browser (mode: ${preMode})`);
  const { browser, captureMode } = await acquireBrowser(chromeArgs);
  console.log(`[Benchmark] Browser launched (captureMode: ${captureMode})`);

  if (captureMode !== "beginframe") {
    console.error("[Benchmark] FATAL: BeginFrame mode required.");
    process.exit(1);
  }

  const allResults: BenchmarkResult[] = [];

  try {
    // ── 1. BASELINE (batch capture, all frames with screenshots) ─────

    console.log("\n--- Running BASELINE (capture all 450 frames) ---");
    {
      const { page, baseFrameTimeTicks } = await setupPage(browser, server.url);
      const cdp = await getCdpSession(page);
      await cdp.send("HeadlessExperimental.enable");

      const opts: BatchCaptureOptions = {
        totalFrames: TOTAL_FRAMES,
        fps: FPS,
        format: FORMAT,
        quality: QUALITY,
        baseFrameTimeTicks,
      };

      const result = await batchCaptureFrames(page, cdp, opts);
      await page.close();

      // Encode baseline
      const outputPath = join(OUTPUT_DIR, "baseline.mp4");
      const enc = await encodeWithStreaming(result.buffers, outputPath);

      const br: BenchmarkResult = {
        label: "Baseline (all frames)",
        totalMs: result.totalMs + enc.durationMs,
        captureMs: result.totalMs,
        encodeMs: enc.durationMs,
        framesTotal: TOTAL_FRAMES,
        framesCaptured: result.hasDamageCount,
        framesSkipped: result.noDamageCount,
        hasDamage: result.hasDamageCount,
        noDamage: result.noDamageCount,
        avgFrameMs: result.perFrameMs.reduce((a, b) => a + b, 0) / result.perFrameMs.length,
        p50Ms: percentile(result.perFrameMs, 0.5),
        p95Ms: percentile(result.perFrameMs, 0.95),
        outputSize: enc.fileSize,
      };
      printResult(br);
      allResults.push(br);
    }

    // ── 2. STRATEGY 1: Aggressive Damage Detection ────────────────────

    console.log("\n--- Running STRATEGY 1 (aggressive damage detection) ---");
    {
      const { page, baseFrameTimeTicks } = await setupPage(browser, server.url);
      const cdp = await getCdpSession(page);
      await cdp.send("HeadlessExperimental.enable");

      const opts: SmartSkipOptions = {
        totalFrames: TOTAL_FRAMES,
        fps: FPS,
        format: FORMAT,
        quality: QUALITY,
        baseFrameTimeTicks,
      };

      const result = await strategy1AggressiveDamage(page, cdp, opts);
      await page.close();

      // Encode
      const outputPath = join(OUTPUT_DIR, "strategy1.mp4");
      const enc = await encodeWithStreaming(result.buffers, outputPath);

      const br: BenchmarkResult = {
        label: "S1: Aggressive damage detect",
        totalMs: result.totalMs + enc.durationMs,
        captureMs: result.totalMs,
        encodeMs: enc.durationMs,
        framesTotal: TOTAL_FRAMES,
        framesCaptured: result.capturedCount,
        framesSkipped: result.skippedCount,
        hasDamage: result.hasDamageCount,
        noDamage: result.noDamageCount,
        avgFrameMs: result.perFrameMs.reduce((a, b) => a + b, 0) / result.perFrameMs.length,
        p50Ms: percentile(result.perFrameMs, 0.5),
        p95Ms: percentile(result.perFrameMs, 0.95),
        outputSize: enc.fileSize,
      };
      printResult(br);
      allResults.push(br);
    }

    // ── 3. STRATEGY 3: Two-Pass Capture ───────────────────────────────

    console.log("\n--- Running STRATEGY 3 (two-pass scan + selective capture) ---");
    {
      const { page, baseFrameTimeTicks } = await setupPage(browser, server.url);
      const cdp = await getCdpSession(page);
      await cdp.send("HeadlessExperimental.enable");

      const opts: SmartSkipOptions = {
        totalFrames: TOTAL_FRAMES,
        fps: FPS,
        format: FORMAT,
        quality: QUALITY,
        baseFrameTimeTicks,
      };

      const result = await strategy3TwoPass(page, cdp, opts);
      await page.close();

      // Encode
      const outputPath = join(OUTPUT_DIR, "strategy3.mp4");
      const enc = await encodeWithStreaming(result.buffers, outputPath);

      const br: BenchmarkResult = {
        label: "S3: Two-pass scan + selective",
        totalMs: result.totalMs + enc.durationMs,
        captureMs: result.totalMs,
        encodeMs: enc.durationMs,
        framesTotal: TOTAL_FRAMES,
        framesCaptured: result.capturedCount,
        framesSkipped: result.skippedCount,
        hasDamage: result.hasDamageCount,
        noDamage: result.noDamageCount,
        avgFrameMs: result.perFrameMs.reduce((a, b) => a + b, 0) / result.perFrameMs.length,
        p50Ms: percentile(result.perFrameMs, 0.5),
        p95Ms: percentile(result.perFrameMs, 0.95),
        outputSize: enc.fileSize,
      };
      printResult(br);
      allResults.push(br);
    }

    // ── 4. STRATEGY 4: Reduced Capture + FFmpeg Concat ────────────────

    console.log("\n--- Running STRATEGY 4 (reduced capture + FFmpeg concat) ---");
    {
      const { page, baseFrameTimeTicks } = await setupPage(browser, server.url);
      const cdp = await getCdpSession(page);
      await cdp.send("HeadlessExperimental.enable");

      const concatDir = join(OUTPUT_DIR, "strategy4-frames");

      const opts: SmartSkipOptions & { outputDir: string } = {
        totalFrames: TOTAL_FRAMES,
        fps: FPS,
        format: FORMAT,
        quality: QUALITY,
        baseFrameTimeTicks,
        outputDir: concatDir,
      };

      const result = await strategy4ConcatCapture(page, cdp, opts);
      await page.close();

      console.log(
        `  [S4] Unique frames written: ${result.uniqueFrameFiles.length} (out of ${TOTAL_FRAMES})`,
      );

      // Encode with FFmpeg concat demuxer
      const outputPath = join(OUTPUT_DIR, "strategy4.mp4");
      const encodeStart = Date.now();
      const encResult = await encodeConcatFile(result.concatFilePath, outputPath, {
        fps: FPS,
        width: WIDTH,
        height: HEIGHT,
        preset: "ultrafast",
        quality: 23,
      });
      const encodeMs = Date.now() - encodeStart;

      if (!encResult.success) {
        console.error(`  [S4] Encode failed: ${encResult.error}`);
      }

      const br: BenchmarkResult = {
        label: "S4: Concat (unique frames only)",
        totalMs: result.totalMs + encodeMs,
        captureMs: result.totalMs,
        encodeMs,
        framesTotal: TOTAL_FRAMES,
        framesCaptured: result.capturedCount,
        framesSkipped: result.skippedCount,
        hasDamage: result.hasDamageCount,
        noDamage: result.noDamageCount,
        avgFrameMs: result.perFrameMs.reduce((a, b) => a + b, 0) / result.perFrameMs.length,
        p50Ms: percentile(result.perFrameMs, 0.5),
        p95Ms: percentile(result.perFrameMs, 0.95),
        outputSize: encResult.fileSize,
      };
      printResult(br);
      allResults.push(br);
    }

    // ── Print comparison ──────────────────────────────────────────────

    printComparison(allResults);

  } catch (err) {
    console.error("[Benchmark] Error:", err);
    process.exit(1);
  } finally {
    await releaseBrowser(browser);
    server.close();
    console.log("\n[Benchmark] Done. Output files in:", OUTPUT_DIR);
  }
}

main().catch((err) => {
  console.error("[Benchmark] Fatal:", err);
  process.exit(1);
});
