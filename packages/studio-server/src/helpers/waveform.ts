import { spawn } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";

const SAMPLE_RATE = 4000;
const PEAK_COUNT = 4000;
const WAVEFORM_CACHE_VERSION = "v2";

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

export function decodeAudioPeaks(audioPath: string): Promise<number[]> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(
      findFfBinary("ffmpeg") ?? "ffmpeg",
      [
        "-i",
        audioPath,
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
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
    );

    const chunks: Buffer[] = [];
    proc.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.on("close", (code) => {
      if (code !== 0 && chunks.length === 0) {
        reject(new Error(`ffmpeg exited with code ${code}`));
        return;
      }
      const buf = Buffer.concat(chunks);
      const numSamples = Math.floor(buf.length / 4);
      if (numSamples === 0) {
        reject(new Error("ffmpeg produced no audio samples"));
        return;
      }
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + numSamples * 4);
      resolvePromise(computePeaks(new Float32Array(ab), PEAK_COUNT));
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
  if (existsSync(cachePath)) return;

  const peaks = await decodeAudioPeaks(audioPath);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(peaks));
}
