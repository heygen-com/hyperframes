import { spawn } from "node:child_process";
import {
  existsSync,
  writeFileSync,
  mkdirSync,
  lstatSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { utimes } from "node:fs/promises";
import { dirname, join } from "node:path";
import { requireFfBinary } from "@hyperframes/parsers/ff-binaries";
import { probeAudioTrack } from "./mediaMetadata.js";
import { createStagingDir } from "@hyperframes/core/atomic-file";
import { isProjectCacheFile, readProjectCacheFileAsync } from "./safePath.js";
import { mediaInputArgs } from "./mediaExtensions.js";

const SAMPLE_RATE = 4000;
const PEAK_COUNT = 4000;
const WAVEFORM_CACHE_VERSION = "v2";
export const WAVEFORM_CACHE_LIMITS = { entries: 500, bytes: 256 * 1024 * 1024 };
const SAMPLE_BIN_CAPACITY = 1 << 16;

/**
 * Cache filename for one asset's peaks, keyed on its content as well as its name.
 *
 * The path alone is not an identity. An asset rebuilt in place — a bed
 * re-encoded without its ducking, a plate swapped for the right one — keeps its
 * name and gets new samples, and a path-keyed entry then served the old peaks
 * for the rest of the project's life: the timeline drew a duck that was no
 * longer in the file, which reads as the render having done it. Size and mtime
 * are what a rebuild always changes, and both are already on the stat the route
 * takes to check the file exists.
 *
 * Without a fingerprint it falls back to the old path-only key, so a caller that
 * cannot stat still gets caching rather than an error.
 */
export function buildWaveformCacheKey(
  assetPath: string,
  fingerprint?: { size: number; mtimeMs: number },
): string {
  const name = assetPath.replace(/[/\\]/g, "_");
  if (!fingerprint) return `${WAVEFORM_CACHE_VERSION}_${name}.json`;
  const stamp = `${fingerprint.size}-${Math.round(fingerprint.mtimeMs)}`;
  return `${WAVEFORM_CACHE_VERSION}_${name}_${stamp}.json`;
}

function computePeaks(floats: Float32Array, count: number): number[] {
  const step = floats.length / count;
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * step);
    const end = Math.min(Math.floor((i + 1) * step), floats.length);
    let max = 0;
    for (let j = start; j < end; j++) {
      // fallow-ignore-next-line code-duplication
      const abs = Math.abs(floats[j] ?? 0);
      if (abs > max) max = abs;
    }
    peaks.push(max);
  }
  const maxPeak = Math.max(...peaks, 0.001);
  return peaks.map((p) => p / maxPeak);
}

/** Max-abs per run of samples, in a fixed buffer: when it fills, neighbouring runs merge and each run doubles. */
export interface SampleBins {
  peaks: Float32Array;
  length: number;
  samplesPerBin: number;
  inBin: number;
  carry: Buffer;
}

export function createSampleBins(capacity = SAMPLE_BIN_CAPACITY): SampleBins {
  return {
    peaks: new Float32Array(capacity),
    length: 0,
    samplesPerBin: 1,
    inBin: 0,
    carry: Buffer.alloc(0),
  };
}

function mergeNeighbouringBins(bins: SampleBins): void {
  const half = bins.length / 2;
  for (let i = 0; i < half; i++) {
    bins.peaks[i] = Math.max(bins.peaks[2 * i] ?? 0, bins.peaks[2 * i + 1] ?? 0);
  }
  bins.length = half;
  bins.samplesPerBin *= 2;
}

export function addSamples(bins: SampleBins, chunk: Buffer): void {
  const data = bins.carry.length > 0 ? Buffer.concat([bins.carry, chunk]) : chunk;
  const whole = data.length - (data.length % 4);
  for (let offset = 0; offset < whole; offset += 4) {
    const abs = Math.abs(data.readFloatLE(offset));
    if (bins.inBin === 0) {
      if (bins.length === bins.peaks.length) mergeNeighbouringBins(bins);
      bins.peaks[bins.length++] = abs;
    } else if (abs > (bins.peaks[bins.length - 1] ?? 0)) {
      bins.peaks[bins.length - 1] = abs;
    }
    bins.inBin = (bins.inBin + 1) % bins.samplesPerBin;
  }
  bins.carry = Buffer.from(data.subarray(whole));
}

export async function decodeAudioPeaks(audioPath: string, signal?: AbortSignal): Promise<number[]> {
  const track = await probeAudioTrack(audioPath);
  if (!track) throw new Error("no audio stream");
  signal?.throwIfAborted();
  const ffmpeg = requireFfBinary("ffmpeg");
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(
      ffmpeg,
      [
        ...mediaInputArgs(audioPath),
        "-i",
        audioPath,
        "-map",
        `0:a:${track.stream}`,
        "-af",
        "atrim=start_sample=1152",
        "-f",
        "f32le",
        "-ac",
        "1",
        "-ar",
        String(SAMPLE_RATE),
        "-vn",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true, signal },
    );

    const bins = createSampleBins();
    proc.stdout?.on("data", (chunk: Buffer) => addSamples(bins, chunk));
    proc.on("close", (code) => {
      if (code !== 0 && bins.length === 0) {
        reject(new Error(`ffmpeg exited with code ${code}`));
        return;
      }
      if (bins.length === 0) {
        reject(new Error("ffmpeg produced no audio samples"));
        return;
      }
      resolvePromise(computePeaks(bins.peaks.subarray(0, bins.length), PEAK_COUNT));
    });
    proc.on("error", reject);
  });
}

export async function generateWaveformCache(projectDir: string, assetPath: string): Promise<void> {
  const audioPath = join(projectDir, assetPath);
  if (!existsSync(audioPath)) return;

  const stats = statSync(audioPath);
  const cacheDir = join(projectDir, ".waveform-cache");
  const cachePath = join(cacheDir, buildWaveformCacheKey(assetPath, stats));
  if (isProjectCacheFile(projectDir, cachePath)) return;

  const peaks = await decodeAudioPeaks(audioPath);
  writeWaveformCache(cachePath, peaks);
}

function isWaveformCacheDirectory(cacheDir: string): boolean {
  return lstatSync(cacheDir, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/** Publish complete peaks without following a replaced cache-file symlink. */
export function writeWaveformCache(
  cachePath: string,
  peaks: number[],
  limits = WAVEFORM_CACHE_LIMITS,
): void {
  const cacheDir = dirname(cachePath);
  try {
    mkdirSync(cacheDir, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  if (!isWaveformCacheDirectory(cacheDir)) {
    throw new Error("Waveform cache must be a directory, not a symlink");
  }
  const stagingDir = createStagingDir(cacheDir, ".waveform-");
  try {
    const stagingPath = join(stagingDir, "peaks.json");
    writeFileSync(stagingPath, JSON.stringify(peaks), { flag: "wx" });
    renameSync(stagingPath, cachePath);
  } finally {
    try {
      rmSync(stagingDir, { recursive: true, force: true });
      dropEntriesPastCacheLimit(cacheDir, limits);
    } catch {
      // Cleanup must not mask a write error or fail an already published cache.
    }
  }
}

const PEAKS_CACHE_MAX_BYTES = 64 * 1024 * 1024;

/** A peaks cache entry's numbers; a link, a non-file or anything but numbers is a miss and is decoded again. */
export async function readCachedPeaks(
  projectDir: string,
  cachePath: string,
): Promise<number[] | null> {
  const bytes = await readProjectCacheFileAsync(projectDir, cachePath, PEAKS_CACHE_MAX_BYTES);
  if (!bytes) return null;
  try {
    const parsed: unknown = JSON.parse(bytes.toString("utf-8"));
    if (!Array.isArray(parsed) || !parsed.every((n) => typeof n === "number")) return null;
    await markWaveformCacheUsed(cachePath);
    return parsed;
  } catch {
    return null;
  }
}

/** Marks a cache entry as just used, so eviction drops the least recently used entries first. */
export async function markWaveformCacheUsed(cachePath: string): Promise<void> {
  const now = new Date();
  // An entry that cannot be touched is only evicted sooner.
  await utimes(cachePath, now, now).catch(() => undefined);
}

function dropEntriesPastCacheLimit(cacheDir: string, limits: typeof WAVEFORM_CACHE_LIMITS): void {
  const entries = readdirSync(cacheDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const path = join(cacheDir, entry.name);
      const stats = lstatSync(path, { throwIfNoEntry: false });
      return { path, mtimeMs: stats?.mtimeMs ?? 0, size: stats?.size ?? 0 };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
  let count = entries.length;
  let bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  for (const entry of entries) {
    if (count <= limits.entries && bytes <= limits.bytes) return;
    rmSync(entry.path, { force: true });
    count--;
    bytes -= entry.size;
  }
}
