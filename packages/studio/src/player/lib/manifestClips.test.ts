import { describe, expect, it } from "vitest";
import { wellFormedClips } from "./manifestClips";

const clip = (transitionLabel: unknown) => ({
  id: "a",
  label: "A",
  kind: "element",
  tagName: "div",
  start: 0,
  duration: 3,
  track: 0,
  compositionId: null,
  parentCompositionId: null,
  compositionSrc: null,
  assetUrl: null,
  transitionLabel,
});

describe("wellFormedClips", () => {
  it("keeps a transition label only as the runtime writes one, and the clip either way", () => {
    const clips = wellFormedClips([
      clip("hf:transition:a:b:fade"),
      clip(`hf:transition:a:b:${"x".repeat(200)}`),
      clip("javascript:alert(1)"),
      clip(5),
      clip(null),
    ]);
    expect(clips.map((kept) => kept.transitionLabel)).toEqual([
      "hf:transition:a:b:fade",
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  // fails without the fix: only the numbers of a preview's clip were checked, so any string reached the store.
  it.each([
    ["an id that is not a string", { id: 5 }],
    ["an unbounded id", { id: "x".repeat(10_000) }],
    ["a tag that is an object", { tagName: { toString: () => "div" } }],
    ["an unbounded composition src", { compositionSrc: "a/".repeat(5_000) }],
    ["a label that is not a string", { label: ["A"] }],
    ["an asset url that is not a string", { assetUrl: 7 }],
    ["an ancestor that is not a string", { compositionAncestors: [1] }],
  ])("drops a clip with %s", (_case, fields) => {
    expect(wellFormedClips([{ ...clip(null), ...fields }])).toEqual([]);
  });

  it("keeps a clip with a long label, its label cut short", () => {
    const [kept] = wellFormedClips([{ ...clip(null), label: "L".repeat(5_000) }]);
    expect(kept?.label).toHaveLength(200);
  });
});
