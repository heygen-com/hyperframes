import { describe, expect, it } from "vitest";
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

describe("readMusic", () => {
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
});
