#!/usr/bin/env npx tsx
/**
 * Experiment 4 Benchmark: Single Chrome Instance, Multiple Tabs
 *
 * Compares:
 * - Baseline: N separate Chrome processes (current approach)
 * - Multi-tab: 1 Chrome process with N tabs
 *
 * Uses a self-contained test composition that implements window.__hf directly,
 * avoiding the need for the full producer compilation pipeline.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { createFileServer, type FileServerHandle } from "../services/fileServer.js";
import {
  executeMultiTabCapture,
  executeBaselineCapture,
  type MultiTabResult,
} from "./exp4-multitab-capture.js";
import type { CaptureOptions } from "../types.js";

// ── Test Composition ──────────────────────────────────────────────────────────

/**
 * Self-contained HTML composition for benchmarking.
 * Implements window.__hf directly with GSAP-like animation.
 * 15 seconds at 30fps = 450 frames, matching the baseline measurement.
 */
const TEST_COMPOSITION_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Exp4 Benchmark Composition</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1080px;
      height: 1920px;
      overflow: hidden;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      color: white;
    }
    .title {
      font-size: 120px;
      font-weight: 900;
      text-align: center;
      opacity: 0;
      transform: translateY(100px);
      text-shadow: 0 4px 20px rgba(0,0,0,0.5);
    }
    .subtitle {
      font-size: 48px;
      font-weight: 300;
      text-align: center;
      opacity: 0;
      transform: translateY(50px);
      margin-top: 40px;
      color: #a0d2db;
    }
    .progress-bar {
      width: 600px;
      height: 8px;
      background: rgba(255,255,255,0.15);
      border-radius: 4px;
      margin-top: 80px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #4facfe, #00f2fe);
      border-radius: 4px;
      transition: none;
    }
    .particles {
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
    }
    .particle {
      position: absolute;
      width: 6px; height: 6px;
      background: rgba(255,255,255,0.3);
      border-radius: 50%;
    }
  </style>
</head>
<body>
  <div class="particles" id="particles"></div>
  <div class="title" id="title">HYPERFRAMES</div>
  <div class="subtitle" id="subtitle">Rendering Benchmark</div>
  <div class="progress-bar">
    <div class="progress-fill" id="progress"></div>
  </div>

  <script>
    // Create particles
    const particlesContainer = document.getElementById('particles');
    const NUM_PARTICLES = 30;
    const particles = [];
    for (let i = 0; i < NUM_PARTICLES; i++) {
      const el = document.createElement('div');
      el.className = 'particle';
      el.style.left = Math.random() * 100 + '%';
      el.style.top = Math.random() * 100 + '%';
      el.style.width = (3 + Math.random() * 6) + 'px';
      el.style.height = el.style.width;
      el.style.opacity = (0.1 + Math.random() * 0.4).toString();
      particlesContainer.appendChild(el);
      particles.push({
        el,
        baseX: Math.random() * 1080,
        baseY: Math.random() * 1920,
        speedX: (Math.random() - 0.5) * 100,
        speedY: -30 - Math.random() * 80,
        phase: Math.random() * Math.PI * 2,
      });
    }

    const DURATION = 15;
    const title = document.getElementById('title');
    const subtitle = document.getElementById('subtitle');
    const progress = document.getElementById('progress');

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function easeInOutQuad(t) { return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2; }
    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    function seek(time) {
      const t = clamp(time, 0, DURATION);
      const p = t / DURATION;

      // Title animation: fade in 0-2s
      const titleProgress = clamp(t / 2, 0, 1);
      const titleEased = easeOutCubic(titleProgress);
      title.style.opacity = titleEased.toString();
      title.style.transform = 'translateY(' + (100 * (1 - titleEased)) + 'px)';

      // Subtitle: fade in 1-3s
      const subProgress = clamp((t - 1) / 2, 0, 1);
      const subEased = easeOutCubic(subProgress);
      subtitle.style.opacity = subEased.toString();
      subtitle.style.transform = 'translateY(' + (50 * (1 - subEased)) + 'px)';

      // Progress bar: fills 0-15s
      progress.style.width = (p * 100) + '%';

      // Title color cycling
      const hue = (t * 24) % 360;
      title.style.color = 'hsl(' + hue + ', 80%, 80%)';

      // Scale pulse on title (subtle)
      const pulse = 1 + 0.03 * Math.sin(t * 2 * Math.PI);
      title.style.transform = 'translateY(' + (100 * (1 - titleEased)) + 'px) scale(' + pulse + ')';

      // Particle animation
      for (const particle of particles) {
        const px = particle.baseX + Math.sin(t * 0.5 + particle.phase) * particle.speedX;
        const py = (particle.baseY + particle.speedY * t) % 1920;
        const actualY = py < 0 ? py + 1920 : py;
        particle.el.style.left = px + 'px';
        particle.el.style.top = actualY + 'px';
        particle.el.style.opacity = (0.1 + 0.3 * Math.abs(Math.sin(t + particle.phase))).toString();
      }

      // Fade out at end (13-15s)
      if (t > 13) {
        const fadeOut = 1 - clamp((t - 13) / 2, 0, 1);
        document.body.style.opacity = fadeOut.toString();
      } else {
        document.body.style.opacity = '1';
      }
    }

    // Expose window.__hf protocol directly
    window.__hf = {
      duration: DURATION,
      seek: seek,
    };

    // Set initial state
    seek(0);
  </script>
</body>
</html>`;

// ── Benchmark Runner ──────────────────────────────────────────────────────────

interface BenchmarkRun {
  label: string;
  type: "baseline" | "multitab";
  numWorkers: number;
  result?: MultiTabResult;
  error?: string;
}

function getMemoryUsageMB(): number {
  const usage = process.memoryUsage();
  return Math.round(usage.rss / (1024 * 1024));
}

async function runBenchmark(
  label: string,
  type: "baseline" | "multitab",
  numWorkers: number,
  serverUrl: string,
  captureOptions: CaptureOptions,
  engineConfig?: Partial<import("../config.js").EngineConfig>,
): Promise<BenchmarkRun> {
  const workDir = mkdtempSync(join(tmpdir(), `exp4-${type}-${numWorkers}-`));

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`  Type: ${type}, Workers/Tabs: ${numWorkers}`);
  console.log(`${"=".repeat(60)}`);

  const memBefore = getMemoryUsageMB();
  console.log(`  Memory before: ${memBefore}MB`);

  try {
    let result: MultiTabResult;

    if (type === "baseline") {
      result = await executeBaselineCapture(
        numWorkers,
        serverUrl,
        workDir,
        captureOptions,
        engineConfig,
        (captured, total) => {
          if (captured % 50 === 0 || captured === total) {
            process.stdout.write(`\r  Progress: ${captured}/${total} frames (${Math.round(captured / total * 100)}%)`);
          }
        },
      );
    } else {
      result = await executeMultiTabCapture(
        {
          numTabs: numWorkers,
          serverUrl,
          outputDir: workDir,
          captureOptions,
          engineConfig,
        },
        (captured, total) => {
          if (captured % 50 === 0 || captured === total) {
            process.stdout.write(`\r  Progress: ${captured}/${total} frames (${Math.round(captured / total * 100)}%)`);
          }
        },
      );
    }

    console.log(""); // newline after progress
    const memAfter = getMemoryUsageMB();

    console.log(`  Results:`);
    console.log(`    Total frames:    ${result.totalFrames}`);
    console.log(`    Browser launch:  ${result.browserLaunchMs}ms`);
    console.log(`    Tab init:        ${result.tabInitMs}ms`);
    console.log(`    Capture time:    ${result.totalCaptureMs}ms`);
    console.log(`    Avg frame:       ${result.avgFrameMs}ms`);
    console.log(`    Memory (node):   ${memAfter}MB (delta: +${memAfter - memBefore}MB)`);
    console.log(`    Peak RSS:        ${result.peakMemoryMB}MB`);

    for (const tr of result.tabResults) {
      console.log(`    ${type === "baseline" ? "Worker" : "Tab"} ${tr.tabId}: ${tr.framesCaptured} frames in ${tr.durationMs}ms (avg ${tr.perf.avgTotalMs}ms/frame, seek=${tr.perf.avgSeekMs}ms, screenshot=${tr.perf.avgScreenshotMs}ms)`);
    }

    return { label, type, numWorkers, result };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`  ERROR: ${errMsg}`);
    return { label, type, numWorkers, error: errMsg };
  } finally {
    // Cleanup work directory
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Experiment 4: Single Chrome Instance, Multiple Tabs        ║");
  console.log("║  Comparing multi-process baseline vs single-process tabs    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");

  // Set up test composition on disk
  const testDir = mkdtempSync(join(tmpdir(), "exp4-testcomp-"));
  writeFileSync(join(testDir, "index.html"), TEST_COMPOSITION_HTML);

  // Start file server (using engine's file server -- no runtime injection needed
  // since our test composition implements window.__hf directly)
  let fileServer: FileServerHandle | null = null;

  try {
    fileServer = await createFileServer({
      projectDir: testDir,
      port: 0,
      headScripts: [],
      bodyScripts: [],
      stripEmbeddedRuntime: false,
    });
    console.log(`File server running at ${fileServer.url}`);

    const captureOptions: CaptureOptions = {
      width: 1080,
      height: 1920,
      fps: 30,
      format: "jpeg",
      quality: 80,
    };

    // Run benchmarks
    const runs: BenchmarkRun[] = [];

    // ── BeginFrame mode (default on Linux with headless-shell) ──────────
    console.log("\n--- BEGINFRAME MODE (default on Linux with headless-shell) ---\n");

    // Baseline: 6 separate Chrome processes (matching current production config)
    runs.push(await runBenchmark("BF Baseline: 6 processes", "baseline", 6, fileServer.url, captureOptions));

    // Multi-tab configurations (skip 1-tab as it's trivially slower)
    for (const numTabs of [2, 4, 6, 8]) {
      runs.push(await runBenchmark(
        `BF Multi-tab: ${numTabs} tabs`,
        "multitab",
        numTabs,
        fileServer.url,
        captureOptions,
      ));
    }

    // ── Screenshot mode (force) ─────────────────────────────────────────
    console.log("\n--- SCREENSHOT MODE (forceScreenshot=true) ---\n");

    const screenshotConfig = { forceScreenshot: true } as const;

    runs.push(await runBenchmark("SS Baseline: 6 processes", "baseline", 6, fileServer.url, captureOptions, screenshotConfig));

    for (const numTabs of [2, 4, 6]) {
      runs.push(await runBenchmark(
        `SS Multi-tab: ${numTabs} tabs`,
        "multitab",
        numTabs,
        fileServer.url,
        captureOptions,
        screenshotConfig,
      ));
    }

    // ── Summary ─────────────────────────────────────────────────────────
    console.log("\n\n");
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║                       RESULTS SUMMARY                       ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log("");

    const baseline = runs.find((r) => r.type === "baseline" && r.result);
    const baselineCaptureMs = baseline?.result?.totalCaptureMs ?? 1;
    const baselineLaunchMs = baseline?.result?.browserLaunchMs ?? 1;

    console.log(
      padRight("Configuration", 35) +
      padRight("Launch", 10) +
      padRight("Init", 10) +
      padRight("Capture", 10) +
      padRight("Avg/Fr", 10) +
      padRight("Speedup", 10) +
      padRight("Memory", 10),
    );
    console.log("-".repeat(95));

    for (const run of runs) {
      if (!run.result) {
        console.log(`${padRight(run.label, 35)} FAILED: ${run.error}`);
        continue;
      }
      const r = run.result;
      const speedup = baselineCaptureMs / Math.max(1, r.totalCaptureMs);
      const launchSavings = ((baselineLaunchMs - r.browserLaunchMs) / baselineLaunchMs * 100);

      console.log(
        padRight(run.label, 35) +
        padRight(`${r.browserLaunchMs}ms`, 10) +
        padRight(`${r.tabInitMs}ms`, 10) +
        padRight(`${r.totalCaptureMs}ms`, 10) +
        padRight(`${r.avgFrameMs}ms`, 10) +
        padRight(`${speedup.toFixed(2)}x`, 10) +
        padRight(`${r.peakMemoryMB}MB`, 10),
      );
    }

    console.log("");
    if (baseline?.result) {
      console.log(`Baseline capture time: ${baseline.result.totalCaptureMs}ms (${baseline.result.totalFrames} frames)`);
      console.log(`Baseline browser launch: ${baseline.result.browserLaunchMs}ms (${baseline.result.tabResults.length} separate Chrome processes)`);
    }

    // Find best multi-tab run
    const multiTabRuns = runs.filter((r) => r.type === "multitab" && r.result);
    if (multiTabRuns.length > 0) {
      const best = multiTabRuns.reduce((a, b) =>
        (a.result!.totalCaptureMs < b.result!.totalCaptureMs) ? a : b,
      );
      if (best.result && baseline?.result) {
        const speedup = baseline.result.totalCaptureMs / best.result.totalCaptureMs;
        console.log(`\nBest multi-tab: ${best.label}`);
        console.log(`  Capture: ${best.result.totalCaptureMs}ms (${speedup.toFixed(2)}x vs baseline)`);
        console.log(`  Browser launch: ${best.result.browserLaunchMs}ms (${Math.round((1 - best.result.browserLaunchMs / baseline.result.browserLaunchMs) * 100)}% savings)`);
      }
    }

  } finally {
    if (fileServer) fileServer.close();
    rmSync(testDir, { recursive: true, force: true });
  }
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
