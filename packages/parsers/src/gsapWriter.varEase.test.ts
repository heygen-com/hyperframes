import { describe, expect, it } from "vitest";
import { parseGsapScriptAcornForWrite } from "./gsapParserAcorn.js";
import {
  addAnimationWithKeyframesToScript,
  convertToKeyframesFromScript,
  unrollDynamicAnimations,
} from "./gsapWriterAcorn.js";

const keyframes = [
  { percentage: 0, properties: { x: 0 } },
  { percentage: 100, properties: { x: 100 } },
];
const idOf = (script: string) => parseGsapScriptAcornForWrite(script)?.located[0]?.id ?? "";

describe("an ease the file names by variable is written back as that variable", () => {
  it("when a keyframed tween is added", () => {
    const script = "var tl = gsap.timeline({ paused: true });";
    const out = addAnimationWithKeyframesToScript(
      script,
      "#a",
      0,
      1,
      keyframes,
      "__raw:E",
      "__raw:F",
    );
    expect(out.script).toContain("easeEach: F }");
    expect(out.script).toContain("ease: E }");
    expect(out.script).not.toContain("__raw");
  });

  it("when a flat tween is converted to keyframes", () => {
    const script = `var tl = gsap.timeline({ paused: true });\ntl.to("#a", { x: 100, duration: 1, ease: E }, 0);`;
    const out = convertToKeyframesFromScript(script, idOf(script));
    expect(out).toContain("easeEach: E");
    expect(out).not.toContain("__raw");
  });

  it("when a looped tween is unrolled", () => {
    const script = `var tl = gsap.timeline({ paused: true });
for (let i = 0; i < 2; i++) {
  tl.to(items[i], { x: 100, duration: 1, ease: E }, 0);
}`;
    const out = unrollDynamicAnimations(script, idOf(script), [
      { selector: "#a", keyframes },
      { selector: "#b", keyframes },
    ]);
    expect(out).toContain("ease: E }");
    expect(out).not.toContain("__raw");
  });
});
