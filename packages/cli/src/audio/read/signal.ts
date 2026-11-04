import { PITCH_RATE, type AudioSignal } from "@hyperframes/core/audio-analysis";
import { decodeAudio } from "../analysis/decode.js";

/** Every layer is read from mono at this rate: enough for onsets and band shapes, small enough for a long episode. */
export const READ_RATE = 22050;
export { PITCH_RATE };
const SILENT_DB = -120;
export const ABSENT_DB = -55;

export async function decodeMono(path: string, sampleRate = READ_RATE): Promise<Float32Array> {
  const decoded = await decodeAudio(path, {}, undefined, { sampleRate, mono: true });
  if (!decoded) throw new Error(`${path} has no audio stream`);
  const samples = decoded.signal.channels[0]!;
  if (samples.some((sample) => !Number.isFinite(sample)))
    throw new Error(`${path} contains non-finite audio samples`);
  return samples;
}

export const asSignal = (samples: Float32Array, sampleRate = READ_RATE): AudioSignal => ({
  sampleRate,
  channels: [samples],
});

export function mixed(tracks: readonly Float32Array[]): Float32Array {
  const length = Math.max(0, ...tracks.map((t) => t.length));
  const sum = new Float32Array(length);
  for (const track of tracks) for (let i = 0; i < track.length; i++) sum[i]! += track[i]!;
  return sum;
}

/** RMS level in dBFS of each `hop`-second frame, measured over a `window` centred on it. */
export function levels(
  samples: Float32Array,
  sampleRate: number,
  hop: number,
  window = hop * 2,
): Float32Array {
  const hopSamples = Math.max(1, hop * sampleRate);
  const half = Math.max(1, Math.round((window * sampleRate) / 2));
  const squares = new Float64Array(samples.length + 1);
  for (let i = 0; i < samples.length; i++) squares[i + 1] = squares[i]! + samples[i]! ** 2;
  const frames = Math.ceil(samples.length / hopSamples);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const center = Math.round(f * hopSamples);
    const a = Math.max(0, center - half);
    const b = Math.min(samples.length, center + half);
    const power = b > a ? (squares[b]! - squares[a]!) / (b - a) : 0;
    out[f] = power > 0 ? Math.max(SILENT_DB, 10 * Math.log10(power)) : SILENT_DB;
  }
  return out;
}

export function levelWhileHeardDb(samples: Float32Array, sampleRate: number): number | null {
  let sum = 0;
  let heard = 0;
  for (const db of levels(samples, sampleRate, 0.1, 0.4))
    if (db >= ABSENT_DB) {
      sum += 10 ** (db / 10);
      heard++;
    }
  return heard ? Math.round(10 * Math.log10(sum / heard)) : null;
}

export function quantile(values: ArrayLike<number>, q: number): number {
  if (!values.length) return NaN;
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))]!;
}

export const median = (values: ArrayLike<number>) => quantile(values, 0.5);

export const round = (n: number, places = 2) => {
  const k = 10 ** places;
  return Math.round(n * k) / k;
};

export function spanDb(samples: Float32Array, sampleRate: number, start: number, end: number) {
  const a = Math.max(0, Math.round(start * sampleRate));
  const b = Math.min(samples.length, Math.round(end * sampleRate));
  let sum = 0;
  for (let i = a; i < b; i++) sum += samples[i]! ** 2;
  return b > a && sum > 0 ? Math.max(SILENT_DB, 10 * Math.log10(sum / (b - a))) : SILENT_DB;
}
