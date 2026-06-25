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

  it("strips a per-entry ease without shifting the even index-spacing of the others", () => {
    // GSAP positions array keyframes by array index, so a `{ ease }` carried on an
    // entry is a segment ease (skipped as a property) — it must not change where
    // the surrounding keyframes land. 3 entries → 0 / 50 / 100, even though the
    // middle entry also carries an ease.
    const out = parsePercentageKeyframes([
      { x: 0 },
      { x: 100, ease: "power2.in" },
      { x: 200 },
    ] as unknown as Record<string, unknown>);
    expect(out?.keyframes.map((k) => k.percentage)).toEqual([0, 50, 100]);
    expect(out?.keyframes.map((k) => k.properties)).toEqual([{ x: 0 }, { x: 100 }, { x: 200 }]);
  });

  it("keeps even spacing when an interior array slot has no animatable prop", () => {
    // A degenerate `{ ease }`-only slot contributes no output keyframe, but it is
    // still an array slot GSAP allocates a position to — so the remaining entries
    // keep their original i/(n-1) percentages (0 and 100 for a 3-slot array), not
    // 0/100 collapsed onto a 2-entry spacing.
    const out = parsePercentageKeyframes([
      { x: 0 },
      { ease: "power2.in" },
      { x: 200 },
    ] as unknown as Record<string, unknown>);
    expect(out?.keyframes.map((k) => k.percentage)).toEqual([0, 100]);
    expect(out?.keyframes.map((k) => k.properties)).toEqual([{ x: 0 }, { x: 200 }]);
  });

  it("returns null for keyframes with no positional/animatable props", () => {
    expect(parsePercentageKeyframes([] as unknown as Record<string, unknown>)).toBeNull();
    expect(parsePercentageKeyframes({})).toBeNull();
  });
});
