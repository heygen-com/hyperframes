import { spawnSync } from "node:child_process";

const VIDEO_EXT = /\.(mp4|webm|mov)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac)$/i;

type FfprobeRunner = (
  command: string,
  args: string[],
) => {
  status: number | null;
  stdout: string | Buffer;
  stderr: string | Buffer;
  error?: NodeJS.ErrnoException;
};

export function validateUploadedMedia(
  filePath: string,
  runner: FfprobeRunner = spawnSync as unknown as FfprobeRunner,
): { ok: true } | { ok: false; reason: string } {
  const isVideo = VIDEO_EXT.test(filePath);
  const isAudio = AUDIO_EXT.test(filePath);
  if (!isVideo && !isAudio) {
    return { ok: true };
  }

  const result = runner("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type",
    "-of",
    "json",
    filePath,
  ]);

  if (result.error?.code === "ENOENT") {
    return { ok: true };
  }
  if (result.status !== 0) {
    return { ok: false, reason: "ffprobe failed to read the media file" };
  }

  try {
    const parsed = JSON.parse(String(result.stdout || "{}")) as {
      streams?: Array<{ codec_type?: string }>;
    };
    const streams = parsed.streams ?? [];
    const hasVideo = streams.some((stream) => stream.codec_type === "video");
    const hasAudio = streams.some((stream) => stream.codec_type === "audio");

    if (isVideo && !hasVideo) {
      return { ok: false, reason: "no supported video stream found" };
    }
    if (isAudio && !hasAudio) {
      return { ok: false, reason: "no supported audio stream found" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "ffprobe returned unreadable media metadata" };
  }
}
