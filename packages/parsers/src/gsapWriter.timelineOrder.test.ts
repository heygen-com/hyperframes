import { describe, expect, it } from "vitest";
import * as acorn from "./gsapWriterAcorn.js";
import * as recast from "./gsapParser.js";

const script = (tl: string) => `window.__timelines = window.__timelines || {};
const ${tl} = gsap.timeline({ paused: true });
window.__timelines["main"] = ${tl};`;

const drag = { targetSelector: "#card", method: "set", position: 0, global: true } as const;
const resize = { targetSelector: "#card", method: "set", position: 0 } as const;

function dragThenResize(writer: typeof acorn | typeof recast, tl: string): string {
  const dragged = writer.addAnimationToScript(script(tl), {
    ...drag,
    properties: { x: -217, y: -38 },
  }).script;
  return writer.addAnimationToScript(dragged, {
    ...resize,
    properties: { width: 751, height: 871 },
  }).script;
}

describe.each([
  ["acorn", acorn],
  ["recast", recast],
])("%s writer: statements on the timeline land below its declaration", (_name, writer) => {
  it.each(["tl", "master"])("drag then resize with `const %s`", (tl) => {
    const out = dragThenResize(writer, tl);
    expect(out.indexOf(`${tl}.set("#card"`)).toBeGreaterThan(out.indexOf(`const ${tl} =`));
    expect(out.indexOf(`gsap.set("#card"`)).toBeLessThan(out.indexOf(`const ${tl} =`));
  });

  it("drag then a keyframed tween", () => {
    const dragged = writer.addAnimationToScript(script("tl"), {
      ...drag,
      properties: { x: 10, y: 20 },
    }).script;
    const out = writer.addAnimationWithKeyframesToScript(dragged, "#card", 0, 1, [
      { percentage: 0, properties: { width: 500 } },
      { percentage: 100, properties: { width: 700 } },
    ]).script;
    expect(out.indexOf(`tl.to("#card"`)).toBeGreaterThan(out.indexOf("const tl ="));
  });
});

describe("acorn writer: a lone drag or resize keeps its output", () => {
  it("resize alone", () => {
    const out = acorn.addAnimationToScript(script("tl"), {
      ...resize,
      properties: { width: 751, height: 871 },
    }).script;
    expect(out).toBe(`window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
tl.set("#card", { width: 751, height: 871 }, 0);
window.__timelines["main"] = tl;`);
  });

  it("drag alone", () => {
    const out = acorn.addAnimationToScript(script("tl"), {
      ...drag,
      properties: { x: -217, y: -38 },
    }).script;
    expect(out).toBe(`window.__timelines = window.__timelines || {};
gsap.set("#card", { x: -217, y: -38 });
const tl = gsap.timeline({ paused: true });
window.__timelines["main"] = tl;`);
  });
});
