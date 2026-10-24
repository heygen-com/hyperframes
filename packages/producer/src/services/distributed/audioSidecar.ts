/**
 * A video's audio copied out of its container, nothing re-encoded, stored beside it. Reading audio from the
 * cloud file moves the whole interleaved file; the sidecar is a few MB.
 */

import { extractAudioMetadata, runFfmpeg } from "@hyperframes/engine";
import { extname } from "node:path";

/** Smaller files are cheap to read whole. */
export const AUDIO_SIDECAR_MIN_BYTES = 32 * 1024 * 1024;
const AUDIO_SIDECAR_SOURCE_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);

export function wantsAudioSidecar(path: string, sizeBytes: number): boolean {
  return (
    sizeBytes >= AUDIO_SIDECAR_MIN_BYTES &&
    AUDIO_SIDECAR_SOURCE_EXTENSIONS.has(extname(path).toLowerCase())
  );
}

/** `unavailable`: no ffmpeg on this machine. `none`: no audio, or audio the sidecar would not read back the same. */
export type AudioSidecarOutcome = "built" | "none" | "unavailable";

export async function buildAudioSidecar(
  inputPath: string,
  outputPath: string,
  signal?: AbortSignal,
): Promise<AudioSidecarOutcome> {
  // An audio track starting after the picture shifts an input seek, and with several tracks the video
  // read picks by channel count, not order: either way the sidecar would be read differently.
  const audio = await extractAudioMetadata(inputPath, { signal }).catch(() => null);
  if (!audio) return (await ffmpegIsMissing(signal)) ? "unavailable" : "none";
  if (audio.audioStreamCount !== 1 || (audio.audioStreamLeadSeconds ?? 0) > 0) return "none";
  const result = await runFfmpeg(
    ["-v", "error", "-y", "-i", inputPath, "-map", "0:a:0", "-vn", "-c:a", "copy"].concat([
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      outputPath,
    ]),
    { signal },
  );
  if (result.success) return "built";
  return isMissing(result) ? "unavailable" : "none";
}

const isMissing = (result: { error?: unknown }) =>
  (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

const ffmpegIsMissing = async (signal?: AbortSignal) =>
  isMissing(await runFfmpeg(["-version"], { signal }));
