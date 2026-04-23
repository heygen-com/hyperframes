import { spawn } from "child_process";
import { readFileSync } from "fs";
import { extname } from "path";

/** Spawn ffprobe with given args, return stdout. Throws on non-zero exit or missing binary. */
function runFfprobe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`[FFmpeg] ffprobe exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });
    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("[FFmpeg] ffprobe not found. Please install FFmpeg."));
      } else {
        reject(err);
      }
    });
  });
}

function parseProbeJson(stdout: string): FFProbeOutput {
  try {
    return JSON.parse(stdout);
  } catch (e) {
    throw new Error(
      `[FFmpeg] Failed to parse ffprobe output: ${e instanceof Error ? e.message : e}`,
    );
  }
}

const videoMetadataCache = new Map<string, Promise<VideoMetadata>>();
const audioMetadataCache = new Map<string, Promise<AudioMetadata>>();

export interface VideoColorSpace {
  /** Color transfer characteristics, e.g. "bt709", "smpte2084", "arib-std-b67" */
  colorTransfer: string;
  /** Color primaries, e.g. "bt709", "bt2020" */
  colorPrimaries: string;
  /** Color matrix/space, e.g. "bt709", "bt2020nc" */
  colorSpace: string;
}

export interface VideoMetadata {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  hasAudio: boolean;
  /** True when r_frame_rate and avg_frame_rate differ significantly (>10%), indicating variable frame rate. */
  isVFR: boolean;
  /** Color space info from the video stream. Null if ffprobe didn't report it. */
  colorSpace: VideoColorSpace | null;
}

export interface AudioMetadata {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  audioCodec: string;
  bitrate?: number;
}

interface FFProbeStream {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  color_transfer?: string;
  color_primaries?: string;
  color_space?: string;
}

interface FFProbeFormat {
  duration?: string;
  bit_rate?: string;
}

interface FFProbeOutput {
  streams: FFProbeStream[];
  format: FFProbeFormat;
}

interface StillImageMetadata {
  width: number;
  height: number;
  colorSpace: VideoColorSpace | null;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i] ?? 0;
    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function extractPngMetadataFromBuffer(buf: Buffer): StillImageMetadata | null {
  if (
    buf.length < 8 ||
    buf[0] !== 137 ||
    buf[1] !== 80 ||
    buf[2] !== 78 ||
    buf[3] !== 71 ||
    buf[4] !== 13 ||
    buf[5] !== 10 ||
    buf[6] !== 26 ||
    buf[7] !== 10
  ) {
    return null;
  }

  let width = 0;
  let height = 0;
  let seenIdat = false;
  let pos = 8;
  while (pos + 12 <= buf.length) {
    const chunkLen = buf.readUInt32BE(pos);
    const chunkType = buf.toString("ascii", pos + 4, pos + 8);
    if (pos + 12 + chunkLen > buf.length) return null;
    const chunkData = buf.subarray(pos + 8, pos + 8 + chunkLen);
    const chunkCrc = buf.readUInt32BE(pos + 8 + chunkLen);
    const chunkBytes = Buffer.concat([Buffer.from(chunkType, "ascii"), chunkData]);
    if (crc32(chunkBytes) !== chunkCrc) return null;

    if (chunkType === "IHDR" && chunkLen >= 8) {
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
    }

    if (chunkType === "IDAT") {
      seenIdat = true;
    }

    if (chunkType === "cICP" && chunkLen === 4 && !seenIdat) {
      const primariesCode = chunkData[0] ?? 0;
      const transferCode = chunkData[1] ?? 0;
      const matrixCode = chunkData[2] ?? 0;

      return {
        width,
        height,
        colorSpace: {
          colorPrimaries:
            primariesCode === 9
              ? "bt2020"
              : primariesCode === 1
                ? "bt709"
                : `unknown-${primariesCode}`,
          colorTransfer:
            transferCode === 16
              ? "smpte2084"
              : transferCode === 18
                ? "arib-std-b67"
                : transferCode === 1
                  ? "bt709"
                  : `unknown-${transferCode}`,
          colorSpace:
            matrixCode === 9 ? "bt2020nc" : matrixCode === 0 ? "gbr" : `unknown-${matrixCode}`,
        },
      };
    }

    if (chunkType === "IEND") break;
    pos += 12 + chunkLen;
  }

  return width > 0 && height > 0 ? { width, height, colorSpace: null } : null;
}

function extractStillImageMetadata(filePath: string): StillImageMetadata | null {
  if (extname(filePath).toLowerCase() !== ".png") return null;

  try {
    return extractPngMetadataFromBuffer(readFileSync(filePath));
  } catch {
    return null;
  }
}

function parseFrameRate(frameRateStr: string | undefined): number {
  if (!frameRateStr) return 0;
  const parts = frameRateStr.split("/");
  if (parts.length === 2) {
    const num = parseFloat(parts[0] ?? "");
    const den = parseFloat(parts[1] ?? "");
    if (den !== 0) return Math.round((num / den) * 100) / 100;
  }
  return parseFloat(frameRateStr) || 0;
}

/**
 * Probe a media file (video, image, or container) and return normalized metadata.
 *
 * Despite the legacy name `extractVideoMetadata` (still exported as a
 * deprecated alias below), this also handles still images such as PNG so it
 * can be used uniformly for any visual asset the HDR pipeline encounters.
 */
export async function extractMediaMetadata(filePath: string): Promise<VideoMetadata> {
  const cached = videoMetadataCache.get(filePath);
  if (cached) return cached;

  const probePromise = (async (): Promise<VideoMetadata> => {
    const stillImageMeta = extractStillImageMetadata(filePath);

    let output: FFProbeOutput | null = null;
    try {
      const stdout = await runFfprobe([
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        filePath,
      ]);
      output = parseProbeJson(stdout);
    } catch (error) {
      if (!stillImageMeta) throw error;
    }

    const videoStream = output?.streams.find((s) => s.codec_type === "video");
    if (!videoStream) {
      if (stillImageMeta) {
        return {
          durationSeconds: 0,
          width: stillImageMeta.width,
          height: stillImageMeta.height,
          fps: 0,
          videoCodec: "png",
          hasAudio: false,
          isVFR: false,
          colorSpace: stillImageMeta.colorSpace,
        };
      }
      throw new Error("[FFmpeg] No video stream found");
    }

    const rFps = parseFrameRate(videoStream.r_frame_rate);
    const avgFps = parseFrameRate(videoStream.avg_frame_rate);
    const fps = avgFps || rFps;
    // VFR: r_frame_rate (max/nominal) differs from avg_frame_rate (actual average) by >10%
    const isVFR = rFps > 0 && avgFps > 0 && Math.abs(rFps - avgFps) / Math.max(rFps, avgFps) > 0.1;

    const colorTransfer = videoStream.color_transfer || "";
    const colorPrimaries = videoStream.color_primaries || "";
    const colorSpaceVal = videoStream.color_space || "";
    const ffprobeColorSpace =
      colorTransfer || colorPrimaries || colorSpaceVal
        ? { colorTransfer, colorPrimaries, colorSpace: colorSpaceVal }
        : null;
    const colorSpace = ffprobeColorSpace ?? stillImageMeta?.colorSpace ?? null;

    return {
      durationSeconds: output?.format.duration ? parseFloat(output.format.duration) : 0,
      width: videoStream.width || stillImageMeta?.width || 0,
      height: videoStream.height || stillImageMeta?.height || 0,
      fps,
      videoCodec: videoStream.codec_name || "unknown",
      hasAudio: output?.streams.some((s) => s.codec_type === "audio") ?? false,
      isVFR,
      colorSpace,
    };
  })();

  videoMetadataCache.set(filePath, probePromise);
  probePromise.catch(() => {
    if (videoMetadataCache.get(filePath) === probePromise) {
      videoMetadataCache.delete(filePath);
    }
  });
  return probePromise;
}

/**
 * @deprecated Use `extractMediaMetadata` — this name is kept for backward
 * compatibility with consumers that imported the original video-only name
 * before still-image (PNG) support was added. New callers should prefer
 * `extractMediaMetadata`.
 */
export const extractVideoMetadata = extractMediaMetadata;

export async function extractAudioMetadata(filePath: string): Promise<AudioMetadata> {
  const cached = audioMetadataCache.get(filePath);
  if (cached) return cached;

  const probePromise = (async (): Promise<AudioMetadata> => {
    const stdout = await runFfprobe([
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);
    const output = parseProbeJson(stdout);
    const audioStream = output.streams.find((s) => s.codec_type === "audio");
    if (!audioStream) throw new Error("[FFmpeg] No audio stream found");

    const durationSeconds = output.format.duration ? parseFloat(output.format.duration) : 0;

    return {
      durationSeconds,
      sampleRate: audioStream.sample_rate ? parseInt(audioStream.sample_rate) : 44100,
      channels: audioStream.channels || 2,
      audioCodec: audioStream.codec_name || "unknown",
      bitrate: output.format.bit_rate ? parseInt(output.format.bit_rate) : undefined,
    };
  })();

  audioMetadataCache.set(filePath, probePromise);
  probePromise.catch(() => {
    if (audioMetadataCache.get(filePath) === probePromise) {
      audioMetadataCache.delete(filePath);
    }
  });
  return probePromise;
}

export interface KeyframeAnalysis {
  avgIntervalSeconds: number;
  maxIntervalSeconds: number;
  keyframeCount: number;
  isProblematic: boolean;
}

const keyframeCache = new Map<string, Promise<KeyframeAnalysis>>();

/**
 * Check keyframe intervals in a video file. Intervals > 2s cause seeking
 * issues in the headless renderer and audio/video desync. Videos from
 * yt-dlp --download-sections or screen recordings often have sparse keyframes.
 */
export async function analyzeKeyframeIntervals(filePath: string): Promise<KeyframeAnalysis> {
  const cached = keyframeCache.get(filePath);
  if (cached) return cached;

  const promise = analyzeKeyframeIntervalsUncached(filePath);
  keyframeCache.set(filePath, promise);
  promise.catch(() => {
    if (keyframeCache.get(filePath) === promise) {
      keyframeCache.delete(filePath);
    }
  });
  return promise;
}

async function analyzeKeyframeIntervalsUncached(filePath: string): Promise<KeyframeAnalysis> {
  const stdout = await runFfprobe([
    "-v",
    "quiet",
    "-select_streams",
    "v:0",
    "-skip_frame",
    "nokey",
    "-show_entries",
    "frame=pts_time",
    "-of",
    "csv=p=0",
    filePath,
  ]);

  const timestamps = stdout
    .split("\n")
    .map((line) => parseFloat(line.trim()))
    .filter((t) => Number.isFinite(t));

  if (timestamps.length < 2) {
    return {
      avgIntervalSeconds: 0,
      maxIntervalSeconds: 0,
      keyframeCount: timestamps.length,
      isProblematic: false,
    };
  }

  let maxInterval = 0;
  let totalInterval = 0;
  for (let i = 1; i < timestamps.length; i++) {
    const interval = (timestamps[i] ?? 0) - (timestamps[i - 1] ?? 0);
    totalInterval += interval;
    if (interval > maxInterval) maxInterval = interval;
  }

  const avgInterval = totalInterval / (timestamps.length - 1);
  return {
    avgIntervalSeconds: Math.round(avgInterval * 100) / 100,
    maxIntervalSeconds: Math.round(maxInterval * 100) / 100,
    keyframeCount: timestamps.length,
    isProblematic: maxInterval > 2,
  };
}
