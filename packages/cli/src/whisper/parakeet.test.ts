import { describe, expect, it } from "vitest";
import { mergeTokensToWords } from "./parakeet.js";

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
