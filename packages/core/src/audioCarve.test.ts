import { describe, expect, it } from "vitest";
import {
  analyseCarveBands,
  carveBandsToChain,
  DEFAULT_CARVE,
  normalizeCarveSettings,
} from "./audioCarve.js";

const SR = 48000;

/** A tone-plus-harmonics stand-in for a voice, centred on `f0`. */
function voiceLike(f0: number, seconds = 0.5): Float32Array {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] =
      0.6 * Math.sin(2 * Math.PI * f0 * t) +
      0.3 * Math.sin(2 * Math.PI * f0 * 2 * t) +
      0.1 * Math.sin(2 * Math.PI * f0 * 3 * t);
  }
  return out;
}

describe("normalizeCarveSettings", () => {
  it("fills defaults and clamps nonsense", () => {
    expect(normalizeCarveSettings(undefined)).toEqual(DEFAULT_CARVE);
    const v = normalizeCarveSettings({ maxCutDb: 500, bands: 99, q: 0, intelligibilityBias: -3 });
    expect(v.maxCutDb).toBe(24);
    expect(v.bands).toBe(6);
    expect(v.q).toBe(0.3);
    expect(v.intelligibilityBias).toBe(0);
  });
});

describe("analyseCarveBands", () => {
  it("returns nothing for silence-length input", () => {
    expect(analyseCarveBands(new Float32Array(0), SR, DEFAULT_CARVE)).toEqual([]);
  });

  it("returns the requested number of bands, ascending, all cuts", () => {
    const bands = analyseCarveBands(voiceLike(250), SR, { ...DEFAULT_CARVE, bands: 3 });
    expect(bands).toHaveLength(3);
    expect(bands.map((b) => b.freq)).toEqual([...bands.map((b) => b.freq)].sort((a, b) => a - b));
    for (const b of bands) expect(b.gainDb).toBeLessThan(0);
  });

  it("never cuts deeper than the configured maximum", () => {
    const bands = analyseCarveBands(voiceLike(400), SR, { ...DEFAULT_CARVE, maxCutDb: 5 });
    for (const b of bands) expect(Math.abs(b.gainDb)).toBeLessThanOrEqual(5);
  });

  it("follows raw voice power when the bias is off", () => {
    // With no bias, a low-pitched voice should select its own fundamental
    // region — this is the behaviour that makes an unbiased carve thin the bed
    // rather than unmask the voice.
    const bands = analyseCarveBands(voiceLike(160), SR, {
      ...DEFAULT_CARVE,
      bands: 1,
      intelligibilityBias: 0,
    });
    expect(bands[0]!.freq).toBeLessThanOrEqual(400);
  });

  it("moves selection upward when the bias is on", () => {
    // The bias reweights ranking, it does not override the spectrum: a band the
    // voice has no energy in is not worth carving. So the guarantee is that
    // biasing never selects *lower* than the unbiased ranking, and lifts it
    // whenever there is competing energy up top to select.
    const broadband = (() => {
      const n = Math.floor(SR * 0.5);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        out[i] =
          0.5 * Math.sin(2 * Math.PI * 160 * t) +
          0.45 * Math.sin(2 * Math.PI * 1000 * t) +
          0.4 * Math.sin(2 * Math.PI * 2500 * t);
      }
      return out;
    })();
    const flat = analyseCarveBands(broadband, SR, {
      ...DEFAULT_CARVE,
      bands: 1,
      intelligibilityBias: 0,
    });
    const biased = analyseCarveBands(broadband, SR, {
      ...DEFAULT_CARVE,
      bands: 1,
      intelligibilityBias: 1,
    });
    expect(biased[0]!.freq).toBeGreaterThanOrEqual(flat[0]!.freq);
    expect(biased[0]!.freq).toBeGreaterThanOrEqual(1000);
  });

  /**
   * A voice with the spectral tilt real speech has: energy falls off about 6 dB
   * per octave above the fundamental, so the low bands carry 20-30 dB more power
   * than the presence region. `broadband` above spreads its three tones over
   * roughly 2 dB, which is why it cannot tell a working bias from an inert one.
   */
  function tiltedVoice(f0 = 120, seconds = 0.5): Float32Array {
    const n = Math.floor(SR * seconds);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let v = 0;
      // Harmonics out past 6 kHz, each 6 dB/octave down, so every candidate band
      // has real energy to rank and the ranking is decided by the weighting
      // rather than by which band happens to be the only one occupied.
      for (let h = 1; h * f0 < SR / 2 && h <= 64; h++) {
        v += (1 / h) * Math.sin(2 * Math.PI * f0 * h * t);
      }
      out[i] = 0.5 * v;
    }
    return out;
  }

  it("reaches the presence region at the default bias, not just at bias 1", () => {
    // The point of the feature: dip the bed where the voice is MASKED, 1-3 kHz,
    // not where the voice is loudest. DEFAULT_CARVE is what a user gets from
    // clicking "Analyse and apply", so the default has to do this — a knob that
    // only works at its extreme does not work.
    const bands = analyseCarveBands(tiltedVoice(), SR, { ...DEFAULT_CARVE, bands: 3 });
    expect(bands.map((b) => b.freq).some((f) => f >= 1000)).toBe(true);
  });

  it("gives the bias enough authority to cross a speech-sized tilt", () => {
    // The authority, stated in the unit that decides it: a multiplicative weight
    // bounded below by (1 - bias) can move a ranking by at most
    // 10*log10(1/(1 - bias)) — 5.2 dB at the 0.7 default. Speech tilts 20-30 dB.
    //
    // Two tones, the low one 9 dB louder, both on candidate centres (the bands
    // are a third of an octave wide but their centres step about two thirds
    // apart, so a tone between two of them — 2 kHz, say — falls in a gap and is
    // invisible to the analysis). Raw power says 250 Hz; the default bias has to
    // be able to say 1.6 kHz anyway.
    //
    // 9 dB rather than the 21 dB the bias nominally carries at 0.7: a lone tone
    // is diluted by `bandPower` averaging across the band's bins, and the 1.6 kHz
    // band spans about six times as many bins as the 250 Hz one, which costs
    // roughly 8 dB. Broadband content — a real voice — fills both and keeps it.
    const twoTone = (() => {
      const n = Math.floor(SR * 0.5);
      const out = new Float32Array(n);
      const quiet = Math.pow(10, -9 / 20);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        out[i] =
          0.5 * Math.sin(2 * Math.PI * 250 * t) + 0.5 * quiet * Math.sin(2 * Math.PI * 1600 * t);
      }
      return out;
    })();
    const one = { ...DEFAULT_CARVE, bands: 1 };
    expect(analyseCarveBands(twoTone, SR, { ...one, intelligibilityBias: 0 })[0]!.freq).toBe(250);
    expect(analyseCarveBands(twoTone, SR, one)[0]!.freq).toBe(1600);
  });

  it("still follows raw power exactly when the bias is off", () => {
    // The escape hatch keeps working: at bias 0 selection is the voice's own
    // loudest band, whatever the weighting curve would have preferred.
    const bands = analyseCarveBands(tiltedVoice(), SR, {
      ...DEFAULT_CARVE,
      bands: 1,
      intelligibilityBias: 0,
    });
    expect(bands[0]!.freq).toBeLessThanOrEqual(400);
  });
});

describe("carveBandsToChain", () => {
  it("turns bands into peaking nodes carrying the analysed values", () => {
    const chain = carveBandsToChain([{ freq: 1000, gainDb: -6, q: 1.4 }]);
    expect(chain.nodes).toHaveLength(1);
    expect(chain.nodes[0]!.type).toBe("peaking");
    expect(chain.nodes[0]!.params).toMatchObject({ frequency: 1000, gain: -6, q: 1.4 });
  });

  it("produces an empty chain for no bands", () => {
    expect(carveBandsToChain([]).nodes).toEqual([]);
  });
});
