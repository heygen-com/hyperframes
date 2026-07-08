import { spawn } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const SAMPLE_RATE = 4000;
const PEAK_COUNT = 4000;
const WAVEFORM_CACHE_VERSION = "v2";

export function buildWaveformCacheKey(assetPath: string): string {
  return `${WAVEFORM_CACHE_VERSION}_${assetPath.replace(/[/\\]/g, "_")}.json`;
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

function ffmpegBinary(): string {
  const configured = process.env.HYPERFRAMES_FFMPEG_PATH?.trim();
  if (configured) return resolve(configured);
  return "ffmpeg";
}

export function decodeAudioPeaks(audioPath: string): Promise<number[]> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(
      ffmpegBinary(),
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
      { stdio: ["ignore", "pipe", "ignore"] },
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

  const cacheDir = join(projectDir, ".waveform-cache");
  const cachePath = join(cacheDir, buildWaveformCacheKey(assetPath));
  if (existsSync(cachePath)) return;

  const peaks = await decodeAudioPeaks(audioPath);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(peaks));
}
