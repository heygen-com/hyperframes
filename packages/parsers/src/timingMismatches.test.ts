import { describe, expect, it } from "vitest";
import { parseGsapScriptAcorn } from "./gsapParserAcorn.js";
import { timingMismatches } from "./timingMismatches.js";

const comp = (body: string, script: string, rootAttrs = 'data-duration="10"') =>
  `<div data-composition-id="main" ${rootAttrs}>${body}</div><script>const tl = gsap.timeline({paused:true});${script}</script>`;
const clip = (id: string, start: number, dur: number) =>
  `<div id="${id}" data-start="${start}" data-duration="${dur}"></div>`;

describe("timingMismatches", () => {
  it("flags a tween that starts an element outside its data-start window", () => {
    const r = timingMismatches(comp(clip("a", 2, 3), `tl.to("#a",{opacity:1,duration:1},6);`));
    expect(r.findings).toEqual([
      {
        kind: "tween-outside-window",
        selector: "#a",
        elementId: "a",
        dataStart: 2,
        dataEnd: 5,
        tweenStart: 6,
        tweenEnd: 7,
      },
    ]);
  });

  it("accepts a tween inside the window and a set at 0 before the window", () => {
    const r = timingMismatches(
      comp(clip("a", 2, 3), `tl.set("#a",{opacity:0},0);tl.to("#a",{opacity:1,duration:1},2.5);`),
    );
    expect(r).toEqual({ findings: [], unresolved: [] });
  });

  it("flags an animated top-level element with no timing attributes", () => {
    const r = timingMismatches(comp(`<div id="b"></div>`, `tl.to("#b",{x:1,duration:1},0);`));
    expect(r.findings).toEqual([
      { kind: "animated-without-timing", selector: "#b", elementId: "b" },
    ]);
  });

  it("does not flag an untimed element inside a timed clip", () => {
    const html = comp(
      `<div id="a" data-start="0" data-duration="4"><span id="c"></span></div>`,
      `tl.to("#c",{x:1,duration:1},0);`,
    );
    expect(timingMismatches(html).findings).toEqual([]);
  });

  it("flags a timeline that runs past the root data-duration", () => {
    const r = timingMismatches(comp(clip("a", 0, 12), `tl.to("#a",{x:1,duration:2},10);`));
    expect(r.findings).toContainEqual({
      kind: "timeline-exceeds-root-duration",
      rootDuration: 10,
      timelineEnd: 12,
    });
  });

  it("treats a root duration longer than the timeline as benign", () => {
    const r = timingMismatches(comp(clip("a", 0, 4), `tl.to("#a",{x:1,duration:2},0);`));
    expect(r.findings).toEqual([]);
  });

  it("reports a non-literal duration as unresolved and never guesses the next start", () => {
    const r = timingMismatches(
      comp(
        clip("a", 0, 5) + clip("b", 0, 5),
        `tl.to("#a",{x:1,duration:D},0);tl.to("#b",{x:1,duration:1});`,
      ),
    );
    expect(r.findings).toEqual([]);
    expect(r.unresolved).toEqual([
      { selector: "#a", reason: "duration" },
      { selector: "#b", reason: "position" },
    ]);
  });
});

describe("timingMismatches edge cases", () => {
  it("flags a from tween that starts before data-start", () => {
    const r = timingMismatches(comp(clip("a", 2, 3), `tl.from("#a",{opacity:0,duration:1},0);`));
    expect(r.findings).toMatchObject([
      { kind: "tween-outside-window", tweenStart: 0, dataStart: 2 },
    ]);
  });

  it("reports a non-numeric data-start as unresolved, not a finding", () => {
    const html = comp(
      `<div id="a" data-start="other + 1" data-duration="2"></div>`,
      `tl.to("#a",{x:1,duration:1},9);`,
    );
    expect(timingMismatches(html)).toEqual({
      findings: [],
      unresolved: [{ selector: "#a", reason: "start-attribute" }],
    });
  });

  it("reports a staggered tween as unresolved", () => {
    const html = comp(clip("a", 0, 5), `tl.to("#a",{x:1,duration:1,stagger:0.2},9);`);
    expect(timingMismatches(html).unresolved).toEqual([{ selector: "#a", reason: "stagger" }]);
  });

  it("ignores off-timeline global sets and sub-composition hosts", () => {
    const html = comp(
      `<div id="h" data-composition-id="sub" data-start="1" data-duration="2"></div><div id="u"></div>`,
      `gsap.set("#u",{opacity:0});tl.to("#h",{x:1,duration:1},8);`,
    );
    expect(timingMismatches(html).findings).toEqual([]);
  });

  it("reports an untimed animated element once however many tweens target it", () => {
    const html = comp(
      `<div id="b"></div>`,
      `tl.to("#b",{x:1,duration:1},0);tl.to("#b",{y:1,duration:1},1);`,
    );
    expect(timingMismatches(html).findings).toHaveLength(1);
  });
});

describe("parseGsapScriptAcorn unresolved duration", () => {
  const starts = (script: string) =>
    parseGsapScriptAcorn(script).animations.map((a) => a.resolvedStart);

  it("keeps GSAP's 0.5s default for an absent duration", () => {
    expect(starts(`const tl = gsap.timeline();tl.to("#a",{x:1});tl.to("#b",{x:1});`)).toEqual([
      0, 0.5,
    ]);
  });

  it("leaves every later cursor-relative start unresolved after a non-literal duration", () => {
    expect(
      starts(
        `const tl = gsap.timeline();tl.to("#a",{x:1,duration:D},1);tl.to("#b",{x:1});tl.to("#c",{x:1},4);`,
      ),
    ).toEqual([1, undefined, 4]);
  });

  it("marks the tween itself with durationUnresolved", () => {
    const [a] = parseGsapScriptAcorn(
      `const tl = gsap.timeline();tl.to("#a",{x:1,duration:D});`,
    ).animations;
    expect(a?.durationUnresolved).toBe(true);
  });

  it("marks tweens that inherit a non-literal timeline default duration", () => {
    const [a] = parseGsapScriptAcorn(
      `const tl = gsap.timeline({defaults:{duration:D}});tl.to("#a",{x:1});`,
    ).animations;
    expect(a?.durationUnresolved).toBe(true);
  });
  it.each([
    ["a vars variable", `const v = makeVars(); tl.to("#a", v); tl.to("#b", {x:1});`],
    ["a vars call", `tl.to("#a", makeVars()); tl.to("#b", {x:1});`],
    ["a spread", `tl.to("#a", {x:1, ...opts}); tl.to("#b", {x:1});`],
  ])("treats %s as an unknown duration", (_name, script) => {
    const [, b] = parseGsapScriptAcorn(`const tl = gsap.timeline();${script}`).animations;
    expect(b?.resolvedStart).toBeUndefined();
  });

  it("ignores a duration on a set, which GSAP never reads", () => {
    const [set, next] = parseGsapScriptAcorn(
      `const tl = gsap.timeline();tl.set("#a",{opacity:0,duration:D},0);tl.to("#b",{x:1,duration:1});`,
    ).animations;
    expect(set?.durationUnresolved).toBeUndefined();
    expect(next?.resolvedStart).toBe(0);
  });

  it("does not let a timeline default duration stand in for an authored non-static one", () => {
    const [a] = parseGsapScriptAcorn(
      `const tl = gsap.timeline({defaults:{duration:3}});tl.to("#a",{x:1,duration:D});`,
    ).animations;
    expect(a).toMatchObject({ durationUnresolved: true });
    expect(a?.duration).toBeUndefined();
  });
});
