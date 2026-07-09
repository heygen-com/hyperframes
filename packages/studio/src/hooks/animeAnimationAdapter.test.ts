import { describe, expect, it } from "vitest";
import type { AnimeJsAnimation } from "@hyperframes/core/animejs-parser";
import {
  adaptAnimeAnimation,
  normalizeAnimationPropertyForCollision,
} from "./animeAnimationAdapter";

describe("adaptAnimeAnimation", () => {
  it("maps parsed anime timing and property keyframes into editable animation data", () => {
    const animation: AnimeJsAnimation = {
      engine: "animejs",
      id: "anime-1",
      targetSelector: "#box",
      targets: ["#box"],
      method: "add",
      position: 250,
      resolvedStart: 500,
      duration: 1000,
      ease: "outQuad",
      properties: {
        translateX: [0, 100],
        opacity: 0.8,
      },
      propertyKeyframes: {
        translateX: [
          { to: 40, duration: 250, ease: "outQuad" },
          { to: 100, duration: 750, ease: "outElastic" },
        ],
      },
      propertyGroup: "position",
    };

    const editable = adaptAnimeAnimation(animation);

    expect(editable).toMatchObject({
      id: "anime-1",
      targetSelector: "#box",
      method: "to",
      position: 0.25,
      resolvedStart: 0.5,
      duration: 1,
      ease: "outQuad",
      properties: { translateX: 100, opacity: 0.8 },
      engine: "animejs",
    });
    expect(editable?.keyframes).toEqual({
      format: "percentage",
      easeEach: "outQuad",
      keyframes: [
        { percentage: 25, properties: { translateX: 40 } },
        { percentage: 100, properties: { translateX: 100 } },
      ],
    });
    expect(editable?.anime?.propertyKeyframePercentages).toEqual({
      translateX: { 25: 0, 100: 1 },
    });
  });

  it("normalizes anime transform names for collision checks", () => {
    expect(normalizeAnimationPropertyForCollision("translateX")).toBe("x");
    expect(normalizeAnimationPropertyForCollision("translateY")).toBe("y");
    expect(normalizeAnimationPropertyForCollision("rotate")).toBe("rotation");
  });
});
