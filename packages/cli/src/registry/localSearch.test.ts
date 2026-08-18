import { describe, expect, it } from "vitest";

import { hasNoSearchableTokens, rankByWords, searchByWords, tokenize } from "./localSearch.js";

interface Item {
  name: string;
  text: string;
}

const ITEMS: Item[] = [
  { name: "whip-pan", text: "A fast camera whip blurs between two shots at speed." },
  { name: "number-wheel", text: "A rolling digit counter settles on its final value." },
  { name: "text-reveal", text: "Type reveals line by line beneath a mask." },
];

const textOf = (item: Item) => ({ strong: "", weak: item.text });

describe("tokenize", () => {
  it("drops stop words", () => {
    expect(tokenize("the camera and the shot")).toEqual(["camera", "shot"]);
  });

  it("drops tokens of three characters or fewer", () => {
    expect(tokenize("ab abc abcd")).toEqual(["abc", "abcd"]);
  });

  it("lowercases and strips punctuation and digits", () => {
    expect(tokenize("Camera, pushes 42 times!")).toEqual(["camera", "push", "time"]);
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

// ── The three ranking defects this scorer exists to fix ─────────────────────
// Each case is a query that failed against the real catalog, reduced to the
// smallest fixture that still reproduces it.

const named = (name: string, title: string, body: string) => ({ name, title, body });
const fieldsOf = (i: { name: string; title: string; body: string }) => ({
  strong: `${i.name} ${i.title}`,
  weak: i.body,
});

describe("name and title outrank description", () => {
  const items = [
    named("typewriter", "Typewriter", "Character-by-character text reveal with a blinking cursor."),
    named("mk-emphasis-type", "Emphasis Type", "A phrase types on with emphasis on the key word."),
    named("variable-axis-type", "Variable Axis Type", "Type that shifts along a variable axis."),
  ];

  it("puts the item actually called typewriter first", () => {
    // Ranked seventh against the real catalog before field weighting: an author
    // typing a move's name got entries that merely mention typing.
    expect(rankByWords("typewriter effect on a title", items, fieldsOf)[0]?.item.name).toBe(
      "typewriter",
    );
  });
});

describe("plurals fold to the singular", () => {
  const items = [
    named(
      "count-up",
      "Count Up",
      "A stat counter that eases between values and lands with a pulse.",
    ),
    named("skeleton-reveal", "Skeleton Reveal", "Placeholder blocks resolve into content once."),
  ];

  it("matches a pluralised query against a singular description", () => {
    // "counts" is not "count" and "pulses" is not "pulse", so adding detail to
    // a query used to make the result strictly worse.
    expect(
      rankByWords("a stat that counts up and then pulses once", items, fieldsOf)[0]?.item.name,
    ).toBe("count-up");
  });

  it("leaves a word that merely ends in s alone", () => {
    expect(tokenize("press glass")).toEqual(["press", "glass"]);
  });
});

describe("common words count for less than distinctive ones", () => {
  const items = [
    named("line-by-line-slide", "Line By Line Slide", "A headline arrives one line at a time."),
    named("ui-3d-reveal", "UI 3D Reveal", "A panel reveals in three dimensions."),
    named("panel-reveal", "Panel Reveal", "A panel reveals itself."),
    named("pull-back-reveal", "Pull Back Reveal", "The camera pulls back to reveal the scene."),
  ];

  it("does not let one hit on a catalog-wide word beat several precise ones", () => {
    // Field weighting alone made this worse: every item merely NAMED *-reveal
    // outranked the one that does the thing, because "reveal" is the catalog's
    // most common word. Inverse document frequency is what settles it.
    expect(rankByWords("reveal a headline one line at a time", items, fieldsOf)[0]?.item.name).toBe(
      "line-by-line-slide",
    );
  });
});

describe("hasNoSearchableTokens", () => {
  it("flags a query in a script this ranker cannot index", () => {
    // The catalog is written in English and tokenising on [a-z]+ leaves nothing
    // of a Japanese query. Reporting that as "no items match" told the author
    // the catalog lacked a move it may well have.
    expect(hasNoSearchableTokens("実写写真のみ 9:16 生活ハック")).toBe(true);
  });

  it("does not flag an ordinary query that simply matches nothing", () => {
    expect(hasNoSearchableTokens("quantum entanglement")).toBe(false);
  });

  it("does not flag an empty query, which is a listing rather than a search", () => {
    expect(hasNoSearchableTokens("   ")).toBe(false);
  });

  it("flags a query that is only stop words and punctuation", () => {
    expect(hasNoSearchableTokens("the and of !!!")).toBe(true);
  });
});

describe("the two spellings of a compound word find the same items", () => {
  // Reduced from the real failure: `countdown` returned exactly one item (the
  // only thing tagged with that spelling) while `count down timer` returned
  // sixteen that did not include it. Whichever phrasing an author happened to
  // type decided which half of the answer they saw.
  const items = [
    named("yt-circle-pointer", "Circle Pointer", "An annotation overlay with a countdown chip."),
    named("count-up", "Count Up", "A stat counter that eases between two values."),
    named("decline-chart", "Decline Chart", "A line that counts down as its value falls."),
    named("aurora-drift", "Aurora Drift", "A slow gradient background."),
  ];
  const namesFor = (q: string) => searchByWords(q, items, fieldsOf).map((i) => i.name);

  it("finds the one-word item from the two-word query", () => {
    expect(namesFor("count down timer")).toContain("yt-circle-pointer");
  });

  it("finds the two-word items from the one-word query", () => {
    // The half of the answer the compound spelling used to hide.
    expect(namesFor("countdown")).toEqual(expect.arrayContaining(["count-up", "decline-chart"]));
  });

  it("returns the same set either way, which is the actual defect", () => {
    expect(namesFor("countdown").sort()).toEqual(namesFor("count down").sort());
  });

  it("still ranks the exact compound match first", () => {
    // Splitting must not cost the item that spells it the way you asked. The
    // compound is kept and is rare, so its weight survives the added halves.
    expect(namesFor("countdown")[0]).toBe("yt-circle-pointer");
  });

  it("leaves a word the catalog never uses alone", () => {
    // `timer` appears in none of these items, and inventing a match for it
    // would be widening the query into fiction rather than into phrasing.
    expect(namesFor("timer")).toEqual([]);
  });

  it("does not let a split dislodge the item named for the whole word", () => {
    // `typewriter` splits into `type` + `writer` if both are known. The item
    // literally called typewriter must still win.
    const typing = [
      named("typewriter", "Typewriter", "Character-by-character reveal."),
      named("type-match-cut", "Type Match Cut", "A cut matched on a writer's type."),
    ];

    expect(searchByWords("typewriter", typing, fieldsOf)[0]?.name).toBe("typewriter");
  });
});
