import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { playableAudioTrack } from "@hyperframes/core/audible-video";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import type { AudioSignal } from "@hyperframes/core/audio-analysis";

const run = promisify(execFile);

export interface AudioStreamInfo {
  track: number;
  sampleRate: number;
  channels: number;
  duration: number;
}

function requiredBinary(name: "ffmpeg" | "ffprobe"): string {
  const path = findFfBinary(name, { configuredMustExist: true });
  if (!path) throw new Error(`${name} is required to analyze audio; run: npx hyperframes doctor`);
  return path;
}

/** The playable audio stream's format, or `null` when the file has none. */
export async function probeAudio(
  file: string,
  options: { signal?: AbortSignal; timeout?: number } = {},
): Promise<AudioStreamInfo | null> {
  const { stdout } = await run(
    requiredBinary("ffprobe"),
    [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      "--",
      file,
    ],
    { maxBuffer: 8 * 1024 * 1024, windowsHide: true, ...options },
  );
  const parsed = JSON.parse(stdout) as {
    streams?: {
      codec_type?: string;
      codec_name?: string;
      sample_rate?: string;
      channels?: number;
      duration?: string;
    }[];
    format?: { duration?: string };
  };
  const streams = parsed.streams ?? [];
  const track = playableAudioTrack(streams);
  const stream = track === undefined ? undefined : streams[track];
  if (track === undefined || !stream) return null;
  return {
    track,
    sampleRate: Number(stream.sample_rate),
    channels: stream.channels ?? 1,
    duration: Number(stream.duration ?? parsed.format?.duration ?? 0),
  };
}

export interface DecodeWindow {
  /** Seconds into the file. */
  from?: number;
  /** Seconds of file to read; the rest of the file when absent. */
  seconds?: number;
}

export interface DecodeFormat {
  sampleRate?: number;
  mono?: boolean;
}

export interface Decoded {
  signal: AudioSignal;
  stream: AudioStreamInfo;
}

/** Decode the playable audio stream at its own sample rate, each channel kept apart; `null` when the file has none. */
export async function decodeAudio(
  file: string,
  window: DecodeWindow = {},
  probed?: AudioStreamInfo,
  format: DecodeFormat = {},
): Promise<Decoded | null> {
  const probedInfo = probed ?? (await probeAudio(file));
  if (!probedInfo) return null;
  const info = {
    ...probedInfo,
    sampleRate: format.sampleRate ?? probedInfo.sampleRate,
    channels: format.mono ? 1 : probedInfo.channels,
  };
  const seek = window.from ? ["-ss", String(window.from)] : [];
  const length = window.seconds === undefined ? [] : ["-t", String(window.seconds)];
  const { stdout } = await run(
    requiredBinary("ffmpeg"),
    [
      "-v",
      "error",
      ...seek,
      "-i",
      file,
      ...length,
      "-map",
      `0:a:${info.track}`,
      ...(format.mono ? ["-ac", "1"] : []),
      ...(format.sampleRate ? ["-ar", String(format.sampleRate)] : []),
      "-f",
      "f32le",
      "-acodec",
      "pcm_f32le",
      "-",
    ],
    { encoding: "buffer", maxBuffer: 2 * 1024 * 1024 * 1024, windowsHide: true },
  );
  const bytes = stdout.byteLength - (stdout.byteLength % 4);
  const interleaved = new Float32Array(
    stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + bytes),
  );
  const frames = Math.floor(interleaved.length / info.channels);
  const channels = Array.from({ length: info.channels }, (_, c) => {
    const samples = new Float32Array(frames);
    for (let i = 0; i < frames; i++) samples[i] = interleaved[i * info.channels + c]!;
    return samples;
  });
  return { signal: { sampleRate: info.sampleRate, channels }, stream: info };
}
