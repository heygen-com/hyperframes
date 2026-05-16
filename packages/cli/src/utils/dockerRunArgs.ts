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
  format: "mp4" | "webm" | "mov" | "png-sequence";
  workers?: number;
  gpu: boolean;
  browserGpu: boolean;
  hdrMode: "auto" | "force-hdr" | "force-sdr";
  crf?: number;
  videoBitrate?: string;
  quiet: boolean;
  variables?: Record<string, unknown>;
  entryFile?: string;
  /** Output resolution preset (e.g. "landscape-4k"). Forwarded as `--resolution`. */
  outputResolution?: string;
  pageSideCompositing?: boolean;
}

export function buildDockerRunArgs(input: DockerRunArgsInput): string[] {
  const { imageTag, projectDir, outputDir, outputFilename, options } = input;
  return [
    "run",
    "--rm",
    "--platform",
    "linux/amd64",
    "--shm-size=2g",
    // GPU encoding requires host GPU passthrough.
    ...(options.gpu ? ["--gpus", "all"] : []),
    "-v",
    `${projectDir}:/project:ro`,
    "-v",
    `${outputDir}:/output`,
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
    ...(options.workers != null ? ["--workers", String(options.workers)] : []),
    ...(options.crf != null ? ["--crf", String(options.crf)] : []),
    ...(options.videoBitrate ? ["--video-bitrate", options.videoBitrate] : []),
    ...(options.quiet ? ["--quiet"] : []),
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
  ];
}
