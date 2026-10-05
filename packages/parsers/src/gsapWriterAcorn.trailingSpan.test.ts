import { describe, expect, it } from "vitest";
import { parseGsapScriptAcorn } from "./gsapParserAcorn.js";
import { trimTrailingKeyframeSpans } from "./gsapWriterAcorn.js";

const timeline = `const tl = gsap.timeline({ paused: true });\n`;
const tween = (keys: string, duration = 3, extra = "") =>
  `tl.to("#t", { keyframes: { ${keys} }, duration: ${duration}${extra} }, 1);`;
const shortOfEnd = tween(`"0%": { x: 300 }, "33.333%": { x: 297 }, "66.667%": { x: 48 }`);

const keyed = (script: string) => {
  const anim = parseGsapScriptAcorn(script).animations.find((a) => a.keyframes)!;
  return {
    duration: anim.duration,
    keys: anim.keyframes!.keyframes.map((k) => [k.percentage, k.properties.x]),
  };
};

describe("trimTrailingKeyframeSpans", () => {
  it("ends a tween this mutation wrote on its last key, keeping each key's time", () => {
    const out = trimTrailingKeyframeSpans(timeline, timeline + shortOfEnd);
    expect(keyed(out)).toEqual({
      duration: 2,
      keys: [
        [0, 300],
        [49.999, 297],
        [100, 48],
      ],
    });
  });

  it("leaves a chained tween the mutation did not touch when it edits the link before", () => {
    const chain = (x: number) =>
      `tl.to("#a", { x: ${x}, duration: 1 }, 0).to("#t", { keyframes: { "0%": { x: 300 }, "50%": { x: 48 } }, duration: 2 }, 1);`;
    expect(trimTrailingKeyframeSpans(timeline + chain(1), timeline + chain(2))).toBe(
      timeline + chain(2),
    );
  });

  it("leaves a tween the mutation did not touch, and the bytes around it", () => {
    const script = timeline + shortOfEnd;
    expect(trimTrailingKeyframeSpans(script, script)).toBe(script);
  });

  it.each([
    ["a lone key, which the hold renders", tween(`"0%": { x: 300 }`)],
    ["a tween that already ends on its last key", tween(`"0%": { x: 300 }, "100%": { x: 48 }`)],
    [
      "an outer ease, whose curve the tail is part of",
      tween(`"0%": { x: 300 }, "50%": { x: 48 }`, 3, `, ease: "power2.in"`),
    ],
    [
      "a looping tween, whose tail is part of every cycle",
      tween(`"0%": { x: 300 }, "50%": { x: 48 }`, 3, ", repeat: -1"),
    ],
    [
      "every tween when one is placed after another's end",
      `${shortOfEnd}\ntl.to("#u", { opacity: 1, duration: 1 }, ">");`,
    ],
  ])("leaves %s", (_, written) => {
    expect(trimTrailingKeyframeSpans(timeline, timeline + written)).toBe(timeline + written);
  });
});
