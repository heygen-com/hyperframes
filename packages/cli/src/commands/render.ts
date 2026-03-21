import { defineCommand } from "citty";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { resolveProject } from "../utils/project.js";
import { loadProducer } from "../utils/producer.js";
import { c } from "../ui/colors.js";
import { formatBytes, formatDuration, errorBox } from "../ui/format.js";
import { renderProgress } from "../ui/progress.js";

const VALID_FPS = new Set([24, 30, 60]);
const VALID_QUALITY = new Set(["draft", "standard", "high"]);

export default defineCommand({
  meta: { name: "render", description: "Render a composition to MP4" },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    output: { type: "string", description: "Output path (default: renders/<name>.mp4)" },
    fps: { type: "string", description: "Frame rate: 24, 30, 60", default: "30" },
    quality: { type: "string", description: "Quality: draft, standard, high", default: "standard" },
    workers: { type: "string", description: "Parallel workers 1-8" },
    docker: { type: "boolean", description: "Use Docker for deterministic render", default: false },
    gpu: { type: "boolean", description: "Use GPU encoding", default: false },
    quiet: { type: "boolean", description: "Suppress verbose output", default: false },
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

    // ── Validate workers ──────────────────────────────────────────────────
    let workers: number | undefined;
    if (args.workers != null) {
      const parsed = parseInt(args.workers, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 8) {
        errorBox("Invalid workers", `Got "${args.workers}". Must be between 1 and 8.`);
        process.exit(1);
      }
      workers = parsed;
    }

    // ── Resolve output path ───────────────────────────────────────────────
    const rendersDir = resolve("renders");
    const outputPath = args.output
      ? resolve(args.output)
      : join(rendersDir, `${project.name}.mp4`);

    // Ensure output directory exists
    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const useDocker = args.docker ?? false;
    const useGpu = args.gpu ?? false;
    const quiet = args.quiet ?? false;

    // ── Print render plan ─────────────────────────────────────────────────
    const workerCount = workers ?? 4;
    if (!quiet) {
      console.log("");
      console.log(c.accent("\u25C6") + "  Rendering " + c.accent(project.name) + c.dim(" \u2192 " + outputPath));
      console.log(c.dim("   " + fps + "fps \u00B7 " + quality + " \u00B7 " + workerCount + " workers"));
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
            s.message(`Downloading Chrome... ${c.progress(pct + "%")} ${c.dim("(" + formatBytes(downloaded) + " / " + formatBytes(total) + ")")}`);
          },
        });
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

    // ── Render ────────────────────────────────────────────────────────────
    if (useDocker) {
      await renderDocker(project.dir, outputPath, { fps, quality, workers, gpu: useGpu, quiet });
    } else {
      await renderLocal(project.dir, outputPath, { fps, quality, workers, gpu: useGpu, quiet });
    }
  },
});

interface RenderOptions {
  fps: 24 | 30 | 60;
  quality: "draft" | "standard" | "high";
  workers?: number;
  gpu: boolean;
  quiet: boolean;
}

async function renderDocker(
  projectDir: string,
  outputPath: string,
  options: RenderOptions,
): Promise<void> {
  const producer = await loadProducer();
  const startTime = Date.now();

  try {
    await producer.renderComposition(projectDir, {
      output: outputPath,
      fps: options.fps,
      quality: options.quality,
      workers: options.workers ?? null,
      gpu: options.gpu,
      quiet: options.quiet,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    errorBox("Render failed", message, "Try --docker for containerized rendering");
    process.exit(1);
  }

  const elapsed = Date.now() - startTime;
  printRenderComplete(outputPath, elapsed, options.quiet);
}

async function renderLocal(
  projectDir: string,
  outputPath: string,
  options: RenderOptions,
): Promise<void> {
  const producer = await loadProducer();
  const startTime = Date.now();

  const job = producer.createRenderJob({
    fps: options.fps,
    quality: options.quality,
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
    const message = error instanceof Error ? error.message : String(error);
    errorBox("Render failed", message, "Try --docker for containerized rendering");
    process.exit(1);
  }

  const elapsed = Date.now() - startTime;
  printRenderComplete(outputPath, elapsed, options.quiet);
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
