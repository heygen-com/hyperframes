import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { configFromTokenizerJson, encode, normalize, preTokenize, wordPiece } from "./wordpiece.js";

const REFERENCE_PATH = join(import.meta.dirname, "__fixtures__", "wordpiece-reference.json");
const TOKENIZER_PATH = join(
  homedir(),
  ".hyperframes",
  "models",
  "bge-small-en-v1.5.tokenizer.json",
);

/** A tiny vocab keeps the unit tests readable and independent of the 30k file. */
const CONFIG = configFromTokenizerJson(
  JSON.stringify({
    model: {
      vocab: {
        "[UNK]": 0,
        "[CLS]": 1,
        "[SEP]": 2,
        fast: 3,
        camera: 4,
        "##era": 5,
        cam: 6,
        ".": 7,
        whip: 8,
        pan: 9,
      },
      unk_token: "[UNK]",
      continuing_subword_prefix: "##",
      max_input_chars_per_word: 100,
    },
  }),
);

describe("normalize", () => {
  it("lowercases", () => {
    expect(normalize("Whip PAN")).toBe("whip pan");
  });

  it("strips accents", () => {
    expect(normalize("café naïve")).toBe("cafe naive");
  });

  it("collapses control characters and whitespace variants to spaces", () => {
    expect(normalize("a\tb\nc")).toBe("a b c");
  });

  it("isolates CJK characters so each becomes its own token", () => {
    expect(normalize("a中b")).toBe("a 中 b");
  });
});

describe("preTokenize", () => {
  it("splits on whitespace", () => {
    expect(preTokenize("fast camera pan")).toEqual(["fast", "camera", "pan"]);
  });

  it("isolates punctuation into its own token", () => {
    expect(preTokenize("group: transitions.")).toEqual(["group", ":", "transitions", "."]);
  });

  it("drops empty chunks from repeated spaces", () => {
    expect(preTokenize("a    b")).toEqual(["a", "b"]);
  });
});

describe("wordPiece", () => {
  it("returns a whole word when the vocab has it", () => {
    expect(wordPiece("camera", CONFIG)).toEqual(["camera"]);
  });

  it("splits into continuation pieces, longest match first", () => {
    // "camera" is present whole, so force the split path with a word that is not.
    expect(wordPiece("camera", { ...CONFIG, vocab: { cam: 6, "##era": 5 } })).toEqual([
      "cam",
      "##era",
    ]);
  });

  it("marks the whole word unknown when any piece is unmatchable", () => {
    // Emitting partial pieces would silently change the embedding rather than
    // failing, so a single bad piece invalidates the word.
    expect(wordPiece("zzzz", CONFIG)).toEqual(["[UNK]"]);
  });

  it("marks a word longer than the limit unknown without scanning it", () => {
    expect(wordPiece("x".repeat(101), CONFIG)).toEqual(["[UNK]"]);
  });
});

describe("encode", () => {
  it("wraps the sequence in CLS and SEP", () => {
    const { ids } = encode("fast", CONFIG);
    expect(ids[0]).toBe(CONFIG.vocab["[CLS]"]);
    expect(ids.at(-1)).toBe(CONFIG.vocab["[SEP]"]);
  });

  it("returns masks matching the id length", () => {
    const encoding = encode("fast camera", CONFIG);
    expect(encoding.attentionMask).toHaveLength(encoding.ids.length);
    expect(encoding.tokenTypeIds).toHaveLength(encoding.ids.length);
    expect(new Set(encoding.attentionMask)).toEqual(new Set([1]));
    expect(new Set(encoding.tokenTypeIds)).toEqual(new Set([0]));
  });

  it("encodes empty input as just the special tokens", () => {
    expect(encode("", CONFIG).ids).toEqual([1, 2]);
  });
});

/**
 * The test that actually matters.
 *
 * Wrong token ids produce plausible embeddings and plausible rankings, so
 * nothing downstream fails visibly. Comparing against a real tokenizer over the
 * whole catalog is the only way to know this implementation is correct rather
 * than merely reasonable.
 */
describe("parity with the reference tokenizer", () => {
  const hasFixture = existsSync(REFERENCE_PATH);
  const hasVocab = existsSync(TOKENIZER_PATH);

  it.runIf(hasFixture && hasVocab)("matches reference ids across the whole corpus", () => {
    const config = configFromTokenizerJson(readFileSync(TOKENIZER_PATH, "utf-8"));
    const reference = JSON.parse(readFileSync(REFERENCE_PATH, "utf-8")) as {
      text: string;
      ids: number[];
    }[];
    expect(reference.length).toBeGreaterThan(500);

    const mismatches = reference
      .map(({ text, ids }) => ({ text, expected: ids, actual: encode(text, config).ids }))
      .filter(({ expected, actual }) => expected.join(",") !== actual.join(","));

    expect(
      mismatches
        .slice(0, 3)
        .map(
          (m) => `${JSON.stringify(m.text.slice(0, 60))}\n  want ${m.expected}\n  got  ${m.actual}`,
        ),
    ).toEqual([]);
    expect(mismatches).toHaveLength(0);
  });

  it.skipIf(hasFixture && hasVocab)("is skipped without the fixture and vocab", () => {
    expect(true).toBe(true);
  });
});
