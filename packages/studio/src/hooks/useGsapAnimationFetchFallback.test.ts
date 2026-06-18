import { describe, expect, it } from "vitest";
import type { GsapAnimation, ParsedGsap } from "@hyperframes/core/gsap-parser";
import { selectElementAnimationsOrRetry } from "./useGsapAnimationFetchFallback";

const anim = (targetSelector: string): GsapAnimation =>
  ({ id: targetSelector, targetSelector, properties: {} }) as unknown as GsapAnimation;
const parsed = (anims: GsapAnimation[]): ParsedGsap => ({ animations: anims }) as ParsedGsap;
const target = { id: "puck-a", selector: "#puck-a" };

describe("selectElementAnimationsOrRetry", () => {
  it("returns null (retry) when the parse is cold — null or zero total animations", () => {
    expect(selectElementAnimationsOrRetry(null, target)).toBeNull();
    expect(selectElementAnimationsOrRetry(parsed([]), target)).toBeNull();
  });

  it("returns the matching animations from a warm parse", () => {
    const result = selectElementAnimationsOrRetry(
      parsed([anim("#puck-a"), anim("#other")]),
      target,
    );
    expect(result?.map((a) => a.targetSelector)).toEqual(["#puck-a"]);
  });

  it("returns [] (no retry) for a warm parse with no match — element genuinely has no animation", () => {
    expect(selectElementAnimationsOrRetry(parsed([anim("#other")]), target)).toEqual([]);
  });
});
