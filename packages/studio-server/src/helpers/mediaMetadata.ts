import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { extname } from "node:path";

type FfprobeRunner = (
  command: string,
  args: string[],
  options?: SpawnSyncOptions,
) => {
  status: number | null;
  stdout: string | Buffer;
  stderr: string | Buffer;
  error?: NodeJS.ErrnoException;
};

export type MediaDynamicRange = "hdr" | "sdr" | "unknown";
export type MediaHdrTransfer = "pq" | "hlg" | "unknown";

export interface MediaColorMetadata {
  dynamicRange: MediaDynamicRange;
  hdrTransfer: MediaHdrTransfer | null;
  label: string;
  isHdr: boolean;
  codecName?: string;
  profile?: string;
  pixelFormat?: string;
  colorSpace?: string;
  colorTransfer?: string;
  colorPrimaries?: string;
  bitsPerRawSample?: string;
}

export interface MediaMetadata {
  kind: "video" | "image" | "audio" | "unknown";
  color: MediaColorMetadata;
  probeError?: string;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  pix_fmt?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  bits_per_raw_sample?: string;
}

const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac"]);

function lower(value: string | undefined): string {
  return value?.toLowerCase() ?? "";
}

function inferKindFromPath(path: string): MediaMetadata["kind"] {
  const ext = extname(path).toLowerCase();
  if (VIDEO_EXT.has(ext)) return "video";
  if (IMAGE_EXT.has(ext)) return "image";
  if (AUDIO_EXT.has(ext)) return "audio";
  return "unknown";
}

function colorLabel(input: {
  isHdr: boolean;
  hdrTransfer: MediaHdrTransfer | null;
  colorPrimaries: string;
  colorSpace: string;
  colorTransfer: string;
}): string {
  if (input.isHdr) {
    if (input.hdrTransfer === "pq") return "HDR PQ";
    if (input.hdrTransfer === "hlg") return "HDR HLG";
    return "HDR";
  }
  if (
    input.colorPrimaries.includes("bt709") ||
    input.colorSpace.includes("bt709") ||
    input.colorTransfer.includes("bt709")
  ) {
    return "SDR Rec.709";
  }
  return "SDR/unknown";
}

export function classifyMediaColor(stream: FfprobeStream | null | undefined): MediaColorMetadata {
  const colorPrimaries = lower(stream?.color_primaries);
  const colorSpace = lower(stream?.color_space);
  const colorTransfer = lower(stream?.color_transfer);
  const isHdr =
    colorPrimaries.includes("bt2020") ||
    colorSpace.includes("bt2020") ||
    colorTransfer === "smpte2084" ||
    colorTransfer === "arib-std-b67";
  const hdrTransfer: MediaHdrTransfer | null = isHdr
    ? colorTransfer === "smpte2084"
      ? "pq"
      : colorTransfer === "arib-std-b67"
        ? "hlg"
        : "unknown"
    : null;

  return {
    dynamicRange: stream ? (isHdr ? "hdr" : "sdr") : "unknown",
    hdrTransfer,
    label: stream
      ? colorLabel({ isHdr, hdrTransfer, colorPrimaries, colorSpace, colorTransfer })
      : "Unknown",
    isHdr,
    codecName: stream?.codec_name,
    profile: stream?.profile,
    pixelFormat: stream?.pix_fmt,
    colorSpace: stream?.color_space,
    colorTransfer: stream?.color_transfer,
    colorPrimaries: stream?.color_primaries,
    bitsPerRawSample: stream?.bits_per_raw_sample,
  };
}

export function probeMediaMetadata(
  filePath: string,
  runner: FfprobeRunner = spawnSync as unknown as FfprobeRunner,
): MediaMetadata {
  const kind = inferKindFromPath(filePath);
  if (kind === "audio" || kind === "unknown") {
    return { kind, color: classifyMediaColor(null) };
  }

  const result = runner(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,profile,pix_fmt,color_space,color_transfer,color_primaries,bits_per_raw_sample",
      "-of",
      "json",
      filePath,
    ],
    { timeout: 15_000, maxBuffer: 1024 * 1024 },
  );

  if (result.error?.code === "ENOENT") {
    return { kind, color: classifyMediaColor(null), probeError: "ffprobe unavailable" };
  }
  if (result.status !== 0) {
    return { kind, color: classifyMediaColor(null), probeError: "ffprobe failed" };
  }

  try {
    const parsed = JSON.parse(String(result.stdout || "{}")) as { streams?: FfprobeStream[] };
    const stream = parsed.streams?.find((item) =>
      kind === "image" ? item.codec_type === "video" : item.codec_type === kind,
    );
    return { kind, color: classifyMediaColor(stream) };
  } catch {
    return { kind, color: classifyMediaColor(null), probeError: "ffprobe returned invalid json" };
  }
}
