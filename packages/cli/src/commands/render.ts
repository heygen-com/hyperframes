import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";

export const examples: Example[] = [
  ["Render to MP4", "hyperframes render --output output.mp4"],
  ["Render transparent overlay (ProRes)", "hyperframes render --format mov --output overlay.mov"],
  ["Render transparent WebM overlay", "hyperframes render --format webm --output overlay.webm"],
  ["High quality at 60fps", "hyperframes render --fps 60 --quality high --output hd.mp4"],
  ["Deterministic render via Docker", "hyperframes render --docker --output deterministic.mp4"],
  ["Parallel rendering with 6 workers", "hyperframes render --workers 6 --output fast.mp4"],
  ["HDR output (H.265 10-bit)", "hyperframes render --hdr --output hdr-output.mp4"],
];
import { cpus, freemem, tmpdir } from "node:os";
import { resolve, dirname, join, basename } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { resolveProject } from "../utils/project.js";
import { lintProject, shouldBlockRender } from "../utils/lintProject.js";
import { formatLintFindings } from "../utils/lintFormat.js";
import { loadProducer } from "../utils/producer.js";
import { c } from "../ui/colors.js";
import { formatBytes, formatDuration, errorBox } from "../ui/format.js";
import { renderProgress } from "../ui/progress.js";
import { trackRenderComplete, trackRenderError } from "../telemetry/events.js";
import { bytesToMb } from "../telemetry/system.js";
import { VERSION } from "../version.js";
import { isDevMode } from "../utils/env.js";
import { buildDockerRunArgs } from "../utils/dockerRunArgs.js";
import type { RenderJob } from "@hyperframes/producer";

const VALID_FPS = new Set([24, 30, 60]);
const VALID_QUALITY = new Set(["draft", "standard", "high"]);
const VALID_FORMAT = new Set(["mp4", "webm", "mov"]);
const FORMAT_EXT: Record<string, string> = { mp4: ".mp4", webm: ".webm", mov: ".mov" };

const CPU_CORE_COUNT = cpus().length;

/** 3/4 of CPU cores, capped at 8. Each worker spawns a Chrome process (~256 MB). */
function defaultWorkerCount(): number {
  return Math.max(1, Math.min(Math.floor((CPU_CORE_COUNT * 3) / 4), 8));
}

export default defineCommand({
  meta: {
    name: "render",
    description: "Render a composition to MP4, WebM, or MOV",
  },
  args: {
    dir: {
      type: "positional",
      description: "Project directory",
      required: false,
    },
    output: {
      type: "string",
      alias: "o",
      description: "Output path (default: renders/<name>.mp4)",
    },
    fps: {
      type: "string",
      alias: "f",
      description: "Frame rate: 24, 30, 60",
      default: "30",
    },
    quality: {
      type: "string",
      alias: "q",
      description: "Quality: draft, standard, high",
      default: "standard",
    },
    format: {
      type: "string",
      description: "Output format: mp4, webm, mov (MOV/WebM render with transparency)",
      default: "mp4",
    },
    workers: {
      type: "string",
      alias: "w",
      description:
        "Parallel render workers (number or 'auto'). Default: auto. " +
        "Each worker launches a separate Chrome process (~256 MB RAM).",
    },
    docker: {
      type: "boolean",
      description: "Use Docker for deterministic render",
      default: false,
    },
    hdr: {
      type: "boolean",
      description: "Enable HDR: probe sources for PQ/HLG, output H.265 10-bit BT.2020",
      default: false,
    },
    crf: {
      type: "string",
      description: "Override encoder CRF. Mutually exclusive with --video-bitrate.",
    },
    "video-bitrate": {
      type: "string",
      description: "Target video bitrate such as 10M. Mutually exclusive with --crf.",
    },
    gpu: { type: "boolean", description: "Use GPU encoding", default: false },
    quiet: {
      type: "boolean",
      description: "Suppress verbose output",
      default: false,
    },
    strict: {
      type: "boolean",
      description: "Fail render on lint errors",
      default: false,
    },
    "strict-all": {
      type: "boolean",
      description: "Fail render on lint errors AND warnings",
      default: false,
    },
    "max-concurrent-renders": {
      type: "string",
      description: "Max concurrent renders when using the producer server (1-10). Default: 2.",
    },
  },
  async run({ args }) {
    // ── Resolve project ────────────────────────────────────────────────────
    const project = resolveProject(args.dir);

    // ── Validate fps ───────────────────────────────────────────────────────
    const fpsRaw = parseInt(args.fps ?? "30", 10);
    if (!VALID_FPS.has(fpsRaw)) {
      errorBox("Invalid fps", `Got "${args.fps ?? "30"}". Must be 24, 30, or 60.`);
      process.exit(1);
    }
    const fps = fpsRaw as 24 | 30 | 60;

    // ── Validate quality ───────────────────────────────────────────────────
    const qualityRaw = args.quality ?? "standard";
    if (!VALID_QUALITY.has(qualityRaw)) {
      errorBox("Invalid quality", `Got "${qualityRaw}". Must be draft, standard, or high.`);
      process.exit(1);
    }
    const quality = qualityRaw as "draft" | "standard" | "high";

    // ── Validate format ─────────────────────────────────────────────────
    const formatRaw = args.format ?? "mp4";
    if (!VALID_FORMAT.has(formatRaw)) {
      errorBox("Invalid format", `Got "${formatRaw}". Must be mp4, webm, or mov.`);
      process.exit(1);
    }
    const format = formatRaw as "mp4" | "webm" | "mov";

    // ── Validate workers ──────────────────────────────────────────────────
    let workers: number | undefined;
    if (args.workers != null && args.workers !== "auto") {
      const parsed = parseInt(args.workers, 10);
      if (isNaN(parsed) || parsed < 1) {
        errorBox("Invalid workers", `Got "${args.workers}". Must be a positive number or "auto".`);
        process.exit(1);
      }
      workers = parsed;
    }

    // ── Validate max-concurrent-renders ─────────────────────────────────
    if (args["max-concurrent-renders"] != null) {
      const parsed = parseInt(args["max-concurrent-renders"], 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 10) {
        errorBox(
          "Invalid max-concurrent-renders",
          `Got "${args["max-concurrent-renders"]}". Must be a number between 1 and 10.`,
        );
        process.exit(1);
      }
      process.env.PRODUCER_MAX_CONCURRENT_RENDERS = String(parsed);
    }

    // ── Resolve output path ───────────────────────────────────────────────
    const rendersDir = resolve("renders");
    const ext = FORMAT_EXT[format] ?? ".mp4";
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10);
    const timePart = now.toTimeString().slice(0, 8).replace(/:/g, "-");
    const outputPath = args.output
      ? resolve(args.output)
      : join(rendersDir, `${project.name}_${datePart}_${timePart}${ext}`);

    // Ensure output directory exists
    mkdirSync(dirname(outputPath), { recursive: true });

    const useDocker = args.docker ?? false;
    const useGpu = args.gpu ?? false;
    const quiet = args.quiet ?? false;
    const strictAll = args["strict-all"] ?? false;
    const strictErrors = (args.strict ?? false) || strictAll;
    const crfRaw = args.crf;
    const videoBitrate = args["video-bitrate"]?.trim();

    if (crfRaw != null && videoBitrate) {
      errorBox("Conflicting encoder settings", "Use either --crf or --video-bitrate, not both.");
      process.exit(1);
    }

    let crf: number | undefined;
    if (crfRaw != null) {
      const parsed = Number(crfRaw);
      if (!Number.isInteger(parsed) || parsed < 0) {
        errorBox("Invalid crf", `Got "${crfRaw}". Must be a non-negative integer.`);
        process.exit(1);
      }
      crf = parsed;
    }

    if (args["video-bitrate"] != null && !videoBitrate) {
      errorBox(
        "Invalid video-bitrate",
        `Got "${args["video-bitrate"]}". Must be a non-empty bitrate such as "10M".`,
      );
      process.exit(1);
    }

    // ── Print render plan ─────────────────────────────────────────────────
    const workerCount = workers ?? defaultWorkerCount();
    if (!quiet) {
      const workerLabel =
        args.workers != null
          ? `${workerCount} workers`
          : `${workerCount} workers (auto — ${CPU_CORE_COUNT} cores detected)`;
      console.log("");
      console.log(
        c.accent("\u25C6") +
          "  Rendering " +
          c.accent(project.name) +
          c.dim(" \u2192 " + outputPath),
      );
      console.log(c.dim("   " + fps + "fps \u00B7 " + quality + " \u00B7 " + workerLabel));
      console.log("");
    }

    // ── Check FFmpeg for local renders ───────────────────────────────────
    if (!useDocker) {
      const { findFFmpeg, getFFmpegInstallHint } = await import("../browser/ffmpeg.js");
      if (!findFFmpeg()) {
        errorBox(
          "FFmpeg not found",
          "Rendering requires FFmpeg for video encoding.",
          `Install: ${getFFmpegInstallHint()}`,
        );
        process.exit(1);
      }
    }

    // ── Ensure browser for local renders ────────────────────────────────
    let browserPath: string | undefined;
    if (!useDocker) {
      const { ensureBrowser } = await import("../browser/manager.js");
      const clack = await import("@clack/prompts");
      const s = clack.spinner();
      s.start("Checking browser...");
      try {
        const info = await ensureBrowser({
          onProgress: (downloaded, total) => {
            if (total <= 0) return;
            const pct = Math.floor((downloaded / total) * 100);
            s.message(
              `Downloading Chrome... ${c.progress(pct + "%")} ${c.dim("(" + formatBytes(downloaded) + " / " + formatBytes(total) + ")")}`,
            );
          },
        });
        browserPath = info.executablePath;
        s.stop(c.dim(`Browser: ${info.source}`));
      } catch (err: unknown) {
        s.stop(c.error("Browser not available"));
        errorBox(
          "Chrome not found",
          err instanceof Error ? err.message : String(err),
          "Run: npx hyperframes browser ensure",
        );
        process.exit(1);
      }
    }

    // ── Pre-render lint ──────────────────────────────────────────────────
    {
      const lintResult = lintProject(project);
      if (!quiet && (lintResult.totalErrors > 0 || lintResult.totalWarnings > 0)) {
        console.log("");
        for (const line of formatLintFindings(lintResult, { errorsFirst: true })) console.log(line);
        if (
          shouldBlockRender(
            strictErrors,
            strictAll,
            lintResult.totalErrors,
            lintResult.totalWarnings,
          )
        ) {
          const mode = strictAll ? "--strict-all" : "--strict";
          console.log("");
          console.log(c.error(`  Aborting render due to lint issues (${mode} mode).`));
          console.log("");
          process.exit(1);
        }
        console.log(c.dim("  Continuing render despite lint issues. Use --strict to block."));
        console.log("");
      }
    }

    // ── Render ────────────────────────────────────────────────────────────
    if (useDocker) {
      await renderDocker(project.dir, outputPath, {
        fps,
        quality,
        format,
        workers: workerCount,
        gpu: useGpu,
        hdr: args.hdr ?? false,
        crf,
        videoBitrate,
        quiet,
      });
    } else {
      await renderLocal(project.dir, outputPath, {
        fps,
        quality,
        format,
        workers: workerCount,
        gpu: useGpu,
        hdr: args.hdr ?? false,
        crf,
        videoBitrate,
        quiet,
        browserPath,
      });
    }
  },
});

interface RenderOptions {
  fps: 24 | 30 | 60;
  quality: "draft" | "standard" | "high";
  format: "mp4" | "webm" | "mov";
  workers: number;
  gpu: boolean;
  hdr: boolean;
  crf?: number;
  videoBitrate?: string;
  quiet: boolean;
  browserPath?: string;
}

const DOCKER_IMAGE_PREFIX = "hyperframes-renderer";

function dockerImageTag(version: string): string {
  return `${DOCKER_IMAGE_PREFIX}:${version}`;
}

function resolveDockerfilePath(): string {
  // Built CLI: dist/docker/Dockerfile.render
  const builtPath = resolve(__dirname, "docker", "Dockerfile.render");
  // Dev mode: src/docker/Dockerfile.render
  const devPath = resolve(__dirname, "..", "src", "docker", "Dockerfile.render");
  for (const p of [builtPath, devPath]) {
    try {
      statSync(p);
      return p;
    } catch {
      continue;
    }
  }
  throw new Error("Dockerfile.render not found — CLI package may be corrupted");
}

function dockerImageExists(tag: string): boolean {
  try {
    execFileSync("docker", ["image", "inspect", tag], { stdio: "pipe", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function ensureDockerImage(version: string, quiet: boolean): string {
  const tag = dockerImageTag(version);

  if (dockerImageExists(tag)) {
    if (!quiet) console.log(c.dim(`  Docker image: ${tag} (cached)`));
    return tag;
  }

  if (!quiet) console.log(c.dim(`  Building Docker image: ${tag}...`));

  const dockerfilePath = resolveDockerfilePath();

  // Copy Dockerfile to a temp build context so docker build has a clean context
  const tmpDir = join(tmpdir(), `hyperframes-docker-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(join(tmpDir, "Dockerfile"), readFileSync(dockerfilePath));

  // linux/amd64 forced — chrome-headless-shell doesn't ship ARM Linux binaries
  try {
    execFileSync(
      "docker",
      [
        "build",
        "--platform",
        "linux/amd64",
        "--build-arg",
        `HYPERFRAMES_VERSION=${version}`,
        "-t",
        tag,
        tmpDir,
      ],
      { stdio: quiet ? "pipe" : "inherit", timeout: 600_000 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to build Docker image: ${message}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  if (!quiet) console.log(c.dim(`  Docker image: ${tag} (built)`));
  return tag;
}

async function renderDocker(
  projectDir: string,
  outputPath: string,
  options: RenderOptions,
): Promise<void> {
  const startTime = Date.now();

  // Dev mode (tsx/ts-node) uses "latest" since the local version isn't on npm
  const dockerVersion = isDevMode() ? "latest" : VERSION;
  if (!options.quiet && isDevMode()) {
    console.log(c.dim("  Dev mode: using hyperframes@latest in Docker image"));
  }

  let imageTag: string;
  try {
    imageTag = ensureDockerImage(dockerVersion, options.quiet);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const isDockerMissing = /connect|not found|ENOENT/i.test(message);
    errorBox(
      isDockerMissing ? "Docker not available" : "Docker image build failed",
      message,
      isDockerMissing
        ? "Install Docker: https://docs.docker.com/get-docker/"
        : "Check Docker is running: docker info",
    );
    process.exit(1);
  }

  const outputDir = dirname(outputPath);
  const outputFilename = basename(outputPath);
  const dockerArgs = buildDockerRunArgs({
    imageTag,
    projectDir: resolve(projectDir),
    outputDir: resolve(outputDir),
    outputFilename,
    options: {
      fps: options.fps,
      quality: options.quality,
      format: options.format,
      workers: options.workers,
      gpu: options.gpu,
      hdr: options.hdr,
      crf: options.crf,
      videoBitrate: options.videoBitrate,
      quiet: options.quiet,
    },
  });

  if (!options.quiet) {
    console.log(c.dim("  Running render in Docker container..."));
    console.log("");
  }

  try {
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn("docker", dockerArgs, {
        // When quiet, still show stderr so container errors surface
        stdio: options.quiet ? ["pipe", "pipe", "inherit"] : "inherit",
      });
      child.on("close", (code) => {
        if (code === 0) resolvePromise();
        else reject(new Error(`Docker render exited with code ${code}`));
      });
      child.on("error", (err) => reject(err));
    });
  } catch (error: unknown) {
    handleRenderError(error, options, startTime, true, "Check Docker is running: docker info");
  }

  const elapsed = Date.now() - startTime;

  // Track metrics (no job object available from Docker — use a minimal stub)
  trackRenderComplete({
    durationMs: elapsed,
    fps: options.fps,
    quality: options.quality,
    workers: options.workers,
    docker: true,
    gpu: options.gpu,
    ...getMemorySnapshot(),
  });

  printRenderComplete(outputPath, elapsed, options.quiet);
}

async function renderLocal(
  projectDir: string,
  outputPath: string,
  options: RenderOptions,
): Promise<void> {
  const producer = await loadProducer();
  const startTime = Date.now();

  // Pass the resolved browser path to the producer via env var so
  // resolveConfig() picks it up. This bridges the CLI's ensureBrowser()
  // (which knows about system Chrome on macOS) with the engine's
  // acquireBrowser() (which only checks the puppeteer cache).
  if (options.browserPath && !process.env.PRODUCER_HEADLESS_SHELL_PATH) {
    process.env.PRODUCER_HEADLESS_SHELL_PATH = options.browserPath;
  }

  const job = producer.createRenderJob({
    fps: options.fps,
    quality: options.quality,
    format: options.format,
    workers: options.workers,
    useGpu: options.gpu,
    hdr: options.hdr,
    crf: options.crf,
    videoBitrate: options.videoBitrate,
  });

  const onProgress = options.quiet
    ? undefined
    : (progressJob: { progress: number }, message: string) => {
        renderProgress(progressJob.progress, message);
      };

  try {
    await producer.executeRenderJob(job, projectDir, outputPath, onProgress);
  } catch (error: unknown) {
    handleRenderError(error, options, startTime, false, "Try --docker for containerized rendering");
  }

  const elapsed = Date.now() - startTime;
  trackRenderMetrics(job, elapsed, options, false);
  printRenderComplete(outputPath, elapsed, options.quiet);
}

function getMemorySnapshot() {
  return {
    peakMemoryMb: bytesToMb(process.memoryUsage.rss()),
    memoryFreeMb: bytesToMb(freemem()),
  };
}

function handleRenderError(
  error: unknown,
  options: RenderOptions,
  startTime: number,
  docker: boolean,
  hint: string,
): never {
  const message = error instanceof Error ? error.message : String(error);
  trackRenderError({
    fps: options.fps,
    quality: options.quality,
    docker,
    workers: options.workers,
    gpu: options.gpu,
    elapsedMs: Date.now() - startTime,
    errorMessage: message,
    ...getMemorySnapshot(),
  });
  errorBox("Render failed", message, hint);
  process.exit(1);
}

/**
 * Extract rich metrics from the completed render job and send to telemetry.
 * speed_ratio = composition_duration / render_time — higher is better, >1 means faster than realtime.
 */
function trackRenderMetrics(
  job: RenderJob,
  elapsedMs: number,
  options: RenderOptions,
  docker: boolean,
): void {
  const perf = job.perfSummary;
  const compositionDurationMs = perf
    ? Math.round(perf.compositionDurationSeconds * 1000)
    : undefined;
  const speedRatio =
    compositionDurationMs && compositionDurationMs > 0 && elapsedMs > 0
      ? Math.round((compositionDurationMs / elapsedMs) * 100) / 100
      : undefined;

  const stages = perf?.stages ?? {};
  const extract = perf?.videoExtractBreakdown;

  trackRenderComplete({
    durationMs: elapsedMs,
    fps: options.fps,
    quality: options.quality,
    workers: options.workers,
    docker,
    gpu: options.gpu,
    compositionDurationMs,
    compositionWidth: perf?.resolution.width,
    compositionHeight: perf?.resolution.height,
    totalFrames: perf?.totalFrames,
    speedRatio,
    captureAvgMs: perf?.captureAvgMs,
    capturePeakMs: perf?.capturePeakMs,
    tmpPeakBytes: perf?.tmpPeakBytes,
    stageCompileMs: stages.compileMs,
    stageVideoExtractMs: stages.videoExtractMs,
    stageAudioProcessMs: stages.audioProcessMs,
    stageCaptureMs: stages.captureMs,
    stageEncodeMs: stages.encodeMs,
    stageAssembleMs: stages.assembleMs,
    extractResolveMs: extract?.resolveMs,
    extractHdrProbeMs: extract?.hdrProbeMs,
    extractHdrPreflightMs: extract?.hdrPreflightMs,
    extractHdrPreflightCount: extract?.hdrPreflightCount,
    extractVfrProbeMs: extract?.vfrProbeMs,
    extractVfrPreflightMs: extract?.vfrPreflightMs,
    extractVfrPreflightCount: extract?.vfrPreflightCount,
    extractPhase3Ms: extract?.extractMs,
    extractCacheHits: extract?.cacheHits,
    extractCacheMisses: extract?.cacheMisses,
    ...getMemorySnapshot(),
  });
}

function printRenderComplete(outputPath: string, elapsedMs: number, quiet: boolean): void {
  if (quiet) return;

  let fileSize = "unknown";
  try {
    fileSize = formatBytes(statSync(outputPath).size);
  } catch {
    // file doesn't exist or is inaccessible
  }

  const duration = formatDuration(elapsedMs);
  console.log("");
  console.log(c.success("\u25C7") + "  " + c.accent(outputPath));
  console.log("   " + c.bold(fileSize) + c.dim(" \u00B7 " + duration + " \u00B7 completed"));
}
