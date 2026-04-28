/**
 * Build the argument array for `docker run` that invokes the Hyperframes
 * renderer inside a container.
 *
 * Pure function with no I/O so it can be snapshot-tested. Any new render
 * flag added to the CLI must also be threaded through here AND covered by
 * a test in `dockerRunArgs.test.ts` — that combination is what catches
 * silent-drop regressions like the one that lost `--hdr` historically.
 */
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
  fps: 24 | 30 | 60;
  quality: "draft" | "standard" | "high";
  format: "mp4" | "webm" | "mov";
  workers: number;
  gpu: boolean;
  hdr: boolean;
  crf?: number;
  videoBitrate?: string;
  quiet: boolean;
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
    String(options.fps),
    "--quality",
    options.quality,
    "--format",
    options.format,
    "--workers",
    String(options.workers),
    ...(options.crf != null ? ["--crf", String(options.crf)] : []),
    ...(options.videoBitrate ? ["--video-bitrate", options.videoBitrate] : []),
    ...(options.quiet ? ["--quiet"] : []),
    ...(options.gpu ? ["--gpu"] : []),
    ...(options.hdr ? ["--hdr"] : []),
  ];
}
