import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";

export const PEAK_BIN_SECONDS = 0.05;
const PEAK_SAMPLE_RATE = 48_000;
const execFileAsync = promisify(execFile);
const PEAK_MAP_CACHE_VERSION = "peaks-v2";

/**
 * Running max-abs per bin over interleaved f32le at the source's own channel
 * count. Native channels, not `-ac 2`: ffmpeg's mono upmix pans at -3 dB,
 * which would hide a clip that really does reach 0 dBFS.
 */
export interface PeakAccumulator {
  bins: number[];
  frame: number;
  carry: Buffer;
  framesPerBin: number;
  channels: number;
}

export function createPeakAccumulator(
  sampleRate = PEAK_SAMPLE_RATE,
  binSeconds = PEAK_BIN_SECONDS,
  channels = 2,
): PeakAccumulator {
  return {
    bins: [],
    frame: 0,
    carry: Buffer.alloc(0),
    framesPerBin: Math.max(1, Math.round(sampleRate * binSeconds)),
    channels: Math.max(1, channels),
  };
}

function framePeak(data: Buffer, offset: number, channels: number): number {
  let peak = 0;
  for (let ch = 0; ch < channels; ch++) {
    peak = Math.max(peak, Math.abs(data.readFloatLE(offset + ch * 4)));
  }
  return peak;
}

export function accumulatePeaks(acc: PeakAccumulator, chunk: Buffer): void {
  const data = acc.carry.length > 0 ? Buffer.concat([acc.carry, chunk]) : chunk;
  const frameBytes = 4 * acc.channels;
  const whole = data.length - (data.length % frameBytes);
  for (let offset = 0; offset < whole; offset += frameBytes) {
    const peak = framePeak(data, offset, acc.channels);
    const bin = Math.floor(acc.frame / acc.framesPerBin);
    if (acc.bins.length <= bin) acc.bins.push(0);
    if (peak > (acc.bins[bin] ?? 0)) acc.bins[bin] = peak;
    acc.frame += 1;
  }
  acc.carry = Buffer.from(data.subarray(whole));
}

/** Linear sample peak per bin, NOT normalized — the level is the point. */
export function finishPeaks(acc: PeakAccumulator): number[] {
  return acc.bins.map((peak) => Number(peak.toFixed(4)));
}

async function probeChannels(mediaPath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    findFfBinary("ffprobe") ?? "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=channels",
      "-of",
      "csv=p=0",
      mediaPath,
    ],
    { encoding: "utf8", timeout: 30_000, windowsHide: true },
  );
  const channels = Number.parseInt(stdout.trim(), 10);
  if (!Number.isFinite(channels) || channels < 1) throw new Error("no audio stream");
  return channels;
}

export async function decodePeakMap(mediaPath: string): Promise<number[]> {
  const channels = await probeChannels(mediaPath);
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(
      findFfBinary("ffmpeg") ?? "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        mediaPath,
        "-map",
        "0:a:0",
        "-vn",
        "-ar",
        String(PEAK_SAMPLE_RATE),
        "-f",
        "f32le",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
    );
    const acc = createPeakAccumulator(PEAK_SAMPLE_RATE, PEAK_BIN_SECONDS, channels);
    proc.stdout?.on("data", (chunk: Buffer) => accumulatePeaks(acc, chunk));
    proc.on("close", (code) => {
      if (acc.frame === 0) {
        reject(new Error(`ffmpeg produced no audio samples (exit ${code})`));
        return;
      }
      resolvePromise(finishPeaks(acc));
    });
    proc.on("error", reject);
  });
}

/** Keyed on content (size + mtime) like the waveform cache, under its own version prefix. */
export function buildPeakMapCacheKey(
  assetPath: string,
  fingerprint: { size: number; mtimeMs: number },
): string {
  const name = assetPath.replace(/[/\\]/g, "_");
  return `${PEAK_MAP_CACHE_VERSION}_${name}_${fingerprint.size}-${Math.round(fingerprint.mtimeMs)}.json`;
}
