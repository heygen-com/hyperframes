import { describe, it, expect } from "vitest";
import { parsePercentageKeyframes } from "./gsapShared";

describe("parsePercentageKeyframes", () => {
  it("parses the object/percentage form", () => {
    const out = parsePercentageKeyframes({ "0%": { x: 0, y: 0 }, "100%": { x: 9, y: 4 } });
    expect(out?.keyframes).toEqual([
      { percentage: 0, properties: { x: 0, y: 0 } },
      { percentage: 100, properties: { x: 9, y: 4 } },
    ]);
  });

  it("parses GSAP array-form keyframes as evenly-distributed steps", () => {
    // Regression: a multi-point shuttle path authored as `keyframes: [...]` used to
    // read as null (no `N%` keys) → no motion path. Steps map to i/(n-1)*100%.
    const out = parsePercentageKeyframes([
      { x: 0, y: 0 },
      { x: 520, y: 120 },
      { x: 1040, y: 0 },
      { x: 1480, y: 160 },
    ] as unknown as Record<string, unknown>);
    expect(out?.keyframes.map((k) => k.percentage)).toEqual([0, 33.3, 66.7, 100]);
    expect(out?.keyframes[1]!.properties).toEqual({ x: 520, y: 120 });
  });

  it("returns null for keyframes with no positional/animatable props", () => {
    expect(parsePercentageKeyframes([] as unknown as Record<string, unknown>)).toBeNull();
    expect(parsePercentageKeyframes({})).toBeNull();
  });
});
