import { failCommand, requestCliExit } from "../utils/commandResult.js";
import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { createRenderPlan, resolveBrowserGpuForCli, type RenderFormat } from "./render/plan.js";
import { presentRenderPlan } from "./render/present.js";
import { executeRenderPlan, renderLintContinuationHint } from "./render/execute.js";
// Test-only seams retained at the command boundary for render behavior tests.
export { resolveBrowserGpuForCli, renderLintContinuationHint };

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
  [
    "Relocate frame cache off C: (Windows) or another small partition",
    "hyperframes render --frames-cache-dir D:/hf-cache --output out.mp4",
  ],
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
import { freemem, tmpdir } from "node:os";
import { resolve, dirname, join, basename } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { loadProducer } from "../utils/producer.js";
import { c } from "../ui/colors.js";
import { formatBytes, formatRenderSummaryDetail, errorBox } from "../ui/format.js";
import { warnIfWebmAlphaDropped } from "../utils/webmAlphaCheck.js";
import { renderProgress } from "../ui/progress.js";
import {
  trackRenderComplete,
  trackRenderError,
  trackRenderObservation,
} from "../telemetry/events.js";
import { maybePromptRenderFeedback } from "../telemetry/feedback.js";
import {
  readConfigFresh,
  recordRecentRender,
  writeConfig,
  type HyperframesConfig,
} from "../telemetry/config.js";
import { shouldTrack } from "../telemetry/client.js";
import { renderJobObservabilityTelemetryPayload } from "../telemetry/renderObservability.js";
import { bytesToMb } from "../telemetry/system.js";
import { VERSION } from "../version.js";
import { isDevMode } from "../utils/env.js";
import { buildDockerRunArgs, resolveDockerPlatform } from "../utils/dockerRunArgs.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { runEnvironmentChecks } from "../browser/preflight.js";
import {
  detectH264EncoderMode,
  getFFmpegInstallHint,
  H264EncoderUnavailableError,
} from "../browser/ffmpeg.js";
import { chromeLaunchRemediation } from "../browser/linuxDeps.js";
import { macosOldChromeCrashRemediation } from "../browser/macosOldChromeCrash.js";
import { killOrphanedProcesses } from "../utils/orphanCleanup.js";
import {
  markRenderSucceeded,
  runPostRenderStep,
  runPostRenderStepAsync,
} from "../utils/render-success-state.js";
import type { ProducerLogger, RenderJob } from "@hyperframes/producer";
import { EXTRACT_CACHE_DIR_DISABLED_ALIASES, type VideoFrameFormat } from "@hyperframes/engine";
import {
  checkOutputResolutionCompatibility,
  suggestMatchingPreset,
  fpsToNumber,
  type CanvasResolution,
  type OutputResolutionIssueKind,
  type Fps,
} from "@hyperframes/core";

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
    "best-effort": {
      type: "boolean",
      description:
        "Allow output with structured capture-readiness warnings (default). Use --no-best-effort to fail on missing or unready media.",
      default: true,
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
      description: "With --batch, emit exactly one final JSON result document.",
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
    "frames-cache-dir": {
      type: "string",
      description:
        "Directory for the content-addressed extracted-frame cache. " +
        "Use to relocate the cache off the system drive when the OS temp " +
        "directory lives on a small partition (e.g. Windows C: exhaustion " +
        `during long renders). Pass ${EXTRACT_CACHE_DIR_DISABLED_ALIASES.map((a) => `"${a}"`).join(" / ")} to ` +
        "disable caching entirely (frames extract into the render's workDir " +
        "and are cleaned up when the render ends). Default: " +
        "<tmpdir>/hyperframes-extract-cache-<uid>. " +
        "Env: HYPERFRAMES_EXTRACT_CACHE_DIR.",
    },
  },
  // Keep the transport adapter thin: each phase has one ownership boundary.
  async run({ args }) {
    const plan = createRenderPlan(args);
    await presentRenderPlan(plan);
    await executeRenderPlan(plan, {
      renderDocker,
      renderLocal,
      checkResolution: checkRenderResolutionPreflight,
    });
  },
});

export interface SingleRenderResult {
  durationMs?: number;
  renderTimeMs: number;
  outcome?: "completed" | "completed_with_warnings";
  warnings?: Array<{ code: string; message: string }>;
}

export interface RenderOptions {
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
  bestEffort?: boolean;
  browserPath?: string;
  variables?: Record<string, unknown>;
  entryFile?: string;
  exitAfterComplete?: boolean;
  /** Output resolution preset; see `resolveDeviceScaleFactor` for constraints. */
  outputResolution?: CanvasResolution;
  /** Whether the resolution names a tier without fixing an orientation. */
  outputResolutionAspectAgnostic?: boolean;
  /** Raw resolution flag retained for the in-container CLI. */
  outputResolutionRaw?: string;
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
  modes: { alphaRequested: boolean; hdrRequested: boolean; aspectAgnostic?: boolean },
): Promise<{ message: string; kind: OutputResolutionIssueKind } | undefined> {
  if (!outputResolution) return undefined;
  const dims = await readCompositionDimensions(compositionHtml);
  // Couldn't determine the composition's actual dimensions — defer to the
  // pipeline's own defense-in-depth check rather than guess.
  if (!dims) return undefined;
  const effective =
    modes.aspectAgnostic === true
      ? (suggestMatchingPreset(dims.width, dims.height, outputResolution) ?? outputResolution)
      : outputResolution;
  const compat = checkOutputResolutionCompatibility({
    compositionWidth: dims.width,
    compositionHeight: dims.height,
    outputResolution: effective,
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
    failCommand();
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
    failCommand();
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
      outputResolution: options.outputResolutionRaw ?? options.outputResolution,
      pageSideCompositing: options.pageSideCompositing,
      debug: options.debug,
      bestEffort: options.bestEffort,
      experimentalFastCapture: options.experimentalFastCapture,
      pageNavigationTimeoutMs: options.pageNavigationTimeoutMs,
      protocolTimeoutMs: options.protocolTimeout,
      playerReadyTimeoutMs: options.playerReadyTimeout,
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

  // Docker child exited 0 → the containerized producer already validated
  // AND committed the artifact. Mirror renderLocal's post-success guarantee
  // so any late throw here (telemetry flush, feedback prompt) cannot flip
  // the exit code.
  markRenderSucceeded();

  // Track metrics (no job object available from Docker — use a minimal stub)
  runPostRenderStep("trackRenderComplete", () =>
    trackRenderComplete({
      durationMs: elapsed,
      fps: fpsToNumber(options.fps),
      quality: options.quality,
      workers: options.workers,
      docker: true,
      gpu: options.gpu,
      authoringSkill: options.authoringSkill,
      ...getMemorySnapshot(),
    }),
  );

  // ponytail: Docker runs the producer in a child process, so no perfSummary is
  // threaded back here; the summary shows render time only (never a wrong video
  // length). Probe the output with ffprobe if a duration figure is wanted here.
  runPostRenderStep("printRenderComplete", () =>
    printRenderComplete(outputPath, elapsed, options.quiet),
  );
  runPostRenderStep("warnIfWebmAlphaDropped", () =>
    warnIfWebmAlphaDropped(outputPath, options.format, options.quiet),
  );
  if (options.exitAfterComplete) scheduleRenderProcessExit();
  return { renderTimeMs: elapsed };
}

// fallow-ignore-next-line complexity
export async function renderLocal(
  projectDir: string,
  outputPath: string,
  options: RenderOptions,
): Promise<SingleRenderResult> {
  const recoveredOrphanTrees = killOrphanedProcesses();
  if (recoveredOrphanTrees > 0 && !options.quiet) {
    console.warn(
      c.warn(
        `  Recovered ${recoveredOrphanTrees} orphaned browser process ${recoveredOrphanTrees === 1 ? "tree" : "trees"} from an interrupted render.`,
      ),
    );
  }

  const preflight = await runEnvironmentChecks({
    projectDir,
    diskPaths: [tmpdir(), dirname(outputPath)],
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
    failCommand();
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

  if (!options.gpu && options.format === "mp4" && preflight.ffmpegPath) {
    let encoderMode: ReturnType<typeof detectH264EncoderMode> = "software";
    try {
      encoderMode = detectH264EncoderMode(preflight.ffmpegPath, false);
    } catch (error) {
      if (error instanceof H264EncoderUnavailableError) {
        errorBox(
          "MP4 H.264 encoder unavailable",
          error.message,
          `Install an FFmpeg build with libx264 support (${getFFmpegInstallHint()}), or render WebM instead: hyperframes render --format webm --output output.webm`,
        );
        failCommand();
      }
      // Capability probing is advisory. Let the real encode surface the
      // authoritative FFmpeg error instead of failing here with a bare stack.
      if (!options.quiet) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(c.warn(`  Unable to probe H.264 encoder capabilities: ${detail}`));
      }
    }
    if (encoderMode === "gpu") {
      console.warn(
        c.warn("  FFmpeg does not include libx264; falling back to VideoToolbox H.264 encoding."),
      );
      options = { ...options, gpu: true };
    }
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

  const engineConfig = producer.resolveConfig({
    browserGpuMode: options.browserGpuMode ?? "software",
    ...(options.pageNavigationTimeoutMs != null
      ? { pageNavigationTimeout: options.pageNavigationTimeoutMs }
      : {}),
    ...(options.protocolTimeout != null && { protocolTimeout: options.protocolTimeout }),
    ...(options.playerReadyTimeout != null && { playerReadyTimeout: options.playerReadyTimeout }),
    ...(options.vp9CpuUsed != null ? { vp9CpuUsed: options.vp9CpuUsed } : {}),
  });
  const request = producer.createRenderRequest({
    projectDir,
    outputPath,
    engineConfig,
    options: {
      fps: options.fps,
      quality: options.quality,
      format: options.format,
      gifLoop: options.gifLoop,
      workers: options.workers,
      useGpu: options.gpu,
      hdrMode: options.hdrMode,
      crf: options.crf,
      videoBitrate: options.videoBitrate,
      videoFrameFormat: options.videoFrameFormat,
      variables: options.variables,
      entryFile: options.entryFile,
      outputResolution: options.outputResolution,
      outputResolutionAspectAgnostic: options.outputResolutionAspectAgnostic,
      debug: options.debug,
      strictness: options.bestEffort === false ? "strict" : "best-effort",
    },
  });
  const job = producer.createRenderJob(producer.renderConfigFromRequest(request, { logger }));

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

  // Render resolved without throwing → producer's `artifact validated`
  // checkpoint fired AND the artifact was committed to disk. From this
  // point on, ANY thrown teardown error must not be allowed to override
  // the exit code. Field signal ts=1784169760 / ts=1784171150 / ts=1784172467
  // (win32/x64, CLI 0.7.58): valid MP4 on disk, exited 1 with no error print.
  markRenderSucceeded();

  maybeConsumeDeParallelRouterTrial(deParallelRouterTrialArmed, job, options.quiet);
  const elapsed = Date.now() - startTime;
  if (job.outcome === "completed_with_warnings") {
    for (const warning of job.warnings) {
      console.warn(c.warn(`  [${warning.code}] ${warning.message}`));
    }
  }
  runPostRenderStep("trackRenderMetrics", () => trackRenderMetrics(job, elapsed, options, false));
  runPostRenderStep("printRenderComplete", () =>
    printRenderComplete(
      outputPath,
      elapsed,
      options.quiet,
      job.perfSummary?.compositionDurationSeconds,
      job.perfSummary?.totalFrames,
    ),
  );
  runPostRenderStep("warnIfWebmAlphaDropped", () =>
    warnIfWebmAlphaDropped(outputPath, options.format, options.quiet),
  );
  if (!options.skipFeedback) {
    await runPostRenderStepAsync("maybePromptRenderFeedback", () =>
      maybePromptRenderFeedback({
        renderDurationMs: elapsed,
        quiet: options.quiet,
      }),
    );
  }
  if (options.exitAfterComplete) scheduleRenderProcessExit();
  const durationMs = job.perfSummary
    ? Math.round(job.perfSummary.compositionDurationSeconds * 1000)
    : undefined;
  const outcome =
    job.outcome === "completed_with_warnings" ? "completed_with_warnings" : "completed";
  return {
    renderTimeMs: elapsed,
    durationMs,
    outcome,
    warnings: job.warnings.map((warning) => ({ code: warning.code, message: warning.message })),
  };
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
  const timer = setTimeout(() => requestCliExit(0), 100);
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
  // Failed renders join the recent-renders ring too — a bug report filed via
  // `hyperframes feedback` is MOST likely to be about a failed render.
  if (job?.id) recordRecentRender(job.id, false);
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
    failCommand();
  }
  // macOS <13 dyld Symbol-not-found on the pinned chrome-headless-shell
  // build. Different remediation shape (older shell + env-var override)
  // than the Linux shared-lib install, so it lives in its own detector.
  const macosRemediation = macosOldChromeCrashRemediation(message);
  if (macosRemediation) {
    errorBox("Render failed — Chrome could not launch", message, macosRemediation);
    failCommand();
  }
  errorBox("Render failed", message, hint);
  failCommand();
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
  // Successful render → recent-renders ring, so a later `hyperframes
  // feedback` can attach this render's telemetry id to the report.
  recordRecentRender(job.id, true);
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
    workersBoundBy: perf?.workerSizing?.boundBy,
    workersCpuBased: perf?.workerSizing?.cpuBasedWorkers,
    workersMemoryBased: perf?.workerSizing?.memoryBasedWorkers,
    workersHeapBased: perf?.workerSizing?.heapBasedWorkers,
    workersFrameBased: perf?.workerSizing?.frameBasedWorkers,
    workersHeapLimitMb: perf?.workerSizing?.heapLimitMb,
    workersExceedHeapAdvisory: perf?.workerSizing?.exceedsHeapAdvisory,
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
    deFallbackFailedDb: perf?.drawElement?.fallbackFailedDb,
    deFallbackFrameIndex: perf?.drawElement?.fallbackFrameIndex,
    deFallbackThresholdDb: perf?.drawElement?.fallbackThresholdDb,
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
