#!/usr/bin/env node
/**
 * Experiment 3 Benchmark: Xvfb Virtual Framebuffer Capture
 *
 * Compares:
 *   - Baseline: CDP BeginFrame screenshot path (single worker)
 *   - Xvfb Deterministic: seek + x11grab per frame
 *   - Xvfb Fast Draft: continuous x11grab while seeking
 *   - Xvfb Synced Draft: x11grab at fps rate with seek sync
 *
 * Uses the `chat` test fixture (15s @ 30fps = 450 frames).
 */

import { mkdirSync, existsSync, statSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

// Use the producer's file server which injects the Hyperframe runtime + render mode bridge.
// The engine's fileServer does NOT inject runtime scripts, so window.__timelines / window.__hf
// would be undefined with the chat composition fixture.
import { createFileServer, type FileServerHandle } from "../../../producer/src/services/fileServer.js";
import {
  acquireBrowser,
  releaseBrowser,
  buildChromeArgs,
  resolveHeadlessShellPath,
  type CaptureMode,
} from "../services/browserManager.js";
import { getCdpSession } from "../services/screenshotService.js";
import {
  createCaptureSession,
  initializeSession,
  closeCaptureSession,
  captureFrame,
  getCapturePerfSummary,
} from "../services/frameCapture.js";
import {
  encodeFramesFromDir,
} from "../services/chunkEncoder.js";
import type { CaptureOptions } from "../types.js";

import {
  startXvfb,
  launchHeadedChrome,
  navigateAndWait,
  captureXvfbDeterministic,
  captureXvfbFastDraft,
  captureXvfbSyncedDraft,
  type XvfbInstance,
  type XvfbCaptureResult,
} from "./exp3-xvfb-capture.js";

import type { Browser, Page } from "puppeteer-core";

// ── Configuration ──────────────────────────────────────────────────────────

const FIXTURE_DIR = resolve(
  import.meta.dirname ?? ".",
  "../../../producer/tests/chat/src",
);
const FPS = 30;
const DURATION_S = 15;
const TOTAL_FRAMES = DURATION_S * FPS; // 450
const WIDTH = 1080;
const HEIGHT = 1920;
const FORMAT: "jpeg" = "jpeg";
const QUALITY = 80;
const XVFB_DISPLAY = ":99";

// Use a small frame subset for faster iteration (set to TOTAL_FRAMES for full run)
const FRAME_LIMIT = TOTAL_FRAMES;

// ── Helpers ────────────────────────────────────────────────────────────────

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)]!;
}

function formatTimings(label: string, result: { totalMs: number; perFrameMs: number[] }) {
  const { totalMs, perFrameMs } = result;
  const avg = perFrameMs.reduce((a, b) => a + b, 0) / perFrameMs.length;
  const p50 = percentile(perFrameMs, 0.5);
  const p95 = percentile(perFrameMs, 0.95);
  const p99 = percentile(perFrameMs, 0.99);
  const min = Math.min(...perFrameMs);
  const max = Math.max(...perFrameMs);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Total:     ${totalMs}ms`);
  console.log(`  Avg/frame: ${avg.toFixed(2)}ms`);
  console.log(`  P50:       ${p50.toFixed(1)}ms`);
  console.log(`  P95:       ${p95.toFixed(1)}ms`);
  console.log(`  P99:       ${p99.toFixed(1)}ms`);
  console.log(`  Min:       ${min.toFixed(1)}ms`);
  console.log(`  Max:       ${max.toFixed(1)}ms`);

  return { avg, p50, p95, p99, min, max };
}

// ── Baseline: CDP BeginFrame Capture ────────────────────────────────────────

interface BaselineResult {
  totalMs: number;
  captureMs: number;
  encodeMs: number;
  frameCount: number;
  outputPath: string;
  outputFileSize: number;
  perFrameMs: number[];
}

async function runBaseline(serverUrl: string, workDir: string): Promise<BaselineResult> {
  console.log("\n[Baseline] Starting CDP BeginFrame capture (single worker)...");

  const framesDir = join(workDir, "baseline-frames");
  const outputPath = join(workDir, "baseline.mp4");
  mkdirSync(framesDir, { recursive: true });

  const captureOptions: CaptureOptions = {
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    format: FORMAT,
    quality: QUALITY,
  };

  const overallStart = Date.now();
  const perFrameMs: number[] = [];

  // Create capture session
  const session = await createCaptureSession(serverUrl, framesDir, captureOptions);
  await initializeSession(session);

  // Capture frames
  const captureStart = Date.now();
  for (let i = 0; i < FRAME_LIMIT; i++) {
    const frameStart = Date.now();
    const time = i / FPS;
    await captureFrame(session, i, time);
    perFrameMs.push(Date.now() - frameStart);

    if (i % 100 === 0 || i === FRAME_LIMIT - 1) {
      console.log(`[Baseline] Frame ${i}/${FRAME_LIMIT} (${Date.now() - frameStart}ms)`);
    }
  }
  const captureMs = Date.now() - captureStart;

  // Encode
  console.log("[Baseline] Encoding frames to video...");
  const encodeStart = Date.now();
  const encodeResult = await encodeFramesFromDir(framesDir, "frame_%06d.jpg", outputPath, {
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    codec: "h264",
    preset: "ultrafast",
    quality: 23,
    pixelFormat: "yuv420p",
  });
  const encodeMs = Date.now() - encodeStart;

  if (!encodeResult.success) {
    console.error("[Baseline] Encode failed:", encodeResult.error);
  }

  const perf = getCapturePerfSummary(session);
  console.log(`[Baseline] Capture perf: avg=${perf.avgTotalMs}ms/frame, seek=${perf.avgSeekMs}ms, screenshot=${perf.avgScreenshotMs}ms`);

  await closeCaptureSession(session);

  const totalMs = Date.now() - overallStart;
  const outputFileSize = existsSync(outputPath) ? statSync(outputPath).size : 0;

  return {
    totalMs,
    captureMs,
    encodeMs,
    frameCount: FRAME_LIMIT,
    outputPath,
    outputFileSize,
    perFrameMs,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  Experiment 3: Xvfb Virtual Framebuffer Capture");
  console.log("=".repeat(60));
  console.log(`  Frames:     ${FRAME_LIMIT} (${DURATION_S}s @ ${FPS}fps)`);
  console.log(`  Resolution: ${WIDTH}x${HEIGHT}`);
  console.log(`  Format:     ${FORMAT} q=${QUALITY}`);
  console.log(`  Fixture:    ${FIXTURE_DIR}`);
  console.log("");

  // Verify fixture exists
  if (!existsSync(FIXTURE_DIR)) {
    console.error(`[Benchmark] Fixture dir not found: ${FIXTURE_DIR}`);
    process.exit(1);
  }

  // Work directory for output
  const workDir = join(tmpdir(), `exp3-benchmark-${Date.now()}`);
  mkdirSync(workDir, { recursive: true });
  console.log(`[Benchmark] Work dir: ${workDir}`);

  // Start file server
  console.log(`[Benchmark] Starting file server for: ${FIXTURE_DIR}`);
  const server = await createFileServer({
    projectDir: FIXTURE_DIR,
    port: 0,
  });
  console.log(`[Benchmark] File server running at ${server.url}`);

  let xvfb: XvfbInstance | null = null;
  let xvfbBrowser: Browser | null = null;

  const results: {
    baseline?: BaselineResult;
    deterministic?: XvfbCaptureResult;
    fastDraft?: XvfbCaptureResult;
    syncedDraft?: XvfbCaptureResult;
  } = {};

  try {
    // ── Run 1: Baseline CDP capture ─────────────────────────────────────
    results.baseline = await runBaseline(server.url, workDir);
    formatTimings("BASELINE (CDP BeginFrame, single worker)", results.baseline);

    // ── Start Xvfb ──────────────────────────────────────────────────────
    console.log(`\n[Benchmark] Starting Xvfb on display ${XVFB_DISPLAY} (${WIDTH}x${HEIGHT})...`);
    xvfb = startXvfb(XVFB_DISPLAY, WIDTH, HEIGHT);
    console.log("[Benchmark] Xvfb started");

    // ── Run 2: Xvfb Deterministic ───────────────────────────────────────
    console.log("\n[Benchmark] Starting Xvfb DETERMINISTIC capture...");
    {
      const { browser, page } = await launchHeadedChrome(XVFB_DISPLAY, WIDTH, HEIGHT);
      xvfbBrowser = browser;

      await navigateAndWait(page, server.url);

      results.deterministic = await captureXvfbDeterministic(
        {
          serverUrl: server.url,
          width: WIDTH,
          height: HEIGHT,
          fps: FPS,
          totalFrames: FRAME_LIMIT,
          durationSeconds: DURATION_S,
          outputPath: join(workDir, "xvfb-deterministic.mp4"),
          quality: QUALITY,
        },
        XVFB_DISPLAY,
        page,
      );

      await page.close();
      await browser.close().catch(() => {});
      xvfbBrowser = null;

      formatTimings("XVFB DETERMINISTIC (seek + x11grab per frame)", results.deterministic);
    }

    // ── Run 3: Xvfb Fast Draft ──────────────────────────────────────────
    console.log("\n[Benchmark] Starting Xvfb FAST DRAFT capture...");
    {
      const { browser, page } = await launchHeadedChrome(XVFB_DISPLAY, WIDTH, HEIGHT);
      xvfbBrowser = browser;

      await navigateAndWait(page, server.url);

      results.fastDraft = await captureXvfbFastDraft(
        {
          serverUrl: server.url,
          width: WIDTH,
          height: HEIGHT,
          fps: FPS,
          totalFrames: FRAME_LIMIT,
          durationSeconds: DURATION_S,
          outputPath: join(workDir, "xvfb-fast-draft.mp4"),
          quality: QUALITY,
        },
        XVFB_DISPLAY,
        page,
      );

      await page.close();
      await browser.close().catch(() => {});
      xvfbBrowser = null;

      formatTimings("XVFB FAST DRAFT (continuous x11grab + rapid seek)", results.fastDraft);
    }

    // ── Run 4: Xvfb Synced Draft ────────────────────────────────────────
    console.log("\n[Benchmark] Starting Xvfb SYNCED DRAFT capture...");
    {
      const { browser, page } = await launchHeadedChrome(XVFB_DISPLAY, WIDTH, HEIGHT);
      xvfbBrowser = browser;

      await navigateAndWait(page, server.url);

      results.syncedDraft = await captureXvfbSyncedDraft(
        {
          serverUrl: server.url,
          width: WIDTH,
          height: HEIGHT,
          fps: FPS,
          totalFrames: FRAME_LIMIT,
          durationSeconds: DURATION_S,
          outputPath: join(workDir, "xvfb-synced-draft.mp4"),
          quality: QUALITY,
        },
        XVFB_DISPLAY,
        page,
      );

      await page.close();
      await browser.close().catch(() => {});
      xvfbBrowser = null;

      formatTimings("XVFB SYNCED DRAFT (x11grab @ fps + seek sync)", results.syncedDraft);
    }

    // ── Comparison ──────────────────────────────────────────────────────
    console.log(`\n${"=".repeat(70)}`);
    console.log("  COMPARISON SUMMARY");
    console.log(`${"=".repeat(70)}`);

    const b = results.baseline!;
    const d = results.deterministic!;
    const f = results.fastDraft!;
    const s = results.syncedDraft!;

    const fmtRow = (label: string, r: { totalMs: number; captureMs: number; encodeMs: number; frameCount: number; outputFileSize: number }) => {
      const avgCapture = r.captureMs / r.frameCount;
      const sizeMB = (r.outputFileSize / (1024 * 1024)).toFixed(1);
      console.log(
        `  ${label.padEnd(28)} total=${String(r.totalMs).padStart(7)}ms  ` +
        `capture=${String(r.captureMs).padStart(7)}ms  ` +
        `encode=${String(r.encodeMs).padStart(6)}ms  ` +
        `avg/frame=${avgCapture.toFixed(1).padStart(6)}ms  ` +
        `size=${sizeMB}MB`,
      );
    };

    fmtRow("Baseline (CDP BeginFrame)", b);
    fmtRow("Xvfb Deterministic", d);
    fmtRow("Xvfb Fast Draft", f);
    fmtRow("Xvfb Synced Draft", s);

    console.log("");
    console.log("  Speedup vs baseline:");
    const speedup = (label: string, r: { totalMs: number }) => {
      const ratio = b.totalMs / Math.max(1, r.totalMs);
      const savedMs = b.totalMs - r.totalMs;
      const savedPct = (savedMs / b.totalMs) * 100;
      const arrow = ratio >= 1 ? "FASTER" : "SLOWER";
      console.log(
        `    ${label.padEnd(26)} ${ratio.toFixed(2)}x ${arrow} (${savedMs > 0 ? "-" : "+"}${Math.abs(savedMs)}ms, ${savedPct > 0 ? "-" : "+"}${Math.abs(savedPct).toFixed(1)}%)`,
      );
    };
    speedup("Xvfb Deterministic", d);
    speedup("Xvfb Fast Draft", f);
    speedup("Xvfb Synced Draft", s);

    console.log(`\n  Output files:`);
    console.log(`    Baseline:       ${b.outputPath} (${(b.outputFileSize / 1024 / 1024).toFixed(1)}MB)`);
    console.log(`    Deterministic:  ${d.outputPath} (${(d.outputFileSize / 1024 / 1024).toFixed(1)}MB)`);
    console.log(`    Fast Draft:     ${f.outputPath} (${(f.outputFileSize / 1024 / 1024).toFixed(1)}MB)`);
    console.log(`    Synced Draft:   ${s.outputPath} (${(s.outputFileSize / 1024 / 1024).toFixed(1)}MB)`);

    console.log(`\n${"=".repeat(70)}\n`);
  } catch (err) {
    console.error("[Benchmark] Error:", err);
  } finally {
    // Cleanup
    if (xvfbBrowser) {
      await xvfbBrowser.close().catch(() => {});
    }
    if (xvfb) {
      xvfb.stop();
      console.log("[Benchmark] Xvfb stopped");
    }
    server.close();
    console.log("[Benchmark] File server stopped");
    console.log(`[Benchmark] Work dir preserved at: ${workDir}`);
  }
}

main().catch((err) => {
  console.error("[Benchmark] Unhandled error:", err);
  process.exit(1);
});
