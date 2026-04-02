import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { existsSync, mkdirSync, statSync } from "node:fs";

export const examples: Example[] = [
  ["Render to MP4", "hyperframes render --output output.mp4"],
  ["Render transparent WebM overlay", "hyperframes render --format webm --output overlay.webm"],
  ["High quality at 60fps", "hyperframes render --fps 60 --quality high --output hd.mp4"],
  ["Deterministic render via Docker", "hyperframes render --docker --output deterministic.mp4"],
  ["Parallel rendering with 4 workers", "hyperframes render --workers 4 --output fast.mp4"],
];
import { cpus, freemem } from "node:os";
import { resolve, dirname, join } from "node:path";
import { resolveProject } from "../utils/project.js";
import { lintProject, shouldBlockRender } from "../utils/lintProject.js";
import { formatLintFindings } from "../utils/lintFormat.js";
import { loadProducer } from "../utils/producer.js";
import { c } from "../ui/colors.js";
import { formatBytes, formatDuration, errorBox } from "../ui/format.js";
import { renderProgress } from "../ui/progress.js";
import { trackRenderComplete, trackRenderError } from "../telemetry/events.js";
import { bytesToMb } from "../telemetry/system.js";
import type { RenderJob } from "@hyperframes/producer";

const VALID_FPS = new Set([24, 30, 60]);
const VALID_QUALITY = new Set(["draft", "standard", "high"]);
const VALID_FORMAT = new Set(["mp4", "webm"]);

const CPU_CORE_COUNT = cpus().length;

/** Half of CPU cores, capped at 4. Each worker spawns a Chrome process (~256 MB). */
function defaultWorkerCount(): number {
  return Math.max(1, Math.min(Math.floor(CPU_CORE_COUNT / 2), 4));
}

export default defineCommand({
  meta: {
    name: "render",
    description: "Render a composition to MP4 or WebM",
  },
  args: {
    dir: {
      type: "positional",
      description: "Project directory",
      required: false,
    },
    output: {
      type: "string",
      description: "Output path (default: renders/<name>.mp4)",
    },
    fps: {
      type: "string",
      description: "Frame rate: 24, 30, 60",
      default: "30",
    },
    quality: {
      type: "string",
      description: "Quality: draft, standard, high",
      default: "standard",
    },
    format: {
      type: "string",
      description: "Output format: mp4, webm (WebM renders with transparency)",
      default: "mp4",
    },
    workers: {
      type: "string",
      description:
        "Parallel render workers (1-8 or 'auto'). Default: half your CPU cores, max 4. " +
        "Each worker launches a separate Chrome process.",
    },
    docker: {
      type: "boolean",
      description: "Use Docker for deterministic render",
      default: false,
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
      errorBox("Invalid format", `Got "${formatRaw}". Must be mp4 or webm.`);
      process.exit(1);
    }
    const format = formatRaw as "mp4" | "webm";

    // ── Validate workers ──────────────────────────────────────────────────
    let workers: number | undefined;
    if (args.workers != null && args.workers !== "auto") {
      const parsed = parseInt(args.workers, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 8) {
        errorBox("Invalid workers", `Got "${args.workers}". Must be 1-8 or "auto".`);
        process.exit(1);
      }
      workers = parsed;
    }

    // ── Resolve output path ───────────────────────────────────────────────
    const rendersDir = resolve("renders");
    const ext = format === "webm" ? ".webm" : ".mp4";
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

    // ── Print render plan ─────────────────────────────────────────────────
    const workerCount = workers ?? defaultWorkerCount();
    if (!quiet) {
      const workerLabel =
        args.workers != null
          ? `${workerCount} workers`
          : `${workerCount} workers (auto \u2014 half of ${CPU_CORE_COUNT} cores)`;
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
        quiet,
      });
    } else {
      await renderLocal(project.dir, outputPath, {
        fps,
        quality,
        format,
        workers: workerCount,
        gpu: useGpu,
        quiet,
        browserPath,
      });
    }
  },
});

interface RenderOptions {
  fps: 24 | 30 | 60;
  quality: "draft" | "standard" | "high";
  format: "mp4" | "webm";
  workers: number;
  gpu: boolean;
  quiet: boolean;
  browserPath?: string;
}

async function renderDocker(
  projectDir: string,
  outputPath: string,
  options: RenderOptions,
): Promise<void> {
  const producer = await loadProducer();
  const startTime = Date.now();

  let job: RenderJob;
  try {
    job = producer.createRenderJob({
      fps: options.fps,
      quality: options.quality,
      format: options.format,
      workers: options.workers,
      useGpu: options.gpu,
    });
    await producer.executeRenderJob(job, projectDir, outputPath);
  } catch (error: unknown) {
    handleRenderError(error, options, startTime, true, "Check Docker is running: docker info");
  }

  const elapsed = Date.now() - startTime;
  trackRenderMetrics(job, elapsed, options, true);
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
    ...getMemorySnapshot(),
  });
}

function printRenderComplete(outputPath: string, elapsedMs: number, quiet: boolean): void {
  if (quiet) return;

  let fileSize = "unknown";
  if (existsSync(outputPath)) {
    const stat = statSync(outputPath);
    fileSize = formatBytes(stat.size);
  }

  const duration = formatDuration(elapsedMs);
  console.log("");
  console.log(c.success("\u25C7") + "  " + c.accent(outputPath));
  console.log("   " + c.bold(fileSize) + c.dim(" \u00B7 " + duration + " \u00B7 completed"));
}
