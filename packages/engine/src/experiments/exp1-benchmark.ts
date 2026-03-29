/**
 * Experiment 1 Benchmark: CDP Batch Rendering - Kill IPC Round-Trips
 *
 * Compares three approaches:
 *   A. Baseline:      2 sequential CDP round-trips/frame (seek await + beginFrame await)
 *   B. Pipelined:     2 CDP calls/frame but pipelined (fire seek + beginFrame together)
 *   C. rAF Batch:     1 CDP call/frame (seeks pre-registered via rAF inside beginFrame)
 *
 * Uses a self-contained fixture implementing window.__hf (15s @ 30fps = 450 frames).
 */

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
  baselineCaptureFrames,
  pipelinedCaptureFrames,
  batchCaptureFrames,
  type BatchCaptureOptions,
  type BatchCaptureResult,
} from "../services/experimentalBatchCapture.js";

import type { Browser, Page } from "puppeteer-core";
import { dirname } from "path";
import { fileURLToPath } from "url";

// ── Configuration ──────────────────────────────────────────────────────────────

const THIS_DIR = typeof import.meta.dirname === "string"
  ? import.meta.dirname
  : dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = THIS_DIR;
const FPS = 30;
const DURATION_S = 15;
const TOTAL_FRAMES = DURATION_S * FPS; // 450
const WIDTH = 1080;
const HEIGHT = 1920;
const FORMAT: "jpeg" = "jpeg";
const QUALITY = 80;

// ── Helpers ────────────────────────────────────────────────────────────────────

async function startFileServer(): Promise<FileServerHandle> {
  console.log(`[Benchmark] Starting file server for: ${FIXTURE_DIR}`);
  const server = await createFileServer({
    projectDir: FIXTURE_DIR,
    port: 0,
  });
  console.log(`[Benchmark] File server running at ${server.url}`);
  return server;
}

async function launchBrowser(): Promise<{
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

  console.log(`[Benchmark] Launching browser (mode: ${preMode})`);
  const { browser, captureMode } = await acquireBrowser(chromeArgs);
  console.log(`[Benchmark] Browser launched (captureMode: ${captureMode})`);

  if (captureMode !== "beginframe") {
    console.warn("[Benchmark] WARNING: Not using beginFrame mode.");
  }

  return { browser, captureMode };
}

async function setupPage(
  browser: Browser,
  serverUrl: string,
): Promise<{ page: Page; baseFrameTimeTicks: number }> {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

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

  const url = `${serverUrl}/fixture.html`;
  console.log(`[Benchmark] Navigating to ${url}`);
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
    throw new Error("[Benchmark] window.__hf not ready after 30s");
  }

  await page.evaluate(`document.fonts?.ready`);
  warmupRunning = false;

  const baseFrameTimeTicks = (warmupTicks + 10) * warmupIntervalMs;
  console.log(`[Benchmark] Page ready (warmupTicks=${warmupTicks})`);

  return { page, baseFrameTimeTicks };
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)]!;
}

function formatResults(label: string, result: BatchCaptureResult) {
  const avg = result.perFrameMs.reduce((a, b) => a + b, 0) / result.perFrameMs.length;
  const p50 = percentile(result.perFrameMs, 0.5);
  const p95 = percentile(result.perFrameMs, 0.95);
  const p99 = percentile(result.perFrameMs, 0.99);
  const min = Math.min(...result.perFrameMs);
  const max = Math.max(...result.perFrameMs);

  console.log(`\n${"=".repeat(64)}`);
  console.log(`  ${label}`);
  console.log(`${"=".repeat(64)}`);
  console.log(`  Total:     ${result.totalMs}ms`);
  console.log(`  Avg/frame: ${avg.toFixed(2)}ms`);
  console.log(`  P50:       ${p50}ms    P95: ${p95}ms    P99: ${p99}ms`);
  console.log(`  Min:       ${min}ms    Max: ${max}ms`);
  console.log(`  Damage:    ${result.hasDamageCount}/${result.perFrameMs.length} frames`);

  return { avg, p50, p95, p99, min, max };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "=".repeat(64));
  console.log("  Experiment 1: CDP Batch Rendering Benchmark");
  console.log("=".repeat(64));
  console.log(`  ${TOTAL_FRAMES} frames (${DURATION_S}s @ ${FPS}fps) | ${WIDTH}x${HEIGHT} | ${FORMAT} q=${QUALITY}`);
  console.log("");

  const server = await startFileServer();
  let browser: Browser | null = null;

  try {
    const { browser: b, captureMode } = await launchBrowser();
    browser = b;

    if (captureMode !== "beginframe") {
      console.error("\n[Benchmark] FATAL: BeginFrame mode required. Need chrome-headless-shell on Linux.");
      process.exit(1);
    }

    const results: { label: string; result: BatchCaptureResult; stats: ReturnType<typeof formatResults> }[] = [];

    // ── A. Baseline ───────────────────────────────────────────────────
    {
      console.log("\n[Benchmark] A. BASELINE (2 sequential CDP round-trips/frame)...");
      const { page, baseFrameTimeTicks } = await setupPage(browser, server.url);
      const cdp = await getCdpSession(page);
      await cdp.send("HeadlessExperimental.enable");

      const result = await baselineCaptureFrames(page, cdp, {
        totalFrames: TOTAL_FRAMES, fps: FPS, format: FORMAT, quality: QUALITY, baseFrameTimeTicks,
      });
      const stats = formatResults("A. BASELINE (await seek, await beginFrame)", result);
      results.push({ label: "Baseline", result, stats });
      await page.close();
    }

    // ── B. Pipelined Seek ─────────────────────────────────────────────
    {
      console.log("\n[Benchmark] B. PIPELINED (fire seek + beginFrame together)...");
      const { page, baseFrameTimeTicks } = await setupPage(browser, server.url);
      const cdp = await getCdpSession(page);
      await cdp.send("HeadlessExperimental.enable");

      const result = await pipelinedCaptureFrames(page, cdp, {
        totalFrames: TOTAL_FRAMES, fps: FPS, format: FORMAT, quality: QUALITY, baseFrameTimeTicks,
      });
      const stats = formatResults("B. PIPELINED (fire-and-forget seek + beginFrame)", result);
      results.push({ label: "Pipelined", result, stats });
      await page.close();
    }

    // ── C. rAF Batch ──────────────────────────────────────────────────
    {
      console.log("\n[Benchmark] C. rAF BATCH (seek via rAF, 1 CDP call/frame)...");
      const { page, baseFrameTimeTicks } = await setupPage(browser, server.url);
      const cdp = await getCdpSession(page);
      await cdp.send("HeadlessExperimental.enable");

      const result = await batchCaptureFrames(page, cdp, {
        totalFrames: TOTAL_FRAMES, fps: FPS, format: FORMAT, quality: QUALITY, baseFrameTimeTicks,
      });
      const stats = formatResults("C. rAF BATCH (seek via rAF, beginFrame only)", result);
      results.push({ label: "rAF Batch", result, stats });
      await page.close();
    }

    // ── Summary ───────────────────────────────────────────────────────
    const baseline = results[0]!;
    console.log(`\n${"=".repeat(64)}`);
    console.log("  SUMMARY");
    console.log(`${"=".repeat(64)}`);
    console.log(`  ${"Approach".padEnd(18)} ${"Total".padStart(8)} ${"Avg/fr".padStart(10)} ${"P50".padStart(6)} ${"P95".padStart(6)} ${"Speedup".padStart(8)}`);
    console.log(`  ${"-".repeat(56)}`);

    for (const r of results) {
      const speedup = baseline.result.totalMs / Math.max(1, r.result.totalMs);
      console.log(
        `  ${r.label.padEnd(18)} ${(r.result.totalMs + "ms").padStart(8)} ${(r.stats.avg.toFixed(1) + "ms").padStart(10)} ${(r.stats.p50 + "ms").padStart(6)} ${(r.stats.p95 + "ms").padStart(6)} ${(speedup.toFixed(2) + "x").padStart(8)}`
      );
    }
    console.log(`${"=".repeat(64)}\n`);

    // Integrity check
    let mismatchCount = 0;
    const checkIndices = [0, 1, 10, 50, 100, 200, 300, 400, 449];
    for (const r of results.slice(1)) {
      for (const idx of checkIndices) {
        if (idx >= baseline.result.buffers.length || idx >= r.result.buffers.length) continue;
        const baseSize = baseline.result.buffers[idx]!.length;
        const testSize = r.result.buffers[idx]!.length;
        if (baseSize === 0 || testSize === 0) continue;
        const ratio = Math.min(baseSize, testSize) / Math.max(baseSize, testSize);
        if (ratio < 0.5) {
          mismatchCount++;
          console.warn(`  [Integrity] ${r.label} frame ${idx}: size ratio=${ratio.toFixed(2)}`);
        }
      }
    }
    if (mismatchCount === 0) {
      console.log("  [Integrity] All spot-checks passed.");
    }

  } catch (err) {
    console.error("[Benchmark] Error:", err);
    process.exit(1);
  } finally {
    if (browser) await releaseBrowser(browser);
    server.close();
  }
}

main().catch((err) => {
  console.error("[Benchmark] Unhandled error:", err);
  process.exit(1);
});
