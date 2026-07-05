import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mergeTokensToWords } from "./parakeet-words.mjs";

test("mergeTokensToWords joins sub-word tokens on the space boundary", () => {
  const parakeet = {
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
  };
  const { words } = mergeTokensToWords(parakeet);
  assert.deepEqual(words, [
    { text: "Hello", start: 0.0, end: 0.48 },
    { text: "everyone.", start: 0.48, end: 1.28 },
    { text: "Um,", start: 1.28, end: 1.92 },
  ]);
});

test("mergeTokensToWords spans multiple sentences and drops empties", () => {
  const parakeet = {
    text: "Hi there",
    sentences: [
      { tokens: [{ text: "Hi", start: 0, end: 0.2 }] },
      { tokens: [{ text: " there", start: 0.5, end: 0.9 }] },
    ],
  };
  const { words } = mergeTokensToWords(parakeet);
  assert.equal(words.length, 2);
  assert.equal(words[1].text, "there");
  assert.equal(words[1].start, 0.5);
});

test("mergeTokensToWords tolerates missing sentences/tokens", () => {
  assert.deepEqual(mergeTokensToWords({}).words, []);
  assert.deepEqual(mergeTokensToWords({ sentences: [{}] }).words, []);
});
