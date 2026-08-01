/**
 * Voiceover carve: find the bands a voice occupies and dip a music bed there,
 * so the voice sits in front without ducking the whole track.
 *
 * This is a relationship between two tracks, not an effect on one. The controls
 * live on the bed being processed and name the voice to listen to, the same way
 * a sidechain compressor works: you select the track that gets quieter and pick
 * what makes it quieter.
 *
 * The output is an ordinary FX chain of peaking filters, so a carve is just a
 * chain the studio generated rather than a separate rendering path.
 */

import {
  defaultAudioFxParams,
  HF_AUDIO_FX_CHAIN_VERSION,
  type HfAudioFxChain,
  type HfAudioFxNode,
} from "./audioFx.js";

export const HF_AUDIO_CARVE_ATTR = "data-fx-carve";

/** Third-octave centres spanning the range speech actually occupies. */
const CANDIDATE_CENTERS_HZ = [160, 250, 400, 630, 1000, 1600, 2500, 4000, 6000] as const;

const FRAME = 4096;
const HOP = 2048;

export interface HfCarveBand {
  freq: number;
  gainDb: number;
  q: number;
}

export interface HfCarveSettings {
  /** Element id of the voice track to analyse. */
  source: string;
  /** Deepest cut applied to the strongest band. */
  maxCutDb: number;
  /** How many bands to dip. */
  bands: number;
  q: number;
  /**
   * Weight selection toward intelligibility rather than raw voice energy.
   *
   * Ranking purely by voice power lands on the fundamental almost every time,
   * because that is where a voice is loudest — but masking that actually hurts
   * a voiceover happens higher up, and dipping 160 Hz mostly just thins the
   * bed. Weighting pushes selection toward 1-3 kHz where intelligibility lives.
   */
  intelligibilityBias: number;
}

export const DEFAULT_CARVE: HfCarveSettings = {
  source: "",
  maxCutDb: 6,
  bands: 3,
  q: 1.4,
  intelligibilityBias: 0.7,
};

export function normalizeCarveSettings(raw: Partial<HfCarveSettings> | undefined): HfCarveSettings {
  const clamp = (v: unknown, lo: number, hi: number, dflt: number): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  return {
    source: typeof raw?.source === "string" ? raw.source : "",
    maxCutDb: clamp(raw?.maxCutDb, 0, 24, DEFAULT_CARVE.maxCutDb),
    bands: Math.round(clamp(raw?.bands, 1, 6, DEFAULT_CARVE.bands)),
    q: clamp(raw?.q, 0.3, 8, DEFAULT_CARVE.q),
    intelligibilityBias: clamp(raw?.intelligibilityBias, 0, 1, DEFAULT_CARVE.intelligibilityBias),
  };
}

/** Averaged power spectrum, Welch-style. */
function powerSpectrum(
  mono: Float32Array,
  sampleRate: number,
): { freqs: number[]; power: number[] } {
  const n = Math.max(mono.length, FRAME);
  const padded =
    mono.length >= FRAME
      ? mono
      : (() => {
          const p = new Float32Array(FRAME);
          p.set(mono);
          return p;
        })();

  const window = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));

  const bins = FRAME / 2 + 1;
  const acc = new Float64Array(bins);
  let frames = 0;
  for (let start = 0; start + FRAME <= n; start += HOP) {
    // Goertzel-free naive DFT would be O(n^2); use a real FFT via recursion on
    // a copied frame. FRAME is a power of two so the radix-2 split is exact.
    const re = new Float64Array(FRAME);
    const im = new Float64Array(FRAME);
    for (let i = 0; i < FRAME; i++) re[i] = (padded[start + i] ?? 0) * window[i]!;
    fft(re, im);
    for (let k = 0; k < bins; k++) acc[k]! += re[k]! * re[k]! + im[k]! * im[k]!;
    frames++;
  }
  if (frames === 0) frames = 1;

  const freqs: number[] = [];
  const power: number[] = [];
  for (let k = 0; k < bins; k++) {
    freqs.push((k * sampleRate) / FRAME);
    power.push(acc[k]! / frames);
  }
  return { freqs, power };
}

/** In-place iterative radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]!;
        const ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci;
        const vi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function bandPower(freqs: number[], power: number[], center: number): number {
  const lo = center / Math.pow(2, 1 / 6);
  const hi = center * Math.pow(2, 1 / 6);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i]! >= lo && freqs[i]! < hi) {
      sum += power[i]!;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Weight applied to each candidate band when ranking. At bias 0 this is flat
 * (pure voice power); at 1 it peaks around 2 kHz, where speech intelligibility
 * lives and where a bed most often masks a voice.
 */
function intelligibilityWeight(center: number, bias: number): number {
  const octavesFrom2k = Math.log2(center / 2000);
  const shaped = Math.exp(-(octavesFrom2k * octavesFrom2k) / 2);
  return 1 - bias + bias * shaped;
}

/**
 * Analyse a voice and return the bands to dip in the bed. Bands come back in
 * ascending frequency; the deepest cut lands on the strongest band and the
 * others scale with their relative weight, floored at half depth so a selected
 * band still does something audible.
 */
export function analyseCarveBands(
  voice: Float32Array,
  sampleRate: number,
  settings: HfCarveSettings,
): HfCarveBand[] {
  if (voice.length === 0) return [];
  const { freqs, power } = powerSpectrum(voice, sampleRate);

  const scored = CANDIDATE_CENTERS_HZ.map((center) => ({
    center,
    score:
      bandPower(freqs, power, center) * intelligibilityWeight(center, settings.intelligibilityBias),
  })).sort((a, b) => b.score - a.score);

  const selected = scored.slice(0, Math.max(1, settings.bands)).filter((b) => b.score > 0);
  if (selected.length === 0) return [];

  const top = selected[0]!.score;
  return selected
    .map(({ center, score }) => {
      const depth = Math.min(
        settings.maxCutDb,
        Math.max(settings.maxCutDb / 2, settings.maxCutDb * (score / top)),
      );
      return { freq: center, gainDb: -Number(depth.toFixed(2)), q: settings.q };
    })
    .sort((a, b) => a.freq - b.freq);
}

/** Carve bands as an ordinary FX chain of peaking filters. */
export function carveBandsToChain(bands: HfCarveBand[]): HfAudioFxChain {
  const nodes: HfAudioFxNode[] = bands.map((b) => ({
    type: "peaking",
    enabled: true,
    params: {
      ...defaultAudioFxParams("peaking"),
      frequency: b.freq,
      gain: b.gainDb,
      q: b.q,
    },
  }));
  return { version: HF_AUDIO_FX_CHAIN_VERSION, nodes };
}
