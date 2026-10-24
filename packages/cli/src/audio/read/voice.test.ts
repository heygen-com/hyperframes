import { describe, expect, it } from "vitest";
import { voiceFromActivity, voiceFromWords } from "./voice.js";
import { READ_RATE } from "./signal.js";

const glide = (start: number, end: number, from: number, to: number, step = 0.04) => {
  const points = [];
  for (let t = start; t < end; t += step)
    points.push({ t, hz: from + ((to - from) * (t - start)) / (end - start) });
  return points;
};

describe("voiceFromWords", () => {
  const words = [
    { text: "伊", start: 1.0, end: 1.2 },
    { text: "朗", start: 1.2, end: 1.4 },
    { text: "经", start: 1.4, end: 1.6 },
    { text: "济。", start: 1.6, end: 2.0 },
    { text: "涨", start: 3.0, end: 3.25 },
    { text: "了", start: 3.25, end: 3.5 },
  ];

  it("splits sentences at end punctuation, counts Han characters per second and lists pauses", () => {
    const voice = voiceFromWords(words, []);
    expect(voice.unit).toBe("chars");
    expect(voice.sentences.map((s) => [s.text, s.start, s.end, s.rate])).toEqual([
      ["伊朗经济。", 1, 2, 4],
      ["涨了", 3, 3.5, 4],
    ]);
    expect(voice.pauses).toEqual([{ start: 2, end: 3 }]);
    expect(voice.meanRate).toBe(4);
  });

  it("says a sentence ends rising when its last third lifts two semitones or more", () => {
    const track = [...glide(1, 1.7, 180, 180), ...glide(1.7, 2, 180, 240)];
    const voice = voiceFromWords(words, track);
    expect(voice.sentences[0]).toMatchObject({ ending: "rising", pitchHz: 180 });
    expect(voice.sentences[1]!.ending).toBeNull();
  });

  it("counts words, not letters, in a Latin transcript", () => {
    const voice = voiceFromWords(
      [
        { text: "Prices", start: 0, end: 0.5 },
        { text: "rose", start: 0.5, end: 0.8 },
        { text: "fast.", start: 0.8, end: 1 },
      ],
      [],
    );
    expect(voice.unit).toBe("words");
    expect(voice.sentences[0]).toMatchObject({ text: "Prices rose fast.", rate: 3 });
  });
});

describe("voiceFromActivity", () => {
  it("finds the voiced spans and the pause between them without a transcript", () => {
    const samples = new Float32Array(4 * READ_RATE);
    for (let i = 0; i < samples.length; i++) {
      const t = i / READ_RATE;
      if ((t >= 0.5 && t < 1.5) || (t >= 2.5 && t < 3.5))
        samples[i] = 0.3 * Math.sin(2 * Math.PI * 200 * t);
    }
    const voice = voiceFromActivity(samples, READ_RATE, []);
    expect(voice.source).toBe("activity");
    expect(voice.sentences.map((s) => [s.text, Math.round(s.start * 10) / 10])).toEqual([
      [null, 0.5],
      [null, 2.5],
    ]);
    expect(voice.pauses).toHaveLength(1);
    expect(voice.pauses[0]!.end - voice.pauses[0]!.start).toBeCloseTo(1, 0);
  });
});
