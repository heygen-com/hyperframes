import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
  statSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { createRenderJob, executeRenderJob } from "./services/renderOrchestrator.js";
import { compileForRender } from "./services/htmlCompiler.js";
import { validateCompilation } from "./services/compilationTester.js";
import { extractVideoMetadata } from "./utils/ffprobe.js";
import { buildRmsEnvelope, compareAudioEnvelopes } from "./utils/audioRegression.js";

// ── Types ────────────────────────────────────────────────────────────────────

type TestMetadata = {
  name: string;
  description: string;
  tags: string[];
  minPsnr: number;
  maxFrameFailures: number;
  minAudioCorrelation: number;
  maxAudioLagWindows: number;
  renderConfig: {
    fps: 24 | 30 | 60;
    format?: "mp4" | "webm"; // Optional: defaults to "mp4"
    workers?: number; // Optional: auto-calculates if omitted
    /** Enable HDR color-space probing + HDR10 encode pipeline. */
    hdr?: boolean;
  };
};

type TestSuite = {
  id: string;
  dir: string;
  srcDir: string;
  meta: TestMetadata;
};

type CliOptions = {
  testNames: string[];
  excludeTags: string[];
  update: boolean;
  sequential: boolean;
  keepTemp: boolean;
};

type TestResult = {
  suite: TestSuite;
  passed: boolean;
  compilation?: {
    passed: boolean;
    errors: string[];
    warnings: string[];
  };
  visual?: {
    passed: boolean;
    failedFrames: number;
    checkpoints: Array<{ time: number; psnr: number; passed: boolean }>;
  };
  audio?: {
    passed: boolean;
    correlation: number;
    lagWindows: number;
  };
  renderedOutputPath?: string;
};

// ── Utilities ────────────────────────────────────────────────────────────────

/**
 * Pretty-print logger for human-readable output alongside JSON events
 */
function logPretty(message: string, emoji = "•") {
  console.error(`${emoji} ${message}`);
}

function parseArgs(argv: string[]): CliOptions {
  const testNames: string[] = [];
  const excludeTags: string[] = [];
  let update = false;
  let sequential = false;
  let keepTemp = false;

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (token === "--update") {
      update = true;
    } else if (token === "--sequential") {
      sequential = true;
    } else if (token === "--keep-temp") {
      keepTemp = true;
    } else if (token === "--exclude-tags" && i + 1 < argv.length) {
      i += 1;
      const tagArg = argv[i];
      if (tagArg) excludeTags.push(...tagArg.split(","));
    } else if (!token.startsWith("--")) {
      testNames.push(token);
    }
  }

  return { testNames, excludeTags, update, sequential, keepTemp };
}

function validateMetadata(meta: unknown): TestMetadata {
  if (typeof meta !== "object" || meta === null) {
    throw new Error("meta.json must be a JSON object");
  }
  const m = meta as Record<string, unknown>;
  if (typeof m.name !== "string" || !m.name) {
    throw new Error("meta.json: 'name' must be a non-empty string");
  }
  if (typeof m.description !== "string") {
    throw new Error("meta.json: 'description' must be a string");
  }
  if (!Array.isArray(m.tags)) {
    throw new Error("meta.json: 'tags' must be an array");
  }
  if (typeof m.minPsnr !== "number" || m.minPsnr < 0) {
    throw new Error("meta.json: 'minPsnr' must be a non-negative number");
  }
  if (typeof m.maxFrameFailures !== "number" || m.maxFrameFailures < 0) {
    throw new Error("meta.json: 'maxFrameFailures' must be a non-negative number");
  }
  if (
    typeof m.minAudioCorrelation !== "number" ||
    m.minAudioCorrelation < 0 ||
    m.minAudioCorrelation > 1
  ) {
    throw new Error("meta.json: 'minAudioCorrelation' must be between 0 and 1");
  }
  if (typeof m.maxAudioLagWindows !== "number" || m.maxAudioLagWindows < 1) {
    throw new Error("meta.json: 'maxAudioLagWindows' must be >= 1");
  }
  if (!m.renderConfig || typeof m.renderConfig !== "object") {
    throw new Error("meta.json: 'renderConfig' must be an object");
  }
  const rc = m.renderConfig as Record<string, unknown>;
  if (![24, 30, 60].includes(rc.fps as number)) {
    throw new Error("meta.json: 'renderConfig.fps' must be 24, 30, or 60");
  }
  if (rc.format !== undefined && rc.format !== "mp4" && rc.format !== "webm") {
    throw new Error("meta.json: 'renderConfig.format' must be 'mp4' or 'webm' (or omit for mp4)");
  }
  if (rc.workers !== undefined) {
    if (typeof rc.workers !== "number" || rc.workers < 1) {
      throw new Error("meta.json: 'renderConfig.workers' must be >= 1 (or omit to auto-calculate)");
    }
  }
  if (rc.hdr !== undefined && typeof rc.hdr !== "boolean") {
    throw new Error("meta.json: 'renderConfig.hdr' must be a boolean (or omit for false)");
  }

  return m as TestMetadata;
}

function discoverTestSuites(
  testsDir: string,
  filterNames: string[],
  excludeTags: string[] = [],
): TestSuite[] {
  if (!existsSync(testsDir)) {
    throw new Error(`Tests directory not found: ${testsDir}`);
  }

  const entries = readdirSync(testsDir);
  const suites: TestSuite[] = [];

  for (const entry of entries) {
    const dir = join(testsDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    if (entry === "node_modules" || entry.startsWith(".")) continue;

    // If filter is specified, skip non-matching tests
    if (filterNames.length > 0 && !filterNames.includes(entry)) {
      continue;
    }

    const srcDir = join(dir, "src");
    const metaPath = join(dir, "meta.json");

    // Validate structure
    if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) {
      console.warn(`⚠️  Skipping ${entry}: missing src/ directory`);
      continue;
    }
    if (!existsSync(join(srcDir, "index.html"))) {
      console.warn(`⚠️  Skipping ${entry}: missing src/index.html`);
      continue;
    }
    if (!existsSync(metaPath)) {
      console.warn(`⚠️  Skipping ${entry}: missing meta.json`);
      continue;
    }

    // Parse and validate meta.json
    let meta: TestMetadata;
    try {
      const metaRaw = JSON.parse(readFileSync(metaPath, "utf-8"));
      meta = validateMetadata(metaRaw);
    } catch (error) {
      console.warn(
        `⚠️  Skipping ${entry}: invalid meta.json - ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    // Skip tests with excluded tags
    if (excludeTags.length > 0 && meta.tags.some((t) => excludeTags.includes(t))) {
      logPretty(
        `Skipping ${entry}: excluded by tags [${meta.tags.filter((t) => excludeTags.includes(t)).join(", ")}]`,
        "⏭️",
      );
      continue;
    }

    suites.push({
      id: entry,
      dir,
      srcDir,
      meta,
    });
  }

  return suites;
}

// ── FFmpeg Utilities ─────────────────────────────────────────────────────────

function runFfmpeg(args: string[], label: string): { stdout: Buffer; stderr: string } {
  const result = spawnSync("ffmpeg", args, {
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
    encoding: "buffer",
  });
  const stderr = result.stderr.toString("utf-8");
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${stderr}`);
  }
  return { stdout: result.stdout, stderr };
}

function extractFrameAsImage(
  videoPath: string,
  timeSeconds: number,
  outputPath: string,
  fps: number,
): void {
  const frameIndex = Math.max(0, Math.round(timeSeconds * fps));
  runFfmpeg(
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      videoPath,
      "-vf",
      `select='eq(n\\,${frameIndex})'`,
      "-frames:v",
      "1",
      "-y",
      outputPath,
    ],
    `Frame extraction at ${timeSeconds}s`,
  );
}

function psnrAtCheckpoint(
  renderedVideo: string,
  snapshotVideo: string,
  checkpointSec: number,
  fps: number,
): number {
  const frameIndex = Math.max(0, Math.round(checkpointSec * fps));
  const filter = `[0:v]select='eq(n\\,${frameIndex})',setpts=PTS-STARTPTS[rv];[1:v]select='eq(n\\,${frameIndex})',setpts=PTS-STARTPTS[gv];[rv][gv]psnr`;
  const args = [
    "-hide_banner",
    "-loglevel",
    "info",
    "-i",
    renderedVideo,
    "-i",
    snapshotVideo,
    "-filter_complex",
    filter,
    "-frames:v",
    "1",
    "-f",
    "null",
    "-",
  ];
  const { stderr } = runFfmpeg(args, `Frame PSNR at ${checkpointSec}s`);
  const match = stderr.match(/average:\s*([^\s]+)/i);
  if (!match) {
    throw new Error(`Unable to parse PSNR output at ${checkpointSec}s`);
  }
  const rawValue = (match[1] ?? "").trim().toLowerCase();
  if (rawValue === "inf" || rawValue === "infinite") {
    return Number.POSITIVE_INFINITY;
  }
  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue)) {
    throw new Error(`Invalid PSNR value at ${checkpointSec}s: ${match[1]}`);
  }
  return parsedValue;
}

function extractMonoPcm16(videoPath: string): Int16Array {
  try {
    const { stdout } = runFfmpeg(
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        videoPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "s16le",
        "-",
      ],
      `Audio extraction (${videoPath})`,
    );
    if (stdout.byteLength < 2) {
      return new Int16Array(0);
    }
    return new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 2));
  } catch (err) {
    // No audio stream (e.g., WebM without audio) — log but don't fail
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("does not contain any stream")) {
      logPretty(`Audio extraction warning: ${msg.slice(0, 200)}`, "⚠️");
    }
    return new Int16Array(0);
  }
}

// ── Failure Reporting ────────────────────────────────────────────────────────

function saveFailureDetails(
  suite: TestSuite,
  result: TestResult,
  renderedVideoPath: string,
  snapshotVideoPath: string,
  compiledHtml?: string,
  snapshotHtml?: string,
): void {
  const failuresDir = join(suite.dir, "failures");
  if (!existsSync(failuresDir)) {
    mkdirSync(failuresDir, { recursive: true });
  }

  // Save compilation failures
  if (result.compilation && !result.compilation.passed) {
    if (compiledHtml && snapshotHtml) {
      writeFileSync(join(failuresDir, "actual.html"), compiledHtml, "utf-8");
      writeFileSync(join(failuresDir, "expected.html"), snapshotHtml, "utf-8");

      const diffSummary = [
        "=== COMPILATION FAILURE ===",
        "",
        "Errors:",
        ...result.compilation.errors.map((e) => `  - ${e}`),
        "",
        "Files saved for comparison:",
        `  - actual.html (what was compiled)`,
        `  - expected.html (golden snapshot)`,
        "",
        "To compare:",
        `  diff failures/expected.html failures/actual.html`,
        "",
      ].join("\n");

      writeFileSync(join(failuresDir, "compilation-diff.txt"), diffSummary, "utf-8");
      logPretty(`Saved compilation failure details to ${failuresDir}/`, "💾");
    }
  }

  // Save visual failures
  if (result.visual && !result.visual.passed && result.visual.checkpoints.length > 0) {
    const failedCheckpoints = result.visual.checkpoints.filter((c) => !c.passed);

    const visualReport = {
      summary: {
        totalCheckpoints: result.visual.checkpoints.length,
        failedCheckpoints: failedCheckpoints.length,
        threshold: suite.meta.minPsnr,
      },
      failedFrames: failedCheckpoints.map((c) => ({
        time: c.time,
        psnr: c.psnr,
        belowThresholdBy: suite.meta.minPsnr - c.psnr,
      })),
    };

    writeFileSync(
      join(failuresDir, "visual-failures.json"),
      JSON.stringify(visualReport, null, 2),
      "utf-8",
    );

    // Extract images for first 10 failed frames
    const framesToExtract = failedCheckpoints.slice(0, 10);
    if (framesToExtract.length > 0) {
      const framesDir = join(failuresDir, "frames");
      if (!existsSync(framesDir)) {
        mkdirSync(framesDir, { recursive: true });
      }

      logPretty(`Extracting ${framesToExtract.length} failed frames...`, "📸");

      for (const checkpoint of framesToExtract) {
        const timeStr = checkpoint.time.toFixed(2).replace(".", "_");
        try {
          extractFrameAsImage(
            renderedVideoPath,
            checkpoint.time,
            join(framesDir, `actual_${timeStr}s.png`),
            suite.meta.renderConfig.fps,
          );
          extractFrameAsImage(
            snapshotVideoPath,
            checkpoint.time,
            join(framesDir, `expected_${timeStr}s.png`),
            suite.meta.renderConfig.fps,
          );
        } catch {
          logPretty(`  Warning: Could not extract frame at ${checkpoint.time}s`, "⚠️");
        }
      }
    }

    logPretty(`Saved visual failure details to ${failuresDir}/`, "💾");
  }

  // Save audio failures
  if (result.audio && !result.audio.passed) {
    const audioReport = {
      summary: {
        correlation: result.audio.correlation,
        lagWindows: result.audio.lagWindows,
        threshold: suite.meta.minAudioCorrelation,
        maxLagWindows: suite.meta.maxAudioLagWindows,
      },
      analysis: {
        correlationBelowThreshold: result.audio.correlation < suite.meta.minAudioCorrelation,
        lagExceedsLimit: Math.abs(result.audio.lagWindows) > suite.meta.maxAudioLagWindows,
      },
    };

    writeFileSync(
      join(failuresDir, "audio-failures.json"),
      JSON.stringify(audioReport, null, 2),
      "utf-8",
    );

    logPretty(`Saved audio failure details to ${failuresDir}/`, "💾");
  }
}

// ── Test Execution ───────────────────────────────────────────────────────────

async function runTestSuite(
  suite: TestSuite,
  options: {
    update: boolean;
    keepTemp: boolean;
  },
): Promise<TestResult> {
  // Use predictable temp location: /tmp/hyperframes-tests/{test-id}/
  const testsRoot = join(tmpdir(), "hyperframes-tests");
  if (!existsSync(testsRoot)) {
    mkdirSync(testsRoot, { recursive: true });
  }

  const tempRoot = join(testsRoot, suite.id);
  if (existsSync(tempRoot)) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  mkdirSync(tempRoot, { recursive: true });

  const tempDownloadDir = join(tempRoot, "downloads");
  const outputFormat = suite.meta.renderConfig.format ?? "mp4";
  const videoExt = outputFormat === "webm" ? ".webm" : ".mp4";
  const renderedOutputPath = join(tempRoot, `output${videoExt}`);

  // Snapshot files stored in test's output/ directory
  const snapshotDir = join(suite.dir, "output");
  const snapshotCompiledPath = join(snapshotDir, "compiled.html");
  const snapshotVideoPath = join(snapshotDir, `output${videoExt}`);

  console.log(JSON.stringify({ event: "test_start", suite: suite.id, name: suite.meta.name }));
  logPretty(`Running test: ${suite.meta.name}`, "🧪");

  const result: TestResult = { suite, passed: false };
  let compiledHtml: string | undefined;
  let snapshotHtml: string | undefined;

  try {
    // STEP 1: Compile HTML
    console.log(JSON.stringify({ event: "compilation_start", suite: suite.id }));
    logPretty("Compiling composition...", "⚙️");

    const inputHtmlPath = join(suite.srcDir, "index.html");
    if (!existsSync(inputHtmlPath)) {
      throw new Error(`Input HTML not found: ${inputHtmlPath}`);
    }

    const compiled = await compileForRender(suite.srcDir, inputHtmlPath, tempDownloadDir);
    compiledHtml = compiled.html;

    // Update mode: save snapshot and pass
    if (options.update) {
      if (!existsSync(snapshotDir)) {
        mkdirSync(snapshotDir, { recursive: true });
      }
      writeFileSync(snapshotCompiledPath, compiled.html, "utf-8");
      console.log(
        JSON.stringify({
          event: "snapshot_updated",
          suite: suite.id,
          file: "output/compiled.html",
        }),
      );
      result.compilation = { passed: true, errors: [], warnings: [] };
    } else {
      // Test mode: compare against snapshot
      if (!existsSync(snapshotCompiledPath)) {
        throw new Error(
          `Snapshot not found: ${snapshotCompiledPath}. Run with --update to create it.`,
        );
      }

      snapshotHtml = readFileSync(snapshotCompiledPath, "utf-8");
      const validation = validateCompilation(compiled.html, snapshotHtml);

      result.compilation = {
        passed: validation.passed,
        errors: validation.errors,
        warnings: validation.warnings,
      };

      console.log(
        JSON.stringify({
          event: "compilation_complete",
          suite: suite.id,
          passed: validation.passed,
          errors: validation.errors.length,
          warnings: validation.warnings.length,
        }),
      );

      if (!validation.passed) {
        console.error(
          JSON.stringify({
            event: "compilation_failed",
            suite: suite.id,
            errors: validation.errors,
          }),
        );
        result.passed = false;
        return result;
      }
    }

    // STEP 2: Render video
    console.log(JSON.stringify({ event: "rendering_start", suite: suite.id }));
    logPretty("Rendering video...", "🎬");

    const tempSrcDir = join(tempRoot, "src");
    cpSync(suite.srcDir, tempSrcDir, { recursive: true });

    const job = createRenderJob({
      fps: suite.meta.renderConfig.fps,
      quality: "high", // Always use max quality for tests
      format: outputFormat,
      workers: suite.meta.renderConfig.workers,
      useGpu: false,
      debug: false,
      hdr: suite.meta.renderConfig.hdr ?? false,
    });

    await executeRenderJob(job, tempSrcDir, renderedOutputPath);

    console.log(JSON.stringify({ event: "rendering_complete", suite: suite.id }));
    logPretty("Render complete! Starting quality validation...", "✓");

    // Update mode: save snapshot and pass
    if (options.update) {
      if (!existsSync(snapshotDir)) {
        mkdirSync(snapshotDir, { recursive: true });
      }
      copyFileSync(renderedOutputPath, snapshotVideoPath);
      console.log(
        JSON.stringify({
          event: "snapshot_updated",
          suite: suite.id,
          file: `output/output${videoExt}`,
        }),
      );
      result.visual = { passed: true, failedFrames: 0, checkpoints: [] };
      result.audio = { passed: true, correlation: 1, lagWindows: 0 };
      result.passed = true;
      return result;
    }

    // Test mode: compare against snapshot
    if (!existsSync(snapshotVideoPath)) {
      throw new Error(`Snapshot not found: ${snapshotVideoPath}. Run with --update to create it.`);
    }

    // Visual comparison (100 frames, 1 per 1% of video duration)
    logPretty("Comparing visual quality (100 checkpoints)...", "🔍");
    const videoMetadata = await extractVideoMetadata(renderedOutputPath);
    const videoDuration = videoMetadata.durationSeconds;

    const visualCheckpoints: Array<{ time: number; psnr: number; passed: boolean }> = [];
    for (let i = 0; i < 100; i++) {
      const time = (videoDuration * i) / 100;
      const psnr = psnrAtCheckpoint(
        renderedOutputPath,
        snapshotVideoPath,
        time,
        suite.meta.renderConfig.fps,
      );
      visualCheckpoints.push({
        time,
        psnr,
        passed: psnr >= suite.meta.minPsnr,
      });

      // Progress indicator every 20 checkpoints
      if ((i + 1) % 20 === 0) {
        logPretty(`  Progress: ${i + 1}/100 checkpoints`, "  ");
      }
    }

    const failedFrames = visualCheckpoints.filter((c) => !c.passed).length;
    const visualPassed = failedFrames <= suite.meta.maxFrameFailures;

    result.visual = {
      passed: visualPassed,
      failedFrames,
      checkpoints: visualCheckpoints,
    };

    console.log(
      JSON.stringify({
        event: "visual_comparison_complete",
        suite: suite.id,
        passed: visualPassed,
        failedFrames,
        checkpoints: visualCheckpoints,
      }),
    );

    if (visualPassed) {
      logPretty(
        `Visual quality: PASSED (${failedFrames} failed frames, threshold: ${suite.meta.maxFrameFailures})`,
        "✓",
      );
    } else {
      logPretty(
        `Visual quality: FAILED (${failedFrames} failed frames, threshold: ${suite.meta.maxFrameFailures})`,
        "✗",
      );
    }

    // Audio comparison
    logPretty("Comparing audio quality...", "🔊");
    const renderedAudio = extractMonoPcm16(renderedOutputPath);
    const snapshotAudio = extractMonoPcm16(snapshotVideoPath);

    let audioPassed = true;
    let audioCorrelation = 1;
    let audioLagWindows = 0;

    if (renderedAudio.length > 0 && snapshotAudio.length > 0) {
      const renderedEnvelope = buildRmsEnvelope(renderedAudio);
      const snapshotEnvelope = buildRmsEnvelope(snapshotAudio);
      const audio = compareAudioEnvelopes(
        renderedEnvelope,
        snapshotEnvelope,
        suite.meta.maxAudioLagWindows,
      );
      audioCorrelation = audio.correlation;
      audioLagWindows = audio.lagWindows;
      audioPassed = audio.correlation >= suite.meta.minAudioCorrelation;
    }

    result.audio = {
      passed: audioPassed,
      correlation: audioCorrelation,
      lagWindows: audioLagWindows,
    };

    console.log(
      JSON.stringify({
        event: "audio_comparison_complete",
        suite: suite.id,
        passed: audioPassed,
        correlation: audioCorrelation,
        lagWindows: audioLagWindows,
      }),
    );

    if (audioPassed) {
      logPretty(
        `Audio quality: PASSED (correlation: ${audioCorrelation.toFixed(3)}, lag: ${audioLagWindows})`,
        "✓",
      );
    } else {
      logPretty(
        `Audio quality: FAILED (correlation: ${audioCorrelation.toFixed(3)}, threshold: ${suite.meta.minAudioCorrelation})`,
        "✗",
      );
    }

    // Overall test passes if all checks passed
    result.passed = result.compilation!.passed && visualPassed && audioPassed;
    result.renderedOutputPath = options.keepTemp ? renderedOutputPath : undefined;

    if (result.passed) {
      logPretty(`Test PASSED: ${suite.meta.name}`, "✅");
    } else {
      logPretty(`Test FAILED: ${suite.meta.name}`, "❌");
    }

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.passed = false;

    console.error(
      JSON.stringify({
        event: "test_error",
        suite: suite.id,
        error: errorMessage,
      }),
    );

    return result;
  } finally {
    // Save failure details before cleanup
    if (!result.passed && !options.update) {
      try {
        saveFailureDetails(
          suite,
          result,
          renderedOutputPath,
          snapshotVideoPath,
          compiledHtml,
          snapshotHtml,
        );
      } catch (error) {
        logPretty(
          `Warning: Could not save failure details: ${error instanceof Error ? error.message : String(error)}`,
          "⚠️",
        );
      }
    }

    // Clean up temp directory
    if (!options.keepTemp) {
      rmSync(tempRoot, { recursive: true, force: true });
    } else {
      console.log(JSON.stringify({ event: "temp_preserved", suite: suite.id, path: tempRoot }));
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const options = parseArgs(process.argv);
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const producerRoot = resolve(moduleDir, "..");
  const testsDir = join(producerRoot, "tests");

  const suites = discoverTestSuites(testsDir, options.testNames, options.excludeTags);

  if (suites.length === 0) {
    if (options.testNames.length > 0) {
      throw new Error(`No test suites found matching: ${options.testNames.join(", ")}`);
    }
    throw new Error(`No test suites found in ${testsDir}`);
  }

  console.log(
    JSON.stringify({
      event: "test_suite_start",
      totalSuites: suites.length,
      parallel: !options.sequential,
    }),
  );

  logPretty(
    `Starting ${suites.length} test suite(s) - ${options.sequential ? "sequential" : "parallel"} mode`,
    "🚀",
  );

  let results: TestResult[] = [];

  if (options.sequential) {
    // Sequential execution
    for (const suite of suites) {
      try {
        const result = await runTestSuite(suite, options);
        results.push(result);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "test_failed",
            suite: suite.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        process.exitCode = 1;
      }
    }
  } else {
    // Parallel execution (default)
    const settledResults = await Promise.allSettled(
      suites.map((suite) => runTestSuite(suite, options)),
    );

    results = settledResults.map((settled, index) => {
      const matchingSuite = suites[index];
      if (settled.status === "fulfilled") {
        return settled.value;
      } else {
        console.error(
          JSON.stringify({
            event: "test_failed",
            suite: matchingSuite?.id ?? "unknown",
            error:
              settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
          }),
        );
        process.exitCode = 1;
        if (!matchingSuite) {
          throw new Error(`No matching suite at index ${index}`);
        }
        return {
          suite: matchingSuite,
          passed: false,
        };
      }
    });
  }

  // Summary
  if (options.update) {
    console.log(
      JSON.stringify({
        event: "snapshots_updated",
        total: results.length,
      }),
    );
    logPretty(`Updated ${results.length} snapshot(s)`, "📸");
  } else {
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    const failedAtCompilation = results.filter(
      (r) => r.compilation && !r.compilation.passed,
    ).length;
    const failedAtVisual = results.filter((r) => r.visual && !r.visual.passed).length;
    const failedAtAudio = results.filter((r) => r.audio && !r.audio.passed).length;

    console.log(
      JSON.stringify({
        event: "test_suite_summary",
        total: results.length,
        passed,
        failed,
        failedAtCompilation,
        failedAtVisual,
        failedAtAudio,
        results: results.map((r) => ({
          suite: r.suite.id,
          name: r.suite.meta.name,
          passed: r.passed,
          compilation: r.compilation?.passed,
          visual: r.visual?.passed,
          audio: r.audio?.passed,
        })),
      }),
    );

    // Pretty summary
    logPretty("═══════════════════════════════════════", "");
    logPretty(`Test Suite Summary`, "📊");
    logPretty(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`, "");
    if (failed > 0) {
      logPretty(`  Failed at compilation: ${failedAtCompilation}`, "");
      logPretty(`  Failed at visual: ${failedAtVisual}`, "");
      logPretty(`  Failed at audio: ${failedAtAudio}`, "");
    }
    logPretty("═══════════════════════════════════════", "");

    if (failed > 0) {
      process.exitCode = 1;
    }
  }
}

void run().catch((error) => {
  console.error(
    JSON.stringify({
      event: "test_suite_fatal",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
