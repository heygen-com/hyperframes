import { describe, it, expect } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { getAnimationsForElement } from "./useGsapTweenCache";

function anim(targetSelector: string): GsapAnimation {
  return {
    id: `${targetSelector}-to-0`,
    targetSelector,
    method: "to",
    position: 0,
    properties: {},
  };
}

describe("getAnimationsForElement", () => {
  const animations = [anim("#hero"), anim(".kicker"), anim(".kicker"), anim(".co-new")];

  it("matches tweens by element id", () => {
    const result = getAnimationsForElement(animations, { id: "hero" });
    expect(result.map((a) => a.targetSelector)).toEqual(["#hero"]);
  });

  it("matches class-targeted tweens by the element's selector", () => {
    // Real compositions target tweens by class (querySelector(".kicker")); the
    // selected element has no id, so id-only matching would miss these.
    const result = getAnimationsForElement(animations, { id: null, selector: ".kicker" });
    expect(result).toHaveLength(2);
    expect(result.every((a) => a.targetSelector === ".kicker")).toBe(true);
  });

  it("matches by id or selector when both are present", () => {
    const result = getAnimationsForElement(animations, { id: "hero", selector: ".co-new" });
    expect(result.map((a) => a.targetSelector).sort()).toEqual(["#hero", ".co-new"]);
  });

  it("returns nothing when neither id nor selector is provided", () => {
    expect(getAnimationsForElement(animations, {})).toEqual([]);
    expect(getAnimationsForElement(animations, { id: null, selector: null })).toEqual([]);
  });

  it("matches an element that is one member of a group-selector tween", () => {
    // Array/toArray targets serialize as a CSS group selector; selecting either
    // member element should surface the shared tween.
    const grouped = [anim(".clock-face, .clock-hand")];
    expect(getAnimationsForElement(grouped, { selector: ".clock-face" })).toHaveLength(1);
    expect(getAnimationsForElement(grouped, { selector: ".clock-hand" })).toHaveLength(1);
    expect(getAnimationsForElement(grouped, { selector: ".unrelated" })).toHaveLength(0);
  });
});
