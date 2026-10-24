import { describe, expect, it } from "vitest";
import { parseGsapScriptAcorn } from "./gsapParserAcorn.js";
import { parseGsapScript } from "./gsapParser.js";
import { unrollComputedTimeline } from "./gsapUnroll.js";

const script = `const tl = gsap.timeline({ paused: true });
function animate() {
  tl.to("#dot", { duration: 4, ease: "none", keyframes: {
    x: [0, 100, 200], opacity: [0, 1], easeEach: "none"
  } }, 0);
}
animate();`;

const expected = [
  { percentage: 0, properties: { x: 0, opacity: 0 } },
  { percentage: 50, properties: { x: 100 } },
  { percentage: 100, properties: { x: 200, opacity: 1 } },
];

describe.each([
  { name: "acorn", parse: parseGsapScriptAcorn },
  { name: "recast", parse: parseGsapScript },
])("$name simple-array keyframes", ({ parse }) => {
  it("spreads each property over the full tween duration", () => {
    const animation = parse(script).animations[0];
    expect(animation?.keyframes).toEqual({
      format: "simple-array",
      keyframes: expected,
      easeEach: "none",
    });
  });

  it("merges shared times and keeps each channel's intermediate values", () => {
    const source = `const tl = gsap.timeline({ paused: true });
tl.to("#dot", { duration: 6, keyframes: {
  opacity: [0, 0.5, 1], x: [0, 100, 200, 300], easeEach: "none"
} }, 0);`;
    expect(parse(source).animations[0]?.keyframes?.keyframes).toEqual([
      { percentage: 0, properties: { opacity: 0, x: 0 } },
      { percentage: 33, properties: { x: 100 } },
      { percentage: 50, properties: { opacity: 0.5 } },
      { percentage: 67, properties: { x: 200 } },
      { percentage: 100, properties: { opacity: 1, x: 300 } },
    ]);
  });
});

it("unrolls unequal property arrays without shortening a channel", () => {
  const unrolled = unrollComputedTimeline(script);
  expect(unrolled).not.toContain("function animate");
  expect(parseGsapScriptAcorn(unrolled).animations[0]?.keyframes?.keyframes).toEqual(expected);
  expect(unrollComputedTimeline(unrolled)).toBe(unrolled);
});
