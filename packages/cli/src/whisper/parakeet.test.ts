import { describe, expect, it } from "vitest";
import {
  droppedSpeechGaps,
  mergeTokensToWords,
  mergeWindowsToWords,
  silenceCuts,
  spliceGap,
} from "./parakeet.js";

describe("mergeTokensToWords", () => {
  it("joins Parakeet sub-word tokens into words on the space boundary", () => {
    const words = mergeTokensToWords({
      text: "Hello everyone. Um,",
      sentences: [
        {
          tokens: [
            { text: " H", start: 0.0, end: 0.24 },
            { text: "ello", start: 0.24, end: 0.48 },
            { text: " everyone.", start: 0.48, end: 1.28 },
            { text: " Um,", start: 1.28, end: 1.92 },
          ],
        },
      ],
    });
    expect(words).toEqual([
      { text: "Hello", start: 0.0, end: 0.48 },
      { text: "everyone.", start: 0.48, end: 1.28 },
      { text: "Um,", start: 1.28, end: 1.92 },
    ]);
  });

  it("spans sentences and tolerates missing tokens", () => {
    expect(mergeTokensToWords({}).length).toBe(0);
    const words = mergeTokensToWords({
      sentences: [
        { tokens: [{ text: "Hi", start: 0, end: 0.2 }] },
        { tokens: [{ text: " there", start: 0.5, end: 0.9 }] },
      ],
    });
    expect(words.map((w) => w.text)).toEqual(["Hi", "there"]);
    expect(words[1]!.start).toBe(0.5);
  });
});

describe("mergeWindowsToWords", () => {
  it("shifts each window's token times by the window's start", () => {
    const words = mergeWindowsToWords([
      { offset: 0, tokens: [" Hel", "lo"], timestamps: [0.125, 0.25], durations: [0.125, 0.25] },
      { offset: 60.5, tokens: [" world"], timestamps: [0.25], durations: [0.5] },
    ]);
    expect(words).toEqual([
      { text: "Hello", start: 0.125, end: 0.5 },
      { text: "world", start: 60.75, end: 61.25 },
    ]);
  });
});

describe("silenceCuts", () => {
  // 100 samples/s keeps the fixture small: 150 s of steady sound with two 0.1 s silences.
  const rate = 100;
  const loud = (seconds: number) => new Float32Array(seconds * rate).fill(0.5);

  it("moves each cut to the quietest 100 ms within 5 s of the 60 s target", () => {
    const samples = loud(150);
    samples.fill(0, 5830, 5840);
    samples.fill(0, 12195, 12205);
    expect(silenceCuts(samples, rate)).toEqual([0, 5835, 12200, 15000]);
  });

  it("leaves audio shorter than one window whole", () => {
    expect(silenceCuts(loud(42), rate)).toEqual([0, 4200]);
  });

  it("makes no window for empty audio", () => {
    expect(silenceCuts(new Float32Array(0), rate)).toEqual([0]);
  });
});

describe("droppedSpeechGaps", () => {
  const rate = 100;
  const tokens = (timestamps: number[]) => ({
    tokens: timestamps.map(() => " w"),
    timestamps,
    durations: timestamps.map(() => 0.2),
  });

  it("finds a second of loud audio before the first token and between tokens", () => {
    const speech = new Float32Array(6 * rate).fill(0.5);
    expect(droppedSpeechGaps(speech, rate, tokens([2.08, 2.5, 3, 3.5, 4, 4.5, 5, 5.5]))).toEqual([
      [0, 2.08],
    ]);
    expect(droppedSpeechGaps(speech, rate, tokens([0, 0.5, 1, 3.5, 4, 4.5, 5, 5.5]))).toEqual([
      [1.2, 3.5],
    ]);
    expect(
      droppedSpeechGaps(speech, rate, tokens([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5])),
    ).toEqual([]);
  });

  it("ignores a quiet pause, silence, and a loud window with no tokens at all", () => {
    const pause = new Float32Array(6 * rate).fill(0.5);
    pause.fill(0, 2 * rate, 4 * rate);
    expect(
      droppedSpeechGaps(pause, rate, tokens([0.1, 0.6, 1.1, 1.6, 4.1, 4.6, 5.1, 5.6])),
    ).toEqual([]);
    expect(droppedSpeechGaps(new Float32Array(3 * rate), rate, tokens([]))).toEqual([]);
    expect(droppedSpeechGaps(new Float32Array(3 * rate).fill(0.5), rate, tokens([]))).toEqual([]);
  });
});

describe("spliceGap", () => {
  const w = (...pairs: [string, number][]) => ({
    tokens: pairs.map(([text]) => text),
    timestamps: pairs.map(([, start]) => start),
    durations: pairs.map(() => 0.1),
  });
  const text = (r: ReturnType<typeof spliceGap>) =>
    mergeWindowsToWords([{ offset: 0, ...r }])
      .map((word) => word.text)
      .join(" ");

  it("adds the gap's words in order and drops neighbours re-heard off time, in another case", () => {
    const decoded = w([" so", 9.5], [" A", 13], ["sk", 13.25]);
    const patch = w(
      [" so", 0.5],
      [" ask", 0.75],
      [" not", 2.75],
      [",", 3.25],
      [" a", 3.5],
      ["sk", 3.75],
    );
    expect(text(spliceGap(decoded, patch, 9.25, [9.75, 13]))).toBe("so ask not, Ask");
  });

  it("drops a right neighbour the patch splits into other tokens", () => {
    const decoded = w([" so", 9], [" ask", 10]);
    const patch = w([" so", 8.95], [" not", 9.4], [" a", 9.8], ["sk", 9.95]);
    expect(text(spliceGap(decoded, patch, 0, [9.2, 10]))).toBe("so not ask");
  });

  it("never glues the rest of a re-split left neighbour onto it", () => {
    const decoded = w([" thing", 5], [" right", 7]);
    const patch = w([" th", 5], ["ing", 5.35], [" we", 5.8], [" said", 6.3]);
    expect(text(spliceGap(decoded, patch, 0, [5.3, 7]))).toBe("thing we said right");
  });

  it("compares whole words, so a gap word is not eaten by a neighbour's last token", () => {
    const decoded = w([" it", 3], ["'s", 3.2], [" now", 5]);
    const patch = w([" s", 3.4], ["o", 3.5], [" what", 4]);
    expect(text(spliceGap(decoded, patch, 0, [3.3, 5]))).toBe("it's so what now");
  });

  it("keeps a patch's first word even when it has no leading space", () => {
    const decoded = w([" so", 9], [" right", 12]);
    expect(text(spliceGap(decoded, w(["ask", 9.4], [" not", 10.1]), 0, [9.1, 12]))).toBe(
      "so ask not right",
    );
  });

  it("keeps a real repeat that starts well inside the gap", () => {
    const decoded = w([" that", 2], [" right", 4]);
    const patch = w([" that", 3], [" is", 3.4]);
    expect(text(spliceGap(decoded, patch, 0, [2.2, 4]))).toBe("that that is right");
  });

  it("adds a word shared by two gaps once, however each patch splits it", () => {
    const decoded = w([" a", 1], [" mid", 3], [" z", 5]);
    const first = spliceGap(decoded, w([" one", 1.8], [" m", 2.8], ["id", 2.95]), 0, [1.2, 3]);
    const both = spliceGap(first, w([" mi", 3.35], ["d", 3.45], [" two", 4]), 0, [3.3, 5]);
    expect(text(both)).toBe("a one mid two z");
  });
});
