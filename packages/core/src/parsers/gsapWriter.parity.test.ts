/**
 * Parity harness — recast writer (gsapParser.ts) vs acorn writer
 * (gsapWriterAcorn.ts). Both must produce scripts that REPARSE to the same
 * animation model. Byte-equality is not expected (recast pretty-prints, acorn
 * splices), so parity is asserted on the parsed GsapAnimation, not raw text.
 *
 * This is the safety net for porting WS-3 ops one at a time: each ported op
 * gets a fixture row here proving it matches the battle-tested original.
 */
import { describe, expect, it } from "vitest";
import { parseGsapScript, removeAllKeyframesFromScript as removeAllRecast } from "./gsapParser.js";
import { parseGsapScriptAcornForWrite, type ParsedGsapAcornForWrite } from "./gsapParserAcorn.js";
import { removeAllKeyframesFromScript as removeAllAcorn } from "./gsapWriterAcorn.js";

function acornId(script: string): string {
  const parsed = parseGsapScriptAcornForWrite(script) as ParsedGsapAcornForWrite;
  return parsed.located[0]!.id;
}

/** Reparse a written script and return the first animation's editable shape. */
function shapeOf(script: string) {
  const anim = parseGsapScript(script).animations[0]!;
  return {
    method: anim.method,
    properties: anim.properties,
    keyframes: anim.keyframes,
    duration: anim.duration,
    ease: anim.ease,
  };
}

const REMOVE_ALL_FIXTURES: Array<{ name: string; script: string }> = [
  {
    name: "to() — collapses to last keyframe",
    script: `
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", {
        keyframes: { "0%": { x: 0 }, "50%": { x: 100 }, "100%": { x: 200, opacity: 1 } },
        duration: 2
      }, 0);
    `,
  },
  {
    name: "to() — single keyframe + ease",
    script: `
      const tl = gsap.timeline({ paused: true });
      tl.to("#box", {
        keyframes: { "0%": { opacity: 0 }, "100%": { opacity: 1 } },
        duration: 1,
        ease: "none"
      }, 0.5);
    `,
  },
  {
    name: "to() — easeEach dropped on collapse",
    script: `
      const tl = gsap.timeline({ paused: true });
      tl.to("#card", {
        keyframes: { "0%": { y: 0 }, "100%": { y: -40 }, easeEach: "power2.inOut" },
        duration: 1.5
      }, 0);
    `,
  },
];

describe("parity: removeAllKeyframesFromScript (recast vs acorn)", () => {
  for (const { name, script } of REMOVE_ALL_FIXTURES) {
    it(name, () => {
      const id = acornId(script);
      // Sanity: recast and acorn agree on the id for this tween.
      expect(parseGsapScript(script).animations[0]!.id).toBe(id);

      const recastOut = removeAllRecast(script, id);
      const acornOut = removeAllAcorn(script, id);

      const recastShape = shapeOf(recastOut);
      const acornShape = shapeOf(acornOut);

      expect(acornShape.keyframes).toBeUndefined();
      expect(acornShape).toEqual(recastShape);
    });
  }

  it("no-op when id not found", () => {
    const script = REMOVE_ALL_FIXTURES[0]!.script;
    expect(removeAllAcorn(script, "nonexistent-id")).toBe(script);
  });

  it("no-op when tween has no keyframes", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#flat", { x: 100, duration: 1 }, 0);
    `;
    const id = acornId(script);
    expect(removeAllAcorn(script, id)).toBe(script);
  });
});
