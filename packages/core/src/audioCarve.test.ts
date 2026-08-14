import { describe, expect, it } from "vitest";
import { MAX_AUTOMATION_POINTS, sampleAutomationLane } from "./audioAutomation.js";
import {
  analyseCarveBands,
  analyseCarveDuck,
  analyseCarveDynamics,
  carveBandsToChain,
  carveProfile,
  classifyAudioName,
  clipsOverlap,
  mixCarveSources,
  couldBeCarveSource,
  DEFAULT_CARVE,
  normalizeCarveSettings,
} from "./audioCarve.js";

/** The profile the panel's default strength produces — what the separate controls defaulted to. */
const PROFILE = carveProfile(DEFAULT_CARVE.strength);

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
    expect(normalizeCarveSettings({ strength: 40 }).strength).toBe(1);
    expect(normalizeCarveSettings({ strength: -3 }).strength).toBe(0);
    expect(normalizeCarveSettings({ strength: Number.NaN }).strength).toBe(DEFAULT_CARVE.strength);
  });

  it("reads a carve written before the controls collapsed into one", () => {
    // Depth is the number that said most about intent, so it maps back onto the
    // strength that reproduces it rather than being dropped.
    expect(normalizeCarveSettings({ maxCutDb: 6, bands: 3, q: 1.4 }).strength).toBe(0.25);
    expect(carveProfile(normalizeCarveSettings({ maxCutDb: 6 }).strength).maxCutDb).toBe(6);
    expect(normalizeCarveSettings({ maxCutDb: 10 }).strength).toBe(0.5);
    expect(normalizeCarveSettings({ maxCutDb: 24 }).strength).toBe(1);
  });

  it("keeps an explicit strength over a legacy depth", () => {
    expect(normalizeCarveSettings({ strength: 0.25, maxCutDb: 10 }).strength).toBe(0.25);
  });
});

describe("carveProfile", () => {
  it("lands on the old defaults at the strength the panel starts at", () => {
    // The separate controls shipped 6 dB, 3 bands, Q 1.4, bias 0.7, and the duck
    // pair defaulted to 6/9 — a project carved before the collapse must sound the
    // same after it. That point is a quarter of the way up, since the knob's range
    // was later doubled above it.
    expect(DEFAULT_CARVE.strength).toBe(0.25);
    expect(PROFILE).toEqual({
      maxCutDb: 6,
      bands: 3,
      q: 1.4,
      intelligibilityBias: 0.7,
      duckDb: 6,
      headroomDb: 9,
    });
  });

  it("moves every number the same direction, monotonically", () => {
    const steps = [0, 0.25, 0.5, 0.75, 1].map(carveProfile);
    for (let i = 1; i < steps.length; i++) {
      const a = steps[i - 1]!;
      const b = steps[i]!;
      expect(b.maxCutDb).toBeGreaterThan(a.maxCutDb);
      expect(b.bands).toBeGreaterThanOrEqual(a.bands);
      expect(b.q).toBeGreaterThan(a.q);
      expect(b.duckDb).toBeGreaterThan(a.duckDb);
      expect(b.headroomDb).toBeGreaterThan(a.headroomDb);
    }
  });

  it("carves frequencies only at zero, and goes hard at the top", () => {
    expect(carveProfile(0).duckDb).toBe(0);
    expect(carveProfile(0).bands).toBe(1);
    expect(carveProfile(1).maxCutDb).toBe(18);
    expect(carveProfile(1).bands).toBe(6);
    expect(carveProfile(1).duckDb).toBe(24);
    // The bias is a 0..1 weight, so the top of the knob is all the way over
    // rather than past it.
    expect(carveProfile(1).intelligibilityBias).toBe(1);
  });

  it("puts the old top of the knob at the halfway mark", () => {
    // The range was doubled because full strength could not sit a bed under a
    // loud voice. Everything the knob used to reach is now the bottom half.
    expect(carveProfile(0.5)).toEqual({
      maxCutDb: 10,
      bands: 4,
      q: 1.7,
      intelligibilityBias: 0.8,
      duckDb: 12,
      headroomDb: 12,
    });
  });

  it("clamps a strength outside the knob's own range", () => {
    expect(carveProfile(9)).toEqual(carveProfile(1));
    expect(carveProfile(-9)).toEqual(carveProfile(0));
  });
});

describe("analyseCarveBands", () => {
  it("returns nothing for silence-length input", () => {
    expect(analyseCarveBands(new Float32Array(0), SR, PROFILE)).toEqual([]);
  });

  it("returns the requested number of bands, ascending, all cuts", () => {
    const bands = analyseCarveBands(voiceLike(250), SR, { ...PROFILE, bands: 3 });
    expect(bands).toHaveLength(3);
    expect(bands.map((b) => b.freq)).toEqual([...bands.map((b) => b.freq)].sort((a, b) => a - b));
    for (const b of bands) expect(b.gainDb).toBeLessThan(0);
  });

  it("never cuts deeper than the configured maximum", () => {
    const bands = analyseCarveBands(voiceLike(400), SR, { ...PROFILE, maxCutDb: 5 });
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
    const bands = analyseCarveBands(tiltedVoice(), SR, { ...PROFILE, bands: 3 });
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
    const one = { ...PROFILE, bands: 1 };
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

/**
 * Both analysis loops reuse one pair of FFT scratch arrays across every window
 * rather than allocating a pair per hop — a 5-minute 48 kHz voiceover is ~7000
 * hops, so ~460 MB of transient Float64Array used to churn through the main
 * thread for one carve. `re` is fully overwritten each window, but `im` is only
 * ever added to, so it has to be cleared; missing that, the imaginary part
 * accumulates across windows and every spectrum after the first is wrong by a
 * growing amount.
 */
describe("reused FFT scratch across windows", () => {
  /** A steady tone on an exact bin centre (48000/4096 x 128), so every window is identical. */
  const steady = (seconds: number): Float32Array => {
    const n = Math.floor(SR * seconds);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * 1500 * i) / SR);
    return out;
  };

  it("measures the same bands however many windows the clip has", () => {
    // Every window carries the same spectrum, so the Welch average cannot
    // depend on how many were averaged — unless one window is contaminating
    // the next.
    const short = analyseCarveBands(steady(0.5), SR, PROFILE);
    const long = analyseCarveBands(steady(12), SR, PROFILE);
    expect(short.length).toBeGreaterThan(0);
    expect(long).toEqual(short);
  });

  it("keeps a steady tone's dynamics envelope flat instead of drifting", () => {
    const [lane] = analyseCarveDynamics(steady(12), SR, [{ freq: 1600, gainDb: -8, q: 1.4 }]);
    const value = (t: number): number =>
      sampleAutomationLane({ target: "fx.n1.gain", points: lane!.points }, t);
    // Past the attack the cut has to sit still, because the signal does. A
    // window contaminated by the one before it grows the measured power over
    // the clip, and the envelope — which is relative to the band's own peak —
    // slides with it.
    expect(value(4)).toBeLessThan(-1);
    expect(value(8)).toBeCloseTo(value(4), 0);
    expect(value(11)).toBeCloseTo(value(4), 0);
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

describe("analyseCarveDuck", () => {
  const SR8 = 8000;

  /** Steady tone at a given amplitude — stands in for a bed or a voice. */
  function tone(amp: number, seconds: number, f = 300, sr = SR8): Float32Array {
    const out = new Float32Array(Math.floor(sr * seconds));
    for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin(2 * Math.PI * f * (i / sr));
    return out;
  }

  /** Silence, then speech-level tone, then silence. */
  function voiceWithPause(amp: number, seconds: number, from: number, to: number): Float32Array {
    const out = new Float32Array(Math.floor(SR8 * seconds));
    for (let i = 0; i < out.length; i++) {
      const t = i / SR8;
      out[i] = t >= from && t < to ? amp * Math.sin(2 * Math.PI * 700 * t) : 0;
    }
    return out;
  }

  const at = (points: { t: number; v: number }[], t: number): number =>
    sampleAutomationLane({ target: "fx.n1.gain", points }, t);

  const settings = (over: Partial<typeof PROFILE> = {}) => ({
    ...PROFILE,
    duckDb: 12,
    headroomDb: 9,
    ...over,
  });

  it("leaves the bed alone where the voice is silent", () => {
    // The whole point of a follower: no voice, nothing to make room for. Before
    // the first word it is exactly flat; afterwards it eases back rather than
    // snapping, so the tail is checked by the release cases below.
    const duck = analyseCarveDuck(voiceWithPause(0.5, 16, 3, 6), tone(0.5, 16), SR8, settings(), 0);
    expect(at(duck, 1)).toBe(0);
    // A window is half a second wide and its value is stamped at its centre, so
    // the duck begins up to half a window before the first word — checked clear
    // of that rather than right against it.
    expect(at(duck, 2)).toBe(0);
    // Back to inaudible by the end of a long tail rather than held down for the
    // clip; the envelope's last point is pinned at exactly no cut.
    expect(at(duck, 15)).toBeCloseTo(0, 1);
    expect(duck.at(-1)?.v).toBe(0);
  });

  it("ducks a loud bed under a quiet voice", () => {
    // Bed 12 dB above the voice with 9 dB of headroom asked for: the bed has to
    // come down by about 21 dB, which the cap holds at 12.
    const duck = analyseCarveDuck(
      voiceWithPause(0.12, 8, 2, 7),
      tone(0.5, 8),
      SR8,
      settings({ duckDb: 24 }),
      0,
    );
    expect(at(duck, 4.5)).toBeLessThan(-15);
  });

  it("barely touches a bed already sitting under the voice", () => {
    const duck = analyseCarveDuck(voiceWithPause(0.8, 8, 2, 7), tone(0.05, 8), SR8, settings(), 0);
    expect(at(duck, 4.5)).toBeGreaterThan(-1);
  });

  it("lets the bed come back slowly after the voice stops", () => {
    // A bed that jumps back to full the instant a word ends is heard as the
    // effect switching off. It has to ease back over seconds — and the envelope's
    // own step is ~0.3s on a long voice, so a release near that lands the whole
    // recovery inside one step, which is exactly the flip this pins against.
    const voice = voiceWithPause(0.5, 14, 2, 6);
    const duck = analyseCarveDuck(voice, tone(0.5, 14), SR8, settings({ duckDb: 12 }), 0);
    const atSpeech = at(duck, 5.5);
    expect(atSpeech).toBeLessThan(-6);

    // Still most of the way down a third of a second after the last word...
    expect(at(duck, 6.3)).toBeLessThan(atSpeech * 0.6);
    // ...noticeably recovered by a second and a half...
    expect(at(duck, 7.5)).toBeGreaterThan(atSpeech * 0.5);
    // ...and within a hair of flat a few seconds later, rather than held down.
    expect(at(duck, 11)).toBeGreaterThan(-0.6);
  });

  it("finishes the release past the last word instead of snapping at the end", () => {
    // A lane's last point has to be no cut, or the bed stays dipped for the rest
    // of the clip. Jumping there from full duck is the same flip the slow release
    // exists to prevent, just moved to the end of the narration — so the envelope
    // keeps decaying past the voice and pins once it is inaudible.
    const voice = voiceWithPause(0.5, 8, 1, 7.9);
    const duck = analyseCarveDuck(voice, tone(0.5, 12), SR8, settings({ duckDb: 12 }), 0);
    const steps = duck.slice(1).map((p, i) => Math.abs(p.v - duck[i]!.v));
    expect(Math.max(...steps.slice(-4))).toBeLessThan(2);
    // Still ducked a moment after the voice stops, and flat well after.
    expect(at(duck, 8.2)).toBeLessThan(-2);
    expect(duck.at(-1)?.v).toBe(0);
    expect(duck.at(-1)!.t).toBeGreaterThan(8);
  });

  it("comes back up more slowly than it ducks", () => {
    // Asymmetric on purpose: the cut has to be there by the time a word is
    // audible, and gone slowly enough that the bed does not pump between
    // sentences.
    const voice = voiceWithPause(0.5, 14, 4, 8);
    const duck = analyseCarveDuck(voice, tone(0.5, 14), SR8, settings({ duckDb: 12 }), 0);
    const floor = Math.min(...duck.map((p) => p.v));
    const toHalfDown = duck.find((p) => p.v <= floor * 0.5)?.t ?? Infinity;
    const backToHalfUp =
      [...duck].reverse().find((p) => p.v <= floor * 0.5)?.t ?? Number.NEGATIVE_INFINITY;
    const attackSpan = toHalfDown - 4;
    const releaseSpan = backToHalfUp - 8;
    expect(releaseSpan).toBeGreaterThan(attackSpan * 2);
  });

  it("never exceeds the configured maximum", () => {
    const duck = analyseCarveDuck(
      voiceWithPause(0.02, 8, 2, 7),
      tone(0.9, 8),
      SR8,
      settings({ duckDb: 6 }),
      0,
    );
    expect(Math.min(...duck.map((p) => p.v))).toBeGreaterThanOrEqual(-6);
  });

  it("reads the bed at the offset between the two clips", () => {
    // The bed starts before the voice, so voice-local 0 is bed-local `offset`.
    // Given a bed that is loud only in its first half, a voice that starts 4s
    // into it must see the quiet half and duck less than the same voice at 0.
    const bed = new Float32Array(Math.floor(SR8 * 8));
    for (let i = 0; i < bed.length; i++) {
      const t = i / SR8;
      bed[i] = (t < 4 ? 0.9 : 0.02) * Math.sin(2 * Math.PI * 300 * t);
    }
    const voice = voiceWithPause(0.3, 4, 0.5, 3.5);
    const aligned = analyseCarveDuck(voice, bed, SR8, settings({ duckDb: 24 }), 0);
    const shifted = analyseCarveDuck(voice, bed, SR8, settings({ duckDb: 24 }), 4);
    expect(at(aligned, 2)).toBeLessThan(at(shifted, 2));
  });

  it("returns nothing without a voice, and stays inside the point budget", () => {
    expect(analyseCarveDuck(new Float32Array(0), tone(0.5, 2), SR8, settings(), 0)).toEqual([]);
    const long = analyseCarveDuck(
      voiceWithPause(0.4, 200, 5, 195),
      tone(0.5, 200),
      SR8,
      settings(),
      0,
    );
    expect(long.length).toBeLessThanOrEqual(MAX_AUTOMATION_POINTS);
  });
});

describe("analyseCarveDynamics", () => {
  const BAND = { freq: 1000, gainDb: -8, q: 1.4 };

  /** Silence, then a 1 kHz burst, then silence again. */
  function burst(sampleRate: number, seconds: number, from: number, to: number): Float32Array {
    const out = new Float32Array(Math.floor(sampleRate * seconds));
    for (let i = 0; i < out.length; i++) {
      const t = i / sampleRate;
      out[i] = t >= from && t < to ? 0.7 * Math.sin(2 * Math.PI * 1000 * t) : 0;
    }
    return out;
  }

  const at = (points: { t: number; v: number }[], t: number): number =>
    sampleAutomationLane({ target: "fx.n1.gain", points }, t);

  it("holds the filter flat where the voice is silent and cuts where it speaks", () => {
    const [lane] = analyseCarveDynamics(burst(SR, 6, 2, 4), SR, [BAND]);
    expect(lane!.freq).toBe(1000);
    expect(at(lane!.points, 0.7)).toBeCloseTo(0, 1);
    expect(at(lane!.points, 3)).toBeLessThan(-6);
    expect(at(lane!.points, 5.3)).toBeCloseTo(0, 1);
  });

  it("pins both ends of the envelope to no cut", () => {
    const [lane] = analyseCarveDynamics(burst(SR, 6, 2, 4), SR, [BAND]);
    const points = lane!.points;
    expect(points[0]).toMatchObject({ t: 0, v: 0 });
    expect(points.at(-1)!.v).toBe(0);
    // Held past the end, so the bed comes back up rather than staying dipped.
    expect(points.at(-1)!.t).toBeGreaterThanOrEqual(5.9);
  });

  it("never exceeds the point budget a lane can hold", () => {
    const long = burst(8000, 200, 10, 190);
    const [lane] = analyseCarveDynamics(long, 8000, [BAND]);
    expect(lane!.points.length).toBeLessThanOrEqual(MAX_AUTOMATION_POINTS);
    expect(lane!.points.length).toBeGreaterThan(2);
  });

  it("returns one envelope per band, and nothing for no input", () => {
    const sig = burst(SR, 3, 0.5, 2.5);
    expect(analyseCarveDynamics(sig, SR, [BAND, { freq: 2500, gainDb: -4, q: 1.4 }])).toHaveLength(
      2,
    );
    expect(analyseCarveDynamics(new Float32Array(0), SR, [BAND])).toEqual([]);
  });
});

describe("classifyAudioName", () => {
  it("reads a track's kind from its id and its filename together", () => {
    // Either can be the informative one: elements named a1/a2 may still have
    // narration.mp3 and bgm.mp3 behind them.
    expect(classifyAudioName("narration")).toBe("voice");
    expect(classifyAudioName("a1", "voiceover-take3.wav")).toBe("voice");
    expect(classifyAudioName("music-bed")).toBe("music");
    expect(classifyAudioName("a2", "bgm_loop.m4a")).toBe("music");
    expect(classifyAudioName("sfx-explosion")).toBe("sfx");
    expect(classifyAudioName("whoosh-01")).toBe("sfx");
  });

  it("says nothing about a name that says nothing", () => {
    // The common case, and the reason nothing downstream may treat "unknown" as
    // "not a voice": it would hide the one track somebody needs to pick.
    expect(classifyAudioName("a1")).toBe("unknown");
    expect(classifyAudioName("clip-2", "0f9c1a.mp3")).toBe("unknown");
    expect(classifyAudioName(undefined, null)).toBe("unknown");
  });

  it("prefers voice when a name carries both hints", () => {
    // A file called voiceover-over-music-bed.wav is the voiceover, and a track
    // matching both is better offered than hidden.
    expect(classifyAudioName("voiceover-over-music-bed.wav")).toBe("voice");
  });

  it("offers speech and unnamed tracks as carve sources, never music or effects", () => {
    expect(couldBeCarveSource("recap-audio")).toBe(true);
    expect(couldBeCarveSource("a1")).toBe(true);
    expect(couldBeCarveSource("music-bed")).toBe(false);
    expect(couldBeCarveSource("sfx-explosion")).toBe(false);
  });

  it("treats underscores as separators, not word characters, for short hints", () => {
    // `\b` treats `_` as a word character, so `\bbed\b` used to miss `bed_01` —
    // an underscore-separated bed classified as "unknown" and could end up
    // offered as its own carve source.
    expect(classifyAudioName("bed_01")).toBe("music");
    expect(classifyAudioName("my_bed")).toBe("music");
    expect(classifyAudioName("music_bed_loop")).toBe("music");
    expect(classifyAudioName("theme_song")).toBe("music");
    expect(classifyAudioName("vo_take3")).toBe("voice");
    expect(classifyAudioName("main_vox")).toBe("voice");
    expect(couldBeCarveSource("bed_01")).toBe(false);
  });
});

describe("clipsOverlap", () => {
  it("overlaps when the spans genuinely share time", () => {
    expect(clipsOverlap({ start: 0, duration: 5 }, { start: 3, duration: 5 })).toBe(true);
  });

  it("does not overlap when one span ends before the other starts", () => {
    expect(clipsOverlap({ start: 0, duration: 5 }, { start: 5, duration: 5 })).toBe(false);
    expect(clipsOverlap({ start: 10, duration: 5 }, { start: 0, duration: 5 })).toBe(false);
  });

  it("does not overlap two clips that only touch at an edge", () => {
    // Half-open: an end exactly at the other's start shares no time to carve.
    expect(clipsOverlap({ start: 0, duration: 5 }, { start: 5, duration: 5 })).toBe(false);
  });

  it("treats a null or undefined duration as unbounded", () => {
    expect(clipsOverlap({ start: 0, duration: null }, { start: 100, duration: 1 })).toBe(true);
    expect(clipsOverlap({ start: 0 }, { start: 100, duration: 1 })).toBe(true);
    // Symmetric: the unbounded span can be on either side.
    expect(clipsOverlap({ start: 100, duration: 1 }, { start: 0, duration: undefined })).toBe(true);
  });

  it("gives a zero-duration clip a single instant, not a span", () => {
    expect(clipsOverlap({ start: 5, duration: 0 }, { start: 5, duration: 5 })).toBe(false);
    expect(clipsOverlap({ start: 5, duration: 0 }, { start: 4, duration: 5 })).toBe(true);
  });

  it("clamps a negative duration to zero rather than inverting the interval", () => {
    // The regression: end = start + duration puts a negative-duration clip's
    // end BEFORE its start, and end(a) is what the other clip's start gets
    // compared against — so a smaller (earlier) broken end silently rejects
    // real overlaps too. {start:10, duration:-5} clamped is a zero-length
    // clip AT t=10, which genuinely sits inside {start:6, duration:20}'s
    // [6, 26) span; the unclamped math missed it (end(a) came out to 5).
    expect(clipsOverlap({ start: 10, duration: -5 }, { start: 6, duration: 20 })).toBe(true);
    // And it stays correct where it isn't inside anything.
    expect(clipsOverlap({ start: 10, duration: -5 }, { start: 20, duration: 5 })).toBe(false);
  });
});

describe("mixCarveSources", () => {
  const tone = (seconds: number, level: number, sampleRate = 48000) =>
    new Float32Array(Math.round(seconds * sampleRate)).fill(level);

  it("places every voice where it starts on the bed's clock", () => {
    // Three people talking at different times is still one question — where and
    // when is speech masking this bed — so they become one signal.
    const mixed = mixCarveSources(
      [
        { samples: tone(1, 0.5), offsetSeconds: 1 },
        { samples: tone(1, 0.25), offsetSeconds: 3 },
      ],
      48000,
    );
    expect(mixed.length).toBe(4 * 48000);
    const at = (t: number) => mixed[Math.round(t * 48000)];
    expect(at(0.5)).toBe(0); // before anyone speaks
    expect(at(1.5)).toBeCloseTo(0.5, 5);
    expect(at(2.5)).toBe(0); // the gap between them
    expect(at(3.5)).toBeCloseTo(0.25, 5);
  });

  it("sums voices that overlap, because two at once mask more than one", () => {
    const mixed = mixCarveSources(
      [
        { samples: tone(1, 0.3), offsetSeconds: 0 },
        { samples: tone(1, 0.3), offsetSeconds: 0 },
      ],
      48000,
    );
    expect(mixed[0]).toBeCloseTo(0.6, 5);
  });

  it("drops the part of a voice that plays before the bed starts", () => {
    // It masks nothing there, and folding it in at zero would put a cut where
    // there is no voice.
    const mixed = mixCarveSources([{ samples: tone(1, 0.5), offsetSeconds: -0.5 }], 48000);
    expect(mixed.length).toBe(0.5 * 48000);
    expect(mixed[0]).toBeCloseTo(0.5, 5);
  });

  it("has nothing to mix when there are no voices", () => {
    expect(mixCarveSources([], 48000)).toHaveLength(0);
  });
});

describe("carve settings written before this took a list of voices", () => {
  it("reads a single `source` as a one-voice list, and forgets `dynamic`", () => {
    // Every carve is dynamic now: a static one thinned the bed through every pause,
    // and nobody wanted that once they had heard both.
    const read = normalizeCarveSettings({ source: "vo", strength: 0.4, dynamic: false } as never);
    expect(read.sources).toEqual(["vo"]);
    expect(read.strength).toBe(0.4);
    expect("dynamic" in read).toBe(false);
  });

  it("drops empty ids rather than carrying a source that names nothing", () => {
    expect(normalizeCarveSettings({ sources: ["", "vo", ""] } as never).sources).toEqual(["vo"]);
    expect(normalizeCarveSettings({ source: "" } as never).sources).toEqual([]);
  });
});
