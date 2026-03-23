import { spawn } from "child_process";

const videoMetadataCache = new Map<string, Promise<VideoMetadata>>();
const audioMetadataCache = new Map<string, Promise<AudioMetadata>>();

export interface VideoMetadata {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  hasAudio: boolean;
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
}

interface FFProbeFormat {
  duration?: string;
  bit_rate?: string;
}

interface FFProbeOutput {
  streams: FFProbeStream[];
  format: FFProbeFormat;
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

export async function extractVideoMetadata(filePath: string): Promise<VideoMetadata> {
  const cached = videoMetadataCache.get(filePath);
  if (cached) {
    return cached;
  }

  const probePromise = new Promise<VideoMetadata>((resolve, reject) => {
    const args = [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ];

    const ffprobe = spawn("ffprobe", args);
    let stdout = "";
    let stderr = "";

    ffprobe.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    ffprobe.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffprobe.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`[FFmpeg] ffprobe exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const output: FFProbeOutput = JSON.parse(stdout);
        const videoStream = output.streams.find((s) => s.codec_type === "video");
        if (!videoStream) {
          reject(new Error("[FFmpeg] No video stream found"));
          return;
        }

        const hasAudio = output.streams.some((s) => s.codec_type === "audio");
        const fps =
          parseFrameRate(videoStream.avg_frame_rate) || parseFrameRate(videoStream.r_frame_rate);
        const durationSeconds = output.format.duration ? parseFloat(output.format.duration) : 0;

        const metadata: VideoMetadata = {
          durationSeconds,
          width: videoStream.width || 0,
          height: videoStream.height || 0,
          fps,
          videoCodec: videoStream.codec_name || "unknown",
          hasAudio,
        };
        resolve(metadata);
      } catch (parseError: unknown) {
        reject(
          new Error(
            `[FFmpeg] Failed to parse ffprobe output: ${parseError instanceof Error ? parseError.message : parseError}`,
          ),
        );
      }
    });

    ffprobe.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("[FFmpeg] ffprobe not found. Please install FFmpeg."));
      } else {
        reject(err);
      }
    });
  });
  videoMetadataCache.set(filePath, probePromise);
  probePromise.catch(() => {
    if (videoMetadataCache.get(filePath) === probePromise) {
      videoMetadataCache.delete(filePath);
    }
  });
  return probePromise;
}

export async function extractAudioMetadata(filePath: string): Promise<AudioMetadata> {
  const cached = audioMetadataCache.get(filePath);
  if (cached) {
    return cached;
  }

  const probePromise = new Promise<AudioMetadata>((resolve, reject) => {
    const args = [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ];

    const ffprobe = spawn("ffprobe", args);
    let stdout = "";
    let stderr = "";

    ffprobe.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    ffprobe.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffprobe.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`[FFmpeg] ffprobe exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const output: FFProbeOutput = JSON.parse(stdout);
        const audioStream = output.streams.find((s) => s.codec_type === "audio");
        if (!audioStream) {
          reject(new Error("[FFmpeg] No audio stream found"));
          return;
        }

        const durationSeconds = output.format.duration ? parseFloat(output.format.duration) : 0;

        const metadata: AudioMetadata = {
          durationSeconds,
          sampleRate: audioStream.sample_rate ? parseInt(audioStream.sample_rate) : 44100,
          channels: audioStream.channels || 2,
          audioCodec: audioStream.codec_name || "unknown",
          bitrate: output.format.bit_rate ? parseInt(output.format.bit_rate) : undefined,
        };
        resolve(metadata);
      } catch (parseError: unknown) {
        reject(
          new Error(
            `[FFmpeg] Failed to parse ffprobe output: ${parseError instanceof Error ? parseError.message : parseError}`,
          ),
        );
      }
    });

    ffprobe.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("[FFmpeg] ffprobe not found. Please install FFmpeg."));
      } else {
        reject(err);
      }
    });
  });
  audioMetadataCache.set(filePath, probePromise);
  probePromise.catch(() => {
    if (audioMetadataCache.get(filePath) === probePromise) {
      audioMetadataCache.delete(filePath);
    }
  });
  return probePromise;
}
