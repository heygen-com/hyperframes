import { describe, expect, it } from "vitest";
import type { AudioSignal } from "./audioAnalysis";
import { rhythm, tempoOf } from "./audioRhythm";
import { sections } from "./audioSections";
import { snapper } from "./audioSnap";

const RATE = 22_050;

function random(seed = 3) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return (state / 2_147_483_648) * 2 - 1;
  };
}

/** A drum pattern on a known grid: a kick with a low thump on each bar's first beat, a click on the others. */
function drums(beatTimes: number[], meter: number, seconds: number, rate = RATE): AudioSignal {
  const samples = new Float32Array(Math.round(seconds * rate));
  const noise = random();
  beatTimes.forEach((t, k) => {
    const downbeat = k % meter === 0;
    const start = Math.round(t * rate);
    for (let i = 0; i < 0.12 * rate && start + i < samples.length; i++) {
      const since = i / rate;
      const click = (downbeat ? 0.5 : 0.35) * noise() * Math.exp(-since / 0.02);
      const thump = downbeat
        ? 0.8 * Math.sin(2 * Math.PI * 55 * since) * Math.exp(-since / 0.06)
        : 0;
      samples[start + i]! += click + thump;
    }
  });
  return { sampleRate: rate, channels: [samples] };
}

/** The same hit on every beat, over chords that change every four beats from beat `firstChange`. */
function chordsOverEvenHits(
  beatTimes: number[],
  firstChange: number,
  seconds: number,
): AudioSignal {
  const samples = new Float32Array(Math.round(seconds * RATE));
  const noise = random(7);
  const roots = [220, 175, 262, 196];
  beatTimes.forEach((t) => {
    const start = Math.round(t * RATE);
    for (let i = 0; i < 0.08 * RATE && start + i < samples.length; i++)
      samples[start + i]! += 0.4 * noise() * Math.exp(-i / RATE / 0.02);
  });
  const period = beatTimes[1]! - beatTimes[0]!;
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    const bar = Math.floor((t - beatTimes[firstChange]!) / (4 * period));
    const root = roots[((bar % 4) + 4) % 4]!;
    for (const ratio of [1, 1.26, 1.5])
      samples[i]! += 0.08 * Math.sin(2 * Math.PI * root * ratio * t);
  }
  return { sampleRate: RATE, channels: [samples] };
}

const grid = (from: number, period: number, until: number) =>
  Array.from({ length: Math.floor((until - from) / period) + 1 }, (_, k) => from + k * period);

/** Share of `truth` with a detected time within 70 ms, the usual beat-tracking tolerance. */
const recall = (found: number[], truth: number[]) =>
  truth.filter((t) => found.some((f) => Math.abs(f - t) <= 0.07)).length / truth.length;

describe("rhythm", () => {
  it("places beats on a steady grid, with its tempo and its bars", () => {
    const truth = grid(0.25, 0.5, 19.5);
    const { beats, downbeats } = rhythm(drums(truth, 4, 20));
    expect(recall(beats.times, truth)).toBeGreaterThan(0.95);
    expect(beats.times.length).toBeLessThanOrEqual(truth.length + 1);
    expect(beats.confidence).toBeGreaterThan(0.3);
    expect(tempoOf(beats.times).value).toBeCloseTo(120, 0);
    expect(downbeats).toMatchObject({ meter: 4, confidence: "low" });
    expect(
      recall(
        downbeats.times,
        truth.filter((_, k) => k % 4 === 0),
      ),
    ).toBeGreaterThan(0.9);
  });

  it("follows a tempo that changes partway through", () => {
    const truth = [...grid(0.25, 0.6, 15), ...grid(15.25, 0.45, 30)];
    const { beats } = rhythm(drums(truth, 4, 30));
    expect(recall(beats.times, truth)).toBeGreaterThan(0.85);
    const curve = tempoOf(beats.times).curve;
    expect(curve[0]!.bpm).toBeCloseTo(100, -1);
    expect(curve[curve.length - 1]!.bpm).toBeCloseTo(133, -1);
  });

  it("gives the same beats at any sample rate and for mono or the same sound on two channels", () => {
    const truth = grid(0.25, 0.5, 19.5);
    const reference = rhythm(drums(truth, 4, 20)).beats.times;
    const wide = drums(truth, 4, 20, 44_100).channels[0]!;
    const stereo = rhythm({ sampleRate: 44_100, channels: [wide, wide.slice()] }).beats.times;
    expect(stereo).toHaveLength(reference.length);
    stereo.forEach((t, k) => expect(Math.abs(t - reference[k]!)).toBeLessThanOrEqual(0.011));
  });

  it("puts the bar where the chords change when every beat hits the same", () => {
    const truth = grid(0.25, 0.5, 23.5);
    const { downbeats } = rhythm(chordsOverEvenHits(truth, 1, 24));
    expect(downbeats.meter).toBe(4);
    const changes = truth.filter((_, k) => k % 4 === 1);
    expect(recall(downbeats.times, changes)).toBeGreaterThan(0.9);
  });

  it("finds no steady beat in silence or in noise, and none in a clip too short to tell", () => {
    const silent = rhythm({ sampleRate: RATE, channels: [new Float32Array(10 * RATE)] });
    expect(silent.beats).toMatchObject({ times: [], reason: "no steady beat" });
    const noise = random(9);
    const hiss = rhythm({
      sampleRate: RATE,
      channels: [Float32Array.from({ length: 10 * RATE }, () => 0.3 * noise())],
    });
    expect(hiss.beats.times).toEqual([]);
    expect(hiss.downbeats.times).toEqual([]);
    const short = rhythm(drums(grid(0.25, 0.5, 3), 4, 3));
    expect(short.beats).toMatchObject({ times: [], reason: "too short for a steady beat" });
  });
});

describe("tempoOf", () => {
  it("has no tempo without two beats", () => {
    expect(tempoOf([1])).toEqual({ value: null, curve: [] });
  });

  it("reads 96 BPM off beats placed on 10 ms frames, though no interval between them is 625 ms", () => {
    const beats = grid(0.4, 0.625, 20).map((t) => Math.round(t * 100) / 100);
    const tempo = tempoOf(beats);
    expect(tempo.value).toBeCloseTo(96, 0);
    expect(tempo.curve.every((point) => Math.abs(point.bpm - 96) < 0.5)).toBe(true);
  });
});

describe("sections", () => {
  /** Noise filtered differently per part, each a steady texture, with a beat throughout. */
  function parts(spec: { seconds: number; bright: boolean }[]): AudioSignal {
    const total = spec.reduce((a, p) => a + p.seconds, 0);
    const drumsTrack = drums(grid(0.25, 0.5, total - 0.5), 4, total).channels[0]!;
    const noise = random(5);
    let low = 0;
    let at = 0;
    for (const part of spec) {
      for (let i = Math.round(at * RATE); i < Math.round((at + part.seconds) * RATE); i++) {
        const white = noise();
        low = 0.98 * low + 0.02 * white;
        drumsTrack[i]! += part.bright ? 0.15 * (white - low) : 2 * low;
      }
      at += part.seconds;
    }
    return { sampleRate: RATE, channels: [drumsTrack] };
  }

  it("splits where the sound changes, on a beat, and gives a returning part its earlier letter", () => {
    const found = sections(
      parts([
        { seconds: 20, bright: false },
        { seconds: 20, bright: true },
        { seconds: 20, bright: false },
      ]),
    );
    expect(found.spans.map((s) => s.label)).toEqual(["A", "B", "A"]);
    expect(found.spans[1]!.start).toBeCloseTo(20, 0);
    expect(found.spans[2]!.start).toBeCloseTo(40, 0);
    expect(found.spans[2]!.end).toBe(60);
    expect(found.snap).toMatchObject({ reference: "signal beats", snapped: 2, unsnapped: [] });
  });

  it.each([1, 4, 8])(
    "keeps 30 seconds of silence as one section with a %s-second minimum",
    (minSeconds) => {
      const signal = { sampleRate: RATE, channels: [new Float32Array(30 * RATE)] };
      expect(sections(signal, { minSeconds }).spans).toEqual([{ start: 0, end: 30, label: "A" }]);
    },
  );

  it("keeps a short sound as one section", () => {
    expect(sections(parts([{ seconds: 5, bright: true }])).spans).toEqual([
      { start: 0, end: 5, label: "A" },
    ]);
  });
});

describe("snapper", () => {
  it("moves each time to the nearest measured one within tolerance and keeps the rest, counting both", () => {
    const onBeat = snapper([1, 2, 3, 4], 0.1, "signal beats");
    expect([0.95, 2.04, 2.5, 3.98].map(onBeat.snap)).toEqual([1, 2, 2.5, 4]);
    expect(onBeat.report()).toEqual({
      reference: "signal beats",
      toleranceMs: 100,
      snapped: 3,
      unsnapped: [2.5],
      medianShiftMs: 40,
    });
  });

  it("keeps every time when nothing was measured", () => {
    const none = snapper([], 0.1, "signal beats");
    expect(none.snap(1.23)).toBe(1.23);
    expect(none.report()).toMatchObject({ snapped: 0, unsnapped: [1.23], medianShiftMs: null });
  });
});
