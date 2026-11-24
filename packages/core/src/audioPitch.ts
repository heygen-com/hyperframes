/** The rate pitch is tracked at: 8 kHz keeps the 70–500 Hz search cheap. */
export const PITCH_RATE = 8000;

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

function voiced(channels: readonly Float32Array[], start: number): boolean {
  let energy = 0;
  for (const pcm of channels) for (let i = 0; i < FRAME; i++) energy += pcm[start + i]! ** 2;
  return 10 * Math.log10(energy / (FRAME * channels.length) + 1e-12) >= VOICED_DB;
}

function difference(channels: readonly Float32Array[], start: number, tau: number): number {
  let sum = 0;
  for (const pcm of channels) {
    for (let i = 0; i < FRAME; i++) {
      const delta = pcm[start + i]! - pcm[start + i + tau]!;
      sum += delta * delta;
    }
  }
  return sum;
}

/** The first lag whose normalized difference dips under the threshold, followed down to its minimum; -1 if none. */
function periodOf(channels: readonly Float32Array[], start: number, d: Float64Array): number {
  let running = 0;
  let lag = -1;
  for (let tau = 1; tau <= MAX_LAG; tau++) {
    const sum = difference(channels, start, tau);
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
  return channelPitchTrack([pcm]);
}

function channelPitchTrack(channels: readonly Float32Array[]): PitchPoint[] {
  const length = channels[0]?.length ?? 0;
  const out: PitchPoint[] = [];
  const d = new Float64Array(MAX_LAG + 1);
  for (let start = 0; start + FRAME + MAX_LAG <= length; start += HOP) {
    if (!voiced(channels, start)) continue;
    const lag = periodOf(channels, start, d);
    if (lag > 0) out.push({ t: (start + FRAME / 2) / PITCH_RATE, hz: PITCH_RATE / lag });
  }
  return out;
}

/** Mono at {@link PITCH_RATE}: channels averaged, a box filter as wide as the step against aliasing, then sampled. */
export function atPitchRate(channels: readonly Float32Array[], sampleRate: number): Float32Array {
  const length = channels[0]?.length ?? 0;
  if (!length || !channels.length) return new Float32Array(0);
  const step = sampleRate / PITCH_RATE;
  const width = Math.max(1, Math.round(step));
  const sums = new Float64Array(length + 1);
  for (let i = 0; i < length; i++) {
    let mixed = 0;
    for (const channel of channels) mixed += channel[i]!;
    sums[i + 1] = sums[i]! + mixed / channels.length;
  }
  const out = new Float32Array(Math.floor(length / step));
  for (let n = 0; n < out.length; n++) {
    const from = Math.floor(n * step);
    const to = Math.min(length, from + width);
    out[n] = (sums[to]! - sums[from]!) / (to - from);
  }
  return out;
}

/** The share of 40 ms frames with a fundamental in the voice range; hits, whooshes and noise have none. */
export function voicedShare(channels: readonly Float32Array[], sampleRate: number): number {
  const pitched = channels.map((channel) => atPitchRate([channel], sampleRate));
  const frames = Math.floor((pitched[0]?.length ?? 0) / HOP);
  return frames ? channelPitchTrack(pitched).length / frames : 0;
}
