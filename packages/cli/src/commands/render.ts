import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import {
  reportVariableIssues,
  resolveVariablesArg,
  validateVariablesAgainstProject,
} from "../utils/variables.js";
import {
  parseGifLoopArg,
  resolveBrowserTimeoutMsArg,
  resolveCompositionEntryArg,
} from "../utils/renderArgs.js";

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
    "Render animated GIF for PRs/docs",
    "hyperframes render --format gif --fps 15 --gif-loop 0 --output demo.gif",
  ],
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
  [
    "Batch render one output per variables row",
    'hyperframes render --batch rows.json --output "renders/{name}.mp4"',
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
import {
  trackRenderComplete,
  trackRenderError,
  trackRenderObservation,
} from "../telemetry/events.js";
import { maybePromptRenderFeedback } from "../telemetry/feedback.js";
import { renderJobObservabilityTelemetryPayload } from "../telemetry/renderObservability.js";
import { normalizeSkillSlug } from "../telemetry/skill.js";
import { bytesToMb } from "../telemetry/system.js";
import { VERSION } from "../version.js";
import { isDevMode } from "../utils/env.js";
import { buildDockerRunArgs, resolveDockerPlatform } from "../utils/dockerRunArgs.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { runEnvironmentChecks } from "../browser/preflight.js";
import type { ProducerLogger, RenderJob } from "@hyperframes/producer";
import {
  MAX_VP9_CPU_USED,
  MIN_VP9_CPU_USED,
  isVideoFrameFormat,
  type VideoFrameFormat,
} from "@hyperframes/engine";
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
const RENDER_FORMATS = ["mp4", "webm", "mov", "png-sequence", "gif"] as const;
type RenderFormat = (typeof RENDER_FORMATS)[number];
const VALID_FORMAT = new Set<string>(RENDER_FORMATS);
const RENDER_FORMAT_LABEL = "mp4, webm, mov, png-sequence, or gif";
// `png-sequence` writes a directory of frames rather than a single muxed file,
// so its "extension" is empty — the auto-output path becomes a directory name.
const FORMAT_EXT: Record<RenderFormat, string> = {
  mp4: ".mp4",
  webm: ".webm",
  mov: ".mov",
  "png-sequence": "",
  gif: ".gif",
};

const CPU_CORE_COUNT = cpus().length;

function parseRenderFormat(input: string): RenderFormat | undefined {
  if (!VALID_FORMAT.has(input)) return undefined;
  return RENDER_FORMATS.find((format) => format === input);
}

export default defineCommand({
  meta: {
    name: "render",
    description: "Render a composition to MP4, WebM, MOV, GIF, or a PNG sequence",
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
        "Sub-compositions using <template> wrappers must be referenced from index.html via data-composition-src. " +
        "Pass `.` (or omit the flag) to render the project's index.html.",
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
    skill: {
      type: "string",
      description:
        "Authoring workflow skill that initiated this render (e.g. product-launch-video). " +
        "Recorded on anonymous render telemetry for per-skill usage breakdowns; ignored unless it is a slug.",
    },
    format: {
      type: "string",
      description:
        "Output format: mp4, webm, mov, gif, png-sequence " +
        "(MOV/WebM render with transparency; png-sequence writes RGBA frames " +
        "to a directory for AE/Nuke/Fusion ingest; gif is best at 15fps for PRs/docs)",
      default: "mp4",
    },
    "gif-loop": {
      type: "string",
      description: "GIF loop count, 0 = infinite. Range: 0-65535. Only used with --format gif.",
    },
    "video-frame-format": {
      type: "string",
      description:
        "Source video frame extraction format: auto, jpg, png (default: auto). " +
        "Use png for UI recordings, screen captures, and color-sensitive source videos; " +
        "alpha-capable sources always extract as PNG.",
      default: "auto",
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
    "vp9-cpu-used": {
      type: "string",
      description:
        "libvpx-vp9 -cpu-used value for WebM encodes (-8 to 8). Higher is faster with a larger quality/size tradeoff. Env: PRODUCER_VP9_CPU_USED.",
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
    debug: {
      type: "boolean",
      description:
        "Write full render diagnostics and keep intermediate artifacts under the producer .debug directory.",
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
    batch: {
      type: "string",
      description:
        'Path to a JSON array of variable rows (or {"rows":[...]}). Renders one output per row.',
    },
    "batch-concurrency": {
      type: "string",
      description:
        "Maximum number of batch rows to render at once. Default: 1, because each render already parallelizes across workers.",
    },
    "batch-fail-fast": {
      type: "boolean",
      description: "Stop launching new batch rows after the first row failure.",
      default: false,
    },
    json: {
      type: "boolean",
      description: "With --batch, emit JSON progress events.",
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
    "browser-timeout": {
      type: "string",
      description:
        "Puppeteer page-navigation timeout in SECONDS for the entry HTML. " +
        "Increase when heavy compositions (many videos / fonts / asset " +
        "requests) cannot reach domcontentloaded within the 60s default " +
        "(see issue #1199). Accepts 0.001-86400 (24h cap). " +
        "Note: this controls page.goto only — very heavy compositions may " +
        "also need PRODUCER_PUPPETEER_PROTOCOL_TIMEOUT_MS / " +
        "PRODUCER_PLAYER_READY_TIMEOUT_MS bumped (the post-goto window.__hf " +
        "readiness poll has its own 45s budget). " +
        "Env fallback: PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS (MILLISECONDS).",
    },
    "protocol-timeout": {
      type: "string",
      description:
        "CDP protocol timeout in ms. Increase on slow/low-memory machines " +
        "where Chrome operations time out. Default: 300000 (5 min). " +
        "Env: PRODUCER_PUPPETEER_PROTOCOL_TIMEOUT_MS.",
    },
    "player-ready-timeout": {
      type: "string",
      description:
        "Timeout in ms for the composition player to become ready. " +
        "Increase for complex compositions on slow hardware. Default: 45000 (45 s). " +
        "Env: PRODUCER_PLAYER_READY_TIMEOUT_MS.",
    },
    "low-memory-mode": {
      type: "boolean",
      description:
        "Force the low-memory safe render profile on (--low-memory-mode) or " +
        "off (--no-low-memory-mode). Safe mode pins to 1 worker, uses " +
        "screenshot capture, and skips auto-worker calibration to avoid " +
        "memory thrash on constrained machines. Default: auto-detected from " +
        "total RAM (<= 8 GB). Env: PRODUCER_LOW_MEMORY_MODE.",
    },
  },
  // `run` is the citty handler for `hyperframes render` — sequential flag
  // validation + render dispatch. Inherited CRITICAL on main (CRAP 1290);
  // this PR extracted --browser-timeout + --composition validators into
  // `utils/renderArgs.ts`, reducing cyclomatic 75→65 and CRAP 1290→978.
  // Full decomposition is tracked separately and out of scope for #1199.
  // fallow-ignore-next-line complexity
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
    let fps: Fps = fpsParse.value;

    // ── Validate quality ───────────────────────────────────────────────────
    const qualityRaw = args.quality ?? "standard";
    if (!VALID_QUALITY.has(qualityRaw)) {
      errorBox("Invalid quality", `Got "${qualityRaw}". Must be draft, standard, or high.`);
      process.exit(1);
    }
    const quality = qualityRaw as "draft" | "standard" | "high";

    // ── Authoring skill (telemetry attribution) ────────────────────────────
    // Optional slug naming the workflow skill that drove this render (e.g.
    // "product-launch-video"), tagged onto render telemetry for per-skill usage
    // breakdowns. Slug-gated (shared with the `events` command) so a caller
    // can't push high-cardinality or PII strings into the anonymous event
    // stream; a missing/invalid value is omitted.
    const authoringSkill = normalizeSkillSlug(args.skill);
    if (typeof args.skill === "string" && args.skill.trim() !== "" && !authoringSkill) {
      // Surface a typo (e.g. camelCase) instead of silently losing attribution.
      // Warning only — never fails the render.
      process.stderr.write(
        `hyperframes: ignoring --skill="${args.skill}" — not a valid slug ` +
          "(lowercase letters/digits/hyphens, max 64); this render will be unattributed.\n",
      );
    }

    // ── Validate format ─────────────────────────────────────────────────
    const formatRaw = args.format ?? "mp4";
    const format = parseRenderFormat(formatRaw);
    if (!format) {
      errorBox("Invalid format", `Got "${formatRaw}". Must be ${RENDER_FORMAT_LABEL}.`);
      process.exit(1);
    }

    let gifFpsCapped = false;
    if (format === "gif" && fpsToNumber(fps) > 30) {
      fps = { num: 30, den: 1 };
      gifFpsCapped = true;
    }

    const gifLoopParse = parseGifLoopArg(args["gif-loop"]);
    if (!gifLoopParse.ok) {
      errorBox("Invalid gif-loop", gifLoopParse.message);
      process.exit(1);
    }
    const gifLoop = gifLoopParse.value ?? (format === "gif" ? 0 : undefined);

    const videoFrameFormatRaw = args["video-frame-format"] ?? "auto";
    if (!isVideoFrameFormat(videoFrameFormatRaw)) {
      errorBox(
        "Invalid video-frame-format",
        `Got "${videoFrameFormatRaw}". Must be auto, jpg, or png.`,
      );
      process.exit(1);
    }
    const videoFrameFormat = videoFrameFormatRaw;

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

    // ── Validate timeout overrides ─────────────────────────────────────
    let protocolTimeout: number | undefined;
    if (args["protocol-timeout"] != null) {
      const parsed = parseInt(args["protocol-timeout"], 10);
      if (isNaN(parsed) || parsed < 1000) {
        errorBox(
          "Invalid protocol-timeout",
          `Got "${args["protocol-timeout"]}". Must be a number >= 1000 (ms).`,
        );
        process.exit(1);
      }
      protocolTimeout = parsed;
    }
    let playerReadyTimeout: number | undefined;
    if (args["player-ready-timeout"] != null) {
      const parsed = parseInt(args["player-ready-timeout"], 10);
      if (isNaN(parsed) || parsed < 1000) {
        errorBox(
          "Invalid player-ready-timeout",
          `Got "${args["player-ready-timeout"]}". Must be a number >= 1000 (ms).`,
        );
        process.exit(1);
      }
      playerReadyTimeout = parsed;
    }

    // ── Wire opt-in: page-side compositing ───────────────────────────────
    if (args["page-side-compositing"] === false) {
      process.env.HF_PAGE_SIDE_COMPOSITING = "false";
    }

    // ── Override: low-memory safe profile (tri-state) ────────────────────
    // Absent → auto-detect from total RAM inside resolveConfig. Explicit
    // --low-memory-mode / --no-low-memory-mode forces it on/off via the env
    // var the producer's resolveConfig reads.
    if (args["low-memory-mode"] != null) {
      process.env.PRODUCER_LOW_MEMORY_MODE = args["low-memory-mode"] ? "true" : "false";
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

    // ── Validate batch mode ───────────────────────────────────────────────
    const batchPath =
      typeof args.batch === "string" && args.batch.trim() !== "" ? args.batch.trim() : undefined;
    if (batchPath && (args.variables != null || args["variables-file"] != null)) {
      errorBox(
        "Conflicting variables flags",
        "Use either --batch or --variables/--variables-file, not both.",
      );
      process.exit(1);
    }

    if (!batchPath && args["batch-concurrency"] != null) {
      errorBox("Invalid batch-concurrency", "--batch-concurrency requires --batch.");
      process.exit(1);
    }
    if (!batchPath && args["batch-fail-fast"]) {
      errorBox("Invalid batch-fail-fast", "--batch-fail-fast requires --batch.");
      process.exit(1);
    }

    let batchConcurrency = 1;
    if (args["batch-concurrency"] != null) {
      const parsed = parseInt(args["batch-concurrency"], 10);
      if (isNaN(parsed) || parsed < 1) {
        errorBox(
          "Invalid batch-concurrency",
          `Got "${args["batch-concurrency"]}". Must be a positive integer.`,
        );
        process.exit(1);
      }
      batchConcurrency = parsed;
    }

    // ── Resolve output path ───────────────────────────────────────────────
    const rendersDir = resolve("renders");
    const ext = FORMAT_EXT[format] ?? ".mp4";
    // fallow-ignore-next-line code-duplication
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10);
    const timePart = now.toTimeString().slice(0, 8).replace(/:/g, "-");
    const batchOutputTemplate = args.output
      ? args.output
      : join(rendersDir, `${project.name}_${datePart}_${timePart}_{index}${ext}`);
    const outputPath = args.output
      ? resolve(args.output)
      : join(rendersDir, `${project.name}_${datePart}_${timePart}${ext}`);

    // Ensure output directory exists
    if (!batchPath) mkdirSync(dirname(outputPath), { recursive: true });

    const useDocker = args.docker ?? false;
    const useGpu = args.gpu ?? false;
    const browserGpuArg = args["browser-gpu"];
    const browserGpuMode = resolveBrowserGpuForCli(useDocker, browserGpuArg);
    const quiet = args.quiet ?? false;
    const debug = args.debug ?? false;
    const batchJson = args.json ?? false;
    const effectiveQuiet = quiet || (batchPath != null && batchJson);
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

    let vp9CpuUsed: number | undefined;
    if (args["vp9-cpu-used"] != null) {
      const raw = args["vp9-cpu-used"];
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < MIN_VP9_CPU_USED || parsed > MAX_VP9_CPU_USED) {
        errorBox(
          "Invalid vp9-cpu-used",
          `Got "${raw}". Must be an integer between ${MIN_VP9_CPU_USED} and ${MAX_VP9_CPU_USED}.`,
        );
        process.exit(1);
      }
      vp9CpuUsed = parsed;
    }

    if (args["video-bitrate"] != null && !videoBitrate) {
      errorBox(
        "Invalid video-bitrate",
        `Got "${args["video-bitrate"]}". Must be a non-empty bitrate such as "10M".`,
      );
      process.exit(1);
    }

    if (!quiet && gifFpsCapped) {
      console.log(c.warn("  GIF output is capped at 30fps. Use --fps 15 for smaller files."));
    }

    // ── Validate browser-timeout (seconds) and composition entry file ────
    // Both validators live in `utils/renderArgs.ts` so the parse/reject
    // branches are unit-testable without `process.exit`. See issue #1199
    // for the original EISDIR / silent-timeout-0 footguns this guards.
    const pageNavigationTimeoutMs = resolveBrowserTimeoutMsArg(args["browser-timeout"]);
    const entryFile = resolveCompositionEntryArg(args.composition, project.dir, statSync);

    // ── Preflight batch rows before browser/lint work ────────────────────
    let batchModule: typeof import("./batchRender.js") | undefined;
    let preparedBatch: import("./batchRender.js").PreparedBatchRender | undefined;
    if (batchPath) {
      batchModule = await import("./batchRender.js");
      try {
        preparedBatch = batchModule.prepareBatchRender({
          batchPath,
          outputTemplate: batchOutputTemplate,
          indexPath: project.indexPath,
          strictVariables: args["strict-variables"] ?? false,
          quiet: quiet || batchJson,
          json: batchJson,
        });
      } catch (error: unknown) {
        batchModule.exitBatchRenderInputError(error);
      }
    }

    // ── Slideshow guard ───────────────────────────────────────────────────
    // A slideshow deck is several top-level scene compositions with no master
    // root. `render` captures only the FIRST composition, so a deck renders as a
    // silently truncated MP4 (e.g. slide 1 of a 40s deck). Warn and point at the
    // deck-native path. Best-effort — never block a render on this probe.
    if (!quiet) {
      try {
        const renderTarget = entryFile ? resolve(project.dir, entryFile) : project.indexPath;
        const { slideshowIslandRegex } = await import("@hyperframes/core/slideshow");
        if (slideshowIslandRegex("i").test(readFileSync(renderTarget, "utf8"))) {
          console.log(
            c.warn("⚠") +
              "  This composition carries a slideshow island — `render` captures only the first" +
              " scene, so the MP4 will be truncated to slide 1. Use " +
              c.accent("hyperframes present") +
              " for the deck; a linear main-line MP4 export is not yet available.",
          );
          console.log("");
        }
      } catch {
        /* best-effort — a missing/unreadable target surfaces later in the real flow */
      }
    }

    // ── Print render plan ─────────────────────────────────────────────────
    if (!quiet && !batchPath) {
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
      let browserSpinner:
        | {
            start: (message?: string) => void;
            message: (message: string) => void;
            stop: (message?: string) => void;
          }
        | undefined;
      try {
        if (effectiveQuiet) {
          const info = await ensureBrowser();
          browserPath = info.executablePath;
        } else {
          const clack = await import("@clack/prompts");
          browserSpinner = clack.spinner();
          browserSpinner.start("Checking browser...");
          const info = await ensureBrowser({
            onProgress: (downloaded, total) => {
              if (total <= 0) return;
              const pct = Math.floor((downloaded / total) * 100);
              browserSpinner?.message(
                `Downloading Chrome... ${c.progress(pct + "%")} ${c.dim("(" + formatBytes(downloaded) + " / " + formatBytes(total) + ")")}`,
              );
            },
          });
          browserPath = info.executablePath;
          browserSpinner.stop(c.dim(`Browser: ${info.source}`));
        }
      } catch (err: unknown) {
        browserSpinner?.stop(c.error("Browser not available"));
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
      const lintResult = await lintProject(project.dir);
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

    // ── Batch render ──────────────────────────────────────────────────────
    if (batchPath && batchModule && preparedBatch) {
      const batchQuiet = quiet || batchJson;
      const hdrMode: RenderOptions["hdrMode"] = args.sdr
        ? "force-sdr"
        : args.hdr
          ? "force-hdr"
          : "auto";
      const renderOptionsBase: RenderOptions = {
        fps,
        quality,
        authoringSkill,
        format,
        workers,
        gpu: useGpu,
        browserGpuMode,
        hdrMode,
        crf,
        vp9CpuUsed,
        videoBitrate,
        quiet: batchQuiet,
        browserPath,
        entryFile,
        outputResolution,
        pageNavigationTimeoutMs,
        protocolTimeout,
        playerReadyTimeout,
        debug,
        exitAfterComplete: false,
        throwOnError: true,
        skipFeedback: true,
      };
      const manifest = await batchModule.runBatchRender({
        prepared: preparedBatch,
        concurrency: batchConcurrency,
        failFast: args["batch-fail-fast"] ?? false,
        quiet: batchQuiet,
        json: batchJson,
        renderOne: (row) =>
          useDocker
            ? renderDocker(project.dir, row.outputPath, {
                ...renderOptionsBase,
                variables: row.variables,
                pageSideCompositing: args["page-side-compositing"] !== false,
              })
            : renderLocal(project.dir, row.outputPath, {
                ...renderOptionsBase,
                variables: row.variables,
              }),
      });
      if (manifest.failed > 0) process.exitCode = 1;
      return;
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
        authoringSkill,
        format,
        gifLoop,
        workers,
        gpu: useGpu,
        browserGpuMode,
        hdrMode: args.sdr ? "force-sdr" : args.hdr ? "force-hdr" : "auto",
        crf,
        vp9CpuUsed,
        videoBitrate,
        videoFrameFormat,
        quiet,
        debug,
        variables,
        entryFile,
        outputResolution,
        pageSideCompositing: args["page-side-compositing"] !== false,
        pageNavigationTimeoutMs,
        protocolTimeout,
        playerReadyTimeout,
        exitAfterComplete: true,
      });
    } else {
      await renderLocal(project.dir, outputPath, {
        fps,
        quality,
        authoringSkill,
        format,
        gifLoop,
        workers,
        gpu: useGpu,
        browserGpuMode,
        hdrMode: args.sdr ? "force-sdr" : args.hdr ? "force-hdr" : "auto",
        crf,
        vp9CpuUsed,
        videoBitrate,
        videoFrameFormat,
        quiet,
        browserPath,
        debug,
        variables,
        entryFile,
        outputResolution,
        pageNavigationTimeoutMs,
        protocolTimeout,
        playerReadyTimeout,
        exitAfterComplete: true,
      });
    }
  },
});

export interface SingleRenderResult {
  durationMs?: number;
  renderTimeMs: number;
}

interface RenderOptions {
  fps: Fps;
  quality: "draft" | "standard" | "high";
  /** Authoring workflow skill that drove this render (telemetry attribution). */
  authoringSkill?: string;
  format: RenderFormat;
  gifLoop?: number;
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
  vp9CpuUsed?: number;
  videoBitrate?: string;
  videoFrameFormat?: VideoFrameFormat;
  quiet: boolean;
  debug?: boolean;
  browserPath?: string;
  variables?: Record<string, unknown>;
  entryFile?: string;
  exitAfterComplete?: boolean;
  /** Output resolution preset; see `resolveDeviceScaleFactor` for constraints. */
  outputResolution?: CanvasResolution;
  pageSideCompositing?: boolean;
  /**
   * Puppeteer `page.goto()` timeout for the entry HTML, in milliseconds.
   * When omitted, the engine default (60s) applies. Surfaced as
   * `--browser-timeout <seconds>` at the CLI and threaded through to the
   * producer's EngineConfig override.
   */
  pageNavigationTimeoutMs?: number;
  /** CDP protocol timeout override (ms). */
  protocolTimeout?: number;
  /** Player-ready timeout override (ms). */
  playerReadyTimeout?: number;
  /** Throw render failures to the caller instead of printing and exiting. */
  throwOnError?: boolean;
  /** Skip the interactive feedback prompt after a successful render. */
  skipFeedback?: boolean;
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

function dockerImageTagForPlatform(version: string, platform: string): string {
  // Suffix the tag with the arch so amd64 and arm64 images of the same
  // hyperframes version coexist in the local cache (a developer who flips
  // between hosts shouldn't have to rebuild).
  const archSuffix = platform === "linux/arm64" ? "-arm64" : "";
  return `${dockerImageTag(version)}${archSuffix}`;
}

function ensureDockerImage(version: string, platform: string, quiet: boolean): string {
  const tag = dockerImageTagForPlatform(version, platform);

  if (dockerImageExists(tag)) {
    if (!quiet) console.log(c.dim(`  Docker image: ${tag} (cached)`));
    return tag;
  }

  if (!quiet) console.log(c.dim(`  Building Docker image: ${tag} (${platform})...`));

  const dockerfilePath = resolveDockerfilePath();

  // Copy Dockerfile to a temp build context so docker build has a clean context
  const tmpDir = join(tmpdir(), `hyperframes-docker-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(join(tmpDir, "Dockerfile"), readFileSync(dockerfilePath));

  // Platform is now derived from the host arch (see resolveDockerPlatform).
  // Apple Silicon and other arm64 hosts get a native linux/arm64 build; the
  // Dockerfile skips chrome-headless-shell on arm64 and falls back to system
  // chromium because chrome-headless-shell ships linux64 only.
  //
  // TARGETARCH is passed explicitly rather than relying on BuildKit's
  // automatic platform args because the legacy builder (and some BuildKit
  // configurations like colima 0.6.x) leaves it unset, which would defeat
  // the arch conditional in the Dockerfile.
  const targetArch = platform === "linux/arm64" ? "arm64" : "amd64";
  try {
    execFileSync(
      "docker",
      [
        "build",
        "--platform",
        platform,
        "--build-arg",
        `HYPERFRAMES_VERSION=${version}`,
        "--build-arg",
        `TARGETARCH=${targetArch}`,
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

/**
 * Resolves the Docker `--platform` for this host and enforces the constraints
 * that come with it — keeping that policy out of `renderDocker` so the
 * orchestrator stays focused on build/run wiring. May terminate the process
 * via errorBox on unrecoverable mismatches (e.g. --gpu on arm64).
 */
function resolveDockerHostPlatform(options: RenderOptions): string {
  const platform = resolveDockerPlatform();

  // Docker Desktop on Apple Silicon (and colima with VZ) doesn't implement
  // the `--gpus` host-passthrough flag, so requesting `--gpu` on a linux/arm64
  // container fails at `docker run` with an opaque device-driver error. Catch
  // it early with actionable guidance.
  if (options.gpu && platform === "linux/arm64") {
    errorBox(
      "--gpu is not supported with --docker on arm64 hosts",
      "Docker Desktop/colima on Apple Silicon doesn't expose --gpus host passthrough to linux/arm64 containers.",
      "Drop --gpu, or run a native (non-Docker) render on this host, or set HYPERFRAMES_DOCKER_PLATFORM=linux/amd64 if you need GPU encoding (slow under qemu but works).",
    );
    process.exit(1);
  }

  if (!options.quiet && platform === "linux/arm64") {
    // chrome-headless-shell doesn't publish a linux-arm64 build, so the arm64
    // image falls back to system chromium. That loses byte-for-byte parity
    // with amd64 renders — fine for end-user output, not fine if you're
    // comparing against an amd64 golden baseline. Set
    // HYPERFRAMES_DOCKER_PLATFORM=linux/amd64 to keep parity (qemu-emulated,
    // slower).
    console.log(
      c.dim(
        "  Host is arm64 — using linux/arm64 image with system chromium " +
          "(output won't be byte-identical to amd64 renders; " +
          "set HYPERFRAMES_DOCKER_PLATFORM=linux/amd64 to force parity).",
      ),
    );
  }

  return platform;
}

// Inherited minor finding (CRAP 37.1, cyclomatic 11). This PR only added
// `pageNavigationTimeoutMs` to the options forwarded to `buildDockerRunArgs`.
// fallow-ignore-next-line complexity
async function renderDocker(
  projectDir: string,
  outputPath: string,
  options: RenderOptions,
): Promise<SingleRenderResult> {
  const startTime = Date.now();

  // Dev mode (tsx/ts-node) uses "latest" since the local version isn't on npm
  const dockerVersion = isDevMode() ? "latest" : VERSION;
  if (!options.quiet && isDevMode()) {
    console.log(c.dim("  Dev mode: using hyperframes@latest in Docker image"));
  }

  const platform = resolveDockerHostPlatform(options);

  let imageTag: string;
  try {
    imageTag = ensureDockerImage(dockerVersion, platform, options.quiet);
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
    platform,
    options: {
      fps: options.fps,
      quality: options.quality,
      format: options.format,
      gifLoop: options.gifLoop,
      workers: options.workers,
      gpu: options.gpu,
      browserGpu: options.browserGpuMode === "hardware",
      hdrMode: options.hdrMode,
      crf: options.crf,
      vp9CpuUsed: options.vp9CpuUsed,
      videoBitrate: options.videoBitrate,
      videoFrameFormat: options.videoFrameFormat,
      quiet: options.quiet,
      variables: options.variables,
      entryFile: options.entryFile,
      outputResolution: options.outputResolution,
      pageSideCompositing: options.pageSideCompositing,
      debug: options.debug,
      pageNavigationTimeoutMs: options.pageNavigationTimeoutMs,
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
    authoringSkill: options.authoringSkill,
    ...getMemorySnapshot(),
  });

  printRenderComplete(outputPath, elapsed, options.quiet);
  if (options.exitAfterComplete) scheduleRenderProcessExit();
  return { renderTimeMs: elapsed };
}

// fallow-ignore-next-line complexity
export async function renderLocal(
  projectDir: string,
  outputPath: string,
  options: RenderOptions,
): Promise<SingleRenderResult> {
  const preflight = await runEnvironmentChecks({
    projectDir,
    browserPath: options.browserPath,
    includeBrowser: true,
    includeDisk: true,
    includeWindowsUnc: true,
  });
  const failedChecks = preflight.outcomes.filter((outcome) => !outcome.ok);
  if (failedChecks.length > 0) {
    for (const check of failedChecks) {
      errorBox(check.title ?? `${check.name} check failed`, check.detail, check.hint);
    }
    process.exit(1);
  }
  if (!options.quiet) {
    for (const outcome of preflight.outcomes) {
      if (outcome.level === "warn") {
        console.warn(c.warn(`  ${outcome.name}: ${outcome.detail}`));
        if (outcome.hint) console.warn(c.dim(`  ${outcome.hint}`));
      }
    }
  }

  if (preflight.ffmpegPath) process.env.HYPERFRAMES_FFMPEG_PATH = preflight.ffmpegPath;
  if (preflight.ffprobePath) process.env.HYPERFRAMES_FFPROBE_PATH = preflight.ffprobePath;
  if (preflight.browser?.executablePath && !process.env.PRODUCER_HEADLESS_SHELL_PATH) {
    process.env.PRODUCER_HEADLESS_SHELL_PATH = preflight.browser.executablePath;
  }

  const producer = await loadProducer();

  const startTime = Date.now();
  const logger = createRenderTelemetryLogger(
    producer.createConsoleLogger?.(options.debug ? "debug" : "info") ?? createNoopProducerLogger(),
  );

  const job = producer.createRenderJob({
    fps: options.fps,
    quality: options.quality,
    format: options.format,
    gifLoop: options.gifLoop,
    workers: options.workers,
    useGpu: options.gpu,
    logger,
    producerConfig: producer.resolveConfig({
      browserGpuMode: options.browserGpuMode ?? "software",
      ...(options.pageNavigationTimeoutMs != null
        ? { pageNavigationTimeout: options.pageNavigationTimeoutMs }
        : {}),
      ...(options.protocolTimeout != null && { protocolTimeout: options.protocolTimeout }),
      ...(options.playerReadyTimeout != null && { playerReadyTimeout: options.playerReadyTimeout }),
      ...(options.vp9CpuUsed != null ? { vp9CpuUsed: options.vp9CpuUsed } : {}),
    }),
    hdrMode: options.hdrMode,
    crf: options.crf,
    videoBitrate: options.videoBitrate,
    videoFrameFormat: options.videoFrameFormat,
    variables: options.variables,
    entryFile: options.entryFile,
    outputResolution: options.outputResolution,
    debug: options.debug,
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
      job,
    );
  }

  const elapsed = Date.now() - startTime;
  trackRenderMetrics(job, elapsed, options, false);
  printRenderComplete(outputPath, elapsed, options.quiet);
  if (!options.skipFeedback) {
    await maybePromptRenderFeedback({
      renderDurationMs: elapsed,
      quiet: options.quiet,
    });
  }
  if (options.exitAfterComplete) scheduleRenderProcessExit();
  const durationMs = job.perfSummary
    ? Math.round(job.perfSummary.compositionDurationSeconds * 1000)
    : undefined;
  return { renderTimeMs: elapsed, durationMs };
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

function metaString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = meta?.[key];
  return typeof value === "string" ? value : undefined;
}

function metaNumber(meta: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = meta?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function metaBoolean(meta: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = meta?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function trackRenderTraceFromLog(message: string, meta: Record<string, unknown> | undefined): void {
  if (message !== "[Render:trace]") return;
  const status = metaString(meta, "status");
  if (status !== "checkpoint" && status !== "error") return;
  trackRenderObservation({
    source: "cli",
    renderJobId: metaString(meta, "renderJobId"),
    phase: metaString(meta, "phase"),
    status,
    compositionHash: metaString(meta, "compositionHash"),
    elapsedMs: metaNumber(meta, "elapsedMs"),
    durationMs: metaNumber(meta, "durationMs"),
    message: metaString(meta, "message"),
    workerCount: metaNumber(meta, "workerCount"),
    forceScreenshot: metaBoolean(meta, "forceScreenshot"),
    useStreamingEncode: metaBoolean(meta, "useStreamingEncode"),
    useLayeredComposite: metaBoolean(meta, "useLayeredComposite"),
    usePageSideCompositing: metaBoolean(meta, "usePageSideCompositing"),
    hasHdrContent: metaBoolean(meta, "hasHdrContent"),
    captureMode: metaString(meta, "captureMode"),
    videoCount: metaNumber(meta, "videoCount"),
    extractedVideoCount: metaNumber(meta, "extractedVideoCount"),
    totalFramesExtracted: metaNumber(meta, "totalFramesExtracted"),
    maxFramesPerVideo: metaNumber(meta, "maxFramesPerVideo"),
    avgFramesPerExtractedVideo: metaNumber(meta, "avgFramesPerExtractedVideo"),
    vfrPreflightCount: metaNumber(meta, "vfrPreflightCount"),
    vfrPreflightMs: metaNumber(meta, "vfrPreflightMs"),
    cacheHits: metaNumber(meta, "cacheHits"),
    cacheMisses: metaNumber(meta, "cacheMisses"),
  });
}

function createRenderTelemetryLogger(base: ProducerLogger): ProducerLogger {
  return {
    error(message, meta) {
      base.error(message, meta);
      trackRenderTraceFromLog(message, meta);
    },
    warn(message, meta) {
      base.warn(message, meta);
      trackRenderTraceFromLog(message, meta);
    },
    info(message, meta) {
      base.info(message, meta);
      trackRenderTraceFromLog(message, meta);
    },
    debug(message, meta) {
      base.debug(message, meta);
      trackRenderTraceFromLog(message, meta);
    },
    isLevelEnabled(level) {
      return base.isLevelEnabled?.(level) ?? true;
    },
  };
}

function createNoopProducerLogger(): ProducerLogger {
  return {
    error() {},
    warn() {},
    info() {},
    debug() {},
    isLevelEnabled() {
      return true;
    },
  };
}

function handleRenderError(
  error: unknown,
  options: RenderOptions,
  startTime: number,
  docker: boolean,
  hint: string,
  failedStage?: string,
  job?: RenderJob,
): never {
  const message = normalizeErrorMessage(error);
  trackRenderError({
    fps: fpsToNumber(options.fps),
    quality: options.quality,
    docker,
    workers: options.workers,
    gpu: options.gpu,
    authoringSkill: options.authoringSkill,
    elapsedMs: Date.now() - startTime,
    errorMessage: message,
    failedStage,
    ...renderJobObservabilityTelemetryPayload(job),
    ...getMemorySnapshot(),
  });
  if (options.throwOnError) {
    throw new Error(message);
  }
  errorBox("Render failed", message, hint);
  process.exit(1);
}

/**
 * Extract rich metrics from the completed render job and send to telemetry.
 * speed_ratio = composition_duration / render_time — higher is better, >1 means faster than realtime.
 */
// Inherited CRITICAL (CRAP 148.4, cyclomatic 24): exhaustive nullish-fallback
// chain across 30+ telemetry fields. Not touched by this PR.
// fallow-ignore-next-line complexity
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
    authoringSkill: options.authoringSkill,
    staticDedupEnabled: perf?.staticDedup?.enabled,
    staticDedupArmed: perf?.staticDedup?.armed,
    staticDedupSkipReason: perf?.staticDedup?.skipReason,
    staticDedupPredictedFrames: perf?.staticDedup?.predictedFrames,
    staticDedupReusedFrames: perf?.staticDedup?.reusedFrames,
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
    stageCaptureSetupMs: stages.captureSetupMs,
    stageCaptureFrameMs: stages.captureFrameMs,
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
    ...renderJobObservabilityTelemetryPayload(job),
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
