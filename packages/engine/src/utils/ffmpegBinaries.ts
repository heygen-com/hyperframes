import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { FFMPEG_PATH_ENV, FFPROBE_PATH_ENV, findFfBinary } from "@hyperframes/parsers/ff-binaries";

export { FFMPEG_PATH_ENV, FFPROBE_PATH_ENV };

// With no trusted copy, an absolute path in HyperFrames' own install that is never created: spawning it
// fails with ENOENT as a missing binary always has, so callers degrade as before, and the OS never
// searches PATH or the working directory for the bare name. The folder name carries the install hint.
function notFound(name: "ffmpeg" | "ffprobe", setting: string): string {
  return join(dirname(fileURLToPath(import.meta.url)), `${name}-not-found-set-${setting}`, name);
}

export function getFfmpegBinary(): string {
  return findFfBinary("ffmpeg") ?? notFound("ffmpeg", FFMPEG_PATH_ENV);
}

export function getFfprobeBinary(): string {
  return findFfBinary("ffprobe") ?? notFound("ffprobe", FFPROBE_PATH_ENV);
}

export function assertConfiguredFfmpegBinariesExist(): void {
  const ffmpegPath = process.env[FFMPEG_PATH_ENV]?.trim();
  if (ffmpegPath && !existsSync(ffmpegPath)) {
    throw new Error(
      `[FFmpeg] FFmpeg binary not found at ${FFMPEG_PATH_ENV}="${ffmpegPath}". ` +
        `Install FFmpeg or unset the override.${pathEncodingHint(ffmpegPath)}`,
    );
  }

  const ffprobePath = process.env[FFPROBE_PATH_ENV]?.trim();
  if (ffprobePath && !existsSync(ffprobePath)) {
    throw new Error(
      `[FFmpeg] FFprobe binary not found at ${FFPROBE_PATH_ENV}="${ffprobePath}". ` +
        `Install FFmpeg or unset the override.${pathEncodingHint(ffprobePath)}`,
    );
  }
}

function pathEncodingHint(configuredPath: string): string {
  if (!configuredPath.includes("\uFFFD")) return "";
  return " The path contains a Unicode replacement character, which usually means it was mangled while being copied or decoded.";
}
