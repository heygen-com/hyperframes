/**
 * Measurements of decoded audio over time: an energy envelope, onsets, the moments a sound lands, loudness and silence.
 * Pure functions of PCM samples, so they run the same in Node, Bun and the browser. Times are seconds into the signal.
 */

import type { AudioAnalysisProvider, AudioCapability } from "./audioAnalysisLadder";
import { finish, type Steps } from "./audioSteps";
import { fft } from "./fft";
import { voicedShare } from "./audioPitch";
import { rhythm } from "./audioRhythm";
import { sections, type SectionOptions } from "./audioSections";

/** Decoded audio: one Float32Array per channel, all the same length. */
export interface AudioSignal {
  sampleRate: number;
  channels: Float32Array[];
}

export type EnvelopeScale = "db" | "linear";

export interface EnvelopeOptions {
  hopMs?: number;
  /** RMS window; twice the hop when left out. */
  windowMs?: number;
  scale?: EnvelopeScale;
  /** Measure only this frequency band, in Hz. */
  band?: [number, number];
}

export interface Envelope {
  hopMs: number;
  scale: EnvelopeScale;
  /** One value per hop, the first centred on time 0. */
  values: number[];
}

export type OnsetMethod = "spectral-flux" | "energy";

export interface OnsetOptions {
  method?: OnsetMethod;
  band?: [number, number];
  /** Smallest normalized strength, 0–1, that counts as an onset. */
  threshold?: number;
  /** Onsets closer than this keep only the stronger. */
  minGapMs?: number;
  hopMs?: number;
}

export interface Onset {
  t: number;
  /** Relative to the strongest onset in the signal, 0–1. */
  strength: number;
}

export interface Onsets {
  method: OnsetMethod;
  events: Onset[];
}

export interface MomentOptions {
  /** The onset is where RMS first reaches this fraction of its peak. */
  onsetRatio?: number;
  /** The tail ends where RMS last stays above the peak plus this many dB. */
  tailDb?: number;
  hopMs?: number;
}

/** Where a sound lands. Null for a silent signal. */
export interface Moments {
  /** RMS first reaches `onsetRatio` of its peak. */
  onset: number;
  /** The largest rise in RMS between neighbouring hops. */
  steepest: number;
  /** The loudest hop. */
  peak: number;
  /** The last hop within `tailDb` of the peak. */
  tailEnd: number;
}

export interface Loudness {
  /** ITU-R BS.1770 gated integrated loudness; null when every block is below the absolute gate. */
  lufsIntegrated: number | null;
  /** The loudest 3 s window. */
  lufsShortTermMax: number | null;
  samplePeakDb: number;
  /** A 4× oversampled estimate of the true peak, in dBTP. */
  truePeakDb: number;
  clipping: { count: number; firstAt: number | null };
}

export interface SilenceOptions {
  thresholdDb?: number;
  minMs?: number;
  hopMs?: number;
}

export interface Span {
  start: number;
  end: number;
}

export type AudioKind = "sfx" | "music" | "voice" | "mixed";

export interface KindGuess {
  value: AudioKind;
  /** 0–1. Signal heuristics only: treat below 0.6 as a guess. */
  confidence: number;
  /** What the guess was made from. */
  features: KindFeatures;
}

export interface KindFeatures {
  duration: number;
  /** Strongest autocorrelation of the onset curve at beat-like lags (0.3–1.5 s), 0–1. */
  regularity: number;
  /** Share of envelope modulation at syllable rate (3–8 Hz), 0–1. */
  syllables: number;
  /** Share of 50 ms frames within 20 dB of the loud end (95th percentile), 0–1: high for beds and speech, low for hits. */
  sustain: number;
  voiced?: number;
}

const DB_FLOOR = -120;

export const signalDuration = (signal: AudioSignal): number =>
  (signal.channels[0]?.length ?? 0) / signal.sampleRate;

/** Per-sample energy. Channels are squared first, so a reversed channel stays audible. */
export function energyMix(signal: AudioSignal): Float32Array {
  return finish(energyMixSteps(signal));
}

const MIX_SAMPLES_PER_STEP = 65536;

export function* energyMixSteps(signal: AudioSignal): Steps<Float32Array> {
  const [first, ...rest] = signal.channels;
  if (!first) return new Float32Array(0);
  if (!rest.length) return first;
  const mixed = new Float32Array(first.length);
  const scale = 1 / signal.channels.length;
  for (let start = 0; start < mixed.length; start += MIX_SAMPLES_PER_STEP) {
    const end = Math.min(mixed.length, start + MIX_SAMPLES_PER_STEP);
    for (const channel of signal.channels)
      for (let i = start; i < end; i++) mixed[i]! += channel[i]! * channel[i]!;
    for (let i = start; i < end; i++) mixed[i] = Math.sqrt(mixed[i]! * scale);
    yield;
  }
  return mixed;
}

const toDb = (amplitude: number) =>
  amplitude > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(amplitude)) : DB_FLOOR;
const hopSamples = (sampleRate: number, hopMs: number) =>
  Math.max(1, Math.round((sampleRate * hopMs) / 1000));
const round = (t: number) => Math.round(t * 1e4) / 1e4;

function rmsFrames(
  samples: Float32Array,
  sampleRate: number,
  hopMs: number,
  windowMs: number,
): number[] {
  const hop = hopSamples(sampleRate, hopMs);
  const half = Math.max(1, Math.round((sampleRate * windowMs) / 2000));
  const frames: number[] = [];
  for (let center = 0; center < samples.length; center += hop) {
    const from = Math.max(0, center - half);
    const to = Math.min(samples.length, center + half);
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!;
    frames.push(to > from ? Math.sqrt(sum / (to - from)) : 0);
  }
  return frames;
}

const fftSizeFor = (sampleRate: number) => 2 ** Math.round(Math.log2(sampleRate * 0.023));

/** Magnitude spectra of Hann-windowed frames centred on each hop, limited to `band`. */
/** The FFT bins inside `band`, as [first, end). */
function bandBins(sampleRate: number, size: number, band?: [number, number]): [number, number] {
  const binHz = sampleRate / size;
  const low = Math.max(1, Math.floor((band?.[0] ?? 0) / binHz));
  return [low, Math.max(low, Math.min(size / 2, Math.ceil((band?.[1] ?? sampleRate / 2) / binHz)))];
}

/** Load the Hann-windowed frame centred on `center` into `re`, zero outside the signal. */
function loadFrame(
  samples: Float32Array,
  center: number,
  window: Float64Array,
  re: Float64Array,
  im: Float64Array,
): void {
  const first = center - window.length / 2;
  for (let i = 0; i < window.length; i++) {
    const at = first + i;
    re[i] = at >= 0 && at < samples.length ? samples[at]! * window[i]! : 0;
    im[i] = 0;
  }
}

function spectra(
  samples: Float32Array,
  sampleRate: number,
  hopMs: number,
  band?: [number, number],
): Float64Array[] {
  const size = fftSizeFor(sampleRate);
  const hop = hopSamples(sampleRate, hopMs);
  const window = Float64Array.from(
    { length: size },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size),
  );
  const [low, high] = bandBins(sampleRate, size, band);
  const frames: Float64Array[] = [];
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let center = 0; center < samples.length; center += hop) {
    loadFrame(samples, center, window, re, im);
    fft(re, im);
    const magnitudes = new Float64Array(high - low);
    for (let k = low; k < high; k++) magnitudes[k - low] = Math.hypot(re[k]!, im[k]!);
    frames.push(magnitudes);
  }
  return frames;
}

function averageMagnitudes(frames: Float64Array[]): Float64Array {
  const mixed = new Float64Array(frames[0]?.length ?? 0);
  for (const frame of frames)
    for (let bin = 0; bin < mixed.length; bin++) mixed[bin]! += frame[bin]!;
  const scale = frames.length || 1;
  for (let bin = 0; bin < mixed.length; bin++) mixed[bin]! /= scale;
  return mixed;
}

/** Mean magnitude spectrum across channels, so opposite polarity cannot cancel a bin. */
function meanSpectra(signal: AudioSignal, hopMs: number, band?: [number, number]): Float64Array[] {
  const stacked = signal.channels.map((channel) =>
    spectra(channel, signal.sampleRate, hopMs, band),
  );
  const count = stacked[0]?.length ?? 0;
  const mixed: Float64Array[] = [];
  for (let frame = 0; frame < count; frame++)
    mixed.push(averageMagnitudes(stacked.map((channel) => channel[frame]!)));
  return mixed;
}

export function envelope(signal: AudioSignal, options: EnvelopeOptions = {}): Envelope {
  const { hopMs = 5, scale = "db", band } = options;
  const windowMs = options.windowMs ?? hopMs * 2;
  const size = fftSizeFor(signal.sampleRate);
  // Parseval over the band's bins; a Hann window keeps 0.375 of a frame's power.
  const amplitudes = band
    ? meanSpectra(signal, hopMs, band).map((frame) => {
        let sum = 0;
        for (const magnitude of frame) sum += magnitude * magnitude;
        return Math.sqrt((2 * sum) / (size * size * 0.375));
      })
    : rmsFrames(energyMix(signal), signal.sampleRate, hopMs, windowMs);
  return { hopMs, scale, values: amplitudes.map((a) => (scale === "db" ? toDb(a) : a)) };
}

/** Positive change between neighbouring frames: spectral flux of log magnitudes, or the rise in RMS. */
function noveltyCurve(
  signal: AudioSignal,
  method: OnsetMethod,
  hopMs: number,
  band?: [number, number],
): number[] {
  const samples = energyMix(signal);
  if (method === "energy") {
    const rms = rmsFrames(samples, signal.sampleRate, hopMs, hopMs * 2);
    return rms.map((value, i) => Math.max(0, value - (rms[i - 1] ?? 0)));
  }
  const frames = meanSpectra(signal, hopMs, band).map((frame) =>
    frame.map((m) => Math.log1p(100 * m)),
  );
  // A frame cut off by the end of the signal splatters across the spectrum; that is the edge, not a hit.
  const lastWhole = Math.floor(
    (samples.length - fftSizeFor(signal.sampleRate) / 2) / hopSamples(signal.sampleRate, hopMs),
  );
  return frames.map((frame, i) => {
    const previous = frames[i - 1];
    if (!previous || i > lastWhole) return 0;
    let flux = 0;
    for (let k = 0; k < frame.length; k++) flux += Math.max(0, frame[k]! - previous[k]!);
    return flux;
  });
}

/** Peaks of the novelty curve that stand out from their neighbourhood. */
/** A local maximum within `gap` frames that clears the mean of its ±`context` neighbourhood by 5% of the top. */
function isOnsetPeak(
  curve: number[],
  i: number,
  gap: number,
  context: number,
  top: number,
): boolean {
  const value = curve[i]!;
  let sum = 0;
  let count = 0;
  for (let j = Math.max(0, i - context); j <= Math.min(curve.length - 1, i + context); j++) {
    if (Math.abs(j - i) <= gap && curve[j]! > value) return false;
    sum += curve[j]!;
    count++;
  }
  return value >= sum / count + 0.05 * top;
}

export function onsets(signal: AudioSignal, options: OnsetOptions = {}): Onsets {
  const { method = "spectral-flux", band, threshold = 0.1, minGapMs = 30, hopMs = 5 } = options;
  const curve = noveltyCurve(signal, method, hopMs, band);
  const top = Math.max(0, ...curve);
  if (top <= 0) return { method, events: [] };
  const gap = Math.max(1, Math.round(minGapMs / hopMs));
  const context = Math.max(gap, Math.round(100 / hopMs));
  const hopSeconds = hopSamples(signal.sampleRate, hopMs) / signal.sampleRate;
  const events: Onset[] = [];
  for (let i = 0; i < curve.length; i++) {
    const strength = curve[i]! / top;
    if (strength < threshold || !isOnsetPeak(curve, i, gap, context, top)) continue;
    const onset = { t: round(i * hopSeconds), strength: round(strength) };
    const last = events[events.length - 1];
    if (!last || onset.t - last.t >= minGapMs / 1000) events.push(onset);
    else if (onset.strength > last.strength) events[events.length - 1] = onset;
  }
  return { method, events };
}

export function moments(signal: AudioSignal, options: MomentOptions = {}): Moments | null {
  const { onsetRatio = 0.2, tailDb = -40, hopMs = 1 } = options;
  const rms = rmsFrames(energyMix(signal), signal.sampleRate, hopMs, Math.max(4, hopMs * 4));
  const hopSeconds = hopSamples(signal.sampleRate, hopMs) / signal.sampleRate;
  let peakIndex = 0;
  for (let i = 1; i < rms.length; i++) if (rms[i]! > rms[peakIndex]!) peakIndex = i;
  const peak = rms[peakIndex] ?? 0;
  if (peak <= 0) return null;
  let onsetIndex = rms.findIndex((value) => value >= peak * onsetRatio);
  if (onsetIndex < 0) onsetIndex = peakIndex;
  let steepestIndex = onsetIndex;
  let steepestRise = -Infinity;
  for (let i = 1; i <= peakIndex; i++) {
    const rise = rms[i]! - rms[i - 1]!;
    if (rise > steepestRise) [steepestRise, steepestIndex] = [rise, i];
  }
  const floor = peak * 10 ** (tailDb / 20);
  let tailIndex = peakIndex;
  for (let i = rms.length - 1; i > peakIndex; i--)
    if (rms[i]! >= floor) {
      tailIndex = i;
      break;
    }
  return {
    onset: round(onsetIndex * hopSeconds),
    steepest: round(steepestIndex * hopSeconds),
    peak: round(peakIndex * hopSeconds),
    tailEnd: round(tailIndex * hopSeconds),
  };
}

type Biquad = [number, number, number, number, number];

/** BS.1770 K-weighting at any sample rate: a high-shelf pre-filter, then the RLB high-pass. */
function kWeighting(sampleRate: number): [Biquad, Biquad] {
  let k = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
  const q = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  let a0 = 1 + k / q + k * k;
  const shelf: Biquad = [
    (vh + (vb * k) / q + k * k) / a0,
    (2 * (k * k - vh)) / a0,
    (vh - (vb * k) / q + k * k) / a0,
    (2 * (k * k - 1)) / a0,
    (1 - k / q + k * k) / a0,
  ];
  k = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
  const q2 = 0.5003270373238773;
  a0 = 1 + k / q2 + k * k;
  const highPass: Biquad = [1, -2, 1, (2 * (k * k - 1)) / a0, (1 - k / q2 + k * k) / a0];
  return [shelf, highPass];
}

function filtered(
  samples: Float32Array | Float64Array,
  [b0, b1, b2, a1, a2]: Biquad,
): Float64Array {
  const out = new Float64Array(samples.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]!;
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

const blockLoudness = (meanSquare: number) =>
  meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : -Infinity;

/** Running sum of squares, so any block's power is one subtraction. */
function squareSums(channel: Float64Array): Float64Array {
  const sums = new Float64Array(channel.length + 1);
  for (let i = 0; i < channel.length; i++) sums[i + 1] = sums[i]! + channel[i]! * channel[i]!;
  return sums;
}

/** Summed channel power of each block of `blockSeconds`, stepped by `stepSeconds`. */
function blockPowers(
  sums: Float64Array[],
  sampleRate: number,
  blockSeconds: number,
  stepSeconds: number,
): number[] {
  const length = (sums[0]?.length ?? 1) - 1;
  if (!length) return [];
  const block = Math.min(length, Math.round(blockSeconds * sampleRate));
  const step = Math.round(stepSeconds * sampleRate);
  const powers: number[] = [];
  for (let start = 0; start + block <= length; start += step)
    powers.push(
      sums.reduce((power, sum) => power + (sum[start + block]! - sum[start]!) / block, 0),
    );
  return powers;
}

const TRUE_PEAK_OVERSAMPLE = 4;
const TRUE_PEAK_TAPS = 12;

const TRUE_PEAK_KERNELS = Array.from({ length: TRUE_PEAK_OVERSAMPLE - 1 }, (_, phase) => {
  const offset = (phase + 1) / TRUE_PEAK_OVERSAMPLE;
  return Float64Array.from({ length: 2 * TRUE_PEAK_TAPS }, (_, tap) => {
    const x = tap - TRUE_PEAK_TAPS + 1 - offset;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    return sinc * (0.5 + 0.5 * Math.cos((Math.PI * x) / TRUE_PEAK_TAPS));
  });
});

/**
 * The 4× oversampled peak, interpolated only between samples at least half the sample peak: overshooting both
 * neighbours by 6 dB takes energy near Nyquist that real program material does not carry.
 */
function truePeak(channel: Float32Array): number {
  let samplePeak = 0;
  for (let i = 0; i < channel.length; i++) samplePeak = Math.max(samplePeak, Math.abs(channel[i]!));
  const floor = samplePeak / 2;
  const taps = 2 * TRUE_PEAK_TAPS;
  let peak = samplePeak;
  for (let n = 0; n + taps <= channel.length; n++) {
    if (
      Math.abs(channel[n + TRUE_PEAK_TAPS - 1]!) < floor &&
      Math.abs(channel[n + TRUE_PEAK_TAPS]!) < floor
    )
      continue;
    for (const kernel of TRUE_PEAK_KERNELS) {
      let y = 0;
      for (let tap = 0; tap < taps; tap++) y += channel[n + tap]! * kernel[tap]!;
      if (y > peak) peak = y;
      else if (-y > peak) peak = -y;
    }
  }
  return peak;
}

export function loudness(signal: AudioSignal): Loudness {
  const [shelf, highPass] = kWeighting(signal.sampleRate);
  const sums = signal.channels.map((channel) =>
    squareSums(filtered(filtered(channel, shelf), highPass)),
  );
  const momentary = blockPowers(sums, signal.sampleRate, 0.4, 0.1);
  const audible = momentary.filter((power) => blockLoudness(power) > -70);
  let lufsIntegrated: number | null = null;
  if (audible.length) {
    const relative = blockLoudness(audible.reduce((a, b) => a + b, 0) / audible.length) - 10;
    const gated = audible.filter((power) => blockLoudness(power) > relative);
    if (gated.length)
      lufsIntegrated =
        Math.round(blockLoudness(gated.reduce((a, b) => a + b, 0) / gated.length) * 10) / 10;
  }
  const shortTerm = blockPowers(sums, signal.sampleRate, 3, 0.1)
    .map(blockLoudness)
    .filter(Number.isFinite);
  let samplePeak = 0;
  let count = 0;
  let firstAt: number | null = null;
  for (const channel of signal.channels)
    for (let i = 0; i < channel.length; i++) {
      const magnitude = Math.abs(channel[i]!);
      samplePeak = Math.max(samplePeak, magnitude);
      if (magnitude >= 0.999) {
        count++;
        const t = i / signal.sampleRate;
        if (firstAt === null || t < firstAt) firstAt = round(t);
      }
    }
  return {
    lufsIntegrated,
    lufsShortTermMax: shortTerm.length ? Math.round(Math.max(...shortTerm) * 10) / 10 : null,
    samplePeakDb: Math.round(toDb(samplePeak) * 10) / 10,
    truePeakDb: Math.round(toDb(Math.max(0, ...signal.channels.map(truePeak))) * 10) / 10,
    clipping: { count, firstAt },
  };
}

export function silence(signal: AudioSignal, options: SilenceOptions = {}): Span[] {
  const { thresholdDb = -50, minMs = 200, hopMs = 5 } = options;
  const db = rmsFrames(energyMix(signal), signal.sampleRate, hopMs, hopMs * 2).map(toDb);
  const hopSeconds = hopSamples(signal.sampleRate, hopMs) / signal.sampleRate;
  const spans: Span[] = [];
  let from: number | null = null;
  for (let i = 0; i <= db.length; i++) {
    const quiet = i < db.length && db[i]! < thresholdDb;
    if (quiet && from === null) from = i;
    if (!quiet && from !== null) {
      if ((i - from) * hopSeconds * 1000 >= minMs)
        spans.push({
          start: round(from * hopSeconds),
          end: round(Math.min(i * hopSeconds, signalDuration(signal))),
        });
      from = null;
    }
  }
  return spans;
}

/** How regular the onsets are: the strongest normalized autocorrelation of the novelty curve at beat-like lags. */
function periodicity(curve: number[], hopMs: number): number {
  const mean = curve.reduce((a, b) => a + b, 0) / (curve.length || 1);
  const centred = curve.map((v) => v - mean);
  const energy = centred.reduce((a, v) => a + v * v, 0);
  if (!energy) return 0;
  let best = 0;
  for (
    let lag = Math.round(300 / hopMs);
    lag <= Math.round(1500 / hopMs) && lag < centred.length;
    lag++
  ) {
    let sum = 0;
    for (let i = lag; i < centred.length; i++) sum += centred[i]! * centred[i - lag]!;
    best = Math.max(best, sum / energy);
  }
  return best;
}

/** How much of the envelope's modulation sits at syllable rate (3–8 Hz). */
function syllableModulation(signal: AudioSignal): number {
  const hopMs = 10;
  const rms = rmsFrames(energyMix(signal), signal.sampleRate, hopMs, 25);
  const size = 2 ** Math.floor(Math.log2(Math.min(rms.length, 1024)));
  if (size < 64) return 0;
  const re = Float64Array.from(rms.slice(0, size));
  const mean = re.reduce((a, b) => a + b, 0) / size;
  for (let i = 0; i < size; i++) re[i] = re[i]! - mean;
  const im = new Float64Array(size);
  fft(re, im);
  const rate = 1000 / hopMs;
  let inBand = 0;
  let total = 0;
  for (let k = 1; k < size / 2; k++) {
    const power = re[k]! * re[k]! + im[k]! * im[k]!;
    const hz = (k * rate) / size;
    total += power;
    if (hz >= 3 && hz <= 8) inBand += power;
  }
  return total ? inBand / total : 0;
}

function sustainShare(signal: AudioSignal): number {
  const levels = rmsFrames(energyMix(signal), signal.sampleRate, 50, 100).map(toDb);
  if (!levels.length) return 0;
  const loud = [...levels].sort((a, b) => a - b)[Math.floor((levels.length - 1) * 0.95)]!;
  return levels.filter((level) => level > loud - 20).length / levels.length;
}

export function kindFeatures(signal: AudioSignal): KindFeatures {
  return {
    duration: round(signalDuration(signal)),
    regularity: round(periodicity(noveltyCurve(signal, "spectral-flux", 10), 10)),
    syllables: round(syllableModulation(signal)),
    sustain: round(sustainShare(signal)),
  };
}

const VOICED_SPEECH = 0.15;
const VOICED_STEADY_SPEECH = 0.25;

/**
 * A first guess at what the audio is. Length decides most of it: beds run long, effects short. Long audio is voice
 * when its envelope moves at syllable rate without a beat; short audio also holds its level. Both need a voice pitch.
 */
export function classify(signal: AudioSignal): KindGuess {
  const features = kindFeatures(signal);
  const { duration, regularity, syllables, sustain } = features;
  const speechLike = syllables >= 0.35 && regularity < 0.35;
  const voiced = () => (features.voiced ??= round(voicedShare(signal.channels, signal.sampleRate)));
  const pitched = () => voiced() >= VOICED_SPEECH;
  if (duration >= 8) {
    if (sustain < 0.4) return { value: "sfx", confidence: 0.6, features };
    if (speechLike && pitched())
      return { value: "voice", confidence: round(Math.min(0.9, 0.4 + syllables)), features };
    if (regularity < 0.2 && syllables >= 0.17 && voiced() >= VOICED_STEADY_SPEECH)
      return { value: "voice", confidence: 0.6, features };
    return { value: "music", confidence: round(Math.min(0.9, 0.5 + regularity)), features };
  }
  if (duration >= 1.5 && syllables >= 0.17 && regularity < 0.3 && sustain >= 0.7 && pitched())
    return { value: "voice", confidence: speechLike ? 0.8 : 0.6, features };
  return { value: "sfx", confidence: duration <= 2 ? 0.85 : 0.65, features };
}

export * from "./audioAnalysisLadder";
export * from "./audioPitch";
export * from "./audioRhythm";
export * from "./audioSections";
export * from "./audioSnap";

const SIGNAL_MEASURES: Partial<
  Record<AudioCapability, (input: AudioSignal, options: Record<string, unknown>) => unknown>
> = {
  beats: (input) => rhythm(input).beats,
  downbeats: (input) => rhythm(input).downbeats,
  sections: (input, options) => sections(input, options as SectionOptions),
  envelope: (input, options) => envelope(input, options as EnvelopeOptions),
  onsets: (input, options) => onsets(input, options as OnsetOptions),
  moments: (input, options) => moments(input, options as MomentOptions),
  loudness: (input) => loudness(input),
  silence: (input, options) => silence(input, options as SilenceOptions),
  kind: (input) => classify(input),
};

/** Signal processing as a ladder provider: always available, the measured ground every other provider snaps to. */
export const signalProvider: AudioAnalysisProvider<AudioSignal> = {
  id: "signal",
  local: true,
  signal: true,
  capabilities: [
    "envelope",
    "onsets",
    "moments",
    "loudness",
    "silence",
    "kind",
    "beats",
    "downbeats",
    "sections",
  ],
  async analyze(capability, input, options) {
    const measure = SIGNAL_MEASURES[capability];
    if (!measure) throw new Error(`signal processing does not measure ${capability}`);
    return measure(input, options);
  },
};
