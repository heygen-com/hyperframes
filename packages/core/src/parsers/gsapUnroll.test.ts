import { describe, it, expect } from "vitest";
import { unrollComputedTimeline } from "./gsapUnroll.js";
import { parseGsapScriptAcorn } from "./gsapParserAcorn.js";

const ARC_SCRIPT = `
const tl = gsap.timeline({ paused: true });
const DX = 852, DY = -322, FLY_SCALE = 56 / 160;
tl.from("#product", { opacity: 0, scale: 0.8, duration: 0.5 }, 0.1);
function addCycle(at, path, curviness, spin) {
  tl.to("#product", { y: -15, scale: 1.05, duration: 0.15 }, at + 0.15);
  tl.to("#product", { motionPath: { path, curviness }, scale: FLY_SCALE, rotation: spin, duration: 0.55 }, at + 0.3);
  tl.to("#basket", { keyframes: { "0%": { y: 0 }, "50%": { y: -12 }, "100%": { y: 0 }, easeEach: "power2.out" }, duration: 0.5 }, at + 0.85);
}
addCycle(1.0, [{x:0,y:-15},{x:180,y:-300},{x:520,y:-360},{x:DX,y:DY}], 2, 18);
addCycle(3.6, [{x:0,y:-15},{x:-120,y:-220},{x:350,y:-380},{x:DX,y:DY}], 2.5, -22);
`;

const sig = (anims: ReturnType<typeof parseGsapScriptAcorn>["animations"]) =>
  anims
    .map(
      (a) =>
        `${a.targetSelector}|${a.method}|${a.resolvedStart}|arc:${a.arcPath?.segments.length ?? 0}|kf:${a.keyframes?.keyframes.length ?? 0}`,
    )
    .join("\n");

describe("unrollComputedTimeline", () => {
  it("unrolls helper calls into literal tweens (visual no-op)", () => {
    const before = parseGsapScriptAcorn(ARC_SCRIPT);
    const unrolled = unrollComputedTimeline(ARC_SCRIPT);
    const after = parseGsapScriptAcorn(unrolled);

    // Same animations, same times, same arcs/keyframes — the render is unchanged.
    expect(after.animations).toHaveLength(before.animations.length);
    expect(sig(after.animations)).toBe(sig(before.animations));
  });

  it("produces only literal tweens (no helper, no provenance)", () => {
    const unrolled = unrollComputedTimeline(ARC_SCRIPT);
    expect(unrolled).not.toContain("addCycle");
    expect(unrolled).not.toContain("function ");
    const after = parseGsapScriptAcorn(unrolled);
    expect(after.animations.every((a) => a.provenance === undefined)).toBe(true);
    // Arc tweens survive as real motionPath arcs.
    expect(after.animations.filter((a) => a.arcPath?.enabled)).toHaveLength(2);
  });

  it("unrolls a bounded for-loop", () => {
    const script = `const tl = gsap.timeline();
      for (let i = 0; i < 3; i++) { tl.to("#x", { x: 100, duration: 0.5 }, i * 0.5); }`;
    const unrolled = unrollComputedTimeline(script);
    expect(unrolled).not.toContain("for (");
    const after = parseGsapScriptAcorn(unrolled);
    expect(after.animations.map((a) => a.resolvedStart)).toEqual([0, 0.5, 1]);
    expect(after.animations.every((a) => a.provenance === undefined)).toBe(true);
  });

  it("leaves a fully-literal composition unchanged", () => {
    const script = `const tl = gsap.timeline();
tl.from("#a", { opacity: 0, duration: 0.5 }, 0.1);`;
    expect(unrollComputedTimeline(script)).toBe(script);
  });
});
