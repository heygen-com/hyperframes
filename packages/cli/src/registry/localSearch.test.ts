import { describe, expect, it } from "vitest";

import { rankByWords, searchByWords, tokenize } from "./localSearch.js";

interface Item {
  name: string;
  text: string;
}

const ITEMS: Item[] = [
  { name: "whip-pan", text: "A fast camera whip blurs between two shots at speed." },
  { name: "number-wheel", text: "A rolling digit counter settles on its final value." },
  { name: "text-reveal", text: "Type reveals line by line beneath a mask." },
];

const textOf = (item: Item) => item.text;

describe("tokenize", () => {
  it("drops stop words", () => {
    expect(tokenize("the camera and the shot")).toEqual(["camera", "shot"]);
  });

  it("drops tokens of three characters or fewer", () => {
    expect(tokenize("ab abc abcd")).toEqual(["abc", "abcd"]);
  });

  it("lowercases and strips punctuation and digits", () => {
    expect(tokenize("Camera, pushes 42 times!")).toEqual(["camera", "pushes", "times"]);
  });

  it("returns nothing for a query made only of stop words", () => {
    expect(tokenize("the and or of")).toEqual([]);
  });
});

describe("rankByWords", () => {
  it("ranks the entry sharing the most vocabulary first", () => {
    expect(rankByWords("rolling counter digit", ITEMS, textOf)[0]?.item.name).toBe("number-wheel");
  });

  it("returns every item, not only matches", () => {
    expect(rankByWords("camera", ITEMS, textOf)).toHaveLength(ITEMS.length);
  });

  it("sorts non-matching items last with a zero score", () => {
    const ranked = rankByWords("rolling counter", ITEMS, textOf);
    expect(ranked.at(-1)?.score).toBe(0);
  });

  it("does not let the wordiest entry win on length alone", () => {
    // Without the sqrt divisor this padded entry outranks the real match.
    const padded: Item[] = [
      ...ITEMS,
      {
        name: "padded",
        text: `camera ${Array.from({ length: 300 }, (_, i) => `filler${i}`).join(" ")}`,
      },
    ];
    expect(rankByWords("fast camera whip speed", padded, textOf)[0]?.item.name).toBe("whip-pan");
  });

  it("breaks ties on descending name, matching the evaluation", () => {
    const tied: Item[] = [
      { name: "alpha", text: "nothing shared here" },
      { name: "zulu", text: "nothing shared here" },
    ];
    expect(rankByWords("unrelated", tied, textOf).map((s) => s.item.name)).toEqual([
      "zulu",
      "alpha",
    ]);
  });

  it("treats a stop-word-only query as matching nothing rather than everything", () => {
    expect(rankByWords("the and of", ITEMS, textOf).every((s) => s.score === 0)).toBe(true);
  });
});

describe("searchByWords", () => {
  it("keeps only entries sharing at least one token", () => {
    expect(searchByWords("rolling counter", ITEMS, textOf).map((i) => i.name)).toEqual([
      "number-wheel",
    ]);
  });

  it("beats substring matching on a natural phrasing", () => {
    // The motivating case. No description contains this phrase, so a substring
    // test returns nothing; shared vocabulary still finds the speed entry.
    const phrase = "make the shot feel fast";
    const substring = ITEMS.filter((i) => i.text.toLowerCase().includes(phrase.toLowerCase()));
    expect(substring).toHaveLength(0);
    expect(searchByWords(phrase, ITEMS, textOf)[0]?.name).toBe("whip-pan");
  });

  it("returns nothing when no vocabulary is shared", () => {
    expect(searchByWords("quantum entanglement", ITEMS, textOf)).toEqual([]);
  });
});
