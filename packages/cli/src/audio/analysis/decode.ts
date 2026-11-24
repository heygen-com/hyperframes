import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findFfBinary, mediaInputFormatArgs } from "@hyperframes/parsers/ff-binaries";
import { assertLiteralMediaInput } from "@hyperframes/parsers/literal-media-input";
import {
  decodableAudioStream,
  misstatesPcmByteRate,
  type FfprobePcmFields,
} from "@hyperframes/parsers/media-streams";
import type { AudioSignal } from "@hyperframes/core/audio-analysis";

const run = promisify(execFile);

export interface AudioStreamInfo {
  audioStream: number;
  sampleRate: number;
  channels: number;
  duration: number;
  misstatedByteRate?: boolean;
}

function requiredBinary(name: "ffmpeg" | "ffprobe"): string {
  const path = findFfBinary(name, { configuredMustExist: true });
  if (!path) throw new Error(`${name} is required to analyze audio; run: npx hyperframes doctor`);
  return path;
}

function literalInputArgs(binary: string, file: string, inputArgs: readonly string[]) {
  if (inputArgs.length === 0) return mediaInputFormatArgs(binary, file);
  assertLiteralMediaInput(file);
  return inputArgs;
}

/** The format of the audio track ffmpeg can decode, or `null` when the file has none. */
export async function probeAudio(
  file: string,
  inputArgs: readonly string[] = [],
): Promise<AudioStreamInfo | null> {
  const ffprobe = requiredBinary("ffprobe");
  const { stdout } = await run(
    ffprobe,
    [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      ...literalInputArgs(ffprobe, file, inputArgs),
      "--",
      file,
    ],
    { maxBuffer: 8 * 1024 * 1024, windowsHide: true },
  );
  const parsed = JSON.parse(stdout) as {
    streams?: (FfprobePcmFields & { duration?: string })[];
    format?: { duration?: string };
  };
  const index = decodableAudioStream(parsed.streams ?? []);
  const stream = index === null ? undefined : parsed.streams?.[index];
  if (index === null || !stream) return null;
  return {
    audioStream: index,
    sampleRate: Number(stream.sample_rate),
    channels: stream.channels ?? 1,
    duration: Number(stream.duration ?? parsed.format?.duration ?? 0),
    misstatedByteRate: misstatesPcmByteRate(stream),
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
  inputArgs?: readonly string[];
}

export interface Decoded {
  signal: AudioSignal;
  stream: AudioStreamInfo;
}

/** Decode the decodable audio track at its own sample rate, channels kept apart; `null` when the file has none. */
export async function decodeAudio(
  file: string,
  window: DecodeWindow = {},
  probed?: AudioStreamInfo,
  format: DecodeFormat = {},
): Promise<Decoded | null> {
  const inputArgs = format.inputArgs ?? [];
  const probedInfo = probed ?? (await probeAudio(file, inputArgs));
  if (!probedInfo) return null;
  const info = {
    ...probedInfo,
    sampleRate: format.sampleRate ?? probedInfo.sampleRate,
    channels: format.mono ? 1 : probedInfo.channels,
  };
  const seek = window.from ? ["-ss", String(window.from)] : [];
  const [inputSeek, decodedSeek] = probedInfo.misstatedByteRate ? [[], seek] : [seek, []];
  const length = window.seconds === undefined ? [] : ["-t", String(window.seconds)];
  const ffmpeg = requiredBinary("ffmpeg");
  const { stdout } = await run(
    ffmpeg,
    [
      "-v",
      "error",
      ...inputSeek,
      ...literalInputArgs(ffmpeg, file, inputArgs),
      "-i",
      file,
      ...decodedSeek,
      ...length,
      "-map",
      `0:a:${probedInfo.audioStream}`,
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
