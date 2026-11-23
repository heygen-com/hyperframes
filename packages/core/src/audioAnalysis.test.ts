import { describe, expect, it } from "vitest";
import {
  classify,
  envelope,
  loudness,
  moments,
  onsets,
  runLadder,
  signalProvider,
  silence,
  type AudioAnalysisProvider,
  type AudioSignal,
} from "./audioAnalysis";

const RATE = 48_000;

/** A seeded noise source, so every run measures the same signal. */
function noise(seed = 1) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return (state / 2_147_483_648) * 2 - 1;
  };
}

function signal(
  seconds: number,
  fill: (t: number, random: () => number) => number,
  channels = 1,
): AudioSignal {
  const random = noise();
  const samples = Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) =>
    fill(i / RATE, random),
  );
  return { sampleRate: RATE, channels: Array.from({ length: channels }, () => samples) };
}

/** Silence, then a noise burst that peaks `rise` seconds after `at` and decays exponentially. */
const impact =
  (at: number, rise: number, decay = 0.08) =>
  (t: number, random: () => number) => {
    if (t < at) return 0;
    const since = t - at;
    const gain = since < rise ? since / rise : Math.exp(-(since - rise) / decay);
    return 0.8 * gain * random();
  };

describe("moments", () => {
  it("finds where an impact starts, rises fastest, peaks and fades", () => {
    const hit = moments(signal(1, impact(0.3, 0.02)))!;
    expect(hit.onset).toBeGreaterThanOrEqual(0.3);
    expect(hit.onset).toBeLessThan(0.31);
    expect(hit.peak).toBeCloseTo(0.32, 2);
    expect(hit.steepest).toBeGreaterThanOrEqual(hit.onset);
    expect(hit.steepest).toBeLessThanOrEqual(hit.peak);
    expect(hit.tailEnd).toBeGreaterThan(0.6);
  });

  it("puts a slow swell's peak at its end, well after its steepest rise", () => {
    const swell = moments(
      signal(1.5, (t, random) => (t < 1.2 ? 0.8 * (t / 1.2) ** 3 * random() : 0)),
    )!;
    expect(swell.peak).toBeGreaterThan(1.1);
    expect(swell.onset).toBeGreaterThan(0.6);
    expect(swell.onset).toBeLessThan(swell.peak);
  });

  it("has no moments in silence", () => {
    expect(moments(signal(0.5, () => 0))).toBeNull();
  });
});

describe("opposite polarity", () => {
  const reversed = signal(3, impact(1, 0.01, 0.05));
  reversed.channels.push(Float32Array.from(reversed.channels[0]!, (sample) => -sample));

  it("still hears a channel that is the reverse of the other", () => {
    expect(moments(reversed)?.peak).toBeCloseTo(1.01, 2);
    for (const method of ["spectral-flux", "energy"] as const)
      expect(
        onsets(reversed, { method }).events.some((event) => Math.abs(event.t - 1) < 0.02),
      ).toBe(true);
    expect(Math.max(...envelope(reversed, { hopMs: 10 }).values)).toBeGreaterThan(-40);
    expect(silence(reversed).some((span) => span.start <= 1.01 && span.end > 1.05)).toBe(false);
  });
});

describe("onsets", () => {
  it("finds each hit of a three-hit effect, the loudest strongest, by spectral flux and by energy", () => {
    const hits = [0.2, 0.55, 0.9];
    const gains = [1, 0.4, 0.7];
    const fill = (t: number, random: () => number) =>
      hits.reduce((sum, at, i) => sum + gains[i]! * impact(at, 0.003, 0.05)(t, random), 0);
    for (const method of ["spectral-flux", "energy"] as const) {
      const found = onsets(signal(1.2, fill), { method });
      expect(found.events.map((e) => e.t).every((t, i) => Math.abs(t - hits[i]!) < 0.015)).toBe(
        true,
      );
      expect(found.events).toHaveLength(3);
      expect(found.events[0]!.strength).toBe(1);
    }
  });

  it("finds a hit 16 dB under the loudest one", () => {
    const fill = (t: number, random: () => number) =>
      impact(0.2, 0.003, 0.05)(t, random) + 0.16 * impact(0.6, 0.003, 0.05)(t, random);
    const found = onsets(signal(1, fill)).events.map((e) => e.t);
    expect(found.some((t) => Math.abs(t - 0.6) < 0.015)).toBe(true);
  });

  it("finds nothing in silence", () => {
    expect(onsets(signal(0.5, () => 0)).events).toEqual([]);
  });
});

describe("envelope", () => {
  it("reads a steady tone at its RMS level, in dB or linear", () => {
    const tone = signal(0.5, (t) => 0.5 * Math.sin(2 * Math.PI * 440 * t));
    const db = envelope(tone, { hopMs: 10 });
    expect(db.values.length).toBe(50);
    expect(db.values[25]).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 0);
    expect(envelope(tone, { scale: "linear" }).values[50]).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("measures only the band asked for", () => {
    const tone = signal(0.5, (t) => 0.5 * Math.sin(2 * Math.PI * 440 * t));
    const inBand = envelope(tone, { band: [300, 600], hopMs: 10 }).values[25]!;
    const outOfBand = envelope(tone, { band: [4000, 8000], hopMs: 10 }).values[25]!;
    expect(inBand).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 0);
    expect(outOfBand).toBeLessThan(inBand - 40);
  });
});

describe("loudness", () => {
  it("reads a full-scale 997 Hz sine in one channel at -3.01 LUFS, as BS.1770 specifies", () => {
    const sine = signal(3, (t) => Math.sin(2 * Math.PI * 997 * t));
    const measured = loudness(sine);
    expect(measured.lufsIntegrated).toBeCloseTo(-3.0, 1);
    expect(measured.samplePeakDb).toBeCloseTo(0, 1);
    expect(measured.clipping.count).toBeGreaterThan(0);
  });

  it("sums channels: the same sine in two channels is 3 dB louder", () => {
    const one = loudness(signal(3, (t) => 0.5 * Math.sin(2 * Math.PI * 997 * t)));
    const two = loudness(signal(3, (t) => 0.5 * Math.sin(2 * Math.PI * 997 * t), 2));
    expect(two.lufsIntegrated! - one.lufsIntegrated!).toBeCloseTo(3.01, 1);
  });

  it("sees an inter-sample peak above the sample peak", () => {
    const quarter = signal(1, (t) => Math.sin(2 * Math.PI * (RATE / 4) * t + Math.PI / 4));
    const measured = loudness(quarter);
    expect(measured.truePeakDb).toBeGreaterThan(measured.samplePeakDb + 2);
  });

  it("has no integrated loudness for silence", () => {
    expect(loudness(signal(1, () => 0)).lufsIntegrated).toBeNull();
  });
});

describe("silence", () => {
  it("returns the quiet spans long enough to count", () => {
    const gaps = silence(
      signal(2, (t, random) => (t < 0.5 || (t > 1.2 && t < 1.25) ? 0 : 0.3 * random())),
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.start).toBe(0);
    expect(gaps[0]!.end).toBeCloseTo(0.5, 1);
  });
});

describe("classify", () => {
  const gaps = noise(7);
  const syllables: number[] = [];
  for (let at = 0.1; at < 10; at += 0.12 + 0.25 * Math.abs(gaps())) syllables.push(at);
  const syllableAt = (t: number) => syllables.findIndex((at) => t - at >= 0 && t - at < 0.15);
  const burst = (t: number) => {
    const n = syllableAt(t);
    return n < 0 ? 0 : 0.5 * Math.sin((Math.PI * (t - syllables[n]!)) / 0.15);
  };
  /** A voice whose pitch moves from syllable to syllable, with breath noise, in irregular bursts over room tone. */
  const speechLike = (t: number, random: () => number) => {
    const hz = 110 + 13 * (syllableAt(t) % 7);
    const fold = Math.sin(2 * Math.PI * hz * t) + 0.5 * Math.sin(4 * Math.PI * hz * t);
    return burst(t) * (fold + 0.3 * random()) + 0.02 * random();
  };
  /** The same envelope as noise: what a hit with a reverb tail looks like to the envelope alone. */
  const unpitched = (t: number, random: () => number) => (burst(t) + 0.02) * random();

  it("calls a short sound an effect", () => {
    expect(classify(signal(1, impact(0.1, 0.01))).value).toBe("sfx");
  });

  it("calls a long sound that only fades away an effect, not a bed", () => {
    expect(classify(signal(10, impact(0.1, 0.01, 1.2))).value).toBe("sfx");
  });

  it("calls a steady beat over a held pad music", () => {
    const beat = (t: number, random: () => number) =>
      0.15 * Math.sin(2 * Math.PI * 220 * t) + impact(0, 0.003, 0.04)(t % 0.5, random);
    expect(classify(signal(10, beat)).value).toBe("music");
  });

  it("calls irregular syllable-length bursts voice, in a long take and in a short line", () => {
    expect(classify(signal(10, speechLike)).value).toBe("voice");
    expect(classify(signal(3, speechLike)).value).toBe("voice");
  });

  it("still calls speech voice when the stereo channels have opposite polarity", () => {
    const speech = signal(3, speechLike);
    const expected = classify(speech);
    speech.channels.push(Float32Array.from(speech.channels[0]!, (sample) => -sample));
    expect(classify(speech)).toEqual(expected);
  });

  it("does not call speech-shaped noise voice: without a voice-range pitch it is an effect or a bed", () => {
    const short = classify(signal(3, unpitched));
    expect(short.value).toBe("sfx");
    expect(short.features.voiced).toBe(0);
    expect(classify(signal(10, unpitched)).value).not.toBe("voice");
  });

  it("calls even-paced speech without a beat voice, and a held pitched pad still music", () => {
    /** Voice that never stops: the syllables only swell a carried pitch, as a presenter or TTS reads. */
    const steady = (t: number, random: () => number) => {
      const hz = 110 + 13 * (Math.max(0, syllableAt(t)) % 7);
      const phrase = (t + 0.4 * Math.sin(t)) % 2.9 < 2.3 ? 1 : 0.03;
      return phrase * (0.25 + 0.6 * burst(t)) * (Math.sin(2 * Math.PI * hz * t) + 0.1 * random());
    };
    const pad = (t: number, random: () => number) =>
      0.3 * (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 330 * t)) +
      0.01 * random();
    const speech = classify(signal(10, steady));
    expect(speech.features.syllables).toBeLessThan(0.35);
    expect(speech.value).toBe("voice");
    expect(classify(signal(10, pad)).value).toBe("music");
  });

  it("reports what the guess was made from", () => {
    expect(Object.keys(classify(signal(3, speechLike)).features)).toEqual([
      "duration",
      "regularity",
      "syllables",
      "sustain",
      "voiced",
    ]);
  });
});

describe("runLadder", () => {
  const tone = signal(0.2, (t) => 0.5 * Math.sin(2 * Math.PI * 440 * t));
  const service: AudioAnalysisProvider<AudioSignal> = {
    id: "service",
    local: false,
    capabilities: ["moments"],
    analyze: async () => ({ onset: 0, steepest: 0, peak: 0, tailEnd: 0 }),
  };
  const broken: AudioAnalysisProvider<AudioSignal> = {
    id: "broken",
    local: true,
    capabilities: ["moments"],
    analyze: async () => {
      throw new Error("model missing");
    },
  };

  it("uses the first provider allowed at the quality asked for", async () => {
    const providers = [service, signalProvider];
    expect((await runLadder("moments", tone, providers)).provenance).toBe("service");
    const local = await runLadder("moments", tone, providers, { quality: "local" });
    expect(local.provenance).toBe("signal");
    expect(local.steps[0]).toEqual({
      provider: "service",
      outcome: "excluded",
      reason: "quality local keeps audio on this machine",
    });
  });

  it("falls through a failing provider and says so", async () => {
    const result = await runLadder("moments", tone, [broken, signalProvider]);
    expect(result.provenance).toBe("signal");
    expect(result.warnings).toEqual(["moments: used signal; broken failed (model missing)"]);
  });

  it("falls through a provider that cannot run here, or whose check throws, and says why", async () => {
    const keyless = { ...service, available: () => ({ ok: false as const, reason: "no key" }) };
    const throwing = {
      ...broken,
      id: "throwing",
      available: () => {
        throw new Error("probe crashed");
      },
    };
    const result = await runLadder("moments", tone, [keyless, throwing, signalProvider]);
    expect(result.provenance).toBe("signal");
    expect(result.steps.map((s) => [s.provider, s.outcome, s.reason])).toEqual([
      ["service", "unavailable", "no key"],
      ["throwing", "unavailable", "probe crashed"],
      ["signal", "answered", undefined],
    ]);
    expect(result.warnings).toEqual([
      "moments: used signal; service unavailable (no key); throwing unavailable (probe crashed)",
    ]);
  });

  it("follows a ladder given in place of the default, and reports a capability no provider offers", async () => {
    const result = await runLadder("moments", tone, [service, signalProvider], {
      ladder: ["signal", "service"],
    });
    expect(result.provenance).toBe("signal");
    const described = await runLadder("describe", tone, [signalProvider]);
    expect(described).toMatchObject({ value: null, provenance: null });
    expect(described.warnings).toEqual(["describe: no provider answered (none offers it)"]);
  });
});
