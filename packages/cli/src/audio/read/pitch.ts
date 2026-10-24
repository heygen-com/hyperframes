import { PITCH_RATE } from "./signal.js";

const FRAME = 320;
const HOP = 320;
const LOW_HZ = 70;
const HIGH_HZ = 500;
const VOICED_DB = -35;
const PERIODIC = 0.15;

export interface PitchPoint {
  t: number;
  hz: number;
}

const MIN_LAG = Math.floor(PITCH_RATE / HIGH_HZ);
const MAX_LAG = Math.ceil(PITCH_RATE / LOW_HZ);

function voiced(pcm: Float32Array, start: number): boolean {
  let energy = 0;
  for (let i = 0; i < FRAME; i++) energy += pcm[start + i]! ** 2;
  return 10 * Math.log10(energy / FRAME + 1e-12) >= VOICED_DB;
}

function difference(pcm: Float32Array, start: number, tau: number): number {
  let sum = 0;
  for (let i = 0; i < FRAME; i++) {
    const delta = pcm[start + i]! - pcm[start + i + tau]!;
    sum += delta * delta;
  }
  return sum;
}

/** The first lag whose normalized difference dips under the threshold, followed down to its minimum; -1 if none. */
function periodOf(pcm: Float32Array, start: number, d: Float64Array): number {
  let running = 0;
  let lag = -1;
  for (let tau = 1; tau <= MAX_LAG; tau++) {
    const sum = difference(pcm, start, tau);
    running += sum;
    d[tau] = running > 0 ? (sum * tau) / running : 1;
    if (lag === -1) {
      if (tau >= MIN_LAG && d[tau]! < PERIODIC) lag = tau;
    } else if (d[tau]! > d[tau - 1]!) break;
    else if (d[tau]! < d[lag]!) lag = tau;
  }
  return lag;
}

/** The fundamental of each voiced 40 ms frame of 8 kHz mono, by YIN's cumulative mean normalized difference. */
export function pitchTrack(pcm: Float32Array): PitchPoint[] {
  const out: PitchPoint[] = [];
  const d = new Float64Array(MAX_LAG + 1);
  for (let start = 0; start + FRAME + MAX_LAG <= pcm.length; start += HOP) {
    if (!voiced(pcm, start)) continue;
    const lag = periodOf(pcm, start, d);
    if (lag > 0) out.push({ t: (start + FRAME / 2) / PITCH_RATE, hz: PITCH_RATE / lag });
  }
  return out;
}

export function within(track: readonly PitchPoint[], start: number, end: number): number[] {
  let lo = 0;
  let hi = track.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (track[mid]!.t < start) lo = mid + 1;
    else hi = mid;
  }
  const out: number[] = [];
  for (let i = lo; i < track.length && track[i]!.t < end; i++) out.push(track[i]!.hz);
  return out;
}

export const semitones = (a: number, b: number) => 12 * Math.log2(a / b);
