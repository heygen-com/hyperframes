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
  format: "mp4" | "webm" | "mov" | "png-sequence" | "gif";
  gifLoop?: number;
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
  variables?: Record<string, unknown>;
  entryFile?: string;
  /** Output resolution preset (e.g. "landscape-4k"). Forwarded as `--resolution`. */
  outputResolution?: string;
  pageSideCompositing?: boolean;
  /** EXPERIMENTAL. drawElementImage frame capture; forwarded as `--experimental-fast-capture`. */
  experimentalFastCapture?: boolean;
  /**
   * Puppeteer page-navigation timeout, in milliseconds. Forwarded to the
   * in-container CLI as `--browser-timeout <seconds>` (the CLI takes
   * seconds; the engine takes ms — kept consistent with the host-side
   * `--browser-timeout` flag).
   */
  pageNavigationTimeoutMs?: number;
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
    ...(options.workers != null ? ["--workers", String(options.workers)] : []),
    ...(options.crf != null ? ["--crf", String(options.crf)] : []),
    ...(options.vp9CpuUsed != null ? ["--vp9-cpu-used", String(options.vp9CpuUsed)] : []),
    ...(options.videoBitrate ? ["--video-bitrate", options.videoBitrate] : []),
    ...(options.videoFrameFormat && options.videoFrameFormat !== "auto"
      ? ["--video-frame-format", options.videoFrameFormat]
      : []),
    ...(options.quiet ? ["--quiet"] : []),
    ...(options.debug ? ["--debug"] : []),
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
    ...(options.pageNavigationTimeoutMs != null
      ? ["--browser-timeout", String(options.pageNavigationTimeoutMs / 1000)]
      : []),
  ];
}
