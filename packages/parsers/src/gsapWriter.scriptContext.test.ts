import { describe, expect, it } from "vitest";
import * as acornWriter from "./gsapWriterAcorn.js";
import * as recastWriter from "./gsapParser.js";
import { parseGsapScript } from "./gsapParser.js";
import type { GsapAnimation } from "./gsapSerialize.js";

const SCRIPT = `var tl = gsap.timeline({ paused: true });
tl.to("#box", { opacity: 1, duration: 1 }, 0);`;
const CLOSER = "</script><script>window.hacked = 1</script><!--";

const writers = [
  ["acorn", acornWriter],
  ["recast", recastWriter],
] as const;

describe.each(writers)("%s writer output stays inside its script element", (_name, writer) => {
  it("escapes a script closer or comment opener in strings and keys", () => {
    const animation: Omit<GsapAnimation, "id"> = {
      targetSelector: `#box[data-x="${CLOSER}"]`,
      method: "to",
      position: 1,
      duration: 1,
      ease: CLOSER,
      properties: { text: CLOSER, [CLOSER]: 1 },
    };
    const { script } = writer.addAnimationToScript(SCRIPT, animation);
    expect(script).not.toMatch(/<\/script|<!--/i);
    const added = parseGsapScript(script).animations.find((a) => a.ease === CLOSER);
    expect(added?.targetSelector).toBe(animation.targetSelector);
    expect(added?.properties.text).toBe(CLOSER);
  });

  it("leaves strings without those sequences byte-for-byte as before", () => {
    const { script } = writer.addAnimationToScript(SCRIPT, {
      targetSelector: "#box",
      method: "to",
      position: 2,
      duration: 1,
      ease: "power2.out",
      properties: { text: "a < b", x: 10 },
    });
    expect(script).toContain('"a < b"');
    expect(script).toContain('"power2.out"');
  });

  it("refuses a tween method outside set, to, from and fromTo", () => {
    const animation = {
      targetSelector: "#box",
      method: "to(window),tl.to" as GsapAnimation["method"],
      position: 0,
      duration: 1,
      properties: { x: 1 },
    };
    expect(() => writer.addAnimationToScript(SCRIPT, animation)).toThrow(/tween method/);
  });

  it("refuses a motion path point that is not a number", () => {
    const point = { x: "0}];window.hacked=1;[{" as unknown as number, y: 0 };
    expect(() => writer.addMotionPathToScript(SCRIPT, "#box", 0, 1, point)).toThrow(/numbers/);
  });
});
