import { describe, expect, it } from "vitest";
import { KEYFRAME_PROPERTY_DEFAULTS } from "./keyframeDefaults";

describe("KEYFRAME_PROPERTY_DEFAULTS", () => {
  it("holds the rest value of each numeric keyframe prop", () => {
    expect(KEYFRAME_PROPERTY_DEFAULTS).toEqual({
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      width: 100,
      height: 100,
    });
  });

  it.each(["color", "filter", "backgroundColor"])("has no default for %s", (prop) => {
    expect(KEYFRAME_PROPERTY_DEFAULTS[prop]).toBeUndefined();
  });
});
