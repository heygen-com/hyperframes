#!/usr/bin/env npx tsx
/**
 * Experiment 6 Benchmark: Resolution Scaling, Encoding Presets, and GL Backend
 *
 * Attacks the TWO biggest remaining bottlenecks:
 *   1. SwiftShader CPU rendering (dominates per-frame capture cost)
 *   2. FFmpeg encoding preset (38% of total at "high" quality)
 *
 * Variants:
 *   1. Baseline: 1080x1920, quality "high" (preset "slow", crf 18)
 *   2. Draft encoding: 1080x1920, quality "draft" (preset "ultrafast", crf 28)
 *   3. Half resolution: 540x960, quality "high"
 *   4. Half resolution + draft encoding: 540x960, quality "draft"
 *   5. No SwiftShader: remove --use-angle=swiftshader, use default GL
 *   6. GPU enabled: --use-angle=gl-egl instead of swiftshader
 *
 * Uses the `chat` test fixture (15s @ 30fps = 450 frames).
 *
 * Variants 1-4 use the full producer pipeline (createRenderJob/executeRenderJob).
 * Variants 5-6 use engine-level capture APIs directly since they require custom
 * Chrome args that can't be overridden through EngineConfig.
 *
 * Usage:
 *   cd /home/ubuntu/workspaces/hyperframes-oss/packages/producer
 *   npx tsx ../engine/src/experiments/exp6-benchmark.ts
 */

import {
  existsSync,
  mkdirSync,
  cpSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  createRenderJob,
  executeRenderJob,
  type RenderConfig,
} from "../../../producer/src/services/renderOrchestrator.js";
import { resolveConfig } from "../config.js";
import {
  acquireBrowser,
  releaseBrowser,
  buildChromeArgs,
  resolveHeadlessShellPath,
  type CaptureMode,
} from "../services/browserManager.js";
import { getCdpSession } from "../services/screenshotService.js";
import {
  createFileServer,
  type FileServerHandle,
} from "../../../producer/src/services/fileServer.js";
import {
  encodeFramesFromDir,
  getEncoderPreset,
} from "../services/chunkEncoder.js";

import type { Browser, Page } from "puppeteer-core";

// ── Configuration ──────────────────────────────────────────────────────────

const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = dirname(__filename2);

const CHAT_FIXTURE_DIR = resolve(
  __dirname2,
  "../../../../packages/producer/tests/chat",
);
const CHAT_SRC_DIR = join(CHAT_FIXTURE_DIR, "src");

const OFFICIAL_BASELINE_MS = 8540;
const FPS = 30;
const DURATION_S = 15;
const TOTAL_FRAMES = FPS * DURATION_S; // 450
const WIDTH = 1080;
const HEIGHT = 1920;

// ── Types ──────────────────────────────────────────────────────────────────

interface VariantResult {
  name: string;
  totalMs: number;
  captureMs: number;
  encodeMs: number;
  assembleMs: number;
  compileMs: number;
  resolution: string;
  quality: string;
  frames: number;
  workers: number;
  speedup: string;
  stages: Record<string, number>;
  error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function createTmpDir(label: string): string {
  const dir = join(tmpdir(), `exp6-${label}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function copyFixture(destRoot: string): string {
  const srcDest = join(destRoot, "src");
  cpSync(CHAT_SRC_DIR, srcDest, { recursive: true });
  return srcDest;
}

/**
 * Create a modified copy of the fixture with different resolution.
 */
function copyFixtureWithResolution(
  destRoot: string,
  width: number,
  height: number,
): string {
  const srcDest = join(destRoot, "src");
  cpSync(CHAT_SRC_DIR, srcDest, { recursive: true });

  const indexPath = join(srcDest, "index.html");
  let indexHtml = readFileSync(indexPath, "utf-8");
  indexHtml = indexHtml
    .replace(/data-width="1080"/g, `data-width="${width}"`)
    .replace(/data-height="1920"/g, `data-height="${height}"`);
  writeFileSync(indexPath, indexHtml, "utf-8");

  const typoPath = join(srcDest, "compositions", "typography.html");
  if (existsSync(typoPath)) {
    let typoHtml = readFileSync(typoPath, "utf-8");
    typoHtml = typoHtml
      .replace(/data-width="1080"/g, `data-width="${width}"`)
      .replace(/data-height="1920"/g, `data-height="${height}"`);
    writeFileSync(typoPath, typoHtml, "utf-8");
  }

  return srcDest;
}

/**
 * Run a variant using the full producer pipeline.
 */
async function runPipelineVariant(
  name: string,
  renderConfig: RenderConfig,
  projectDir: string,
  outputPath: string,
): Promise<VariantResult> {
  console.log(`\n  Running: ${name}...`);
  const job = createRenderJob(renderConfig);

  try {
    await executeRenderJob(job, projectDir, outputPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  FAILED: ${msg}`);
    return {
      name,
      totalMs: 0,
      captureMs: 0,
      encodeMs: 0,
      assembleMs: 0,
      compileMs: 0,
      resolution: "?",
      quality: renderConfig.quality,
      frames: 0,
      workers: 0,
      speedup: "FAILED",
      stages: {},
      error: msg,
    };
  }

  const ps = job.perfSummary!;
  const speedup = OFFICIAL_BASELINE_MS / ps.totalElapsedMs;

  const result: VariantResult = {
    name,
    totalMs: ps.totalElapsedMs,
    captureMs: ps.stages.captureMs ?? 0,
    encodeMs: ps.stages.encodeMs ?? 0,
    assembleMs: ps.stages.assembleMs ?? 0,
    compileMs: ps.stages.compileMs ?? 0,
    resolution: `${ps.resolution.width}x${ps.resolution.height}`,
    quality: ps.quality,
    frames: ps.totalFrames,
    workers: ps.workers,
    speedup: `${speedup.toFixed(2)}x`,
    stages: ps.stages,
  };

  console.log(
    `  => ${ps.totalElapsedMs}ms total | capture ${ps.stages.captureMs ?? "?"}ms | encode ${ps.stages.encodeMs ?? "?"}ms | ${speedup.toFixed(2)}x vs baseline`,
  );

  return result;
}

/**
 * Run a GL-backend variant using engine-level APIs with custom Chrome args.
 * This bypasses the producer pipeline to allow custom Chrome flags.
 */
async function runGlVariant(
  name: string,
  customArgsFn: (baseArgs: string[]) => string[],
): Promise<VariantResult> {
  console.log(`\n  Running: ${name}...`);

  const tmpRoot = createTmpDir(name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase());
  const projectDir = copyFixture(tmpRoot);
  const framesDir = join(tmpRoot, "captured-frames");
  const outputPath = join(tmpRoot, "output.mp4");
  mkdirSync(framesDir, { recursive: true });

  let fileServer: FileServerHandle | null = null;
  let browser: Browser | null = null;

  try {
    const totalStart = Date.now();
    const stages: Record<string, number> = {};

    // Start file server (reuse producer's file server for runtime injection)
    const compileStart = Date.now();
    // We need to compile with the producer's htmlCompiler for runtime injection
    const { compileForRender } = await import(
      "../../../producer/src/services/htmlCompiler.js"
    );
    const workDir = join(tmpRoot, "work");
    mkdirSync(workDir, { recursive: true });
    const htmlPath = join(projectDir, "index.html");
    const compiled = await compileForRender(projectDir, htmlPath, join(workDir, "downloads"));
    // Write compiled artifacts
    const compileDir = join(workDir, "compiled");
    mkdirSync(compileDir, { recursive: true });
    writeFileSync(join(compileDir, "index.html"), compiled.html, "utf-8");
    for (const [srcPath, html] of compiled.subCompositions) {
      const outPath = join(compileDir, srcPath);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, html, "utf-8");
    }
    stages.compileMs = Date.now() - compileStart;

    fileServer = await createFileServer({
      projectDir,
      compiledDir: compileDir,
      port: 0,
    });

    // Build Chrome args with customization
    const headlessShell = resolveHeadlessShellPath();
    const isLinux = process.platform === "linux";
    const preMode: CaptureMode =
      headlessShell && isLinux ? "beginframe" : "screenshot";

    const baseArgs = buildChromeArgs(
      { width: WIDTH, height: HEIGHT, captureMode: preMode },
    );
    const chromeArgs = customArgsFn(baseArgs);

    console.log(`    Chrome GL flags: ${chromeArgs.filter((a) => a.includes("use-gl") || a.includes("use-angle") || a.includes("disable-gpu")).join(" ")}`);

    // Launch browser
    const launchStart = Date.now();
    const { browser: b, captureMode } = await acquireBrowser(chromeArgs);
    browser = b;
    stages.browserLaunchMs = Date.now() - launchStart;

    // Setup page
    const page = await browser.newPage();
    await page.setViewport({
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
    });

    // Navigate and wait for __hf
    const url = `${fileServer.url}/index.html`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

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
      throw new Error("Page __hf not ready after 45s");
    }

    // Capture frames using BeginFrame or screenshot
    const captureStart = Date.now();

    if (captureMode === "beginframe") {
      const client = await getCdpSession(page);
      await client.send("HeadlessExperimental.enable");

      // Get base frame time
      const initResult = (await client.send("HeadlessExperimental.beginFrame", {
        frameTimeTicks: 0,
        interval: 1000 / FPS,
        noDisplayUpdates: false,
      })) as { hasDamage: boolean };

      const frameIntervalMs = 1000 / FPS;
      let frameTimeTicks = frameIntervalMs;

      for (let i = 0; i < TOTAL_FRAMES; i++) {
        const time = i / FPS;
        // Seek
        await page.evaluate(`window.__hf.seek(${time})`);
        // BeginFrame
        const result = (await client.send("HeadlessExperimental.beginFrame", {
          frameTimeTicks,
          interval: frameIntervalMs,
          noDisplayUpdates: false,
          screenshot: { format: "jpeg", quality: 95 },
        })) as { hasDamage: boolean; screenshotData?: string };

        if (result.screenshotData) {
          const buffer = Buffer.from(result.screenshotData, "base64");
          const framePath = join(
            framesDir,
            `frame_${String(i).padStart(6, "0")}.jpg`,
          );
          writeFileSync(framePath, buffer);
        }
        frameTimeTicks += frameIntervalMs;
      }
    } else {
      // Screenshot fallback
      for (let i = 0; i < TOTAL_FRAMES; i++) {
        const time = i / FPS;
        await page.evaluate(`window.__hf.seek(${time})`);
        const screenshot = await page.screenshot({
          type: "jpeg",
          quality: 95,
          encoding: "binary",
        });
        const framePath = join(
          framesDir,
          `frame_${String(i).padStart(6, "0")}.jpg`,
        );
        writeFileSync(framePath, screenshot as Buffer);
      }
    }
    stages.captureMs = Date.now() - captureStart;

    // Close browser
    await page.close();
    await releaseBrowser(browser);
    browser = null;

    // Encode
    const encodeStart = Date.now();
    const preset = getEncoderPreset("high", "mp4");
    const encodeResult = await encodeFramesFromDir(
      framesDir,
      "frame_%06d.jpg",
      outputPath,
      {
        fps: FPS,
        width: WIDTH,
        height: HEIGHT,
        codec: preset.codec,
        preset: preset.preset,
        quality: preset.quality,
        pixelFormat: preset.pixelFormat,
      },
    );
    if (!encodeResult.success) {
      throw new Error(`Encoding failed: ${encodeResult.error}`);
    }
    stages.encodeMs = Date.now() - encodeStart;

    const totalMs = Date.now() - totalStart;
    const speedup = OFFICIAL_BASELINE_MS / totalMs;

    console.log(
      `  => ${totalMs}ms total | capture ${stages.captureMs}ms | encode ${stages.encodeMs}ms | ${speedup.toFixed(2)}x vs baseline`,
    );

    return {
      name,
      totalMs,
      captureMs: stages.captureMs,
      encodeMs: stages.encodeMs,
      assembleMs: 0,
      compileMs: stages.compileMs ?? 0,
      resolution: `${WIDTH}x${HEIGHT}`,
      quality: "high",
      frames: TOTAL_FRAMES,
      workers: 1,
      speedup: `${speedup.toFixed(2)}x`,
      stages,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  FAILED: ${msg}`);
    return {
      name,
      totalMs: 0,
      captureMs: 0,
      encodeMs: 0,
      assembleMs: 0,
      compileMs: 0,
      resolution: `${WIDTH}x${HEIGHT}`,
      quality: "high",
      frames: 0,
      workers: 1,
      speedup: "FAILED",
      stages: {},
      error: msg,
    };
  } finally {
    if (browser) {
      await releaseBrowser(browser).catch(() => {});
    }
    if (fileServer) {
      fileServer.close();
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=".repeat(80));
  console.log("EXPERIMENT 6: Resolution Scaling, Encoding Presets, and GL Backend");
  console.log("=".repeat(80));
  console.log(
    `Official baseline: ${OFFICIAL_BASELINE_MS}ms (1080x1920, 30fps, quality "high", 6 workers)`,
  );
  console.log(`Fixture: ${CHAT_FIXTURE_DIR}`);
  console.log();

  if (!existsSync(CHAT_SRC_DIR)) {
    console.error(`ERROR: Chat fixture not found at ${CHAT_SRC_DIR}`);
    process.exit(1);
  }

  const results: VariantResult[] = [];

  // ── Variant 1: Baseline ────────────────────────────────────────────────
  {
    const tmpRoot = createTmpDir("v1-baseline");
    const projectDir = copyFixture(tmpRoot);
    const outputPath = join(tmpRoot, "output.mp4");

    const config = resolveConfig({ concurrency: 6 });
    const result = await runPipelineVariant(
      "V1: Baseline (1080x1920, high)",
      { fps: 30, quality: "high", producerConfig: config },
      projectDir,
      outputPath,
    );
    results.push(result);
    rmSync(tmpRoot, { recursive: true, force: true });
  }

  // ── Variant 2: Draft encoding ──────────────────────────────────────────
  {
    const tmpRoot = createTmpDir("v2-draft");
    const projectDir = copyFixture(tmpRoot);
    const outputPath = join(tmpRoot, "output.mp4");

    const config = resolveConfig({ concurrency: 6 });
    const result = await runPipelineVariant(
      "V2: Draft encoding (1080x1920, draft)",
      { fps: 30, quality: "draft", producerConfig: config },
      projectDir,
      outputPath,
    );
    results.push(result);
    rmSync(tmpRoot, { recursive: true, force: true });
  }

  // ── Variant 3: Half resolution ─────────────────────────────────────────
  {
    const tmpRoot = createTmpDir("v3-halfres");
    const projectDir = copyFixtureWithResolution(tmpRoot, 540, 960);
    const outputPath = join(tmpRoot, "output.mp4");

    const config = resolveConfig({ concurrency: 6 });
    const result = await runPipelineVariant(
      "V3: Half resolution (540x960, high)",
      { fps: 30, quality: "high", producerConfig: config },
      projectDir,
      outputPath,
    );
    results.push(result);
    rmSync(tmpRoot, { recursive: true, force: true });
  }

  // ── Variant 4: Half resolution + draft encoding ────────────────────────
  {
    const tmpRoot = createTmpDir("v4-halfres-draft");
    const projectDir = copyFixtureWithResolution(tmpRoot, 540, 960);
    const outputPath = join(tmpRoot, "output.mp4");

    const config = resolveConfig({ concurrency: 6 });
    const result = await runPipelineVariant(
      "V4: Half res + draft (540x960, draft)",
      { fps: 30, quality: "draft", producerConfig: config },
      projectDir,
      outputPath,
    );
    results.push(result);
    rmSync(tmpRoot, { recursive: true, force: true });
  }

  // ── Variant 5: No SwiftShader (engine-level, single worker) ────────────
  // Uses engine capture APIs directly to control Chrome args.
  // Single worker for apples-to-apples GL comparison.
  {
    const result = await runGlVariant(
      "V5: No SwiftShader (default GL, 1 worker)",
      (args) => args.filter((a) => a !== "--use-angle=swiftshader"),
    );
    results.push(result);
  }

  // ── Variant 5b: Baseline with swiftshader, single worker ──────────────
  // Control group for variants 5/6: same single-worker engine-level capture
  // but WITH swiftshader, so we can fairly compare GL backends.
  {
    const result = await runGlVariant(
      "V5b: SwiftShader baseline (1 worker)",
      (args) => args, // No modification
    );
    results.push(result);
  }

  // ── Variant 6: GPU / EGL backend ──────────────────────────────────────
  {
    const result = await runGlVariant(
      "V6: GPU/EGL (--use-angle=gl-egl, 1 worker)",
      (args) =>
        args.map((a) =>
          a === "--use-angle=swiftshader" ? "--use-angle=gl-egl" : a,
        ),
    );
    results.push(result);
  }

  // ── Results Summary ────────────────────────────────────────────────────
  console.log("\n\n" + "=".repeat(100));
  console.log("EXPERIMENT 6 RESULTS SUMMARY");
  console.log("=".repeat(100));
  console.log(
    "Variant".padEnd(48) +
      "Total".padStart(8) +
      "Capture".padStart(9) +
      "Encode".padStart(9) +
      "Res".padStart(12) +
      "Workers".padStart(9) +
      "Speedup".padStart(9),
  );
  console.log("-".repeat(100));

  for (const r of results) {
    if (r.error) {
      console.log(
        r.name.padEnd(48) +
          "FAILED".padStart(8) +
          "".padStart(9) +
          "".padStart(9) +
          r.resolution.padStart(12) +
          `${r.workers}`.padStart(9) +
          "FAILED".padStart(9),
      );
    } else {
      console.log(
        r.name.padEnd(48) +
          `${r.totalMs}`.padStart(8) +
          `${r.captureMs}`.padStart(9) +
          `${r.encodeMs}`.padStart(9) +
          r.resolution.padStart(12) +
          `${r.workers}`.padStart(9) +
          r.speedup.padStart(9),
      );
    }
  }

  console.log("=".repeat(100));
  console.log(`\nOfficial baseline reference: ${OFFICIAL_BASELINE_MS}ms`);

  // Detailed breakdown
  console.log("\n\nDETAILED STAGE BREAKDOWN:");
  console.log("-".repeat(80));
  for (const r of results) {
    console.log(`\n${r.name}:`);
    if (r.error) {
      console.log(`  ERROR: ${r.error}`);
      continue;
    }
    console.log(
      `  Total: ${r.totalMs}ms | Workers: ${r.workers} | Frames: ${r.frames}`,
    );
    for (const [stage, ms] of Object.entries(r.stages)) {
      const pct = r.totalMs > 0 ? Math.round((ms / r.totalMs) * 100) : 0;
      console.log(`  ${stage}: ${ms}ms (${pct}%)`);
    }
  }

  // Key findings
  console.log("\n\nKEY COMPARISONS:");
  console.log("-".repeat(80));

  const baseline = results.find((r) => r.name.includes("V1"));
  const draft = results.find((r) => r.name.includes("V2"));
  const halfRes = results.find((r) => r.name.includes("V3"));
  const halfResDraft = results.find((r) => r.name.includes("V4"));
  const noSS = results.find((r) => r.name.includes("V5:"));
  const ssBench = results.find((r) => r.name.includes("V5b"));
  const gpu = results.find((r) => r.name.includes("V6"));

  if (baseline && !baseline.error && draft && !draft.error) {
    const encodeSavings = baseline.encodeMs - draft.encodeMs;
    const totalSavings = baseline.totalMs - draft.totalMs;
    console.log(
      `Draft encoding saves: ${encodeSavings}ms encode time, ${totalSavings}ms total`,
    );
    console.log(
      `  Encode speedup: ${(baseline.encodeMs / draft.encodeMs).toFixed(1)}x`,
    );
  }

  if (baseline && !baseline.error && halfRes && !halfRes.error) {
    const captureSavings = baseline.captureMs - halfRes.captureMs;
    const encodeSavings = baseline.encodeMs - halfRes.encodeMs;
    const totalSavings = baseline.totalMs - halfRes.totalMs;
    console.log(
      `\nHalf resolution saves: ${captureSavings}ms capture, ${encodeSavings}ms encode, ${totalSavings}ms total`,
    );
    console.log(
      `  Capture speedup: ${(baseline.captureMs / halfRes.captureMs).toFixed(1)}x`,
    );
    console.log(
      `  Encode speedup: ${(baseline.encodeMs / halfRes.encodeMs).toFixed(1)}x`,
    );
  }

  if (baseline && !baseline.error && halfResDraft && !halfResDraft.error) {
    const totalSavings = baseline.totalMs - halfResDraft.totalMs;
    console.log(
      `\nHalf res + draft saves: ${totalSavings}ms total (${(baseline.totalMs / halfResDraft.totalMs).toFixed(1)}x faster)`,
    );
  }

  // GL backend comparison (apples-to-apples: single worker)
  if (ssBench && !ssBench.error) {
    console.log(
      `\nGL Backend comparison (single-worker, capture-only):`,
    );
    console.log(
      `  SwiftShader baseline (1 worker): ${ssBench.captureMs}ms capture`,
    );

    if (noSS && !noSS.error) {
      const diff = noSS.captureMs - ssBench.captureMs;
      const sign = diff >= 0 ? "+" : "";
      console.log(
        `  No SwiftShader (default GL):     ${noSS.captureMs}ms capture (${sign}${diff}ms, ${(ssBench.captureMs / noSS.captureMs).toFixed(2)}x)`,
      );
    } else if (noSS?.error) {
      console.log(`  No SwiftShader: FAILED - ${noSS.error}`);
    }

    if (gpu && !gpu.error) {
      const diff = gpu.captureMs - ssBench.captureMs;
      const sign = diff >= 0 ? "+" : "";
      console.log(
        `  GPU/EGL:                         ${gpu.captureMs}ms capture (${sign}${diff}ms, ${(ssBench.captureMs / gpu.captureMs).toFixed(2)}x)`,
      );
    } else if (gpu?.error) {
      console.log(`  GPU/EGL: FAILED - ${gpu.error}`);
    }
  }

  // Save results JSON
  const outputJson = join(tmpdir(), `exp6-results-${Date.now()}.json`);
  writeFileSync(outputJson, JSON.stringify(results, null, 2), "utf-8");
  console.log(`\nResults saved to: ${outputJson}`);
}

main().catch((err) => {
  console.error("Experiment 6 failed:", err);
  process.exit(1);
});
