import { describe, expect, it } from "vitest";
import { formatRead } from "./format.js";
import { READ_VERSION } from "./types.js";
import { readMusic } from "./music.js";
import { READ_RATE } from "./signal.js";

const chord = (hz: number[]) => (t: number) =>
  hz.reduce((sum, f) => sum + 0.1 * Math.sin(2 * Math.PI * f * t), 0);
const C_MAJOR = chord([261.63, 329.63, 392]);
const F_SHARP_MINOR = chord([369.99, 440, 554.37]);

function piano(seconds: number, parts: [number, number, (t: number) => number][]): Float32Array {
  const out = new Float32Array(Math.round(seconds * READ_RATE));
  for (const [from, to, sound] of parts)
    for (let i = Math.round(from * READ_RATE); i < Math.round(to * READ_RATE); i++)
      out[i] = sound(i / READ_RATE);
  return out;
}

let seed = 11;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

function rumble(seconds: number, from = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * READ_RATE));
  let low = 0;
  for (let i = Math.round(from * READ_RATE); i < out.length; i++)
    out[i] = 0.4 * (low = 0.995 * low + 0.02 * noise());
  return out;
}

const kick = (t: number) => {
  const since = t % 0.5;
  return 0.6 * Math.exp(-since / 0.05) * Math.sin(2 * Math.PI * 60 * since);
};

describe("readMusic", () => {
  it.each([0, 0.01, 0.37, 1.03])("keeps silent %s s clips finite and empty", (seconds) => {
    const result = readMusic({
      stems: { other: new Float32Array(Math.round(seconds * READ_RATE)) },
      drums: null,
      sampleRate: READ_RATE,
    });
    expect(result.music.segments).toEqual([]);
    expect(result.music.breaks).toEqual([]);
    expect(result.ambience).toEqual([]);
    expect(result.music.energy).toEqual([]);
  });

  it("bounds short ambience and music to the actual recording", () => {
    for (const samples of [
      rumble(0.01),
      rumble(0.037),
      rumble(0.37),
      piano(1.036, [[0, 1.036, C_MAJOR]]),
    ]) {
      const { music, ambience } = readMusic({
        stems: { other: samples },
        drums: null,
        sampleRate: READ_RATE,
      });
      const spans = [...music.segments, ...ambience, ...music.energy];
      expect(spans.length).toBeGreaterThan(0);
      for (const span of [...ambience, ...music.energy])
        expect(Number.isFinite(span.db)).toBe(true);
      for (const span of spans)
        expect(span.end).toBeLessThanOrEqual(samples.length / READ_RATE + 0.0005);
    }
  });

  it("starts the music where it is sustained, not at a tone and clicks that bridge into it", () => {
    const tick = (at: number) => (t: number) =>
      t >= at && t < at + 0.004 ? 0.09 * Math.exp(-(t - at) / 0.001) * noise() : 0;
    const beep = (t: number) => (t >= 2.9 && t < 3.1 ? 0.2 * Math.sin(2 * Math.PI * 1000 * t) : 0);
    const clicks = [3, 3.5, 4, 4.5].map(tick);
    const samples = piano(12, [[5, 12, C_MAJOR]]).map(
      (v, i) => v + beep(i / READ_RATE) + clicks.reduce((n, c) => n + c(i / READ_RATE), 0),
    );
    const { music, ambience } = readMusic({
      stems: { other: samples },
      drums: null,
      sampleRate: READ_RATE,
    });
    expect(music.segments.map((m) => [m.start, m.end])).toEqual([[5, 12]]);
    expect(ambience).toEqual([]);
  });

  it("splits the bed at its cut-outs and tells a new piece from one that returns", () => {
    const stem = piano(26, [
      [0, 8, C_MAJOR],
      [9, 16, F_SHARP_MINOR],
      [17, 24, C_MAJOR],
    ]);
    const { music } = readMusic({ stems: { piano: stem }, drums: null, sampleRate: READ_RATE });
    expect(
      music.segments.map((s) => [Math.round(s.start), Math.round(s.end), s.piece, s.entry]),
    ).toEqual([
      [0, 8, 1, "start"],
      [9, 16, 2, "new"],
      [17, 24, 1, "returns"],
    ]);
    expect(music.breaks.map((b) => [Math.round(b.start), Math.round(b.end)])).toEqual([
      [8, 9],
      [16, 17],
    ]);
    expect(music.pieces[0]).toMatchObject({ id: 1, instruments: ["piano"], firstAt: 0 });
    expect(music.energy.map((e) => e.start)).toEqual([0]);
  });

  it("names the stems that carry a piece, loudest first, and notes a fade at its end", () => {
    const fadeOut = (t: number) => C_MAJOR(t) * Math.min(1, Math.max(0.001, (10 - t) / 3));
    const loud = piano(10, [[0, 10, fadeOut]]);
    const quiet = loud.map((v) => v * 0.6);
    const { music } = readMusic({
      stems: { piano: loud, guitar: quiet, bass: new Float32Array(loud.length) },
      drums: null,
      sampleRate: READ_RATE,
    });
    expect(music.pieces[0]!.instruments).toEqual(["piano", "guitar"]);
    expect(music.segments[0]!.fadeFrom).toBeGreaterThan(6.5);
  });

  it("keeps a tonal bed on a beat as music, alone in one stem", () => {
    const song = piano(20, [[0, 20, (t) => C_MAJOR(t) + kick(t)]]);
    const { music, ambience } = readMusic({
      stems: { other: song, bass: new Float32Array(song.length) },
      drums: null,
      sampleRate: READ_RATE,
    });
    expect(ambience).toEqual([]);
    expect(music.segments).toHaveLength(1);
    expect(music.segments[0]!.bpm).toBe(120);
  });

  it("reads noise in a single stem as ambience with its level, not as a piece", () => {
    const { music, ambience } = readMusic({
      stems: { other: rumble(10), bass: new Float32Array(10 * READ_RATE) },
      drums: null,
      sampleRate: READ_RATE,
    });
    expect(music.segments).toEqual([]);
    expect(music.pieces).toEqual([]);
    expect(ambience).toEqual([{ start: 0, end: expect.closeTo(10, 0), db: expect.any(Number) }]);
    expect(ambience[0]!.db).toBeGreaterThan(-40);
    expect(ambience[0]!.db).toBeLessThan(-10);
  });

  it.each(["bed", "drums", "lead-in"])(
    "does not borrow beat evidence from other stretches (%s)",
    (placement) => {
      const parts: [number, number, (t: number) => number][] =
        placement === "lead-in"
          ? [[41, 60, C_MAJOR]]
          : [
              [0, 20, C_MAJOR],
              [41, 60, C_MAJOR],
            ];
      const pitched = piano(
        60,
        parts.map(([start, end, sound]) => [
          start,
          end,
          (t) => sound(t) + (placement === "bed" ? kick(t) : 0),
        ]),
      );
      const drums =
        placement === "bed"
          ? null
          : piano(
              60,
              parts.map(([start, end]) => [start, end, kick]),
            );
      const noisy = rumble(60, 21);
      noisy.fill(0, 40 * READ_RATE);
      const { music, ambience } = readMusic({
        stems: { piano: pitched, other: noisy },
        drums,
        sampleRate: READ_RATE,
      });
      expect(ambience.map((span) => [Math.round(span.start), Math.round(span.end)])).toEqual([
        [21, 40],
      ]);
      expect(music.segments.map((span) => [Math.round(span.start), Math.round(span.end)])).toEqual(
        placement === "lead-in"
          ? [[41, 60]]
          : [
              [0, 20],
              [41, 60],
            ],
      );
      expect(music.breaks).toEqual([]);
    },
  );

  it("does not describe a resumption after intervening ambience as a break", () => {
    const stem = piano(26, [
      [0, 8, C_MAJOR],
      [18, 26, C_MAJOR],
    ]);
    const noisy = rumble(26, 9);
    noisy.fill(0, 17 * READ_RATE);
    const { music, ambience } = readMusic({
      stems: { piano: stem, other: noisy },
      drums: null,
      sampleRate: READ_RATE,
    });
    expect(music.segments).toHaveLength(2);
    expect(music.segments[1]!.entry).toBe("resumes");
    expect(ambience).toHaveLength(1);
    expect(music.breaks).toEqual([]);
    const text = formatRead({
      version: READ_VERSION,
      file: "bed.wav",
      sha256: "test",
      duration: 26,
      separation: "stems",
      stems: [],
      transcript: null,
      voice: null,
      effects: null,
      music,
      ambience,
      warnings: [],
    });
    expect(text).toContain("resumes");
    expect(text).not.toContain("after a break");
  });

  it("does not call the gap between music and ambience a break", () => {
    const bed = piano(18, [[0, 8, C_MAJOR]]);
    const noisy = rumble(18, 9);
    const { music, ambience } = readMusic({
      stems: { piano: bed, other: noisy },
      drums: null,
      sampleRate: READ_RATE,
    });
    expect(music.segments.map((s) => [Math.round(s.start), Math.round(s.end)])).toEqual([[0, 8]]);
    expect(ambience.map((a) => [Math.round(a.start), Math.round(a.end)])).toEqual([[9, 18]]);
    expect(music.breaks).toEqual([]);
  });
});
