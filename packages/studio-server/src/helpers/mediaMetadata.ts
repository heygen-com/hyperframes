import { execFile } from "node:child_process";
import { extname } from "node:path";
import {
  firstFrameColourArgs,
  parseFirstFrameColour,
  type PreviewSourceFacts,
  type ToneMapSourceColour,
} from "@hyperframes/core";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { videoStreamHasAlpha } from "@hyperframes/parsers/media-alpha";
import { decodableAudioStream, type FfprobeStreamCodec } from "@hyperframes/parsers/media-streams";

export interface FfprobeRunResult {
  status: number | null;
  stdout: string | Buffer;
  stderr: string | Buffer;
  /** Spawn-level failure (covers both `NodeJS.ErrnoException` and
   * `ExecFileException`); only `code === "ENOENT"` is ever inspected. */
  error?: { code?: string | number | null | undefined };
}

/** Injectable ffprobe runner. May be synchronous (tests) or async (the
 * default `execFile`-based runner below), so cold scans can run many probes
 * concurrently off the event loop. */
export type FfprobeRunner = (
  command: string,
  args: string[],
  options?: { timeout?: number; maxBuffer?: number },
) => FfprobeRunResult | Promise<FfprobeRunResult>;

/** Default runner: genuinely async (`execFile`), unlike the previous
 * `spawnSync`-based one — a pool of concurrent probes actually parallelizes
 * (mirrors `execFileAsync` in packages/lint/src/hevcPreviewLint.ts). */
const execFileRunner: FfprobeRunner = (command, args, options) =>
  new Promise<FfprobeRunResult>((resolvePromise) => {
    execFile(
      command,
      args,
      { timeout: options?.timeout, maxBuffer: options?.maxBuffer, windowsHide: true },
      (error, stdout, stderr) => {
        if (error && error.code === "ENOENT") {
          resolvePromise({ status: null, stdout: "", stderr: "", error });
          return;
        }
        if (error) {
          // Nonzero exit / timeout / kill: report a nonzero status; callers
          // only distinguish "ok" (0) from "failed" from "ENOENT".
          const status = typeof error.code === "number" ? error.code : 1;
          resolvePromise({ status, stdout: stdout ?? "", stderr: stderr ?? "" });
          return;
        }
        resolvePromise({ status: 0, stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });

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
  /** Video audio stream ffmpeg can decode, when probed. Absent means the drop path stays muted. */
  hasAudio?: boolean;
  audioStream?: number;
  /** Video stream carries alpha (pix_fmt or the VP8/VP9 alpha_mode tag). */
  hasAlpha?: boolean;
  durationSeconds?: number;
  source?: PreviewSourceFacts;
  /** Every stream as `type:codec[flags]`, for a failure report. */
  streams?: string[];
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
  width?: number;
  height?: number;
  bit_rate?: string;
  disposition?: Record<string, number | undefined>;
  tags?: Record<string, string | undefined>;
}

const VIDEO_EXT = new Set([
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".m4v",
  ".mxf",
  ".mts",
  ".m2ts",
  ".ts",
]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"]);

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

/** The first shown frame's colour tags, which zscale reads per frame. Empty when unread. */
export async function probeFirstFrameColour(
  filePath: string,
  runner: FfprobeRunner = execFileRunner,
): Promise<ToneMapSourceColour> {
  const ffmpegPath =
    findFfBinary("ffmpeg", { configuredMustExist: true }) ??
    (runner === execFileRunner ? undefined : "ffmpeg");
  if (!ffmpegPath) return {};
  const result = await runner(ffmpegPath, firstFrameColourArgs(filePath), {
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
  return result.status === 0 ? parseFirstFrameColour(String(result.stderr)) : {};
}

function bitDepthOf(stream: FfprobeStream): number {
  const raw = Number(stream.bits_per_raw_sample);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const suffixed = /(\d{1,3})(?:le|be)$/.exec(stream.pix_fmt ?? "");
  return suffixed ? Number(suffixed[1]) : 8;
}

function sourceFactsOf(
  stream: FfprobeStream | undefined,
  formatBitrate: string | undefined,
): PreviewSourceFacts | undefined {
  if (!stream?.width || !stream.height) return undefined;
  const bitrate = Number(stream.bit_rate ?? formatBitrate);
  return {
    width: stream.width,
    height: stream.height,
    bitDepth: bitDepthOf(stream),
    bitrate: Number.isFinite(bitrate) ? bitrate : 0,
  };
}

const STREAM_SUMMARY_MAX = 12;

function summarizeStream(stream: FfprobeStream): string {
  const flags = Object.entries(stream.disposition ?? {})
    .filter(([, on]) => on === 1)
    .map(([name]) => name);
  return `${stream.codec_type ?? "?"}:${stream.codec_name ?? "?"}[${flags.join(",")}]`;
}

type ProbeOutput = {
  streams?: FfprobeStream[];
  format?: { duration?: string; bit_rate?: string };
};

function audioOf(streams: FfprobeStream[]): Pick<MediaMetadata, "hasAudio" | "audioStream"> {
  const audioStream = decodableAudioStream(streams);
  return audioStream === null ? { hasAudio: false } : { hasAudio: true, audioStream };
}

function metadataFromProbe(kind: MediaMetadata["kind"], parsed: ProbeOutput): MediaMetadata {
  const stream = parsed.streams?.find((item) => {
    if (kind === "image") return item.codec_type === "video";
    return item.codec_type === kind && item.disposition?.attached_pic !== 1;
  });
  const metadata: MediaMetadata = {
    kind,
    color: classifyMediaColor(stream),
    streams: (parsed.streams ?? []).slice(0, STREAM_SUMMARY_MAX).map(summarizeStream),
  };
  if (kind === "video") {
    Object.assign(metadata, audioOf(parsed.streams ?? []));
    metadata.hasAlpha = stream !== undefined && videoStreamHasAlpha(stream);
    const duration = Number(parsed.format?.duration);
    if (Number.isFinite(duration) && duration > 0) metadata.durationSeconds = duration;
    metadata.source = sourceFactsOf(stream, parsed.format?.bit_rate);
  }
  return metadata;
}

/** The audio track ffmpeg can decode in a file, with its channel count; null when it has none. */
export async function probeAudioTrack(
  filePath: string,
  runner: FfprobeRunner = execFileRunner,
): Promise<{ stream: number; channels: number } | null> {
  const result = await runner(
    findFfBinary("ffprobe") ?? "ffprobe",
    [
      ...["-v", "error", "-select_streams", "a"],
      ...["-show_entries", "stream=codec_type,codec_name,channels", "-of", "json", "--", filePath],
    ],
    { timeout: 30_000 },
  );
  if (result.status !== 0) return null;
  type Probed = { streams?: (FfprobeStreamCodec & { channels?: number })[] };
  const streams = (JSON.parse(String(result.stdout || "{}")) as Probed).streams ?? [];
  const stream = decodableAudioStream(streams);
  return stream === null ? null : { stream, channels: streams[stream]?.channels ?? 0 };
}

export async function probeMediaMetadata(
  filePath: string,
  runner: FfprobeRunner = execFileRunner,
): Promise<MediaMetadata> {
  const kind = inferKindFromPath(filePath);
  if (kind === "audio" || kind === "unknown") {
    return { kind, color: classifyMediaColor(null) };
  }

  // The default runner degrades a missing ffprobe to "unavailable" without
  // spawning; injected runners own execution and receive the normal command.
  const ffprobePath =
    findFfBinary("ffprobe", { configuredMustExist: true }) ??
    (runner === execFileRunner ? undefined : "ffprobe");
  if (!ffprobePath) {
    return { kind, color: classifyMediaColor(null), probeError: "ffprobe unavailable" };
  }

  const result = await runner(
    ffprobePath,
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,profile,pix_fmt,color_space,color_transfer,color_primaries,bits_per_raw_sample,width,height,bit_rate:stream_disposition:stream_tags=alpha_mode:format=duration,bit_rate",
      "-of",
      "json",
      "--",
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
    return metadataFromProbe(kind, JSON.parse(String(result.stdout || "{}")) as ProbeOutput);
  } catch {
    return { kind, color: classifyMediaColor(null), probeError: "ffprobe returned invalid json" };
  }
}
