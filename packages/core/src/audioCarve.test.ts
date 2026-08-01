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
