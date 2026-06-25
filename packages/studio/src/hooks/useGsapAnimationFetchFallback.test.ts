import { describe, expect, it } from "vitest";
import type { GsapAnimation, ParsedGsap } from "@hyperframes/core/gsap-parser";
import { selectElementAnimationsOrRetry } from "./useGsapAnimationFetchFallback";

const anim = (targetSelector: string): GsapAnimation =>
  ({ id: targetSelector, targetSelector, properties: {} }) as unknown as GsapAnimation;
const parsed = (anims: GsapAnimation[]): ParsedGsap => ({ animations: anims }) as ParsedGsap;
const target = { id: "puck-a", selector: "#puck-a" };

describe("selectElementAnimationsOrRetry", () => {
  it("signals fetch-error (short retry) when the fetch itself failed (null)", () => {
    // A null parse means fetchParsedAnimations hit a 404/network/JSON failure —
    // not a parse-warming race, so it must NOT be conflated with a cold parse.
    expect(selectElementAnimationsOrRetry(null, target)).toEqual({ kind: "fetch-error" });
  });

  it("signals cold (full retry budget) when the parse is reachable but has zero total animations", () => {
    expect(selectElementAnimationsOrRetry(parsed([]), target)).toEqual({ kind: "cold" });
  });

  it("resolves the matching animations from a warm parse", () => {
    const outcome = selectElementAnimationsOrRetry(
      parsed([anim("#puck-a"), anim("#other")]),
      target,
    );
    expect(outcome.kind).toBe("resolved");
    expect(outcome.kind === "resolved" && outcome.animations.map((a) => a.targetSelector)).toEqual([
      "#puck-a",
    ]);
  });

  it("resolves to [] (no retry) for a warm parse with no match — element genuinely has no animation", () => {
    const outcome = selectElementAnimationsOrRetry(parsed([anim("#other")]), target);
    expect(outcome).toEqual({ kind: "resolved", animations: [] });
  });
});
