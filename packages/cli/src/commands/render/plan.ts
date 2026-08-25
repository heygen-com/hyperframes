import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  formatRenderOutputTimestamp,
  fpsToNumber,
  isAspectAgnosticResolutionAlias,
  normalizeResolutionFlag,
  parseFps,
  type CanvasResolution,
  type Fps,
  type FpsParseResult,
} from "@hyperframes/core";
import {
  EXTRACT_CACHE_DIR_DISABLED_ALIASES,
  MAX_VP9_CPU_USED,
  MIN_VP9_CPU_USED,
  isVideoFrameFormat,
  type VideoFrameFormat,
} from "@hyperframes/engine";
import { errorBox } from "../../ui/format.js";
import { failUsage } from "../../utils/commandResult.js";
import { resolveProject } from "../../utils/project.js";
import {
  hasExplicitCompositionArg,
  parseGifLoopArg,
  resolveBrowserTimeoutMsArg,
  resolveCompositionEntryArg,
  resolveDefaultFpsArg,
} from "../../utils/renderArgs.js";
import { normalizeSkillSlug } from "../../telemetry/skill.js";
import { loadProjectConfig } from "../../utils/projectConfig.js";
import { type CatalogUsage, summarizeCatalogUsage } from "../../utils/catalogUsage.js";

const VALID_QUALITY = new Set(["draft", "standard", "high"]);
const RENDER_FORMATS = ["mp4", "webm", "mov", "png-sequence", "gif"] as const;
const VALID_FORMAT = new Set<string>(RENDER_FORMATS);
const RENDER_FORMAT_LABEL = "mp4, webm, mov, png-sequence, or gif";

export type RenderFormat = (typeof RENDER_FORMATS)[number];
export type RenderQuality = "draft" | "standard" | "high";
export type BrowserGpuMode = "auto" | "hardware" | "software";
export type HdrMode = "auto" | "force-hdr" | "force-sdr";
export type RenderProject = ReturnType<typeof resolveProject>;

const FORMAT_EXT: Record<RenderFormat, string> = {
  mp4: ".mp4",
  webm: ".webm",
  mov: ".mov",
  "png-sequence": "",
  gif: ".gif",
};

export interface RenderCommandArgs {
  dir?: string;
  composition?: string;
  output?: string;
  fps?: string;
  quality?: string;
  skill?: string;
  format?: string;
  "gif-loop"?: string;
  "video-frame-format"?: string;
  workers?: string;
  docker?: boolean;
  hdr?: boolean;
  sdr?: boolean;
  crf?: string;
  "video-bitrate"?: string;
  "vp9-cpu-used"?: string;
  gpu?: boolean;
  "browser-gpu"?: boolean;
  quiet?: boolean;
  debug?: boolean;
  "best-effort"?: boolean;
  strict?: boolean;
  "strict-all"?: boolean;
  "max-concurrent-renders"?: string;
  variables?: string;
  "variables-file"?: string;
  "strict-variables"?: boolean;
  batch?: string;
  "batch-concurrency"?: string;
  "batch-fail-fast"?: boolean;
  json?: boolean;
  resolution?: string;
  "page-side-compositing"?: boolean;
  "browser-timeout"?: string;
  "protocol-timeout"?: string;
  "player-ready-timeout"?: string;
  "low-memory-mode"?: boolean;
  "experimental-fast-capture"?: boolean;
  "frames-cache-dir"?: string;
}

export interface RenderPlan {
  project: RenderProject;
  entryFile?: string;
  renderTarget: string;
  fps: Fps;
  quality: RenderQuality;
  authoringSkill?: string;
  invalidAuthoringSkill?: string;
  /** Catalog items installed in this project, and those the entry reaches. */
  catalogUsage: CatalogUsage;
  format: RenderFormat;
  gifLoop?: number;
  gifFpsCapped: boolean;
  videoFrameFormat: VideoFrameFormat;
  outputResolution?: CanvasResolution;
  outputResolutionAspectAgnostic: boolean;
  outputResolutionRaw?: string;
  workers?: number;
  protocolTimeout?: number;
  playerReadyTimeout?: number;
  pageNavigationTimeoutMs?: number;
  batchPath?: string;
  batchConcurrency: number;
  batchFailFast: boolean;
  batchOutputTemplate: string;
  outputPath: string;
  useDocker: boolean;
  useGpu: boolean;
  browserGpuMode: BrowserGpuMode;
  quiet: boolean;
  debug: boolean;
  bestEffort: boolean;
  batchJson: boolean;
  effectiveQuiet: boolean;
  strictAll: boolean;
  strictErrors: boolean;
  crf?: number;
  vp9CpuUsed?: number;
  videoBitrate?: string;
  hdrMode: HdrMode;
  pageSideCompositing: boolean;
  experimentalFastCapture: boolean;
  variablesArg?: string;
  variablesFileArg?: string;
  strictVariables: boolean;
  environment: Readonly<Record<string, string>>;
}

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

function parseRenderFormat(input: string): RenderFormat | undefined {
  if (!VALID_FORMAT.has(input)) return undefined;
  return RENDER_FORMATS.find((format) => format === input);
}

function positiveInteger(raw: string, title: string, message: string, min = 1): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min) {
    errorBox(title, message);
    failUsage();
  }
  return parsed;
}

/** Parse and validate command input into an immutable execution plan. */
// fallow-ignore-next-line complexity
export function createRenderPlan(args: RenderCommandArgs, now = new Date()): RenderPlan {
  const hasExplicitComposition = hasExplicitCompositionArg(args.composition);
  const project = resolveProject(args.dir, { requireIndex: !hasExplicitComposition });
  const entryFile = resolveCompositionEntryArg(args.composition, project.dir, statSync);
  const renderTarget = entryFile ? resolve(project.dir, entryFile) : project.indexPath;
  const fpsArg = resolveDefaultFpsArg(args.fps, project.dir, project.indexPath, entryFile);
  const fpsParse = parseFps(fpsArg ?? "30");
  if (!fpsParse.ok) {
    errorBox("Invalid fps", formatFpsParseError(fpsArg ?? "30", fpsParse.reason));
    failUsage();
  }
  let fps = fpsParse.value;

  const qualityRaw = args.quality ?? "standard";
  if (!VALID_QUALITY.has(qualityRaw)) {
    errorBox("Invalid quality", `Got "${qualityRaw}". Must be draft, standard, or high.`);
    failUsage();
  }
  const quality = qualityRaw as RenderQuality;

  // Attribution resolves the explicit --skill flag first, then falls back to
  // the owning skill persisted in hyperframes.json — so re-renders, batch
  // renders, and `npm run render` (which never re-pass the flag) stay
  // attributed to the workflow that created the project.
  const flagSkill = normalizeSkillSlug(args.skill);
  const authoringSkill = flagSkill ?? loadProjectConfig(project.dir).authoringSkill;
  const invalidAuthoringSkill =
    typeof args.skill === "string" && args.skill.trim() !== "" && !flagSkill
      ? args.skill
      : undefined;

  // Resolved here, once, from the same entry the render will use: batch rows
  // vary only their variables, so every row shares this composition tree.
  const catalogUsage = summarizeCatalogUsage(project.dir, renderTarget);

  const formatRaw = args.format ?? "mp4";
  const format = parseRenderFormat(formatRaw);
  if (!format) {
    errorBox("Invalid format", `Got "${formatRaw}". Must be ${RENDER_FORMAT_LABEL}.`);
    failUsage();
  }

  let gifFpsCapped = false;
  if (format === "gif" && fpsToNumber(fps) > 30) {
    fps = { num: 30, den: 1 };
    gifFpsCapped = true;
  }
  const gifLoopParse = parseGifLoopArg(args["gif-loop"]);
  if (!gifLoopParse.ok) {
    errorBox("Invalid gif-loop", gifLoopParse.message);
    failUsage();
  }
  const gifLoop = gifLoopParse.value ?? (format === "gif" ? 0 : undefined);

  const videoFrameFormatRaw = args["video-frame-format"] ?? "auto";
  if (!isVideoFrameFormat(videoFrameFormatRaw)) {
    errorBox(
      "Invalid video-frame-format",
      `Got "${videoFrameFormatRaw}". Must be auto, jpg, or png.`,
    );
    failUsage();
  }

  let outputResolution: CanvasResolution | undefined;
  let outputResolutionAspectAgnostic = false;
  if (args.resolution !== undefined) {
    outputResolution = normalizeResolutionFlag(args.resolution);
    if (!outputResolution) {
      errorBox(
        "Invalid resolution",
        `Got "${args.resolution}". Must be one of: landscape, portrait, landscape-4k, portrait-4k, square, square-4k ` +
          `(or aliases 1080p, 4k, uhd, 1080p-square, square-1080p, 4k-square).`,
      );
      failUsage();
    }
    outputResolutionAspectAgnostic = isAspectAgnosticResolutionAlias(args.resolution);
    if (args.hdr) {
      errorBox(
        "Conflicting flags",
        "--resolution cannot be combined with --hdr. The HDR pipeline composites at composition dimensions and does not yet support supersampling.",
        "Render in two passes: HDR at composition resolution, then upscale separately with ffmpeg.",
      );
      failUsage();
    }
  }
  if (args.hdr && args.sdr) {
    errorBox("Conflicting flags", "--hdr and --sdr are mutually exclusive.");
    failUsage();
  }

  const workers =
    args.workers != null && args.workers !== "auto"
      ? positiveInteger(
          args.workers,
          "Invalid workers",
          `Got "${args.workers}". Must be a positive number or "auto".`,
        )
      : undefined;
  const protocolTimeout =
    args["protocol-timeout"] != null
      ? positiveInteger(
          args["protocol-timeout"],
          "Invalid protocol-timeout",
          `Got "${args["protocol-timeout"]}". Must be a number >= 1000 (ms).`,
          1000,
        )
      : undefined;
  const playerReadyTimeout =
    args["player-ready-timeout"] != null
      ? positiveInteger(
          args["player-ready-timeout"],
          "Invalid player-ready-timeout",
          `Got "${args["player-ready-timeout"]}". Must be a number >= 1000 (ms).`,
          1000,
        )
      : undefined;

  const environment: Record<string, string> = {};
  if (args["page-side-compositing"] === false) environment.HF_PAGE_SIDE_COMPOSITING = "false";
  if (args["low-memory-mode"] != null) {
    environment.PRODUCER_LOW_MEMORY_MODE = args["low-memory-mode"] ? "true" : "false";
  }
  if (args["experimental-fast-capture"] != null) {
    environment.PRODUCER_EXPERIMENTAL_FAST_CAPTURE = args["experimental-fast-capture"]
      ? "true"
      : "false";
  }
  // Sugar for HYPERFRAMES_EXTRACT_CACHE_DIR. Disabling aliases pass through
  // verbatim for the engine helper; positive paths become CWD-stable here.
  if (typeof args["frames-cache-dir"] === "string" && args["frames-cache-dir"].trim() !== "") {
    const raw = args["frames-cache-dir"].trim();
    const normalized = raw.toLowerCase();
    const isDisableAlias = EXTRACT_CACHE_DIR_DISABLED_ALIASES.includes(normalized);
    environment.HYPERFRAMES_EXTRACT_CACHE_DIR = isDisableAlias ? raw : resolve(raw);
  }
  if (args["max-concurrent-renders"] != null) {
    const parsed = positiveInteger(
      args["max-concurrent-renders"],
      "Invalid max-concurrent-renders",
      `Got "${args["max-concurrent-renders"]}". Must be a number between 1 and 10.`,
    );
    if (parsed > 10) {
      errorBox(
        "Invalid max-concurrent-renders",
        `Got "${args["max-concurrent-renders"]}". Must be a number between 1 and 10.`,
      );
      failUsage();
    }
    environment.PRODUCER_MAX_CONCURRENT_RENDERS = String(parsed);
  }

  const batchPath =
    typeof args.batch === "string" && args.batch.trim() !== "" ? args.batch.trim() : undefined;
  if (batchPath && (args.variables != null || args["variables-file"] != null)) {
    errorBox(
      "Conflicting variables flags",
      "Use either --batch or --variables/--variables-file, not both.",
    );
    failUsage();
  }
  if (!batchPath && args["batch-concurrency"] != null) {
    errorBox("Invalid batch-concurrency", "--batch-concurrency requires --batch.");
    failUsage();
  }
  if (!batchPath && args["batch-fail-fast"]) {
    errorBox("Invalid batch-fail-fast", "--batch-fail-fast requires --batch.");
    failUsage();
  }
  const batchConcurrency =
    args["batch-concurrency"] != null
      ? positiveInteger(
          args["batch-concurrency"],
          "Invalid batch-concurrency",
          `Got "${args["batch-concurrency"]}". Must be a positive integer.`,
        )
      : 1;

  const rendersDir = resolve("renders");
  const ext = FORMAT_EXT[format];
  const timestamp = formatRenderOutputTimestamp(now);
  const batchOutputTemplate = args.output
    ? args.output
    : join(rendersDir, `${project.name}_${timestamp}_{index}${ext}`);
  const outputPath = args.output
    ? resolve(args.output)
    : join(rendersDir, `${project.name}_${timestamp}${ext}`);

  const useDocker = args.docker ?? false;
  const useGpu = args.gpu ?? false;
  const browserGpuMode = resolveBrowserGpuForCli(useDocker, args["browser-gpu"]);
  if (useDocker && args["browser-gpu"] === true) {
    errorBox(
      "Browser GPU is local-only",
      "--browser-gpu uses the host Chrome GPU backend. Docker mode keeps browser rendering deterministic and does not expose a cross-platform Chrome GPU backend.",
      "Run without --docker, or use --gpu for Docker GPU encoding where your Docker host supports GPU passthrough.",
    );
    failUsage();
  }

  const videoBitrate = args["video-bitrate"]?.trim();
  if (args.crf != null && videoBitrate) {
    errorBox("Conflicting encoder settings", "Use either --crf or --video-bitrate, not both.");
    failUsage();
  }
  const crf =
    args.crf != null
      ? positiveInteger(
          args.crf,
          "Invalid crf",
          `Got "${args.crf}". Must be a non-negative integer.`,
          0,
        )
      : undefined;
  let vp9CpuUsed: number | undefined;
  if (args["vp9-cpu-used"] != null) {
    const parsed = Number(args["vp9-cpu-used"]);
    if (!Number.isInteger(parsed) || parsed < MIN_VP9_CPU_USED || parsed > MAX_VP9_CPU_USED) {
      errorBox(
        "Invalid vp9-cpu-used",
        `Got "${args["vp9-cpu-used"]}". Must be an integer between ${MIN_VP9_CPU_USED} and ${MAX_VP9_CPU_USED}.`,
      );
      failUsage();
    }
    vp9CpuUsed = parsed;
  }
  if (args["video-bitrate"] != null && !videoBitrate) {
    errorBox(
      "Invalid video-bitrate",
      `Got "${args["video-bitrate"]}". Must be a non-empty bitrate such as "10M".`,
    );
    failUsage();
  }

  const quiet = args.quiet ?? false;
  const batchJson = args.json ?? false;
  return Object.freeze({
    project,
    entryFile,
    renderTarget,
    fps,
    quality,
    authoringSkill,
    invalidAuthoringSkill,
    catalogUsage,
    format,
    gifLoop,
    gifFpsCapped,
    videoFrameFormat: videoFrameFormatRaw,
    outputResolution,
    outputResolutionAspectAgnostic,
    outputResolutionRaw: args.resolution,
    workers,
    protocolTimeout,
    playerReadyTimeout,
    pageNavigationTimeoutMs: resolveBrowserTimeoutMsArg(args["browser-timeout"]),
    batchPath,
    batchConcurrency,
    batchFailFast: args["batch-fail-fast"] ?? false,
    batchOutputTemplate,
    outputPath,
    useDocker,
    useGpu,
    browserGpuMode,
    quiet,
    debug: args.debug ?? false,
    bestEffort: args["best-effort"] ?? true,
    batchJson,
    effectiveQuiet: quiet || (batchPath != null && batchJson),
    strictAll: args["strict-all"] ?? false,
    strictErrors: (args.strict ?? false) || (args["strict-all"] ?? false),
    crf,
    vp9CpuUsed,
    videoBitrate,
    hdrMode: args.sdr ? "force-sdr" : args.hdr ? "force-hdr" : "auto",
    pageSideCompositing: args["page-side-compositing"] !== false,
    experimentalFastCapture: args["experimental-fast-capture"] === true,
    variablesArg: args.variables,
    variablesFileArg: args["variables-file"],
    strictVariables: args["strict-variables"] ?? false,
    environment: Object.freeze(environment),
  });
}

export function applyRenderEnvironment(plan: RenderPlan): void {
  for (const [key, value] of Object.entries(plan.environment)) process.env[key] = value;
}

export function renderOutputDirectory(plan: RenderPlan): string {
  return dirname(plan.outputPath);
}

/** Resolve browser GPU mode from Docker, CLI, env, then the auto default. */
// Re-exported by render.ts to preserve its tested public seam.
export function resolveBrowserGpuForCli(
  useDocker: boolean,
  browserGpuArg: boolean | undefined,
  envMode = process.env.PRODUCER_BROWSER_GPU_MODE,
): BrowserGpuMode {
  if (useDocker) return "software";
  if (browserGpuArg === true) return "hardware";
  if (browserGpuArg === false) return "software";
  if (envMode === "hardware" || envMode === "software" || envMode === "auto") return envMode;
  return "auto";
}
