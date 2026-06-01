import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import {
  reportVariableIssues,
  resolveVariablesArg,
  validateVariablesAgainstProject,
} from "../utils/variables.js";

export const examples: Example[] = [
  ["Render to MP4", "hyperframes render --output output.mp4"],
  ["Render a specific composition", "hyperframes render -c compositions/intro.html -o intro.mp4"],
  [
    "Upsample any composition to 4K (supersamples via Chrome DPR)",
    "hyperframes render --resolution 4k --output 4k.mp4",
  ],
  ["Render transparent overlay (ProRes)", "hyperframes render --format mov --output overlay.mov"],
  ["Render transparent WebM overlay", "hyperframes render --format webm --output overlay.webm"],
  [
    "Render PNG sequence (RGBA frames for AE/Nuke/Fusion)",
    "hyperframes render --format png-sequence --output frames/",
  ],
  ["High quality at 60fps", "hyperframes render --fps 60 --quality high --output hd.mp4"],
  ["Deterministic render via Docker", "hyperframes render --docker --output deterministic.mp4"],
  ["Parallel rendering with 6 workers", "hyperframes render --workers 6 --output fast.mp4"],
  ["Opt out of browser GPU render", "hyperframes render --no-browser-gpu --output cpu.mp4"],
  ["HDR output (auto-detected)", "hyperframes render --output hdr-output.mp4"],
  [
    "Override composition variables (parametrized render)",
    'hyperframes render --variables \'{"title":"Q4 Report","theme":"dark"}\' --output q4.mp4',
  ],
  [
    "Variables from a JSON file",
    "hyperframes render --variables-file ./vars.json --output out.mp4",
  ],
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
import { maybePromptRenderFeedback } from "../telemetry/feedback.js";
import { bytesToMb } from "../telemetry/system.js";
import { VERSION } from "../version.js";
import { isDevMode } from "../utils/env.js";
import { buildDockerRunArgs } from "../utils/dockerRunArgs.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { findFFmpeg, getFFmpegInstallHint } from "../browser/ffmpeg.js";
import type { RenderJob } from "@hyperframes/producer";
import {
  normalizeResolutionFlag,
  parseFps,
  fpsToNumber,
  fpsToFfmpegArg,
  type CanvasResolution,
  type Fps,
  type FpsParseResult,
} from "@hyperframes/core";

const VALID_QUALITY = new Set(["draft", "standard", "high"]);

/**
 * Map a {@link FpsParseResult} failure reason to a human-friendly
 * error-box message. The empty / undefined / default-fallthrough case
 * shouldn't be reachable from the CLI flag (citty supplies a default of
 * "30") but the branch exists so this helper can be reused by other
 * fps-accepting CLI surfaces in the future.
 */
function formatFpsParseError(
  input: string,
  reason: Exclude<FpsParseResult, { ok: true }>["reason"],
): string {
  switch (reason) {
    case "empty":
      return "Frame rate must not be empty.";
    case "not-a-number":
      return `Got "${input}". Frame rate must be an integer (e.g. 30) or a rational (e.g. 30000/1001 for NTSC).`;
    case "non-positive":
      return `Got "${input}". Frame rate must be greater than zero.`;
    case "out-of-range":
      return `Got "${input}". Frame rate must be in the range 1–240.`;
    case "invalid-fraction":
      return `Got "${input}". Rational frame rates must be two positive integers separated by '/' (e.g. 30000/1001).`;
    case "ambiguous-decimal":
      return `Got "${input}". Decimal frame rates are ambiguous — use the exact rational form instead (e.g. 30000/1001 for 29.97).`;
  }
}
const VALID_FORMAT = new Set(["mp4", "webm", "mov", "png-sequence"]);
// `png-sequence` writes a directory of frames rather than a single muxed file,
// so its "extension" is empty — the auto-output path becomes a directory name.
const FORMAT_EXT: Record<string, string> = {
  mp4: ".mp4",
  webm: ".webm",
  mov: ".mov",
  "png-sequence": "",
};

const CPU_CORE_COUNT = cpus().length;

export default defineCommand({
  meta: {
    name: "render",
    description: "Render a composition to MP4, WebM, MOV, or a PNG sequence",
  },
  args: {
    dir: {
      type: "positional",
      description: "Project directory",
      required: false,
    },
    composition: {
      type: "string",
      alias: "c",
      description:
        "Render a specific composition file instead of index.html (e.g. compositions/intro.html). " +
        "Sub-compositions using <template> wrappers must be referenced from index.html via data-composition-src.",
    },
    output: {
      type: "string",
      alias: "o",
      description: "Output path (default: renders/<name>.mp4)",
    },
    fps: {
      type: "string",
      alias: "f",
      description:
        "Frame rate. Accepts integer (24, 25, 30, 50, 60, 120, 240) or " +
        "ffmpeg-style rational (30000/1001 for NTSC 29.97, 24000/1001 for " +
        "23.976, 60000/1001 for 59.94). Range 1-240.",
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
      description:
        "Output format: mp4, webm, mov, png-sequence " +
        "(MOV/WebM render with transparency; png-sequence writes RGBA frames " +
        "to a directory for AE/Nuke/Fusion ingest)",
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
      description: "Force HDR output even if no HDR sources are detected",
      default: false,
    },
    sdr: {
      type: "boolean",
      description: "Force SDR output even if HDR sources are detected",
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
    "browser-gpu": {
      type: "boolean",
      description:
        "Force host GPU acceleration for Chrome/WebGL capture. Default: auto (probe on first launch; fall back to software if no GPU). Use --no-browser-gpu to force software (SwiftShader).",
    },
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
    variables: {
      type: "string",
      description:
        'JSON object of variable values, merged over the composition\'s data-composition-variables defaults. Example: --variables \'{"title":"Hello"}\'. Read inside the composition via window.__hyperframes.getVariables().',
    },
    "variables-file": {
      type: "string",
      description:
        "Path to a JSON file with variable values (alternative to --variables). The file must contain a single JSON object.",
    },
    "strict-variables": {
      type: "boolean",
      description:
        "Fail render if any --variables key is undeclared or has a wrong type vs the composition's data-composition-variables. Without this flag, mismatches are warnings.",
      default: false,
    },
    resolution: {
      type: "string",
      description:
        "Output resolution preset: landscape (1920x1080), portrait (1080x1920), landscape-4k (3840x2160), portrait-4k (2160x3840), square (1080x1080), square-4k (2160x2160). Aliases: 1080p, 4k, uhd, 1080p-square, square-1080p, 4k-square. The composition is unchanged — Chrome renders at higher DPR (deviceScaleFactor) so the captured screenshot lands at the requested dimensions. Aspect ratio must match the composition; the scale must be an integer multiple. Not yet supported with --hdr.",
    },
    "page-side-compositing": {
      type: "boolean",
      description:
        "Run shader transitions on a page-side WebGL canvas inside Chrome " +
        "instead of the Node-side layered blend. ~6× faster for SDR " +
        "shader-transition renders. HDR/alpha/video content auto-disables. " +
        "Use --no-page-side-compositing to force the layered path.",
      default: true,
    },
  },
  async run({ args }) {
    // ── Resolve project ────────────────────────────────────────────────────
    const project = resolveProject(args.dir);

    // ── Validate fps ───────────────────────────────────────────────────────
    // Accept either integer (`30`) or ffmpeg-style rational (`30000/1001`).
    // The whitelist-based validator was replaced with a sane numeric range so
    // legitimate framerates (NTSC trio, PAL, 120/240 slow-mo) work without
    // CLI gymnastics. The exact rational survives end-to-end into FFmpeg's
    // `-r` / `-framerate` flags via `fpsToFfmpegArg`.
    const fpsParse = parseFps(args.fps ?? "30");
    if (!fpsParse.ok) {
      errorBox("Invalid fps", formatFpsParseError(args.fps ?? "30", fpsParse.reason));
      process.exit(1);
    }
    const fps: Fps = fpsParse.value;

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
      errorBox("Invalid format", `Got "${formatRaw}". Must be mp4, webm, mov, or png-sequence.`);
      process.exit(1);
    }
    const format = formatRaw as "mp4" | "webm" | "mov" | "png-sequence";

    // ── Validate resolution ────────────────────────────────────────────────
    let outputResolution: CanvasResolution | undefined;
    if (args.resolution !== undefined) {
      outputResolution = normalizeResolutionFlag(args.resolution);
      if (!outputResolution) {
        errorBox(
          "Invalid resolution",
          `Got "${args.resolution}". Must be one of: landscape, portrait, landscape-4k, portrait-4k, square, square-4k ` +
            `(or aliases 1080p, 4k, uhd, 1080p-square, square-1080p, 4k-square).`,
        );
        process.exit(1);
      }
      // Reject the --resolution + --hdr combination at the CLI layer so the
      // user sees the friendly errorBox before any work directories or
      // ffmpeg processes spin up. The orchestrator also enforces this via
      // resolveDeviceScaleFactor — defense in depth.
      if (args.hdr) {
        errorBox(
          "Conflicting flags",
          "--resolution cannot be combined with --hdr. The HDR pipeline composites at composition dimensions and does not yet support supersampling.",
          "Render in two passes: HDR at composition resolution, then upscale separately with ffmpeg.",
        );
        process.exit(1);
      }
    }

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

    // ── Wire opt-in: page-side compositing ───────────────────────────────
    if (args["page-side-compositing"] === false) {
      process.env.HF_PAGE_SIDE_COMPOSITING = "false";
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
    const browserGpuArg = args["browser-gpu"];
    const browserGpuMode = resolveBrowserGpuForCli(useDocker, browserGpuArg);
    const quiet = args.quiet ?? false;
    const strictAll = args["strict-all"] ?? false;
    const strictErrors = (args.strict ?? false) || strictAll;
    const crfRaw = args.crf;
    const videoBitrate = args["video-bitrate"]?.trim();

    if (crfRaw != null && videoBitrate) {
      errorBox("Conflicting encoder settings", "Use either --crf or --video-bitrate, not both.");
      process.exit(1);
    }

    if (useDocker && browserGpuArg === true) {
      errorBox(
        "Browser GPU is local-only",
        "--browser-gpu uses the host Chrome GPU backend. Docker mode keeps browser rendering deterministic and does not expose a cross-platform Chrome GPU backend.",
        "Run without --docker, or use --gpu for Docker GPU encoding where your Docker host supports GPU passthrough.",
      );
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

    // ── Validate composition entry file ──────────────────────────────────
    const entryFile = args.composition?.trim().replace(/^\.\//, "") || undefined;
    if (entryFile) {
      const absProjectDir = resolve(project.dir);
      const entryPath = resolve(absProjectDir, entryFile);
      if (!entryPath.startsWith(absProjectDir)) {
        errorBox(
          "Invalid composition path",
          `Entry file must stay inside the project directory: ${entryFile}`,
        );
        process.exit(1);
      }
      try {
        statSync(entryPath);
      } catch {
        errorBox(
          "Composition not found",
          `"${entryFile}" does not exist in the project directory.`,
          "Pass a path to a .html file relative to the project root (e.g. compositions/intro.html).",
        );
        process.exit(1);
      }
    }

    // ── Print render plan ─────────────────────────────────────────────────
    if (!quiet) {
      const workerLabel =
        workers != null ? `${workers} workers` : `auto workers (${CPU_CORE_COUNT} cores detected)`;
      console.log("");
      const nameLabel = entryFile ? project.name + "/" + entryFile : project.name;
      console.log(
        c.accent("\u25C6") + "  Rendering " + c.accent(nameLabel) + c.dim(" \u2192 " + outputPath),
      );
      console.log(
        c.dim("   " + fpsToFfmpegArg(fps) + "fps \u00B7 " + quality + " \u00B7 " + workerLabel),
      );
      if (outputResolution) {
        // Don't claim "supersampled" — when the composition is already at the
        // target dimensions, the DPR resolves to 1 and no supersampling
        // happens. We don't have the composition's dims at this point in the
        // CLI, so describe the intent rather than the mechanism.
        console.log(c.dim("   Output resolution: " + outputResolution));
      }
      if (useGpu || browserGpuMode !== "software") {
        const gpuModes = [
          useGpu ? "encoder GPU" : null,
          browserGpuMode === "hardware"
            ? "browser GPU (forced)"
            : browserGpuMode === "auto"
              ? "browser GPU (auto-detect)"
              : null,
        ].filter(Boolean);
        console.log(c.dim("   GPU: " + gpuModes.join(" + ")));
      }
      console.log("");
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
      const lintResult = await lintProject(project);
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

    // ── Validate HDR/SDR mutual exclusion ────────────────────────────────
    if (args.hdr && args.sdr) {
      console.error("Error: --hdr and --sdr are mutually exclusive.");
      process.exit(1);
    }

    // ── Resolve --variables / --variables-file ──────────────────────────
    const variables = resolveVariablesArg(args.variables, args["variables-file"]);

    // ── Validate --variables against data-composition-variables ─────────
    const strictVariables = args["strict-variables"] ?? false;
    if (variables && Object.keys(variables).length > 0) {
      const issues = validateVariablesAgainstProject(project.indexPath, variables);
      reportVariableIssues(issues, { strict: strictVariables, quiet });
    }

    // ── Render ────────────────────────────────────────────────────────────
    if (useDocker) {
      await renderDocker(project.dir, outputPath, {
        fps,
        quality,
        format,
        workers,
        gpu: useGpu,
        browserGpuMode,
        hdrMode: args.sdr ? "force-sdr" : args.hdr ? "force-hdr" : "auto",
        crf,
        videoBitrate,
        quiet,
        variables,
        entryFile,
        outputResolution,
        pageSideCompositing: args["page-side-compositing"] !== false,
        exitAfterComplete: true,
      });
    } else {
      await renderLocal(project.dir, outputPath, {
        fps,
        quality,
        format,
        workers,
        gpu: useGpu,
        browserGpuMode,
        hdrMode: args.sdr ? "force-sdr" : args.hdr ? "force-hdr" : "auto",
        crf,
        videoBitrate,
        quiet,
        browserPath,
        variables,
        entryFile,
        outputResolution,
        exitAfterComplete: true,
      });
    }
  },
});

interface RenderOptions {
  fps: Fps;
  quality: "draft" | "standard" | "high";
  format: "mp4" | "webm" | "mov" | "png-sequence";
  workers?: number;
  gpu: boolean;
  /**
   * Chrome WebGL backend mode. "auto" probes on first launch and falls back
   * to "software" if no usable GPU. Defaults to "software" when omitted to
   * stay backwards-compatible with callers that pre-date the tri-state.
   */
  browserGpuMode?: "auto" | "hardware" | "software";
  hdrMode: "auto" | "force-hdr" | "force-sdr";
  crf?: number;
  videoBitrate?: string;
  quiet: boolean;
  browserPath?: string;
  variables?: Record<string, unknown>;
  entryFile?: string;
  exitAfterComplete?: boolean;
  /** Output resolution preset; see `resolveDeviceScaleFactor` for constraints. */
  outputResolution?: CanvasResolution;
  pageSideCompositing?: boolean;
}

/**
 * Resolve the browser-GPU mode for a CLI render invocation.
 *
 * Priority (highest first):
 *   1. Docker mode → always "software" (docker has no portable GPU
 *      passthrough; the engine's render path uses SwiftShader).
 *   2. Explicit CLI flag — `--browser-gpu` → "hardware",
 *      `--no-browser-gpu` → "software".
 *   3. Env var `PRODUCER_BROWSER_GPU_MODE` accepts "hardware" / "software" /
 *      "auto".
 *   4. Default = "auto" — engine probes WebGL availability on first launch
 *      and falls back to software if the host lacks a usable GPU.
 *
 * Returning "auto" by default lets local renders Just Work whether or not the
 * host has a GPU, while preserving the explicit overrides for CI / power
 * users who want failure-on-misconfig.
 */
export function resolveBrowserGpuForCli(
  useDocker: boolean,
  browserGpuArg: boolean | undefined,
  envMode = process.env.PRODUCER_BROWSER_GPU_MODE,
): "auto" | "hardware" | "software" {
  if (useDocker) return "software";
  if (browserGpuArg === true) return "hardware";
  if (browserGpuArg === false) return "software";
  if (envMode === "hardware" || envMode === "software" || envMode === "auto") return envMode;
  return "auto";
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
      browserGpu: options.browserGpuMode === "hardware",
      hdrMode: options.hdrMode,
      crf: options.crf,
      videoBitrate: options.videoBitrate,
      quiet: options.quiet,
      variables: options.variables,
      entryFile: options.entryFile,
      outputResolution: options.outputResolution,
      pageSideCompositing: options.pageSideCompositing,
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
    fps: fpsToNumber(options.fps),
    quality: options.quality,
    workers: options.workers,
    docker: true,
    gpu: options.gpu,
    ...getMemorySnapshot(),
  });

  printRenderComplete(outputPath, elapsed, options.quiet);
  if (options.exitAfterComplete) scheduleRenderProcessExit();
}

export async function renderLocal(
  projectDir: string,
  outputPath: string,
  options: RenderOptions,
): Promise<void> {
  const producer = await loadProducer();

  if (!findFFmpeg()) {
    errorBox(
      "FFmpeg not found",
      "FFmpeg is required to encode video. The render cannot proceed without it.",
      getFFmpegInstallHint(),
    );
    process.exit(1);
  }

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
    producerConfig: producer.resolveConfig({
      browserGpuMode: options.browserGpuMode ?? "software",
    }),
    hdrMode: options.hdrMode,
    crf: options.crf,
    videoBitrate: options.videoBitrate,
    variables: options.variables,
    entryFile: options.entryFile,
    outputResolution: options.outputResolution,
  });

  const onProgress = options.quiet
    ? undefined
    : (progressJob: { progress: number }, message: string) => {
        renderProgress(progressJob.progress, message);
      };

  try {
    await producer.executeRenderJob(job, projectDir, outputPath, onProgress);
  } catch (error: unknown) {
    handleRenderError(
      error,
      options,
      startTime,
      false,
      "Try --docker for containerized rendering",
      job.failedStage,
    );
  }

  const elapsed = Date.now() - startTime;
  trackRenderMetrics(job, elapsed, options, false);
  printRenderComplete(outputPath, elapsed, options.quiet);
  await maybePromptRenderFeedback({
    renderDurationMs: elapsed,
    quiet: options.quiet,
  });
  if (options.exitAfterComplete) scheduleRenderProcessExit();
}

type UnrefableTimer = {
  unref: () => void;
};

function isUnrefableTimer(
  timer: ReturnType<typeof setTimeout>,
): timer is ReturnType<typeof setTimeout> & UnrefableTimer {
  return (
    typeof timer === "object" &&
    timer !== null &&
    "unref" in timer &&
    typeof timer.unref === "function"
  );
}

function scheduleRenderProcessExit(): void {
  const timer = setTimeout(() => process.exit(0), 100);
  if (isUnrefableTimer(timer)) timer.unref();
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
  failedStage?: string,
): never {
  const message = normalizeErrorMessage(error);
  trackRenderError({
    fps: fpsToNumber(options.fps),
    quality: options.quality,
    docker,
    workers: options.workers,
    gpu: options.gpu,
    elapsedMs: Date.now() - startTime,
    errorMessage: message,
    failedStage,
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
    fps: fpsToNumber(options.fps),
    quality: options.quality,
    workers: options.workers ?? perf?.workers,
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
    const stat = statSync(outputPath);
    if (stat.isDirectory()) {
      // png-sequence output is a directory; sum the contained file sizes so
      // the user sees the on-disk footprint of the deliverable rather than
      // the platform-specific size of the directory inode itself.
      let total = 0;
      for (const entry of readdirSync(outputPath, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        try {
          total += statSync(join(outputPath, entry.name)).size;
        } catch {
          // skip unreadable entries
        }
      }
      fileSize = formatBytes(total);
    } else {
      fileSize = formatBytes(stat.size);
    }
  } catch {
    // file doesn't exist or is inaccessible
  }

  const duration = formatDuration(elapsedMs);
  console.log("");
  console.log(c.success("\u25C7") + "  " + c.accent(outputPath));
  console.log("   " + c.bold(fileSize) + c.dim(" \u00B7 " + duration + " \u00B7 completed"));
}
