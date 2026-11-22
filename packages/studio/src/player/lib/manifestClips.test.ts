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
});
