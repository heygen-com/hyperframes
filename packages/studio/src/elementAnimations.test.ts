import { describe, expect, it } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { getAnimationsForElement } from "./index";

const tween = (targetSelector: string) => ({ targetSelector }) as GsapAnimation;

describe("an element's animations from Studio's public API", () => {
  it("are the parsed tweens that address it by id or selector, read where a sealed preview's host can", () => {
    const parsed = [tween("#title"), tween(".card, .hero"), tween("#other")];
    expect(getAnimationsForElement(parsed, { id: "title", selector: null })).toEqual([parsed[0]]);
    expect(getAnimationsForElement(parsed, { id: null, selector: ".hero" })).toEqual([parsed[1]]);
  });
});
