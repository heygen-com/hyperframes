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
 * How far the bias may move a band in the ranking, in dB, at full strength.
 *
 * This has to be on the scale of the thing it competes with. Speech spreads
 * 20-30 dB across these candidate bands — it falls off roughly 6 dB per octave
 * above the fundamental — so a bias that can only shift the ranking by a few dB
 * cannot shift it at all. 30 dB gives the 0.7 default about 21 dB of authority
 * over the low bands, enough to cross a normal voice's tilt, while still leaving
 * a band the voice genuinely dominates able to win: the bias reweights the
 * ranking, it does not override the spectrum.
 */
const BIAS_AUTHORITY_DB = 30;

/**
 * Ranking penalty for a candidate band, in dB. Zero at 2 kHz, where speech
 * intelligibility lives and where a bed most often masks a voice, rising as a
 * band sits further away in either direction.
 *
 * Applied in dB, and that is the point. As a multiplicative weight of
 * `1 - bias + bias * shaped` it is bounded below by `1 - bias`, so the most it
 * could ever move a ranking is `10*log10(1/(1 - bias))`: 5.2 dB at the 0.7
 * default, 3 dB at 0.5. Against speech's own 20-30 dB tilt that is no influence,
 * and every bias below ~0.95 ranks exactly like bias 0 — selecting the
 * fundamental every time, the precise outcome the bias exists to prevent. A
 * fixture whose bands sit 2 dB apart cannot tell the two apart.
 */
function intelligibilityPenaltyDb(center: number, bias: number): number {
  const octavesFrom2k = Math.log2(center / 2000);
  const shaped = Math.exp(-(octavesFrom2k * octavesFrom2k) / 2);
  return bias * BIAS_AUTHORITY_DB * (1 - shaped);
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

  const scored = CANDIDATE_CENTERS_HZ.map((center) => {
    const bandPowerAt = bandPower(freqs, power, center);
    return {
      center,
      hasEnergy: bandPowerAt > 0,
      // A band with no energy scores -Infinity rather than a large negative
      // number, so it can never outrank a real band however favourably the bias
      // views its frequency.
      scoreDb:
        bandPowerAt > 0
          ? 10 * Math.log10(bandPowerAt) -
            intelligibilityPenaltyDb(center, settings.intelligibilityBias)
          : Number.NEGATIVE_INFINITY,
    };
  }).sort((a, b) => b.scoreDb - a.scoreDb);

  const selected = scored.slice(0, Math.max(1, settings.bands)).filter((b) => b.hasEnergy);
  if (selected.length === 0) return [];

  const topDb = selected[0]!.scoreDb;
  return selected
    .map(({ center, scoreDb }) => {
      // Same relative depth as a ratio of linear scores would give — a band 3 dB
      // under the strongest gets half its cut — read off the dB difference.
      const relative = Math.pow(10, (scoreDb - topDb) / 10);
      const depth = Math.min(
        settings.maxCutDb,
        Math.max(settings.maxCutDb / 2, settings.maxCutDb * relative),
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
