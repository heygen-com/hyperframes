import { describe, it, expect } from "vitest";

import { compile, parse, plan } from "./compile.mjs";

const SCENE = `
CANVAS 100 100 30
FRAMES 60
DECL box rect
SET  0  box opacity 0
RAMP 30 box opacity 1
SET  45 box fill #FF0000
`;

describe("hfir", () => {
  it("puts a keyframe on the exact frame the table names", () => {
    const { animations } = plan(parse(SCENE));
    const opacity = animations.find((a) => a.css === "opacity");
    // frame 30 of 60 is the midpoint
    expect(opacity.keyframes.map((k) => k.offset)).toEqual([0, 0.5]);
  });

  it("makes SET a hard step and RAMP a linear interpolation", () => {
    const { animations } = plan(parse(SCENE));
    const opacity = animations.find((a) => a.css === "opacity");
    expect(opacity.keyframes[0].easing).toBe("steps(1, end)"); // SET
    expect(opacity.keyframes[1].easing).toBe("linear"); // RAMP
  });

  it("refuses an op that targets an element nobody declared", () => {
    expect(() => parse("CANVAS 10 10 30\nFRAMES 1\nSET 0 ghost x 1")).toThrow(/undeclared/);
  });

  it("refuses a property it cannot map", () => {
    expect(() => parse("CANVAS 10 10 30\nFRAMES 1\nDECL a rect\nSET 0 a wobble 1")).toThrow(
      /unknown property/,
    );
  });

  it("refuses an op past the end of the scene", () => {
    expect(() => parse("CANVAS 10 10 30\nFRAMES 10\nDECL a rect\nSET 99 a x 1")).toThrow(/past/);
  });

  it("emits a composition the renderer can read", () => {
    const { html } = compile(SCENE);
    expect(html).toContain('data-composition-id="root"');
    expect(html).toContain('data-duration="2"'); // 60 frames / 30fps
    expect(html).toContain(".animate(");
  });
});
