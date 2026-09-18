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
});
