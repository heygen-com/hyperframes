/**
 * Build the argument array for `docker run` that invokes the Hyperframes
 * renderer inside a container.
 *
 * Pure function with no I/O so it can be snapshot-tested. Any new render
 * flag added to the CLI must also be threaded through here AND covered by
 * a test in `dockerRunArgs.test.ts` — that combination is what catches
 * silent-drop regressions like the one that lost `--hdr` historically.
 */
import { fpsToFfmpegArg, type Fps } from "@hyperframes/core";
import type { MotionBlurOptions } from "@hyperframes/engine";

export interface DockerRunArgsInput {
  imageTag: string;
  /** Absolute host path to the project directory (mounted read-only at /project). */
  projectDir: string;
  /** Absolute host path to the output directory (mounted read-write at /output). */
  outputDir: string;
  /** Filename within `outputDir` (joined to /output inside the container). */
  outputFilename: string;
  /**
   * Docker `--platform` value (`linux/amd64` or `linux/arm64`). When omitted,
   * resolves to the host architecture via `resolveDockerPlatform()`. Pinning
   * to `linux/amd64` on an arm64 host (the legacy default) forces qemu
   * emulation of chrome-headless-shell, which segfaults or stalls on Apple
   * Silicon — see issue #1193. Native `linux/arm64` uses Playwright's pinned
   * arm64 chrome-headless-shell baked into the image at the cost of
   * byte-for-byte parity with amd64 renders.
   */
  platform?: string;
  options: DockerRenderOptions;
}

export interface DockerRenderOptions {
  /**
   * Frame rate as an exact rational; see `Fps` in @hyperframes/core. The
   * docker-run arg builder serializes this back to a `--fps` string
   * (`"30"` or `"30000/1001"`) which the in-container CLI re-parses with
   * `parseFps`, so the rational survives the host → container hop.
   */
  fps: Fps;
  quality: "draft" | "standard" | "high";
  format: "mp4" | "webm" | "mov" | "png-sequence" | "gif" | "hls";
  gifLoop?: number;
  hlsSegmentSeconds?: number;
  workers?: number;
  gpu: boolean;
  browserGpu: boolean;
  hdrMode: "auto" | "force-hdr" | "force-sdr";
  crf?: number;
  vp9CpuUsed?: number;
  videoBitrate?: string;
  videoFrameFormat?: "auto" | "jpg" | "png";
  quiet: boolean;
  debug?: boolean;
  bestEffort?: boolean;
  variables?: Record<string, unknown>;
  entryFile?: string;
  /** Output resolution preset (e.g. "landscape-4k"). Forwarded as `--resolution`. */
  outputResolution?: string;
  pageSideCompositing?: boolean;
  /** EXPERIMENTAL. drawElementImage frame capture; forwarded as `--experimental-fast-capture`. */
  experimentalFastCapture?: boolean;
  /**
   * Sub-frame motion blur, forwarded as `--motion-blur=<named fields>` (see
   * `formatMotionBlurArg`). Always the `=` spelling, and always with the `=`:
   * the flag takes an optional value, so the space form would swallow the next
   * argument inside the container (and the bare form needs the empty value
   * spelled out).
   */
  motionBlur?: MotionBlurOptions;
  /**
   * The caller passed `--no-motion-blur`, so the container must not blur. This
   * cannot be expressed by leaving `motionBlur` undefined: the in-container CLI
   * re-reads the project's own `hyperframes.json`, whose `render.motionBlur`
   * (written by the AE exporter for every comp with MB on) would turn the blur
   * straight back on. Forwarded as `--no-motion-blur`, which the in-container
   * citty parser reports as the boolean `false` — the same opt-out the host
   * resolved. When both are set the opt-out wins, matching the host's own
   * precedence.
   */
  motionBlurOff?: boolean;
  /**
   * Puppeteer page-navigation timeout, in milliseconds. Forwarded to the
   * in-container CLI as `--browser-timeout <seconds>` (the CLI takes
   * seconds; the engine takes ms — kept consistent with the host-side
   * `--browser-timeout` flag).
   */
  pageNavigationTimeoutMs?: number;
  /** CDP protocol timeout in milliseconds. */
  protocolTimeoutMs?: number;
  /** Player readiness timeout in milliseconds. */
  playerReadyTimeoutMs?: number;
}

/**
 * Serialize `MotionBlurOptions` into the named form `parseMotionBlurArg` reads
 * back (`angle=180,samples=16`), so the in-container CLI reconstructs the same
 * object field by field.
 *
 * The positional `angle:phase:samples` spelling cannot carry this: its slots
 * are positional, so `{ samplesPerFrame: 16 }` alone would serialize to `16`
 * and re-parse as a 16-degree shutter — every later field shifting one slot
 * left. Naming the present fields is what makes a partially-specified option
 * (a hand-authored `render.motionBlur` with a gap, or one produced field by
 * field by the AE exporter) survive the host → container hop unchanged.
 * `blend` names its own field so a linear-blend render does not silently drop
 * to sRGB inside the container.
 */
export function formatMotionBlurArg(options: MotionBlurOptions): string {
  const parts: string[] = [];
  if (options.shutterAngle !== undefined) parts.push(`angle=${options.shutterAngle}`);
  if (options.shutterPhase !== undefined) parts.push(`phase=${options.shutterPhase}`);
  if (options.samplesPerFrame !== undefined) parts.push(`samples=${options.samplesPerFrame}`);
  if (options.blend !== undefined) parts.push(`blend=${options.blend}`);
  return parts.join(",");
}

/**
 * Maps Node's `process.arch` to a Docker `--platform` string. We only emit
 * the two architectures the renderer actively supports — arm64 hosts (Apple
 * Silicon, Graviton, Ampere) and everything else (treated as amd64).
 *
 * Honors `HYPERFRAMES_DOCKER_PLATFORM` as an escape hatch (typed loosely so
 * the override can target future platforms without a CLI release):
 *
 * - Apple Silicon users running an x64 Node binary under Rosetta (where
 *   `process.arch === "x64"` despite the host being arm64) can set it to
 *   `linux/arm64` to avoid re-triggering issue #1193.
 * - Maintainers regenerating amd64 golden baselines on an arm64 host can set
 *   it to `linux/amd64` to keep the byte-for-byte guarantee.
 * - Users on remote daemons (`DOCKER_HOST=ssh://amd64-server`) can force the
 *   actual daemon arch instead of relying on local `process.arch`.
 */
export function resolveDockerPlatform(
  arch: string = process.arch,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.HYPERFRAMES_DOCKER_PLATFORM;
  if (override && override.trim() !== "") return override.trim();
  return arch === "arm64" ? "linux/arm64" : "linux/amd64";
}

// Pure argv builder — the cognitive count tracks the number of optional CLI
// flags it forwards, not branching depth. Each conditional spread is one
// option = O(1) to read. Inherited from main (#1196 added platform handling);
// this PR added one more conditional for --browser-timeout.
// fallow-ignore-next-line complexity
export function buildDockerRunArgs(input: DockerRunArgsInput): string[] {
  const { imageTag, projectDir, outputDir, outputFilename, options } = input;
  const platform = input.platform ?? resolveDockerPlatform();
  return [
    "run",
    "--rm",
    "--platform",
    platform,
    "--shm-size=2g",
    // GPU encoding requires host GPU passthrough.
    ...(options.gpu ? ["--gpus", "all"] : []),
    "-v",
    `${projectDir}:/project:ro`,
    "-v",
    `${outputDir}:/output`,
    // Keep debug artifacts on the mounted host output path. The producer roots
    // `.debug` at dirname(PRODUCER_RENDERS_DIR), so `/output/renders` maps to
    // `/output/.debug/<job id>` instead of a disposable container path.
    ...(options.debug ? ["-e", "PRODUCER_RENDERS_DIR=/output/renders"] : []),
    imageTag,
    "/project",
    "--output",
    `/output/${outputFilename}`,
    "--fps",
    fpsToFfmpegArg(options.fps),
    "--quality",
    options.quality,
    "--format",
    options.format,
    ...(options.gifLoop != null ? ["--gif-loop", String(options.gifLoop)] : []),
    ...(options.hlsSegmentSeconds != null
      ? ["--hls-segment-seconds", String(options.hlsSegmentSeconds)]
      : []),
    ...(options.workers != null ? ["--workers", String(options.workers)] : []),
    ...(options.crf != null ? ["--crf", String(options.crf)] : []),
    ...(options.vp9CpuUsed != null ? ["--vp9-cpu-used", String(options.vp9CpuUsed)] : []),
    ...(options.videoBitrate ? ["--video-bitrate", options.videoBitrate] : []),
    ...(options.videoFrameFormat && options.videoFrameFormat !== "auto"
      ? ["--video-frame-format", options.videoFrameFormat]
      : []),
    ...(options.quiet ? ["--quiet"] : []),
    ...(options.debug ? ["--debug"] : []),
    // The in-container CLI is best-effort by default. Only forward the
    // explicit strict opt-in so Docker and local renders cannot drift.
    ...(options.bestEffort === false ? ["--no-best-effort"] : []),
    ...(options.gpu ? ["--gpu"] : []),
    ...(options.browserGpu ? [] : ["--no-browser-gpu"]),
    ...(options.hdrMode === "force-hdr" ? ["--hdr"] : []),
    ...(options.hdrMode === "force-sdr" ? ["--sdr"] : []),
    ...(options.variables && Object.keys(options.variables).length > 0
      ? ["--variables", JSON.stringify(options.variables)]
      : []),
    ...(options.entryFile ? ["--composition", options.entryFile] : []),
    ...(options.outputResolution ? ["--resolution", options.outputResolution] : []),
    ...(options.pageSideCompositing === false ? ["--no-page-side-compositing"] : []),
    ...(options.experimentalFastCapture ? ["--experimental-fast-capture"] : []),
    ...(options.motionBlur && !options.motionBlurOff
      ? [`--motion-blur=${formatMotionBlurArg(options.motionBlur)}`]
      : []),
    // The opt-out travels as the negated flag the in-container citty parser
    // reports as `false`. Without it an absent `--motion-blur` would let the
    // container re-read the project's own `render.motionBlur` and blur a render
    // the caller explicitly asked to leave sharp.
    ...(options.motionBlurOff ? ["--no-motion-blur"] : []),
    ...(options.pageNavigationTimeoutMs != null
      ? ["--browser-timeout", String(options.pageNavigationTimeoutMs / 1000)]
      : []),
    ...(options.protocolTimeoutMs != null
      ? ["--protocol-timeout", String(options.protocolTimeoutMs)]
      : []),
    ...(options.playerReadyTimeoutMs != null
      ? ["--player-ready-timeout", String(options.playerReadyTimeoutMs)]
      : []),
  ];
}
