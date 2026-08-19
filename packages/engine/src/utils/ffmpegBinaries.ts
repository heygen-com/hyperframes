import { existsSync } from "fs";
import { FFMPEG_PATH_ENV, FFPROBE_PATH_ENV, findFfBinary } from "@hyperframes/parsers/ff-binaries";

export { FFMPEG_PATH_ENV, FFPROBE_PATH_ENV };

// The engine hands spawn a bare binary name as the last resort so the spawn
// error names what the user must install; a configured-but-missing override
// is surfaced separately by assertConfiguredFfmpegBinariesExist below.
export function getFfmpegBinary(): string {
  return findFfBinary("ffmpeg") ?? "ffmpeg";
}

export function getFfprobeBinary(): string {
  return findFfBinary("ffprobe") ?? "ffprobe";
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
