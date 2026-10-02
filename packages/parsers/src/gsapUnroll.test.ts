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

  it("leaves a helper call as authored when a tween duration is not a static number", () => {
    const script = `const tl = gsap.timeline();
function fade(sel, at) { tl.to(sel, { opacity: 1, duration: LEN }, at); }
fade("#a", 1);
fade("#b", 2);`;
    expect(unrollComputedTimeline(script)).toBe(script);
  });

  it("still unrolls a sibling statement whose timing is fully known", () => {
    const script = `const tl = gsap.timeline();
function fade(sel, at, len) { tl.to(sel, { opacity: 1, duration: len }, at); }
fade("#a", 1, LEN);
fade("#b", 2, 0.5);`;
    const out = unrollComputedTimeline(script);
    expect(out).toContain('fade("#a", 1, LEN);');
    expect(out).toContain("function fade");
    expect(out).toContain("duration: 0.5");
  });

  it("leaves a nested helper chain declared and callable", () => {
    const script = `const tl = gsap.timeline();
function fade(sel, at) { tl.to(sel, { opacity: 1, duration: 1 }, at); }
function pop(sel, at) { fade(sel, at); }
pop("#a", 1);
fade("#b", 2);`;
    const out = unrollComputedTimeline(script);
    expect(out).toContain("function pop");
    expect(out).toContain("function fade");
    expect(out).toContain('pop("#a", 1);');
    expect(out).not.toContain('tl.to("#a"');
  });

  it("leaves a call site untouched when its helper also runs a nested helper", () => {
    const script = `const tl = gsap.timeline();
function fade(sel, at) { tl.to(sel, { opacity: 1, duration: 1 }, at); }
function pop(sel, at) { fade(sel, at); tl.to(sel, { scale: 2, duration: 1 }, at); }
pop("#a", 1);`;
    expect(unrollComputedTimeline(script)).toBe(script);
  });

  it("leaves an arrow-function helper chain untouched", () => {
    const script = `const tl = gsap.timeline();
const fade = (sel, at) => { tl.to(sel, { opacity: 1, duration: 1 }, at); };
const pop = (sel, at) => { fade(sel, at); };
pop("#a", 1);`;
    expect(unrollComputedTimeline(script)).toBe(script);
  });

  it("keeps a helper that a call the parser did not expand still reaches", () => {
    const script = `const tl = gsap.timeline();
function fade(sel, at) { tl.to(sel, { opacity: 1, duration: 1 }, at); }
(function () { fade("#z", 5); })();
fade("#b", 2);`;
    const out = unrollComputedTimeline(script);
    expect(out).toContain("function fade");
    expect(out).toContain('tl.to("#b"');
  });

  it.each(["$fade", "fade$", "fadé"])(
    "keeps helper %s that an unexpanded call still reaches",
    (name) => {
      const script = `const tl = gsap.timeline();
function ${name}(sel, at) { tl.to(sel, { opacity: 1, duration: 1 }, at); }
(function () { ${name}("#z", 5); })();
${name}("#b", 2);`;
      expect(unrollComputedTimeline(script)).toContain(`function ${name}`);
    },
  );

  it("does not treat a longer name as a reference to a shorter helper", () => {
    const script = `const tl = gsap.timeline();
function fade(sel, at) { tl.to(sel, { opacity: 1, duration: 1 }, at); }
function fadeIn() {}
fade("#b", 2);
fadeIn();`;
    expect(unrollComputedTimeline(script)).not.toContain("function fade(");
  });

  it("leaves a loop with a computed selector as authored", () => {
    const script = `const tl = gsap.timeline();
for (let i = 0; i < 3; i++) { tl.to("#item" + i, { opacity: 1, duration: 1 }, i); }`;
    expect(unrollComputedTimeline(script)).toBe(script);
  });

  it.each([
    ["a $-prefixed name", "$fade(1)"],
    ["a longer name ending in the helper name", "xfade(1)"],
    ["a name that continues with a $", "fade$(1)"],
  ])("does not read %s as a reference to fade", (_case, call) => {
    const script = `const tl = gsap.timeline();
function fade(sel, at) { tl.to(sel, { opacity: 1, duration: 1 }, at); }
fade("#b", 2);
${call};`;
    expect(unrollComputedTimeline(script)).not.toContain("function fade");
  });

  describe("keeps the timeline the parser read", () => {
    const starts = (script: string) =>
      Object.fromEntries(
        parseGsapScriptAcorn(script).animations.map((a) => [a.targetSelector, a.resolvedStart]),
      );

    const script = `const tl = gsap.timeline();
function fade(s) { tl.to(s, { opacity: 0, duration: 1 }); }
fade("#a"); tl.to("#c", { x: 1, duration: 1 }); fade("#b");`;

    it("resolves helper tweens in source order among literal tweens", () => {
      expect(starts(script)).toEqual({ "#a": 0, "#c": 1, "#b": 2 });
    });

    it("unrolls to a script whose tweens start at the same times", () => {
      expect(starts(unrollComputedTimeline(script))).toEqual(starts(script));
    });

    it("places helper tweens at the label they name, and unrolls to the same starts", () => {
      const labelled = `const tl = gsap.timeline();
function fade(s, at) { tl.to(s, { opacity: 0, duration: 1 }, at); }
tl.addLabel("mid", 2);
fade("#a", "mid"); fade("#b", "mid+=0.5");
tl.to("#c", { x: 1, duration: 1 }, "mid");`;
      expect(starts(labelled)).toEqual({ "#a": 2, "#b": 2.5, "#c": 2 });
      expect(starts(unrollComputedTimeline(labelled))).toEqual(starts(labelled));
    });

    it("keeps the order of a tween chain a helper adds", () => {
      const chained = `const tl = gsap.timeline();
function f() { tl.to("#a", { opacity: 0, duration: 1 }).to("#b", { x: 5, duration: 2 }).to("#c", { y: 7, duration: 3 }); }
f();`;
      expect(starts(chained)).toEqual({ "#a": 0, "#b": 1, "#c": 3 });
      expect(starts(unrollComputedTimeline(chained))).toEqual(starts(chained));
    });

    it("resolves a tween positioned by a label defined inside a helper body", () => {
      const labelInHelper = `const tl = gsap.timeline();
function group(s) { tl.addLabel("mid"); tl.to(s, { opacity: 0, duration: 1 }); }
tl.to("#pre", { x: 1, duration: 1 });
group("#a");
tl.to("#post", { x: 2, duration: 1 }, "mid");`;
      expect(starts(labelInHelper)).toEqual({ "#pre": 0, "#a": 1, "#post": 1 });
    });

    it("resolves a helper that only reads a label defined inside a sibling helper", () => {
      const siblingLabel = `const tl = gsap.timeline();
function makeLabel(s) { tl.addLabel("mid"); tl.to(s, { opacity: 0, duration: 1 }); }
function useLabel(s) { tl.to(s, { x: 1, duration: 1 }, "mid"); }
tl.to("#pre", { y: 1, duration: 1 });
makeLabel("#a");
useLabel("#b");`;
      expect(starts(siblingLabel)).toEqual({ "#pre": 0, "#a": 1, "#b": 1 });
      // useLabel only adds a tween, so it unrolls to a literal at the label's resolved start.
      expect(starts(unrollComputedTimeline(siblingLabel))).toEqual(starts(siblingLabel));
    });
  });

  it("leaves a helper as authored when an inner link of its tween chain has a callback", () => {
    const script = `const tl = gsap.timeline();
function f(s) { tl.to(s, { opacity: 0, duration: 1, onComplete: () => { window.hit++; } }).to(s, { x: 1, duration: 1 }); }
f("#a");`;
    expect(unrollComputedTimeline(script)).toBe(script);
  });

  it("leaves a helper call as authored when the helper does more than add tweens", () => {
    const script = `const tl = gsap.timeline();
function fade(sel, at) { window.count++; tl.to(sel, { opacity: 1, duration: 1 }, at); }
fade("#a", 1);`;
    expect(unrollComputedTimeline(script)).toBe(script);
  });

  it("leaves a loop as authored when its body sets state outside the timeline", () => {
    const script = `const tl = gsap.timeline();
for (let i = 0; i < 2; i++) { gsap.set("#x", { opacity: 0 }); tl.to("#x", { opacity: 1, duration: 1 }, i); }`;
    expect(unrollComputedTimeline(script)).toBe(script);
  });

  it.each([
    ["a tl.call callback", "tl.call(() => window.hit++, [], at);"],
    ["a label", 'tl.addLabel("mark", at);'],
    ["a call chained after a tween", "tl.to(sel, { opacity: 1, duration: 1 }, at).call(() => {});"],
  ])("leaves a helper as authored when it adds %s", (_case, body) => {
    const script = `const tl = gsap.timeline();
function fade(sel, at) { ${body} }
fade("#a", 1);`;
    expect(unrollComputedTimeline(script)).toBe(script);
  });
});
