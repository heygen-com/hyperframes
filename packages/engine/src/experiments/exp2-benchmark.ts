#!/usr/bin/env npx tsx
/**
 * Experiment 2 Benchmark: Sequential vs Streaming Pipeline
 *
 * Starts a file server for the `chat` test fixture (with runtime injection),
 * then runs:
 *   1. Baseline -- capture all frames to disk, then encode (current pipeline)
 *   2. Streaming -- capture + encode concurrently via FFmpeg image2pipe
 *   3. Streaming (low quality) -- same as #2 but with JPEG quality 60
 *
 * Reports wall-clock timings for each variant.
 *
 * Usage:
 *   cd /home/ubuntu/workspaces/hyperframes-oss
 *   npx tsx packages/engine/src/experiments/exp2-benchmark.ts
 */

import { mkdirSync, existsSync, rmSync, writeFileSync } from "fs";
import { join, dirname } from "path";

// Use the producer's file server which injects the Hyperframe runtime + bridge
import { createFileServer, type FileServerHandle } from "../../../producer/src/services/fileServer.js";
// Use the producer's HTML compiler to inline sub-compositions
import { compileForRender } from "../../../producer/src/services/htmlCompiler.js";

import {
  runBaselinePipeline,
  runStreamingPipeline,
  runStreamingPipelineLowQuality,
  runStreamingPipeline2Workers,
  type PipelineTimings,
  type StreamingPipelineOptions,
} from "./exp2-streaming-pipeline.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CHAT_FIXTURE_DIR = join(
  process.cwd(),
  "packages/producer/tests/chat/src",
);

/** Use a smaller frame count so the benchmark completes in reasonable time. */
const FPS = 30;
const DURATION_S = 5; // 5 seconds = 150 frames (enough to measure pipeline differences)
const TOTAL_FRAMES = FPS * DURATION_S;
const WIDTH = 1080;
const HEIGHT = 1920;

const OUTPUT_DIR = join(process.cwd(), "tmp/exp2-benchmark");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMs(ms: number): string {
  return `${ms.toLocaleString()}ms`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function printTimings(label: string, t: PipelineTimings): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Total wall-clock:    ${formatMs(t.totalMs)}`);
  console.log(`  Capture phase:       ${formatMs(t.captureMs)}`);
  console.log(`  Encode phase:        ${formatMs(t.encodeMs)}`);
  console.log(`  Encoder active:      ${formatMs(t.encoderActiveMs)}`);
  console.log(`  Encoder drain:       ${formatMs(t.encoderDrainMs)} (time after last frame to finish)`);
  console.log(`  Frames:              ${t.frameCount}`);
  console.log(`  Avg capture/frame:   ${formatMs(t.avgCapturePerFrameMs)}`);
  console.log(`  Output size:         ${formatBytes(t.outputFileSize)}`);
  console.log(`  Output:              ${t.outputPath}`);
}

function printComparison(baseline: PipelineTimings, streaming: PipelineTimings, streamingLQ: PipelineTimings, streaming2W: PipelineTimings): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  COMPARISON SUMMARY`);
  console.log(`${"=".repeat(60)}`);

  const speedup = (t: PipelineTimings) => ((baseline.totalMs - t.totalMs) / baseline.totalMs * 100).toFixed(1);
  const faster = (pct: string) => Number(pct) > 0 ? "faster" : "slower";

  console.log(`\n  Total time:`);
  console.log(`    Baseline (sequential):     ${formatMs(baseline.totalMs)}`);
  console.log(`    Streaming 1W (q80):        ${formatMs(streaming.totalMs)}  (${speedup(streaming)}% ${faster(speedup(streaming))})`);
  console.log(`    Streaming 1W (q60):        ${formatMs(streamingLQ.totalMs)}  (${speedup(streamingLQ)}% ${faster(speedup(streamingLQ))})`);
  console.log(`    Streaming 2W (q80):        ${formatMs(streaming2W.totalMs)}  (${speedup(streaming2W)}% ${faster(speedup(streaming2W))})`);

  console.log(`\n  Capture time:`);
  console.log(`    Baseline:                  ${formatMs(baseline.captureMs)}`);
  console.log(`    Streaming 1W (q80):        ${formatMs(streaming.captureMs)}`);
  console.log(`    Streaming 1W (q60):        ${formatMs(streamingLQ.captureMs)}`);
  console.log(`    Streaming 2W (q80):        ${formatMs(streaming2W.captureMs)}`);

  console.log(`\n  Encode time:`);
  console.log(`    Baseline (sequential):     ${formatMs(baseline.encodeMs)}`);
  console.log(`    Streaming 1W (q80):        ${formatMs(streaming.encodeMs)} (concurrent)`);
  console.log(`    Streaming 1W (q60):        ${formatMs(streamingLQ.encodeMs)} (concurrent)`);
  console.log(`    Streaming 2W (q80):        ${formatMs(streaming2W.encodeMs)} (concurrent)`);

  console.log(`\n  Encoder drain (flush after last frame):`);
  console.log(`    Baseline:                  N/A (sequential)`);
  console.log(`    Streaming 1W (q80):        ${formatMs(streaming.encoderDrainMs)}`);
  console.log(`    Streaming 1W (q60):        ${formatMs(streamingLQ.encoderDrainMs)}`);
  console.log(`    Streaming 2W (q80):        ${formatMs(streaming2W.encoderDrainMs)}`);

  console.log(`\n  Avg capture per frame:`);
  console.log(`    Baseline:                  ${formatMs(baseline.avgCapturePerFrameMs)}`);
  console.log(`    Streaming 1W (q80):        ${formatMs(streaming.avgCapturePerFrameMs)}`);
  console.log(`    Streaming 1W (q60):        ${formatMs(streamingLQ.avgCapturePerFrameMs)}`);
  console.log(`    Streaming 2W (q80):        ${formatMs(streaming2W.avgCapturePerFrameMs)}`);

  console.log(`\n  Output file size:`);
  console.log(`    Baseline:                  ${formatBytes(baseline.outputFileSize)}`);
  console.log(`    Streaming 1W (q80):        ${formatBytes(streaming.outputFileSize)}`);
  console.log(`    Streaming 1W (q60):        ${formatBytes(streamingLQ.outputFileSize)}`);
  console.log(`    Streaming 2W (q80):        ${formatBytes(streaming2W.outputFileSize)}`);

  // Key insight: baseline = capture + encode, streaming = max(capture, encode) + drain
  const baselineSequentialSum = baseline.captureMs + baseline.encodeMs;
  console.log(`\n  Pipeline overlap analysis:`);
  console.log(`    Baseline sequential sum:   ${formatMs(baselineSequentialSum)} (capture + encode)`);
  console.log(`    Streaming total = capture + drain (encode runs during capture)`);
  console.log(`    1W overlap saved:          ~${formatMs(Math.max(0, baseline.encodeMs - streaming.encoderDrainMs))} (encode minus drain)`);
  console.log(`    2W overlap saved:          ~${formatMs(Math.max(0, baseline.encodeMs - streaming2W.encoderDrainMs))} (encode minus drain)`);

  console.log(`\n  Disk I/O eliminated:`);
  console.log(`    Baseline writes ${baseline.frameCount} JPEG files to disk, reads them back for encode`);
  console.log(`    Streaming pipes buffers directly to FFmpeg stdin (zero disk I/O)`);

  const baselineEncodePercent = (baseline.encodeMs / baseline.totalMs * 100).toFixed(1);
  const streamingDrainPercent = (streaming.encoderDrainMs / streaming.totalMs * 100).toFixed(1);
  console.log(`\n  Encode overhead:`);
  console.log(`    Baseline encode overhead:  ${baselineEncodePercent}% of total (${formatMs(baseline.encodeMs)})`);
  console.log(`    Streaming drain overhead:  ${streamingDrainPercent}% of total (${formatMs(streaming.encoderDrainMs)})`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("Experiment 2: Raw Pixel Pipe + Streaming Encode");
  console.log(`  Fixture:  ${CHAT_FIXTURE_DIR}`);
  console.log(`  Frames:   ${TOTAL_FRAMES} (${DURATION_S}s @ ${FPS}fps)`);
  console.log(`  Size:     ${WIDTH}x${HEIGHT}`);

  // Verify fixture exists
  if (!existsSync(CHAT_FIXTURE_DIR)) {
    console.error(`ERROR: Chat fixture not found at ${CHAT_FIXTURE_DIR}`);
    process.exit(1);
  }

  // Clean output dir
  if (existsSync(OUTPUT_DIR)) {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // --- Step 1: Compile HTML (inline sub-compositions) ---
  console.log("\nCompiling HTML (inlining sub-compositions)...");
  const compiledDir = join(OUTPUT_DIR, "compiled");
  mkdirSync(compiledDir, { recursive: true });

  const compiled = await compileForRender(
    CHAT_FIXTURE_DIR,
    join(CHAT_FIXTURE_DIR, "index.html"),
    join(OUTPUT_DIR, "downloads"),
  );
  writeFileSync(join(compiledDir, "index.html"), compiled.html, "utf-8");
  for (const [srcPath, html] of compiled.subCompositions) {
    const outPath = join(compiledDir, srcPath);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html, "utf-8");
  }
  console.log(`  Compiled: duration=${compiled.staticDuration}s, width=${compiled.width}, height=${compiled.height}`);

  // --- Step 2: Start file server with runtime injection ---
  console.log("\nStarting file server (with runtime injection)...");
  let server: FileServerHandle | null = null;
  try {
    server = await createFileServer({
      projectDir: CHAT_FIXTURE_DIR,
      compiledDir,
      port: 0,
    });
    console.log(`  File server running at ${server.url}`);

    const baseOpts: StreamingPipelineOptions = {
      serverUrl: server.url,
      fps: FPS,
      width: WIDTH,
      height: HEIGHT,
      totalFrames: TOTAL_FRAMES,
      outputPath: "", // set per-variant
    };

    // --- Run baseline ---
    console.log("\n--- Running baseline (sequential capture + encode) ---");
    const baselineTimings = await runBaselinePipeline({
      ...baseOpts,
      outputPath: join(OUTPUT_DIR, "baseline.mp4"),
    });
    printTimings("BASELINE (Sequential)", baselineTimings);

    // --- Run streaming (q80) ---
    console.log("\n--- Running streaming pipeline (JPEG q80) ---");
    const streamingTimings = await runStreamingPipeline({
      ...baseOpts,
      outputPath: join(OUTPUT_DIR, "streaming-q80.mp4"),
      jpegQuality: 80,
    });
    printTimings("STREAMING (JPEG q80)", streamingTimings);

    // --- Run streaming (q60 - reduced quality) ---
    console.log("\n--- Running streaming pipeline (JPEG q60) ---");
    const streamingLQTimings = await runStreamingPipelineLowQuality({
      ...baseOpts,
      outputPath: join(OUTPUT_DIR, "streaming-q60.mp4"),
    });
    printTimings("STREAMING (JPEG q60)", streamingLQTimings);

    // --- Run streaming with 2 workers ---
    console.log("\n--- Running streaming pipeline (2 workers, JPEG q80) ---");
    const streaming2WTimings = await runStreamingPipeline2Workers({
      ...baseOpts,
      outputPath: join(OUTPUT_DIR, "streaming-2w.mp4"),
      jpegQuality: 80,
    });
    printTimings("STREAMING (2 Workers)", streaming2WTimings);

    // --- Comparison ---
    printComparison(baselineTimings, streamingTimings, streamingLQTimings, streaming2WTimings);

  } catch (err) {
    console.error("Benchmark failed:", err);
    process.exit(1);
  } finally {
    if (server) {
      server.close();
      console.log("\nFile server stopped.");
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
