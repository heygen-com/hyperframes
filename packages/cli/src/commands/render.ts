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
  hasExplicitCompositionArg,
  resolveBrowserTimeoutMsArg,
  resolveCompositionEntryArg,
  resolveDefaultFpsArg,
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
import { formatBytes, formatRenderSummaryDetail, errorBox } from "../ui/format.js";
import { warnIfWebmAlphaDropped } from "../utils/webmAlphaCheck.js";
import { renderProgress } from "../ui/progress.js";
import {
  trackRenderComplete,
  trackRenderError,
  trackRenderObservation,
  trackRenderPreflightRejected,
} from "../telemetry/events.js";
import { maybePromptRenderFeedback } from "../telemetry/feedback.js";
import { readConfigFresh, writeConfig, type HyperframesConfig } from "../telemetry/config.js";
import { shouldTrack } from "../telemetry/client.js";
import { renderJobObservabilityTelemetryPayload } from "../telemetry/renderObservability.js";
import { normalizeSkillSlug } from "../telemetry/skill.js";
import { bytesToMb } from "../telemetry/system.js";
import { VERSION } from "../version.js";
import { isDevMode } from "../utils/env.js";
import { buildDockerRunArgs, resolveDockerPlatform } from "../utils/dockerRunArgs.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { runEnvironmentChecks } from "../browser/preflight.js";
import { chromeLaunchRemediation } from "../browser/linuxDeps.js";
import type { ProducerLogger, RenderJob } from "@hyperframes/producer";
import {
  MAX_VP9_CPU_USED,
  MIN_VP9_CPU_USED,
  isVideoFrameFormat,
  type VideoFrameFormat,
} from "@hyperframes/engine";
import {
  normalizeResolutionFlag,
  checkOutputResolutionCompatibility,
  parseFps,
  fpsToNumber,
  fpsToFfmpegArg,
  type CanvasResolution,
  type OutputResolutionIssueKind,
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
        "23.976, 60000/1001 for 59.94). Range 1-240. " +
        "Defaults to the composition's root data-fps, else 30.",
      // No `default` here on purpose: citty would set args.fps="30" on
      // omission, which would make explicitFps always non-null and short-
      // circuit the data-fps resolution below (resolveDefaultFpsArg). The
      // "30" fallback lives at the parseFps(fpsArg ?? "30") call instead.
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
    "experimental-fast-capture": {
      type: "boolean",
      description:
        "Capture frames via Chrome's drawElementImage API instead of " +
        "Page.captureScreenshot — reads DOM paint records directly, ~2x faster. " +
        "Default: on where it can engage (macOS + hardware-GPU browser); " +
        "incompatible compositions and self-verification failures fall back to " +
        "screenshot capture automatically. Pass =false to disable. " +
        "Env: PRODUCER_EXPERIMENTAL_FAST_CAPTURE.",
      // No `default` — an omitted flag must stay `undefined` so the `!= null`
      // guard below leaves PRODUCER_EXPERIMENTAL_FAST_CAPTURE untouched and the
      // env fallback survives (matches the --low-memory-mode idiom).
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
    const hasExplicitComposition = hasExplicitCompositionArg(args.composition);
    const project = resolveProject(args.dir, { requireIndex: !hasExplicitComposition });

    // ── Resolve composition entry file ─────────────────────────────────────
    // Needed early: fps default below must read the actual render target, not
    // always index.html.
    const entryFile = resolveCompositionEntryArg(args.composition, project.dir, statSync);
    const renderTarget = entryFile ? resolve(project.dir, entryFile) : project.indexPath;

    // ── Validate fps ───────────────────────────────────────────────────────
    // Accept either integer (`30`) or ffmpeg-style rational (`30000/1001`).
    // The whitelist-based validator was replaced with a sane numeric range so
    // legitimate framerates (NTSC trio, PAL, 120/240 slow-mo) work without
    // CLI gymnastics. The exact rational survives end-to-end into FFmpeg's
    // `-r` / `-framerate` flags via `fpsToFfmpegArg`.
    // Precedence: explicit --fps, else the composition's root data-fps, else 30.
    // Honoring data-fps matches the runtime — render used to silently force 30
    // even when the composition declared e.g. data-fps="24".
    const fpsArg = resolveDefaultFpsArg(args.fps, project.dir, project.indexPath, entryFile);
    const fpsParse = parseFps(fpsArg ?? "30");
    if (!fpsParse.ok) {
      errorBox("Invalid fps", formatFpsParseError(fpsArg ?? "30", fpsParse.reason));
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

    // ── Override: experimental fast capture (drawElementImage) ───────────
    if (args["experimental-fast-capture"] != null) {
      process.env.PRODUCER_EXPERIMENTAL_FAST_CAPTURE = args["experimental-fast-capture"]
        ? "true"
        : "false";
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

    // ── Validate browser-timeout (seconds) ───────────────────────────────
    // This validator lives in `utils/renderArgs.ts` so the parse/reject
    // branches are unit-testable without `process.exit`. See issue #1199
    // for the original silent-timeout-0 footgun this guards.
    const pageNavigationTimeoutMs = resolveBrowserTimeoutMsArg(args["browser-timeout"]);

    // ── Preflight batch rows before browser/lint work ────────────────────
    let batchModule: typeof import("./batchRender.js") | undefined;
    let preparedBatch: import("./batchRender.js").PreparedBatchRender | undefined;
    if (batchPath) {
      batchModule = await import("./batchRender.js");
      try {
        preparedBatch = batchModule.prepareBatchRender({
          batchPath,
          outputTemplate: batchOutputTemplate,
          indexPath: renderTarget,
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
    // Always resolve to our own pinned/managed Chrome, never a
    // separately-installed puppeteer-cache binary or system Chrome — render
    // behavior (drawElement support included, HF#2060) shouldn't depend on
    // whatever arbitrary Chrome version happens to be on the machine.
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
          const info = await ensureBrowser({ preferManagedChrome: true });
          browserPath = info.executablePath;
        } else {
          const clack = await import("@clack/prompts");
          browserSpinner = clack.spinner();
          browserSpinner.start("Checking browser...");
          const info = await ensureBrowser({
            preferManagedChrome: true,
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
          normalizeErrorMessage(err),
          "Run: npx hyperframes browser ensure",
        );
        process.exit(1);
      }
    }

    // ── Pre-render lint ──────────────────────────────────────────────────
    {
      // lintProject's explicit-entry contract is an absolute source path;
      // entryFile is project-relative for the producer.
      const explicitEntry = entryFile ? renderTarget : undefined;
      const lintResult = await lintProject(project.dir, explicitEntry);
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
        console.log(c.dim(renderLintContinuationHint(strictErrors)));
        console.log("");
      }
    }

    // ── Pre-flight: output-resolution vs composition compatibility ────────
    // Catch a preset whose orientation/aspect ratio (or alpha/HDR mode)
    // conflicts with the composition BEFORE the browser and ffmpeg spin up —
    // otherwise this surfaces cryptically deep inside the render compiler
    // (resolveDeviceScaleFactor). Best-effort: a composition we can't read or
    // whose dimensions aren't a known preset falls through to the pipeline's
    // own defense-in-depth check rather than blocking a render we can't reason
    // about. See render-reliability workstream P1-3.
    if (outputResolution) {
      let resolutionIssue: { message: string; kind: OutputResolutionIssueKind } | undefined;
      try {
        resolutionIssue = await checkRenderResolutionPreflight(
          readFileSync(renderTarget, "utf8"),
          outputResolution,
          {
            alphaRequested: format === "webm" || format === "mov" || format === "png-sequence",
            hdrRequested: args.hdr ?? false,
          },
        );
      } catch {
        // Unreadable file is non-fatal here — the render pipeline will surface
        // the real problem with full context.
      }
      if (resolutionIssue) {
        // Count the pre-flight save so dashboard 1783183 can distinguish
        // "caught early by pre-flight" from a deep render failure or a user who
        // gave up — i.e. measure whether the P1-3 fix is doing its job.
        trackRenderPreflightRejected({ kind: resolutionIssue.kind });
        errorBox("Output resolution incompatible", resolutionIssue.message);
        process.exit(1);
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
        // Sequential batch rows may trial; real concurrent workers
        // (batchConcurrency > 1) can't safely share the trial's process-wide
        // env var/flags — see enableDeParallelRouterTrial's own doc comment.
        enableDeParallelRouterTrial: batchConcurrency <= 1,
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
      const issues = validateVariablesAgainstProject(renderTarget, variables);
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
        experimentalFastCapture: args["experimental-fast-capture"] === true,
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
        // The single top-level CLI render is sequential by construction — the
        // one place the trial's process-wide state is unconditionally safe.
        enableDeParallelRouterTrial: true,
      });
    }
  },
});

export interface SingleRenderResult {
  durationMs?: number;
  renderTimeMs: number;
}

export function renderLintContinuationHint(strictErrors: boolean): string {
  return strictErrors
    ? "  Continuing render despite lint warnings. Use --strict-all to block warnings."
    : "  Continuing render despite lint issues. Use --strict to block errors.";
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
  /** EXPERIMENTAL. drawElementImage frame capture (--experimental-fast-capture). */
  experimentalFastCapture?: boolean;
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
  /**
   * OPT IN to the DE parallel-router CLI trial
   * (`maybeEnableDeParallelRouterTrial`) for this render. Default OFF —
   * only the top-level CLI render command's own call sites should ever set
   * this (review): the trial mechanism shares one process-wide env var and
   * two module-level flags across every `renderLocal` call in the process,
   * which is safe for SEQUENTIAL calls (single render, single-concurrency
   * batch rows) but not for genuinely concurrent ones — racing invocations
   * could tear down or misattribute each other's outcome. Programmatic
   * consumers importing `renderLocal` (a future studio-server path, test
   * harnesses, distributed runners) therefore get NO trial unless they
   * explicitly opt in AND guarantee sequential invocation. The CLI sets
   * this for single renders and for `--batch` at concurrency 1; it leaves
   * it unset for `--batch-concurrency N>=2`.
   */
  enableDeParallelRouterTrial?: boolean;
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

/**
 * Read a composition's dimensions from the SAME source the producer's compiler
 * uses — `data-width` / `data-height` on the `[data-composition-id]` root (see
 * htmlCompiler.ts). Returns `undefined` when they can't be determined (no root,
 * missing/invalid attrs, unparseable HTML). Note the producer *defaults* a
 * missing attr to 1080; this pre-flight deliberately defers instead (returns
 * `undefined`) rather than guess a dimension the author didn't declare, so it
 * never false-aborts — the producer's defense-in-depth still catches that case.
 *
 * Deriving dims any other way (e.g. `data-resolution` or a `#stage` heuristic)
 * risks disagreeing with the actual render: most compositions (all registry
 * blocks) carry `data-width/height` and no `data-resolution`, so a parallel
 * heuristic could false-abort a valid render. `DOMParser` isn't shipped by
 * Node — the CLI polyfills it via linkedom, imported lazily so the heavy DOM
 * library stays out of `render.js`'s module-load graph (it cold-imports at
 * >5 s already; a static linkedom import tips the render test suite's import
 * hook over its timeout — see the note on `renderLocal browser GPU config`).
 */
async function readCompositionDimensions(
  compositionHtml: string,
): Promise<{ width: number; height: number } | undefined> {
  try {
    const { ensureDOMParser } = await import("../utils/dom.js");
    ensureDOMParser();
    const doc = new DOMParser().parseFromString(compositionHtml, "text/html");
    const rootEl = doc.querySelector("[data-composition-id]");
    const width = parseInt(rootEl?.getAttribute("data-width") ?? "", 10);
    const height = parseInt(rootEl?.getAttribute("data-height") ?? "", 10);
    if (width > 0 && height > 0) return { width, height };
  } catch {
    // Unreadable / unparseable composition — fall through to `undefined`.
  }
  return undefined;
}

/**
 * Render pre-flight: return an actionable message when the chosen
 * `outputResolution` preset is incompatible with the composition's
 * orientation/aspect ratio, or with the alpha/HDR mode — or `undefined` when
 * the combination is fine (or can't be determined statically).
 *
 * Extracted (and exported) so the CLI wiring around `process.exit` stays a
 * thin adapter and the branch logic is unit-testable. See render-reliability
 * workstream P1-3.
 */
export async function checkRenderResolutionPreflight(
  compositionHtml: string,
  outputResolution: CanvasResolution | undefined,
  modes: { alphaRequested: boolean; hdrRequested: boolean },
): Promise<{ message: string; kind: OutputResolutionIssueKind } | undefined> {
  if (!outputResolution) return undefined;
  const dims = await readCompositionDimensions(compositionHtml);
  // Couldn't determine the composition's actual dimensions — defer to the
  // pipeline's own defense-in-depth check rather than guess.
  if (!dims) return undefined;
  const compat = checkOutputResolutionCompatibility({
    compositionWidth: dims.width,
    compositionHeight: dims.height,
    outputResolution,
    alphaRequested: modes.alphaRequested,
    hdrRequested: modes.hdrRequested,
  });
  // Narrow to the incompatible case; `message`/`kind` are always set there.
  if (compat.ok || !compat.message || !compat.kind) return undefined;
  return { message: compat.message, kind: compat.kind };
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
  // Dockerfile installs a pinned arm64 chrome-headless-shell from Playwright
  // (chrome-for-testing publishes no linux-arm64 build).
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
    const message = normalizeErrorMessage(error);
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
    // The arm64 image uses Playwright's pinned linux-arm64 chrome-headless-shell
    // (chrome-for-testing has no arm64 build). It's a different Chromium build
    // than amd64's chrome-for-testing binary, so output isn't byte-identical to
    // an amd64 golden baseline — fine for end-user output. Set
    // HYPERFRAMES_DOCKER_PLATFORM=linux/amd64 to force parity (qemu-emulated,
    // slower).
    console.log(
      c.dim(
        "  Host is arm64 — using linux/arm64 image with Playwright's " +
          "chrome-headless-shell (output won't be byte-identical to amd64 " +
          "renders; set HYPERFRAMES_DOCKER_PLATFORM=linux/amd64 to force parity).",
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
    const message = normalizeErrorMessage(error);
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
      experimentalFastCapture: options.experimentalFastCapture,
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

  // ponytail: Docker runs the producer in a child process, so no perfSummary is
  // threaded back here; the summary shows render time only (never a wrong video
  // length). Probe the output with ffprobe if a duration figure is wanted here.
  printRenderComplete(outputPath, elapsed, options.quiet);
  warnIfWebmAlphaDropped(outputPath, options.format, options.quiet);
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
  const deParallelRouterTrialArmed = maybeEnableDeParallelRouterTrial(
    options.quiet,
    options.enableDeParallelRouterTrial === true,
  );

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
    maybeConsumeDeParallelRouterTrial(deParallelRouterTrialArmed, job, options.quiet);
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

  maybeConsumeDeParallelRouterTrial(deParallelRouterTrialArmed, job, options.quiet);
  const elapsed = Date.now() - startTime;
  trackRenderMetrics(job, elapsed, options, false);
  printRenderComplete(
    outputPath,
    elapsed,
    options.quiet,
    job.perfSummary?.compositionDurationSeconds,
    job.perfSummary?.totalFrames,
  );
  warnIfWebmAlphaDropped(outputPath, options.format, options.quiet);
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
  if (status !== "start" && status !== "end" && status !== "checkpoint" && status !== "error") {
    return;
  }
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
    captureOperation: metaString(meta, "captureOperation"),
    framesCompleted: metaNumber(meta, "framesCompleted"),
    totalFrames: metaNumber(meta, "totalFrames"),
    heartbeatIndex: metaNumber(meta, "heartbeatIndex"),
    stageElapsedMs: metaNumber(meta, "stageElapsedMs"),
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

/** Backstop cap: even absent an actual router failure, stop offering the
 * trial after this many engaged (routed or reverted) renders for an
 * install. Without this, a healthy router that never reverts would stay
 * force-enabled on every eligible render forever (review finding). */
const DE_PARALLEL_ROUTER_TRIAL_MAX_RENDERS = 25;

/**
 * True across every `renderLocal` call in THIS process once the trial has
 * armed `HF_DE_PARALLEL_ROUTER` here — distinct from the env var's own
 * value, which stays "true" across an entire `--batch` run. Without this,
 * a second batch row's `process.env.HF_DE_PARALLEL_ROUTER !== undefined`
 * check can't tell "we set this ourselves on row 1" from "the user set
 * this" and would wrongly treat itself as un-armed, silently dropping that
 * row's outcome from ever reaching `maybeConsumeDeParallelRouterTrial`
 * (review finding).
 */
let deParallelRouterTrialManagedByUs = false;

/**
 * In-process latch mirroring `deParallelRouterTrialFired`: set the moment we
 * DECIDE the trial is over, independent of whether persisting that decision
 * to `~/.hyperframes/config.json` succeeds. `writeConfig` swallows all fs
 * errors (by design — telemetry must never break the CLI), so on an
 * unwritable config (root-owned file, disk full) the fired flag can never
 * stick on disk; without this latch the trial would silently re-arm and
 * re-fail on every subsequent render in this process forever (review
 * finding). Later processes still re-arm — disk is the only cross-process
 * channel — but each process now stops after at most one failure it
 * couldn't record.
 */
let deParallelRouterTrialFiredThisProcess = false;

/**
 * Test-only reset for the module-level trial state — a real CLI process
 * only ever runs one `--batch` sequence, so this state never needs
 * resetting outside a test process where many independent test cases share
 * one imported module instance.
 */
// fallow-ignore-next-line unused-export
export function __resetDeParallelRouterTrialStateForTests(): void {
  deParallelRouterTrialManagedByUs = false;
  deParallelRouterTrialFiredThisProcess = false;
}

/**
 * True once the trial should stop offering itself: already failed (on disk
 * or via this process's in-memory latch), hit the render-count backstop, or
 * telemetry isn't actually recordable right now.
 *
 * Checks BOTH `shouldTrack()` and `config.telemetryEnabled` directly, not
 * `shouldTrack()` alone: `shouldTrack()` (`../telemetry/client.js`) memoizes
 * its verdict once per process and never invalidates, so during a long
 * `--batch` run (all rows share one process) a `hyperframes telemetry off`
 * issued from another terminal mid-batch would never be observed. The
 * caller must pass a `readConfigFresh()` snapshot for the same reason —
 * `readConfig()` serves a process-lifetime cache that is exactly as stale
 * as the `shouldTrack()` memoization this check exists to bypass (review
 * finding).
 */
function isDeParallelRouterTrialBlocked(config: HyperframesConfig): boolean {
  const overRenderCap =
    (config.deParallelRouterTrialRenderCount ?? 0) >= DE_PARALLEL_ROUTER_TRIAL_MAX_RENDERS;
  return (
    deParallelRouterTrialFiredThisProcess ||
    Boolean(config.deParallelRouterTrialFired) ||
    overRenderCap ||
    !config.telemetryEnabled ||
    !shouldTrack() ||
    // cli.ts shows the first-run telemetry disclosure via a fire-and-forget,
    // unawaited dynamic import — there's no guarantee it has printed before
    // this render command reaches this point. Requiring telemetryNoticeShown
    // means the trial simply never offers itself on a fresh install's very
    // first invocation (before the disclosure is guaranteed to have run at
    // least once), rather than racing an experimental opt-in message against
    // the disclosure it depends on (review finding).
    !config.telemetryNoticeShown
  );
}

/** Shared cleanup for both `maybeEnableDeParallelRouterTrial` (this process
 * should stop offering the trial) and `maybeConsumeDeParallelRouterTrial`
 * (the trial just failed/hit its cap) — a no-op unless WE were the ones
 * managing the env var. */
function stopManagingDeParallelRouterTrial(): void {
  if (!deParallelRouterTrialManagedByUs) return;
  delete process.env.HF_DE_PARALLEL_ROUTER;
  deParallelRouterTrialManagedByUs = false;
}

/**
 * Enable the DE parallel-router experiment (`HF_DE_PARALLEL_ROUTER`, default
 * off) for this render, on every eligible render for this install (up to
 * `DE_PARALLEL_ROUTER_TRIAL_MAX_RENDERS`), so we get real-traffic router
 * telemetry (revert rate, verify-db distribution) without requiring anyone
 * to manually set the env var — see `HyperframesConfig.deParallelRouterTrialFired`.
 * See `maybeConsumeDeParallelRouterTrial` for what turns it off. Returns
 * whether this call armed it (so the caller knows to check for consumption
 * afterward) — false unless the caller explicitly opted in (`enabled` —
 * OPT-IN polarity, review: only the top-level CLI render command's own
 * sequential call sites set it; programmatic `renderLocal` consumers get no
 * trial by default because the mechanism's process-wide state is unsafe
 * under concurrent invocation — see
 * `RenderOptions.enableDeParallelRouterTrial`), if it's already failed (or
 * hit the render cap) for this install, if the user already set the env var
 * themselves (never override an explicit choice — see
 * `deParallelRouterTrialManagedByUs` for how a later `--batch` row
 * distinguishes that from our own earlier arm), or if telemetry isn't
 * actually recordable right now (see `isDeParallelRouterTrialBlocked`; no
 * point risking the experimental path if we can't even record the
 * resulting signal).
 */
function maybeEnableDeParallelRouterTrial(quiet: boolean, enabled: boolean): boolean {
  if (!enabled) return false;
  // The in-process latch alone decides once it's set — short-circuit before
  // the disk read so post-fired batch rows don't pay a config read + parse +
  // shared-cache invalidation per row for an answer module state already
  // knows (review finding).
  if (deParallelRouterTrialFiredThisProcess) {
    stopManagingDeParallelRouterTrial();
    return false;
  }
  const userSetIt =
    process.env.HF_DE_PARALLEL_ROUTER !== undefined && !deParallelRouterTrialManagedByUs;
  if (userSetIt) return false;

  // readConfigFresh, NOT readConfig: the cached read is exactly as stale as
  // the shouldTrack() memoization the blocked-check exists to bypass — a
  // mid-batch `hyperframes telemetry off` (or another process persisting
  // fired=true) would never be observed through the cache (review finding).
  if (isDeParallelRouterTrialBlocked(readConfigFresh())) {
    stopManagingDeParallelRouterTrial();
    return false;
  }

  if (deParallelRouterTrialManagedByUs) return true;
  deParallelRouterTrialManagedByUs = true;
  process.env.HF_DE_PARALLEL_ROUTER = "true";
  if (!quiet) {
    console.log(
      c.dim(
        "  Trying the experimental parallel drawElement capture path for this install " +
          "(disabled automatically if it ever needs to fall back; opt out anytime: " +
          "HF_DE_PARALLEL_ROUTER=false)",
      ),
    );
  }
  return true;
}

/**
 * The router outcome for this render, or undefined when the router never
 * engaged. `perfSummary.drawElement.parallelRouter` is NEVER undefined on
 * the success path — aggregateDrawElement (perfSummary.ts) defaults it to
 * the string "none" for every render, whether or not drawElement/the router
 * ever engaged. Normalizing "none" to undefined here is required, not
 * optional: without it, ordinary renders below the router's own frame
 * threshold (the common case) would tick the render-count backstop on every
 * single render and trip DE_PARALLEL_ROUTER_TRIAL_MAX_RENDERS after 25
 * completely unrelated renders that never touched the router (review
 * finding).
 */
function resolveDeParallelRouterOutcome(job: RenderJob): string | undefined {
  const outcome =
    job.perfSummary?.drawElement?.parallelRouter ??
    job.errorDetails?.observability?.capture.deParallelRouter;
  return outcome === "none" ? undefined : outcome;
}

/**
 * Persist `deParallelRouterTrialFired: true`, verifying against a fresh
 * disk read that it actually stuck, and re-asserting if a concurrent
 * writer's stale snapshot clobbered it. ONLY the fired flag is retried —
 * re-asserting a boolean is idempotent, so retries can't corrupt anything,
 * unlike the render counter (a re-applied increment double-counts the
 * render when our write landed but a later concurrent write raced our
 * verify read — review finding). Returns false as soon as `writeConfig`
 * reports an fs failure (unwritable `~/.hyperframes` — retrying a failed
 * write is pointless, so the retries are reserved for genuine concurrent
 * clobbers, where the write landed but a racing writer's stale snapshot
 * overwrote it — review finding).
 */
function persistDeParallelRouterTrialFired(): boolean {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const config = readConfigFresh();
    if (config.deParallelRouterTrialFired) return true;
    config.deParallelRouterTrialFired = true;
    if (!writeConfig(config)) return false;
  }
  return Boolean(readConfigFresh().deParallelRouterTrialFired);
}

/**
 * After a trial-armed render, persist that the router's OWN bet actually
 * failed — its self-verify/generic-failure safety net fired
 * (`deParallelRouter === "reverted"`) — or that the render-count backstop
 * (`DE_PARALLEL_ROUTER_TRIAL_MAX_RENDERS`) was reached, so it's never
 * enabled again for this install. A clean "routed" (the render succeeded
 * with no fallback) does NOT consume the trial by itself — the whole point
 * is to keep trying on every eligible render until we see a real failure
 * signal (bounded by the render cap), maximizing successful-routing
 * telemetry volume rather than stopping at the first data point. Checks
 * both the success path (`perfSummary`) and the failure path
 * (`errorDetails.observability.capture`, mutated in place before a hard
 * failure throws) — a render that still failed even after the fallback
 * retry counts too. A render that crashed for an unrelated reason while
 * merely "routed" (never reached "reverted" — e.g. cancellation) does NOT
 * count as a router failure and does not turn the trial off. No-ops if the
 * router never became eligible for this render (e.g. too few frames): the
 * trial stays available for a future run either way, uncounted.
 *
 * Cross-process race semantics (no file locking exists here): the render
 * COUNTER is written exactly once, unverified — a lost increment under a
 * concurrent-writer race just under-counts the exposure cap by one
 * (benign), whereas retrying it would double-count this render whenever our
 * write actually landed but another writer raced the verify read (trips the
 * cap early, killing the trial prematurely — review finding). The FIRED
 * flag is the safety-critical bit and IS verified/re-asserted — see
 * `persistDeParallelRouterTrialFired`.
 */
function maybeConsumeDeParallelRouterTrial(
  trialArmed: boolean,
  job: RenderJob,
  quiet: boolean,
): void {
  if (!trialArmed) return;
  const outcome = resolveDeParallelRouterOutcome(job);
  if (outcome === undefined) return;

  const config = readConfigFresh();
  const renderCount = (config.deParallelRouterTrialRenderCount ?? 0) + 1;
  config.deParallelRouterTrialRenderCount = renderCount;
  const fired = outcome === "reverted" || renderCount >= DE_PARALLEL_ROUTER_TRIAL_MAX_RENDERS;
  if (fired) {
    config.deParallelRouterTrialFired = true;
    // Latch BEFORE attempting persistence — the decision holds for this
    // process even if the disk write never sticks (unwritable config).
    deParallelRouterTrialFiredThisProcess = true;
    stopManagingDeParallelRouterTrial();
  }
  writeConfig(config);
  // `!quiet`-gated like every other trial message: quiet/batch-json renders
  // must produce no unexpected terminal output — CI wrappers asserting
  // empty stderr would misread the warning as a render failure (review
  // finding). The in-process latch above already guarantees the safety
  // behavior the warning describes, whether or not it prints.
  if (fired && !persistDeParallelRouterTrialFired() && !quiet) {
    console.warn(
      c.warn(
        "  Could not persist the parallel drawElement trial's off-switch to " +
          "~/.hyperframes/config.json (unwritable?). The experiment stays off for this " +
          "process; future runs may retry it. Set HF_DE_PARALLEL_ROUTER=false to opt out.",
      ),
    );
  }
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
  // A `Failed to launch the browser process` / `libnss3.so cannot open ...`
  // failure on Linux/WSL is an environment problem, not a composition bug.
  // Replace the generic "Try --docker" hint with the exact per-distro
  // remediation and a pointer at `doctor`.
  const remediation = chromeLaunchRemediation(message);
  if (remediation) {
    errorBox("Render failed — Chrome could not launch", message, remediation);
    process.exit(1);
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
    beginFrameNoDamageFrames: perf?.beginFrameReuse?.noDamageFrames,
    beginFrameHasDamageFrames: perf?.beginFrameReuse?.hasDamageFrames,
    deCaptureMode: perf?.drawElement?.mode,
    deCompileGate: perf?.drawElement?.compileGate,
    deClampReason: perf?.drawElement?.clampReason,
    deWorkerInversion: perf?.drawElement?.workerInversion,
    dePreInversionWorkers: perf?.drawElement?.preInversionWorkers,
    deParallelRouter: perf?.drawElement?.parallelRouter,
    dePreRouterWorkers: perf?.drawElement?.preRouterWorkers,
    deGateReason: perf?.drawElement?.gateReason,
    deWorkerEncode: perf?.drawElement?.workerEncode,
    deVerifyArmed: perf?.drawElement?.verifyArmed,
    deVerifyChecked: perf?.drawElement?.verifyChecked,
    deVerifyMinDb: perf?.drawElement?.verifyMinDb,
    deVerifyInitMs: perf?.drawElement?.verifyInitMs,
    deSelfVerifyFallback: perf?.drawElement?.selfVerifyFallback,
    deFallbackReason: perf?.drawElement?.fallbackReason,
    deBlankSuspects: perf?.drawElement?.blankSuspects,
    deBlankDeterministicAccepts: perf?.drawElement?.blankDeterministicAccepts,
    deBlankRecaptures: perf?.drawElement?.blankRecaptures,
    deBoundaryFrames: perf?.drawElement?.boundaryFrames,
    deNcprFallbacks: perf?.drawElement?.ncprFallbacks,
    compositionDurationMs,
    compositionWidth: perf?.resolution.width,
    compositionHeight: perf?.resolution.height,
    totalFrames: perf?.totalFrames,
    speedRatio,
    captureAvgMs: perf?.captureAvgMs,
    captureP50Ms: perf?.captureP50Ms,
    subTimelineWait: perf?.subTimelineWait,
    videoCount: perf?.videoCount,
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

function printRenderComplete(
  outputPath: string,
  elapsedMs: number,
  quiet: boolean,
  outputDurationSeconds?: number,
  frameCount?: number,
): void {
  if (quiet) return;

  let fileSize = "unknown";
  let isDirectory = false;
  try {
    const stat = statSync(outputPath);
    isDirectory = stat.isDirectory();
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

  const detail = formatRenderSummaryDetail({
    elapsedMs,
    outputDurationSeconds,
    isDirectory,
    frameCount,
  });
  console.log("");
  console.log(c.success("\u25C7") + "  " + c.accent(outputPath));
  console.log("   " + c.bold(fileSize) + c.dim(" \u00B7 " + detail));
}
