import { describe, expect, it, vi } from "vitest";

vi.mock("recast", () => {
  throw new Error("The browser parser must not load Recast");
});
vi.mock("@babel/parser", () => {
  throw new Error("The browser parser must not load Babel");
});

import { isStudioHoldSet, parseGsapScript } from "./gsapParserExports.js";

describe("browser parser entry", () => {
  it("parses and identifies generated holds without loading the legacy parser", () => {
    const parsed = parseGsapScript(`
      const tl = gsap.timeline({ paused: true });
      tl.set("#generated", { x: 25, data: "hf-hold" }, 0);
      tl.set("#authored", { x: 10 }, 0);
      tl.to("#animated", { x: 50, data: "hf-hold", duration: 1 }, 0);
    `);
    expect(
      parsed.animations.filter(isStudioHoldSet).map((animation) => animation.targetSelector),
    ).toEqual(["#generated"]);
  });
});
