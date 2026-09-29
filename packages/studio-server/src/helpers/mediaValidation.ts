import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { FFPROBE_PATH_ENV, findFfBinary } from "@hyperframes/parsers/ff-binaries";

const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v|mxf|mts|m2ts|ts)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac|flac)$/i;

type FfprobeRunner = (
  command: string,
  args: string[],
  options: { windowsHide: boolean },
) => {
  status: number | null;
  stdout: string | Buffer;
  stderr: string | Buffer;
  error?: NodeJS.ErrnoException;
};

type MediaCheck = { ok: true; unchecked?: string } | { ok: false; reason: string };

const defaultRunner = spawnSync as unknown as FfprobeRunner;
const FFPROBE_MISSING =
  "not checked: ffprobe was not found. Install FFmpeg or set HYPERFRAMES_FFPROBE_PATH.";

export function validateUploadedMedia(
  filePath: string,
  runner: FfprobeRunner = defaultRunner,
): MediaCheck {
  const isVideo = VIDEO_EXT.test(filePath);
  const isAudio = AUDIO_EXT.test(filePath);
  if (!isVideo && !isAudio) {
    return { ok: true };
  }

  const ffprobe = findFfBinary("ffprobe") ?? (runner === defaultRunner ? undefined : "ffprobe");
  if (!ffprobe) return { ok: true, unchecked: FFPROBE_MISSING };
  const result = runner(
    ffprobe,
    ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", "--", filePath],
    { windowsHide: true },
  );

  if (result.error && process.env[FFPROBE_PATH_ENV]?.trim()) {
    return {
      ok: false,
      reason: `${FFPROBE_PATH_ENV} names "${ffprobe}", which cannot run: fix it or unset it`,
    };
  }
  if (result.error?.code === "ENOENT") {
    return { ok: true, unchecked: FFPROBE_MISSING };
  }
  if (result.status !== 0) {
    return { ok: false, reason: "ffprobe failed to read the media file" };
  }

  return checkStreams(String(result.stdout || "{}"), isVideo, isAudio);
}

function checkStreams(stdout: string, isVideo: boolean, isAudio: boolean): MediaCheck {
  try {
    const parsed = JSON.parse(stdout) as { streams?: Array<{ codec_type?: string }> };
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

export function validateUploadedMediaBuffer(
  fileName: string,
  buffer: Uint8Array,
  runner: FfprobeRunner = defaultRunner,
): MediaCheck {
  const tempDir = mkdtempSync(join(tmpdir(), "hyperframes-upload-"));
  const tempPath = join(tempDir, basename(fileName));

  try {
    writeFileSync(tempPath, buffer);
    return validateUploadedMedia(tempPath, runner);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
