// fallow-ignore-file complexity
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
import { extractMediaMetadata, extractAudioMetadata } from "./utils/ffprobe.js";
import {
  buildRmsEnvelope,
  compareAudioEnvelopes,
  computeAudioResidualRmsDb,
} from "./utils/audioRegression.js";
import { parseFps, fpsToNumber } from "@hyperframes/core";
import {
  checkDistributedSupport,
  type HarnessMode,
  parseHarnessModeFlag,
  resolveMinPsnrForMode,
  runDistributedSimulatedRender,
} from "./regression-harness-distributed.js";

// `regression-harness-lambda-local` statically imports
// `@hyperframes/aws-lambda`, which depends on @aws-sdk + @sparticuz/chromium.
// In Dockerfile.test the workspace copy of aws-lambda's src isn't present,
// so a static import here would fail at module-load time even when
// running `--mode=in-process`. Load it on demand instead.
//
// The signature is typed via `RunLambdaLocalRender` (in its own types-only
// file) instead of `typeof import(...)` so producer's tsc doesn't have to
// type-check the implementation. The implementation imports
// `@hyperframes/aws-lambda`, whose types come from `dist/index.d.ts` after
// aws-lambda's build runs — a chicken-and-egg with producer's tsc that
// would otherwise fail the whole-repo build.
//
// The dynamic import path is indirected through a variable so tsc can't
// statically resolve the target file. Without this indirection tsc still
// pulls `regression-harness-lambda-local.ts` (and its `@hyperframes/aws-lambda`
// imports) into the program even though the tsconfig `exclude` list
// nominally hides it. `tsx` resolves the path normally at runtime.
import type { RunLambdaLocalRender } from "./regression-harness-lambda-local-types.js";
import type { DistributedFormat } from "./services/distributed/shared.js";

const LAMBDA_LOCAL_MODULE = "./regression-harness-lambda-local.js";

async function loadLambdaLocalRender(): Promise<RunLambdaLocalRender> {
  const mod = (await import(LAMBDA_LOCAL_MODULE)) as {
    runLambdaLocalRender: RunLambdaLocalRender;
  };
  return mod.runLambdaLocalRender;
}

// ── Types ────────────────────────────────────────────────────────────────────

type TestMetadata = {
  name: string;
  description: string;
  tags: string[];
  minPsnr: number;
  maxFrameFailures: number;
  minAudioCorrelation: number;
  maxAudioLagWindows: number;
  /**
   * Optional residual-RMS check. Subtracts the rendered audio from the
   * baseline and reads the residual Overall RMS via `astats`. A value
   * of `-50` treats residuals at-or-below -50 dBFS as effectively-
   * silent — i.e. the streams are sample-level equivalent. Omit
   * (undefined) to skip the check; fixtures authored before this field
   * was introduced have implicit `undefined`.
   */
  maxAudioResidualRmsDb?: number;
  renderConfig: {
    /**
     * Frame rate. Stored on disk as a JSON number (integer fps, e.g. `30`)
     * for legacy meta.json files, or a JSON string (`"30000/1001"` for NTSC)
     * for rationals. The metadata validator normalizes both into an `Fps`
     * rational at load time so downstream code only sees the structured form.
     */
    fps: import("@hyperframes/core").Fps;
    /**
     * Output container. Defaults to `"mp4"`. `"png-sequence"` makes the
     * rendered output a directory of zero-padded RGBA PNGs instead of a
     * single video file — the harness branches its comparison logic
     * accordingly (per-frame byte equality instead of PSNR). `"mov"` and
     * `"webm"` are encoded video containers that share the PSNR path with
     * `"mp4"`. Distributed mode supports all four — webm goes through
     * libvpx-vp9 with closed-GOP concat-copy.
     */
    format?: DistributedFormat;
    /**
     * Codec selection for `format: "mp4"`, forwarded to
     * `DistributedRenderConfig.codec`. The in-process renderer doesn't take
     * a codec hint — for the baseline it always picks the format's default
     * (h264 for mp4 SDR), so `codec: "h265"` is exercised exclusively in
     * `--mode=distributed-simulated`. The PSNR comparison against the
     * baseline therefore measures "h265 chunked + concat" ≈ "h264 single-
     * pass" rather than byte equality. Fixtures asserting a tighter
     * contract should explicitly pin a higher `minPsnr`.
     */
    codec?: "h264" | "h265";
    workers?: number; // Optional: auto-calculates if omitted
    /** Force HDR in the harness; omitted/false preserves historical SDR-only test behavior. */
    hdr?: boolean;
    /**
     * Render this suite with the experimental fast-capture path
     * (drawElementImage, `--experimental-fast-capture`). The golden must be
     * regenerated with the flag on. Used by the `fast-capture` regression
     * guard; omit for the default screenshot/BeginFrame capture.
     */
    experimentalFastCapture?: boolean;
    /**
     * Pin the browser capture path for a regression fixture. The producer's
     * software-GPU default normally prefers screenshots, so BeginFrame-only
     * compositor regressions must opt out explicitly to exercise that path.
     */
    captureMode?: "screenshot" | "beginframe";
    /**
     * Render-time variable overrides, equivalent to `hyperframes render
     * --variables '<json>'`. Injected as `window.__hfVariables` before any
     * page script runs so the runtime helper `getVariables()` returns the
     * merged result of declared defaults (`data-composition-variables`)
     * and these overrides. Omit when the test doesn't exercise variables.
     */
    variables?: Record<string, unknown>;
    /**
     * Chunk size in frames for `--mode=distributed-simulated`. Forwarded
     * to `DistributedRenderConfig.chunkSize`. Ignored in `--mode=in-process`.
     * Default is the plan's own default (240 frames).
     */
    chunkSize?: number;
    /**
     * Cap on parallel chunks for `--mode=distributed-simulated`. Forwarded
     * to `DistributedRenderConfig.maxParallelChunks`. Ignored in
     * `--mode=in-process`. Default is the plan's own default (16).
     */
    maxParallelChunks?: number;
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
  /**
   * Which render path to exercise. `in-process` (default) calls
   * `executeRenderJob`; `distributed-simulated` calls
   * `plan() → renderChunk() × N → assemble()` from
   * `@hyperframes/producer/distributed`. See
   * `regression-harness-distributed.ts`.
   */
  mode: HarnessMode;
};

type TestResult = {
  suite: TestSuite;
  passed: boolean;
  /**
   * Set when `--mode=distributed-simulated` skips a fixture that the
   * distributed pipeline can't run (HDR, NTSC fps, fps∉{24,30,60}).
   * `passed` is `true` for skipped fixtures — skipping is a clean outcome,
   * not a failure — but the summary distinguishes them.
   */
  skipped?: { reason: string };
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
    /**
     * Residual Overall RMS (dBFS) of `rendered - snapshot`. Present only
     * when the fixture opts in via `meta.maxAudioResidualRmsDb`.
     * `Number.NEGATIVE_INFINITY` ⇒ perfect cancellation. `NaN` ⇒ residual
     * check could not run (missing ffmpeg, duration mismatch, ...); see
     * `audio.residualError` for the reason.
     */
    residualRmsDb?: number;
    residualError?: string;
  };
  streamDurationParity?: {
    passed: boolean;
    videoDurationSeconds: number;
    audioDurationSeconds: number;
    driftSeconds: number;
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

/**
 * Format the residual-RMS suffix used in the audio-quality log line.
 *
 * Three states must surface distinctly:
 *   • `null`            → fixture didn't opt into residual RMS         → "" (no suffix)
 *   • `NaN`             → check ran but produced no parseable reading  → "(error: ...)"
 *   • `-Infinity`       → perfect cancellation (identical streams)     → "-inf dBFS"
 *   • finite number     → measured residual                            → "<value> dBFS"
 *
 * Pre-fix this branched on `Number.isFinite()` only, collapsing NaN
 * (a real-failure signal) into the `-inf` label (a perfect-match signal).
 */
function formatResidualSuffix(residualRmsDb: number | null, error: string | undefined): string {
  if (residualRmsDb === null && !error) return "";
  if (error) return `, residualRMS: error (${error})`;
  if (residualRmsDb === null || Number.isNaN(residualRmsDb)) {
    return ", residualRMS: error (no parseable reading)";
  }
  if (!Number.isFinite(residualRmsDb)) return ", residualRMS: -inf dBFS";
  return `, residualRMS: ${residualRmsDb.toFixed(2)} dBFS`;
}

// Exported for unit testing (pinning `--exclude-tags` comma-parsing so the
// values baked into `Dockerfile.test` and `packages/producer/package.json`
// scripts keep matching the parser's contract).
export function parseArgs(argv: string[]): CliOptions {
  const testNames: string[] = [];
  const excludeTags: string[] = [];
  let update = false;
  let sequential = false;
  let keepTemp = false;
  let mode: HarnessMode = "in-process";

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
    } else {
      const parsedMode = parseHarnessModeFlag(token);
      if (parsedMode !== null) {
        mode = parsedMode;
      } else if (!token.startsWith("--")) {
        testNames.push(token);
      }
    }
  }

  if (update && (mode === "distributed-simulated" || mode === "lambda-local")) {
    // The in-process renderer is the source of truth for golden baselines —
    // the other two modes verify the contract against the same baseline,
    // not author their own. Surfacing this at parse time saves a multi-
    // minute render before the user notices.
    throw new Error(
      `regression-harness: --update is incompatible with --mode=${mode}. ` +
        "Generate baselines with the in-process renderer (the default mode), then re-run " +
        "without --update to verify both modes match.",
    );
  }

  return { testNames, excludeTags, update, sequential, keepTemp, mode };
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
  if (
    m.maxAudioResidualRmsDb !== undefined &&
    (typeof m.maxAudioResidualRmsDb !== "number" || !Number.isFinite(m.maxAudioResidualRmsDb))
  ) {
    throw new Error("meta.json: 'maxAudioResidualRmsDb' must be a finite number when present");
  }
  if (!m.renderConfig || typeof m.renderConfig !== "object") {
    throw new Error("meta.json: 'renderConfig' must be an object");
  }
  const rc = m.renderConfig as Record<string, unknown>;
  // Accept either a JSON number (integer fps, e.g. 30) or a JSON string
  // (ffmpeg-style rational, e.g. "30000/1001"). Normalize both into the Fps
  // rational shape and write it back onto the metadata object so all
  // downstream callers can assume the structured form.
  const fpsRaw = rc.fps;
  const fpsParse =
    typeof fpsRaw === "number" || typeof fpsRaw === "string"
      ? parseFps(fpsRaw)
      : ({ ok: false, reason: "not-a-number" } as const);
  if (!fpsParse.ok) {
    throw new Error(
      `meta.json: 'renderConfig.fps' must be an integer (e.g. 30) or rational string (e.g. "30000/1001"); got ${JSON.stringify(
        fpsRaw,
      )}`,
    );
  }
  rc.fps = fpsParse.value;
  if (
    rc.format !== undefined &&
    rc.format !== "mp4" &&
    rc.format !== "webm" &&
    rc.format !== "mov" &&
    rc.format !== "png-sequence"
  ) {
    throw new Error(
      "meta.json: 'renderConfig.format' must be 'mp4', 'webm', 'mov', or 'png-sequence' (or omit for mp4)",
    );
  }
  if (rc.codec !== undefined && rc.codec !== "h264" && rc.codec !== "h265") {
    throw new Error(
      "meta.json: 'renderConfig.codec' must be 'h264' or 'h265' (or omit for the format's default)",
    );
  }
  // Normalize the implicit default before comparing so a fixture that
  // omits `format` (which defaults to "mp4" everywhere downstream) doesn't
  // get accidentally treated as "format is missing, so codec is illegal."
  // The previous formulation `rc.format !== undefined && rc.format !== "mp4"`
  // worked but relied on the reader knowing the default; this reads the
  // intent more directly.
  const effectiveFormat = (rc.format as string | undefined) ?? "mp4";
  if (rc.codec !== undefined && effectiveFormat !== "mp4") {
    throw new Error(
      `meta.json: 'renderConfig.codec' is only valid for format='mp4' (got format=${JSON.stringify(
        rc.format,
      )})`,
    );
  }
  if (rc.workers !== undefined) {
    if (typeof rc.workers !== "number" || rc.workers < 1) {
      throw new Error("meta.json: 'renderConfig.workers' must be >= 1 (or omit to auto-calculate)");
    }
  }
  if (rc.hdr !== undefined && typeof rc.hdr !== "boolean") {
    throw new Error("meta.json: 'renderConfig.hdr' must be a boolean (or omit for false)");
  }
  if (rc.experimentalFastCapture !== undefined && typeof rc.experimentalFastCapture !== "boolean") {
    throw new Error(
      "meta.json: 'renderConfig.experimentalFastCapture' must be a boolean (or omit for false)",
    );
  }
  if (
    rc.captureMode !== undefined &&
    rc.captureMode !== "screenshot" &&
    rc.captureMode !== "beginframe"
  ) {
    throw new Error(
      "meta.json: 'renderConfig.captureMode' must be 'screenshot' or 'beginframe' (or omitted)",
    );
  }
  if (
    rc.variables !== undefined &&
    (rc.variables === null || typeof rc.variables !== "object" || Array.isArray(rc.variables))
  ) {
    throw new Error("meta.json: 'renderConfig.variables' must be a JSON object (or omitted)");
  }
  if (rc.chunkSize !== undefined) {
    if (!Number.isInteger(rc.chunkSize) || (rc.chunkSize as number) < 1) {
      throw new Error(
        "meta.json: 'renderConfig.chunkSize' must be a positive integer (or omitted)",
      );
    }
  }
  if (rc.maxParallelChunks !== undefined) {
    if (!Number.isInteger(rc.maxParallelChunks) || (rc.maxParallelChunks as number) < 1) {
      throw new Error(
        "meta.json: 'renderConfig.maxParallelChunks' must be a positive integer (or omitted)",
      );
    }
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

  const suites: TestSuite[] = [];

  // Validate + push a single candidate fixture directory. Logs the reason
  // and returns silently if the directory doesn't look like a fixture, so
  // callers can blindly hand over every candidate.
  const tryAddSuite = (id: string, dir: string): void => {
    if (filterNames.length > 0 && !filterNames.includes(id)) return;

    const srcDir = join(dir, "src");
    const metaPath = join(dir, "meta.json");

    if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) {
      console.warn(`⚠️  Skipping ${id}: missing src/ directory`);
      return;
    }
    if (!existsSync(join(srcDir, "index.html"))) {
      console.warn(`⚠️  Skipping ${id}: missing src/index.html`);
      return;
    }
    if (!existsSync(metaPath)) {
      console.warn(`⚠️  Skipping ${id}: missing meta.json`);
      return;
    }

    let meta: TestMetadata;
    try {
      const metaRaw = JSON.parse(readFileSync(metaPath, "utf-8"));
      meta = validateMetadata(metaRaw);
    } catch (error) {
      console.warn(
        `⚠️  Skipping ${id}: invalid meta.json - ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    if (excludeTags.length > 0 && meta.tags.some((t) => excludeTags.includes(t))) {
      logPretty(
        `Skipping ${id}: excluded by tags [${meta.tags.filter((t) => excludeTags.includes(t)).join(", ")}]`,
        "⏭️",
      );
      return;
    }

    suites.push({ id, dir, srcDir, meta });
  };

  for (const entry of readdirSync(testsDir)) {
    const dir = join(testsDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    if (entry === "node_modules" || entry.startsWith(".")) continue;

    // `tests/distributed/<name>/` holds fixtures authored for the
    // distributed pipeline. Recurse one level deeper so each `<name>`
    // becomes a first-class fixture ID the user can target on the CLI
    // without a namespace prefix.
    if (entry === "distributed") {
      for (const sub of readdirSync(dir)) {
        const subDir = join(dir, sub);
        if (!statSync(subDir).isDirectory()) continue;
        if (sub === "node_modules" || sub.startsWith(".")) continue;
        tryAddSuite(sub, subDir);
      }
      continue;
    }

    tryAddSuite(entry, dir);
  }

  // CLI filter, failures/ output, baselines, and the suite summary all key
  // off `suite.id`. If a future fixture lands at `tests/distributed/<x>/`
  // while a top-level `tests/<x>/` already exists they would silently
  // collide: both pushed with the same `id`, both running under one name,
  // and the second to write `failures/` overwrites the first. Fail fast
  // here naming both source dirs so the conflict is fixable at author time.
  const seen = new Map<string, string>();
  for (const suite of suites) {
    const prior = seen.get(suite.id);
    if (prior !== undefined) {
      throw new Error(
        `[regression-harness] duplicate fixture id ${JSON.stringify(suite.id)}: ` +
          `${prior} and ${suite.dir}. Rename one of the directories so the CLI ` +
          `--filter, failures/ output, and summary key onto a single suite.`,
      );
    }
    seen.set(suite.id, suite.dir);
  }

  return suites;
}

function copyFixtureSupportFiles(suite: TestSuite, tempRoot: string): void {
  const excluded = new Set(["src", "output", "meta.json", "failures"]);
  for (const entry of readdirSync(suite.dir)) {
    if (excluded.has(entry)) continue;
    cpSync(join(suite.dir, entry), join(tempRoot, entry), { recursive: true });
  }
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
  effectiveMinPsnr: number,
  compiledHtml?: string,
  snapshotHtml?: string,
): void {
  const failuresDir = join(suite.dir, "failures");
  mkdirSync(failuresDir, { recursive: true });

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
        threshold: effectiveMinPsnr,
        fixtureThreshold: suite.meta.minPsnr,
      },
      failedFrames: failedCheckpoints.map((c) => ({
        time: c.time,
        psnr: c.psnr,
        belowThresholdBy: effectiveMinPsnr - c.psnr,
      })),
    };

    writeFileSync(
      join(failuresDir, "visual-failures.json"),
      JSON.stringify(visualReport, null, 2),
      "utf-8",
    );

    // Extract images for first 10 failed frames. png-sequence outputs are
    // already directories of PNGs — copy the failing frames directly instead
    // of running ffmpeg's PSNR frame-selector on a directory (which would
    // throw "Invalid data found when processing input").
    const framesToExtract = failedCheckpoints.slice(0, 10);
    if (framesToExtract.length > 0) {
      const framesDir = join(failuresDir, "frames");
      mkdirSync(framesDir, { recursive: true });

      const renderedIsDir =
        existsSync(renderedVideoPath) && statSync(renderedVideoPath).isDirectory();
      logPretty(`Extracting ${framesToExtract.length} failed frames...`, "📸");

      // For directory output, sort both frame lists once — they're static for
      // the duration of the failure-extraction loop, so the per-checkpoint
      // readdir+filter+sort the loop did before was wasted syscalls.
      const renderedDirFrames = renderedIsDir
        ? readdirSync(renderedVideoPath)
            .filter((n) => n.toLowerCase().endsWith(".png"))
            .sort()
        : null;
      const snapshotDirFrames = renderedIsDir
        ? readdirSync(snapshotVideoPath)
            .filter((n) => n.toLowerCase().endsWith(".png"))
            .sort()
        : null;

      for (const checkpoint of framesToExtract) {
        const timeStr = checkpoint.time.toFixed(2).replace(".", "_");
        try {
          if (renderedDirFrames && snapshotDirFrames) {
            const frameIndex = Math.max(
              0,
              Math.round(checkpoint.time * fpsToNumber(suite.meta.renderConfig.fps)),
            );
            const renderedFrame = renderedDirFrames[frameIndex];
            const snapshotFrame = snapshotDirFrames[frameIndex];
            if (renderedFrame !== undefined) {
              copyFileSync(
                join(renderedVideoPath, renderedFrame),
                join(framesDir, `actual_${timeStr}s.png`),
              );
            }
            if (snapshotFrame !== undefined) {
              copyFileSync(
                join(snapshotVideoPath, snapshotFrame),
                join(framesDir, `expected_${timeStr}s.png`),
              );
            }
          } else {
            extractFrameAsImage(
              renderedVideoPath,
              checkpoint.time,
              join(framesDir, `actual_${timeStr}s.png`),
              fpsToNumber(suite.meta.renderConfig.fps),
            );
            extractFrameAsImage(
              snapshotVideoPath,
              checkpoint.time,
              join(framesDir, `expected_${timeStr}s.png`),
              fpsToNumber(suite.meta.renderConfig.fps),
            );
          }
        } catch {
          logPretty(`  Warning: Could not extract frame at ${checkpoint.time}s`, "⚠️");
        }
      }
    }

    logPretty(`Saved visual failure details to ${failuresDir}/`, "💾");
  }

  // Save audio failures
  if (result.audio && !result.audio.passed) {
    const residualRmsDb = result.audio.residualRmsDb;
    const residualError = result.audio.residualError;
    const residualThreshold = suite.meta.maxAudioResidualRmsDb;
    const residualExceeds =
      residualThreshold !== undefined &&
      typeof residualRmsDb === "number" &&
      Number.isFinite(residualRmsDb) &&
      residualRmsDb > residualThreshold;
    const audioReport = {
      summary: {
        correlation: result.audio.correlation,
        lagWindows: result.audio.lagWindows,
        threshold: suite.meta.minAudioCorrelation,
        maxLagWindows: suite.meta.maxAudioLagWindows,
        ...(residualRmsDb !== undefined ? { residualRmsDb } : {}),
        ...(residualThreshold !== undefined ? { residualThreshold } : {}),
        ...(residualError ? { residualError } : {}),
      },
      analysis: {
        correlationBelowThreshold: result.audio.correlation < suite.meta.minAudioCorrelation,
        lagExceedsLimit: Math.abs(result.audio.lagWindows) > suite.meta.maxAudioLagWindows,
        residualExceedsThreshold: residualExceeds,
        residualCheckFailed: residualError !== undefined,
      },
    };

    writeFileSync(
      join(failuresDir, "audio-failures.json"),
      JSON.stringify(audioReport, null, 2),
      "utf-8",
    );

    logPretty(`Saved audio failure details to ${failuresDir}/`, "💾");
  }

  // Save stream duration parity failures
  if (result.streamDurationParity && !result.streamDurationParity.passed) {
    writeFileSync(
      join(failuresDir, "stream-parity-failure.json"),
      JSON.stringify(result.streamDurationParity, null, 2),
      "utf-8",
    );
    logPretty(`Saved stream duration parity failure to ${failuresDir}/`, "💾");
  }
}

// ── Stream Duration Parity ──────────────────────────────────────────────────

export const MAX_STREAM_DRIFT_SECONDS = 0.5;

export type StreamDurationParity = {
  passed: boolean;
  videoDurationSeconds: number;
  audioDurationSeconds: number;
  driftSeconds: number;
};

export async function checkStreamDurationParity(
  videoPath: string,
): Promise<StreamDurationParity | null> {
  const meta = await extractMediaMetadata(videoPath);
  if (!meta.hasAudio) return null;
  // Read the audio stream's own duration rather than the container's
  // format.duration. extractAudioMetadata returns format.duration which
  // collapses to the same value as videoStreamDurationSeconds when the
  // fallback fires — making the check a tautology on broken muxes where
  // both streams are truncated in sync.
  const audioMeta = await extractAudioMetadata(videoPath);
  const videoDur = meta.videoStreamDurationSeconds;
  const audioDur = audioMeta.streamDurationSeconds ?? audioMeta.durationSeconds;
  const drift = Math.abs(videoDur - audioDur);
  return {
    passed: drift <= MAX_STREAM_DRIFT_SECONDS,
    videoDurationSeconds: videoDur,
    audioDurationSeconds: audioDur,
    driftSeconds: drift,
  };
}

// ── Test Execution ───────────────────────────────────────────────────────────

async function runTestSuite(
  suite: TestSuite,
  options: {
    update: boolean;
    keepTemp: boolean;
    mode: HarnessMode;
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
  const isPngSequence = outputFormat === "png-sequence";
  // png-sequence output is a directory (basename = "frames"); encoded video
  // formats produce a single file (basename = "output.<ext>"). One lookup
  // covers both shapes for the in-temp render and the on-disk baseline.
  // `VIDEO_EXT` is intentionally typed against only the encoded-video set —
  // the `isPngSequence` ternary below short-circuits before `outputFormat`
  // can be `"png-sequence"`, but TS can't narrow through that, so we
  // assert the narrowing at the indexing site rather than over-widening
  // the lookup table.
  const VIDEO_EXT: Record<"mp4" | "mov" | "webm", string> = {
    mp4: ".mp4",
    mov: ".mov",
    webm: ".webm",
  };
  const outputBasename = isPngSequence
    ? "frames"
    : `output${VIDEO_EXT[outputFormat as "mp4" | "mov" | "webm"]}`;
  const renderedOutputPath = join(tempRoot, outputBasename);

  // Snapshot files stored in test's output/ directory. For png-sequence the
  // baseline lives at `output/frames/<frame-N>.png`; for video formats it's
  // a single `output/output.<ext>` file.
  const snapshotDir = join(suite.dir, "output");
  const snapshotCompiledPath = join(snapshotDir, "compiled.html");
  const snapshotVideoPath = join(snapshotDir, outputBasename);

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
    console.log(JSON.stringify({ event: "rendering_start", suite: suite.id, mode: options.mode }));
    logPretty(`Rendering video (mode=${options.mode})...`, "🎬");

    const tempSrcDir = join(tempRoot, "src");
    copyFixtureSupportFiles(suite, tempRoot);
    cpSync(suite.srcDir, tempSrcDir, { recursive: true });

    if (options.mode === "distributed-simulated" || options.mode === "lambda-local") {
      const support = checkDistributedSupport(suite.meta.renderConfig);
      if (!support.supported) {
        // Skipping is a clean outcome — the distributed pipeline (which
        // both modes go through) can't run this fixture, but in-process
        // mode already covers it. Mark passed so the suite summary
        // doesn't trip CI; the `skipped` field is what distinguishes a
        // real pass from a skip.
        console.log(
          JSON.stringify({
            event: "test_skipped",
            suite: suite.id,
            mode: options.mode,
            reason: support.reason,
          }),
        );
        logPretty(`Skipping ${suite.meta.name} (mode=${options.mode}): ${support.reason}`, "⏭️");
        result.passed = true;
        result.skipped = { reason: support.reason };
        return result;
      }
      // `checkDistributedSupport` already narrowed fps to {24,30,60}; the
      // cast surfaces that guarantee to TS. webm is now distributed-
      // supported via closed-GOP concat-copy, so the format passes through.
      const fpsNum = suite.meta.renderConfig.fps.num as 24 | 30 | 60;
      const distributedInput = {
        projectDir: tempSrcDir,
        tempRoot,
        renderedOutputPath,
        fps: fpsNum,
        format: outputFormat,
        codec: suite.meta.renderConfig.codec,
        chunkSize: suite.meta.renderConfig.chunkSize,
        maxParallelChunks: suite.meta.renderConfig.maxParallelChunks,
        variables: suite.meta.renderConfig.variables,
      };
      if (options.mode === "lambda-local") {
        const runLambdaLocalRender = await loadLambdaLocalRender();
        // The fixture's authored dimensions live in the composition's
        // `data-width`/`data-height` attributes, not in `meta.json`'s
        // renderConfig. Until the harness compiles the HTML up-front
        // to surface them here, pass 1920×1080 — the same placeholder
        // `runDistributedSimulatedRender` uses internally. The
        // composition attrs override at plan time.
        await runLambdaLocalRender({ ...distributedInput, width: 1920, height: 1080 });
      } else {
        await runDistributedSimulatedRender(distributedInput);
      }
    } else {
      // Opt-in fast capture (drawElementImage): drives resolveConfig via the env
      // var, scoped to this suite's render so it never leaks to other suites.
      const useFast = suite.meta.renderConfig.experimentalFastCapture === true;
      const prevFast = process.env.PRODUCER_EXPERIMENTAL_FAST_CAPTURE;
      const captureMode = suite.meta.renderConfig.captureMode;
      const prevForceScreenshot = process.env.PRODUCER_FORCE_SCREENSHOT;
      if (useFast) process.env.PRODUCER_EXPERIMENTAL_FAST_CAPTURE = "true";
      if (captureMode) {
        process.env.PRODUCER_FORCE_SCREENSHOT = captureMode === "screenshot" ? "true" : "false";
      }
      try {
        const job = createRenderJob({
          fps: suite.meta.renderConfig.fps,
          quality: "high", // Always use max quality for tests
          format: outputFormat,
          workers: suite.meta.renderConfig.workers,
          useGpu: false,
          debug: false,
          hdrMode: suite.meta.renderConfig.hdr ? "force-hdr" : "force-sdr",
          variables: suite.meta.renderConfig.variables,
        });

        await executeRenderJob(job, tempSrcDir, renderedOutputPath);
      } finally {
        if (useFast) {
          if (prevFast === undefined) delete process.env.PRODUCER_EXPERIMENTAL_FAST_CAPTURE;
          else process.env.PRODUCER_EXPERIMENTAL_FAST_CAPTURE = prevFast;
        }
        if (captureMode) {
          if (prevForceScreenshot === undefined) delete process.env.PRODUCER_FORCE_SCREENSHOT;
          else process.env.PRODUCER_FORCE_SCREENSHOT = prevForceScreenshot;
        }
      }
    }

    console.log(JSON.stringify({ event: "rendering_complete", suite: suite.id }));
    logPretty("Render complete! Starting quality validation...", "✓");

    // Update mode: save snapshot and pass
    if (options.update) {
      if (!existsSync(snapshotDir)) {
        mkdirSync(snapshotDir, { recursive: true });
      }
      if (isPngSequence) {
        // Frames directory — recursive copy so every PNG lands at
        // `<snapshotDir>/frames/<frame-N>.png`. `rmSync(..., force: true)`
        // tolerates a missing path, so the prior existsSync gate was redundant.
        rmSync(snapshotVideoPath, { recursive: true, force: true });
        cpSync(renderedOutputPath, snapshotVideoPath, { recursive: true });
      } else {
        copyFileSync(renderedOutputPath, snapshotVideoPath);
      }
      console.log(
        JSON.stringify({
          event: "snapshot_updated",
          suite: suite.id,
          file: `output/${outputBasename}`,
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

    if (!isPngSequence) {
      const parity = await checkStreamDurationParity(renderedOutputPath);
      if (parity) {
        result.streamDurationParity = parity;
        if (parity.passed) {
          logPretty(
            `Stream duration parity: PASSED (video: ${parity.videoDurationSeconds.toFixed(2)}s, audio: ${parity.audioDurationSeconds.toFixed(2)}s, drift: ${parity.driftSeconds.toFixed(3)}s)`,
            "✓",
          );
        } else {
          logPretty(
            `Stream duration parity: FAILED (video: ${parity.videoDurationSeconds.toFixed(2)}s, audio: ${parity.audioDurationSeconds.toFixed(2)}s, drift: ${parity.driftSeconds.toFixed(3)}s > ${MAX_STREAM_DRIFT_SECONDS}s)`,
            "✗",
          );
        }
      }
    }

    let visualPassed: boolean;
    let failedFrames: number;
    const visualCheckpoints: Array<{ time: number; psnr: number; passed: boolean }> = [];
    if (isPngSequence) {
      // png-sequence visual comparison: byte-equal per frame. The renderer's
      // png output is the raw RGBA Chrome captured, with libpng deflate
      // applied — byte-identical pixels round-trip to byte-identical files.
      // Comparing whole-file SHA-256 catches both pixel drift and any
      // metadata-chunk reorder that would also be a regression.
      logPretty("Comparing png-sequence frames...", "🔍");
      const renderedFrames = readdirSync(renderedOutputPath)
        .filter((name) => name.toLowerCase().endsWith(".png"))
        .sort();
      const snapshotFrames = readdirSync(snapshotVideoPath)
        .filter((name) => name.toLowerCase().endsWith(".png"))
        .sort();
      if (renderedFrames.length !== snapshotFrames.length) {
        logPretty(
          `Frame count mismatch: rendered=${renderedFrames.length}, snapshot=${snapshotFrames.length}`,
          "✗",
        );
        result.visual = {
          passed: false,
          failedFrames: Math.abs(renderedFrames.length - snapshotFrames.length),
          checkpoints: [],
        };
        result.audio = { passed: true, correlation: 1, lagWindows: 0 };
        result.passed = false;
        return result;
      }
      failedFrames = 0;
      const fpsForLog = fpsToNumber(suite.meta.renderConfig.fps);
      for (let i = 0; i < renderedFrames.length; i++) {
        const renderedFrameName = renderedFrames[i];
        const snapshotFrameName = snapshotFrames[i];
        // Defensive: TypeScript's strict-mode index returns `string | undefined`
        // even though we just length-checked. Skip with a failure if the
        // filename ever comes back undefined.
        if (renderedFrameName === undefined || snapshotFrameName === undefined) {
          failedFrames++;
          continue;
        }
        const renderedBytes = readFileSync(join(renderedOutputPath, renderedFrameName));
        const snapshotBytes = readFileSync(join(snapshotVideoPath, snapshotFrameName));
        const equal =
          renderedFrameName === snapshotFrameName &&
          renderedBytes.byteLength === snapshotBytes.byteLength &&
          renderedBytes.equals(snapshotBytes);
        visualCheckpoints.push({
          time: i / fpsForLog,
          // PSNR is Infinity for byte-identical frames, 0 otherwise. The
          // existing summary code interprets psnr >= threshold as "passed"
          // and JSON-serializes Infinity as null; both render correctly.
          psnr: equal ? Number.POSITIVE_INFINITY : 0,
          passed: equal,
        });
        if (!equal) failedFrames++;
        if ((i + 1) % 20 === 0) {
          logPretty(`  Progress: ${i + 1}/${renderedFrames.length} frames`, "  ");
        }
      }
      visualPassed = failedFrames <= suite.meta.maxFrameFailures;
    } else {
      // Visual comparison (100 frames, 1 per 1% of video duration)
      logPretty("Comparing visual quality (100 checkpoints)...", "🔍");
      const videoMetadata = await extractMediaMetadata(renderedOutputPath);
      const snapshotMetadata = await extractMediaMetadata(snapshotVideoPath);
      const videoDuration = Math.min(
        videoMetadata.videoStreamDurationSeconds,
        snapshotMetadata.videoStreamDurationSeconds,
      );
      const fps = fpsToNumber(suite.meta.renderConfig.fps);
      const sampleDuration = Math.max(0, videoDuration - 1 / fps);

      const minPsnrForMode = resolveMinPsnrForMode(options.mode, suite.meta.minPsnr);
      for (let i = 0; i < 100; i++) {
        const time = (sampleDuration * i) / 100;
        const psnr = psnrAtCheckpoint(renderedOutputPath, snapshotVideoPath, time, fps);
        visualCheckpoints.push({
          time,
          psnr,
          passed: psnr >= minPsnrForMode,
        });

        // Progress indicator every 20 checkpoints
        if ((i + 1) % 20 === 0) {
          logPretty(`  Progress: ${i + 1}/100 checkpoints`, "  ");
        }
      }

      failedFrames = visualCheckpoints.filter((c) => !c.passed).length;
      visualPassed = failedFrames <= suite.meta.maxFrameFailures;
    }

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

    // Audio comparison. png-sequence outputs are frame directories with no
    // audio channel — there's nothing to compare, so we report pass and
    // skip the envelope correlation entirely.
    let audioPassed = true;
    let audioCorrelation = 1;
    let audioLagWindows = 0;
    let audioResidualRmsDb: number | null = null;
    let audioResidualError: string | undefined;

    if (!isPngSequence) {
      logPretty("Comparing audio quality...", "🔊");
      const renderedAudio = extractMonoPcm16(renderedOutputPath);
      const snapshotAudio = extractMonoPcm16(snapshotVideoPath);

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

        // Sample-level residual-RMS check (complementary to the
        // envelope-correlation gate above). Only runs when the fixture
        // opts in via `maxAudioResidualRmsDb`; the correlation gate
        // stays in place either way for legacy fixtures. Correlation
        // measures shape similarity at envelope granularity; residual
        // RMS measures sample-level cancellation — both surface
        // different drift classes.
        if (suite.meta.maxAudioResidualRmsDb !== undefined) {
          const residual = computeAudioResidualRmsDb(
            renderedOutputPath,
            snapshotVideoPath,
            suite.meta.maxAudioResidualRmsDb,
          );
          audioResidualRmsDb = residual.overallDb;
          audioResidualError = residual.error;
          if (!residual.ok) {
            audioPassed = false;
          }
        }
      }
    }

    result.audio = {
      passed: audioPassed,
      correlation: audioCorrelation,
      lagWindows: audioLagWindows,
      ...(audioResidualRmsDb !== null ? { residualRmsDb: audioResidualRmsDb } : {}),
      ...(audioResidualError ? { residualError: audioResidualError } : {}),
    };

    console.log(
      JSON.stringify({
        event: "audio_comparison_complete",
        suite: suite.id,
        passed: audioPassed,
        correlation: audioCorrelation,
        lagWindows: audioLagWindows,
        residualRmsDb: audioResidualRmsDb,
        residualError: audioResidualError,
      }),
    );

    const residualSuffix = formatResidualSuffix(audioResidualRmsDb, audioResidualError);
    if (audioPassed) {
      logPretty(
        `Audio quality: PASSED (correlation: ${audioCorrelation.toFixed(3)}, lag: ${audioLagWindows}${residualSuffix})`,
        "✓",
      );
    } else {
      logPretty(
        `Audio quality: FAILED (correlation: ${audioCorrelation.toFixed(3)}, threshold: ${suite.meta.minAudioCorrelation}${residualSuffix})`,
        "✗",
      );
    }

    // Overall test passes if all checks passed
    const parityPassed = result.streamDurationParity?.passed ?? true;
    result.passed = result.compilation!.passed && visualPassed && audioPassed && parityPassed;
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
          resolveMinPsnrForMode(options.mode, suite.meta.minPsnr),
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
      mode: options.mode,
    }),
  );

  logPretty(
    `Starting ${suites.length} test suite(s) - ${options.sequential ? "sequential" : "parallel"} mode, ` +
      `harness mode=${options.mode}`,
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
    const skipped = results.filter((r) => r.skipped).length;
    const passed = results.filter((r) => r.passed && !r.skipped).length;
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
        skipped,
        mode: options.mode,
        failedAtCompilation,
        failedAtVisual,
        failedAtAudio,
        results: results.map((r) => ({
          suite: r.suite.id,
          name: r.suite.meta.name,
          passed: r.passed,
          skipped: r.skipped?.reason,
          compilation: r.compilation?.passed,
          visual: r.visual?.passed,
          audio: r.audio?.passed,
        })),
      }),
    );

    // Pretty summary
    logPretty("═══════════════════════════════════════", "");
    logPretty(`Test Suite Summary (mode=${options.mode})`, "📊");
    logPretty(
      `Total: ${results.length} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`,
      "",
    );
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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void run().catch((error) => {
    console.error(
      JSON.stringify({
        event: "test_suite_fatal",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  });
}
