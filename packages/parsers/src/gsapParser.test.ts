import { describe, it, expect } from "vitest";
import {
  parseGsapScript,
  gsapAnimationsToKeyframes,
  SUPPORTED_PROPS,
  SUPPORTED_EASES,
  serializeGsapAnimations,
  validateCompositionGsap,
  getAnimationsForElementId,
  keyframesToGsapAnimations,
  addAnimationToScript,
  removeAnimationFromScript,
  updateAnimationInScript,
  addKeyframeToScript,
  removeKeyframeFromScript,
  updateKeyframeInScript,
  updateMotionPathPointInScript,
  addMotionPathPointInScript,
  removeMotionPathPointInScript,
  addMotionPathToScript,
  convertToKeyframesInScript,
  removeAllKeyframesFromScript,
  dedupePositionWritesInScript,
  addAnimationWithKeyframesToScript,
  splitAnimationsInScript,
  splitIntoPropertyGroups,
  syncPositionHoldsBeforeKeyframes,
  shiftPositionsInScript,
  scalePositionsInScript,
} from "./gsapParser.js";
import type { GsapAnimation } from "./gsapParser.js";
import { classifyPropertyGroup, classifyTweenPropertyGroup } from "./gsapConstants.js";
import type { Keyframe } from "./types.js";
import {
  parseAndSerialize,
  parseSingleAnimation,
  expectKeyframe,
  expectKeyframesFormat,
  convertAndReparse,
  parseSplitAndAssert,
} from "./gsapParser.test-helpers.js";

describe("parseGsapScript", () => {
  it("parses a basic timeline with .to()", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1, duration: 0.5 }, 0);
    `;
    const result = parseGsapScript(script);

    expect(result.timelineVar).toBe("tl");
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].method).toBe("to");
    expect(result.animations[0].targetSelector).toBe("#el1");
    expect(result.animations[0].properties.opacity).toBe(1);
    expect(result.animations[0].duration).toBe(0.5);
    expect(result.animations[0].position).toBe(0);
  });

  it("parses a timeline with .from()", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.from("#el2", { x: 100, duration: 1 }, 0.5);
    `;
    const result = parseGsapScript(script);

    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].method).toBe("from");
    expect(result.animations[0].targetSelector).toBe("#el2");
    expect(result.animations[0].properties.x).toBe(100);
    expect(result.animations[0].duration).toBe(1);
    expect(result.animations[0].position).toBe(0.5);
  });

  it("parses a timeline with .set()", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.set("#el3", { opacity: 0, x: 50 }, 0);
    `;
    const result = parseGsapScript(script);

    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].method).toBe("set");
    expect(result.animations[0].targetSelector).toBe("#el3");
    expect(result.animations[0].properties.opacity).toBe(0);
    expect(result.animations[0].properties.x).toBe(50);
    expect(result.animations[0].duration).toBeUndefined();
  });

  it("parses a timeline with .fromTo() and position offset", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#el4", { opacity: 0, x: 100 }, { opacity: 1, x: 200, duration: 1 }, 2);
    `;
    const result = parseGsapScript(script);

    expect(result.animations).toHaveLength(1);
    const anim = result.animations[0];
    expect(anim.method).toBe("fromTo");
    expect(anim.targetSelector).toBe("#el4");
    expect(anim.fromProperties).toBeDefined();
    expect(anim.fromProperties?.opacity).toBe(0);
    expect(anim.fromProperties?.x).toBe(100);
    expect(anim.properties.opacity).toBe(1);
    expect(anim.properties.x).toBe(200);
    expect(anim.duration).toBe(1);
    expect(anim.position).toBe(2);
  });

  it("parses negative numbers in property values", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#el5", { opacity: 0, x: -100 }, { opacity: 1, x: 0, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);

    expect(result.animations).toHaveLength(1);
    const anim = result.animations[0];
    expect(anim.fromProperties).toBeDefined();
    expect(anim.fromProperties?.opacity).toBe(0);
    expect(anim.fromProperties?.x).toBe(-100);
  });

  it("handles an empty script", () => {
    const result = parseGsapScript("");

    expect(result.animations).toHaveLength(0);
    expect(result.timelineVar).toBe("tl");
    expect(result.preamble).toBe("const tl = gsap.timeline({ paused: true });");
    expect(result.postamble).toBe("");
  });

  it("extracts preamble correctly", () => {
    const script = `
      const myTl = gsap.timeline({ paused: true });
      myTl.to("#el1", { opacity: 1, duration: 0.5 }, 0);
    `;
    const result = parseGsapScript(script);

    expect(result.timelineVar).toBe("myTl");
    expect(result.preamble).toContain("const myTl = gsap.timeline");
  });

  it("extracts postamble correctly", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1, duration: 0.5 }, 0);
      console.log("done");
    `;
    const result = parseGsapScript(script);

    expect(result.postamble).toContain('console.log("done");');
  });

  it("parses multiple animations", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.set("#el1", { opacity: 0 }, 0);
      tl.to("#el1", { opacity: 1, duration: 0.5 }, 0);
      tl.to("#el2", { x: 100, duration: 1 }, 1);
    `;
    const result = parseGsapScript(script);

    expect(result.animations).toHaveLength(3);
    expect(result.animations[0].method).toBe("set");
    expect(result.animations[1].method).toBe("to");
    expect(result.animations[2].method).toBe("to");
  });

  it("extracts all GSAP properties including non-standard ones", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1, backgroundColor: "red", x: 50, duration: 0.5 }, 0);
    `;
    const result = parseGsapScript(script);

    expect(result.animations[0].properties.opacity).toBe(1);
    expect(result.animations[0].properties.x).toBe(50);
    expect(result.animations[0].properties.backgroundColor).toBe("red");
  });

  it("extracts ease from properties", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1, duration: 1, ease: "power2.out" }, 0);
    `;
    const result = parseGsapScript(script);

    expect(result.animations[0].ease).toBe("power2.out");
  });

  it("uses 'let' or 'var' for timeline declaration", () => {
    const script = `
      let timeline = gsap.timeline({ paused: true });
      timeline.to("#el1", { opacity: 1, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);

    expect(result.timelineVar).toBe("timeline");
    expect(result.animations).toHaveLength(1);
  });

  it("preserves string position values like '+=1' and '<'", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1, duration: 0.5 }, "+=1");
      tl.to("#el2", { x: 100, duration: 1 }, "<");
      tl.to("#el3", { y: 50, duration: 0.3 }, "-=0.5");
    `;
    const result = parseGsapScript(script);

    expect(result.animations).toHaveLength(3);
    expect(result.animations[0].position).toBe("+=1");
    expect(result.animations[1].position).toBe("<");
    expect(result.animations[2].position).toBe("-=0.5");
  });

  it("resolves variable references from const declarations in the same script", () => {
    const script = `
      const FADE = 0.8;
      const OFFSET = -60;
      const MY_EASE = "power3.out";
      const tl = gsap.timeline({ paused: true });
      tl.from("#el1", { y: OFFSET, opacity: 0, duration: FADE, ease: MY_EASE }, 0);
    `;
    const result = parseGsapScript(script);

    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].properties.y).toBe(-60);
    expect(result.animations[0].properties.opacity).toBe(0);
    expect(result.animations[0].duration).toBe(0.8);
    expect(result.animations[0].ease).toBe("power3.out");
  });

  it("resolves computed expressions from scope bindings", () => {
    const script = `
      const BASE = 100;
      const HALF = BASE / 2;
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { x: HALF, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);

    expect(result.animations[0].properties.x).toBe(50);
  });

  it("preserves unresolvable references as __raw: prefixed strings", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: someUndefinedVar, x: 50, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);

    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].properties.x).toBe(50);
    expect(result.animations[0].properties.opacity).toBe("__raw:someUndefinedVar");
  });

  it("generates stable content-based IDs", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1, duration: 0.5 }, 0);
      tl.to("#el2", { x: 100, duration: 1 }, 1);
    `;
    const result1 = parseGsapScript(script);
    const result2 = parseGsapScript(script);

    // IDs are deterministic across parses
    expect(result1.animations[0].id).toBe(result2.animations[0].id);
    expect(result1.animations[1].id).toBe(result2.animations[1].id);

    // IDs encode selector, method, and position
    expect(result1.animations[0].id).toBe("#el1-to-0-visual");
    expect(result1.animations[1].id).toBe("#el2-to-1000-position");
  });

  it("disambiguates colliding IDs with a suffix", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 0, duration: 0.3 }, 0);
      tl.to("#el1", { opacity: 1, duration: 0.5 }, 0);
    `;
    const result = parseGsapScript(script);

    expect(result.animations[0].id).toBe("#el1-to-0-visual");
    expect(result.animations[1].id).toBe("#el1-to-0-visual-2");
  });

  it("uses string position in ID for relative positions", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1, duration: 0.5 }, "+=1");
    `;
    const result = parseGsapScript(script);

    expect(result.animations[0].id).toBe("#el1-to-+=1-visual");
  });
});

describe("resolvedStart — timeline position resolution", () => {
  it("a global gsap.set is off-timeline: resolvedStart is 0, not the comp-end cursor", () => {
    // The trailing global `gsap.set` carries no position; the cursor has advanced
    // to ~3 by the time it's reached. It must NOT inherit that as its start — it's
    // a load-time hold at 0. (Regression: setStart=cursor blocked Enable-keyframes.)
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#a", { x: 100, duration: 3 }, 0);
      gsap.set("#card", { x: -74, y: -469 });
    `;
    const result = parseGsapScript(script);
    const set = result.animations.find((a) => a.targetSelector === "#card");
    expect(set?.method).toBe("set");
    expect(set?.global).toBe(true);
    expect(set?.resolvedStart).toBe(0);
    // The off-timeline set must not perturb the real tween's position either.
    expect(result.animations.find((a) => a.targetSelector === "#a")?.resolvedStart).toBe(0);
  });

  it("resolves chained from() tweens with relative positions (sdk-test pattern)", () => {
    const script = `
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from("#headline", { duration: 0.6, scale: 0.92, transformOrigin: "left center" })
        .from("#subtext",  { duration: 0.5, scale: 0.92, transformOrigin: "left center" }, "-=0.3")
        .from("#box",      { duration: 0.5, scale: 0.5,  transformOrigin: "center center" }, "-=0.3");
    `;
    const result = parseGsapScript(script);

    expect(result.animations).toHaveLength(3);
    // Execution order: #headline, #subtext, #box
    expect(result.animations[0].targetSelector).toBe("#headline");
    expect(result.animations[1].targetSelector).toBe("#subtext");
    expect(result.animations[2].targetSelector).toBe("#box");

    // #headline: implicit position → starts at 0, ends at 0.6
    expect(result.animations[0].resolvedStart).toBe(0);
    expect(result.animations[0].implicitPosition).toBe(true);

    // #subtext: "-=0.3" from cursor (0.6) → 0.6 - 0.3 = 0.3
    expect(result.animations[1].resolvedStart).toBe(0.3);

    // #box: "-=0.3" from cursor (max(0.6, 0.3+0.5=0.8) = 0.8) → 0.8 - 0.3 = 0.5
    expect(result.animations[2].resolvedStart).toBe(0.5);
  });

  it("resolves += and < positions", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1, duration: 0.5 }, "+=1");
      tl.to("#el2", { x: 100, duration: 1 }, "<");
      tl.to("#el3", { y: 50, duration: 0.3 }, "-=0.5");
    `;
    const result = parseGsapScript(script);

    // #el1: "+=1" from cursor (0) → 0 + 1 = 1, ends at 1.5
    expect(result.animations[0].resolvedStart).toBe(1);

    // #el2: "<" = previous start → 1
    expect(result.animations[1].resolvedStart).toBe(1);

    // #el3: "-=0.5" from cursor (max(1.5, 1+1=2) = 2) → 2 - 0.5 = 1.5
    expect(result.animations[2].resolvedStart).toBe(1.5);
  });

  it("resolves numeric positions directly", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1, duration: 0.5 }, 0);
      tl.to("#el2", { x: 100, duration: 1 }, 2);
    `;
    const result = parseGsapScript(script);

    expect(result.animations[0].resolvedStart).toBe(0);
    expect(result.animations[1].resolvedStart).toBe(2);
  });

  it("resolves implicit sequential positions", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1, duration: 0.5 })
        .to("#el2", { x: 100, duration: 1 })
        .to("#el3", { y: 50, duration: 0.3 });
    `;
    const result = parseGsapScript(script);

    // #el1: implicit → cursor=0, ends at 0.5
    expect(result.animations[0].resolvedStart).toBe(0);
    expect(result.animations[0].implicitPosition).toBe(true);

    // #el2: implicit → cursor=0.5, ends at 1.5
    expect(result.animations[1].resolvedStart).toBe(0.5);
    expect(result.animations[1].implicitPosition).toBe(true);

    // #el3: implicit → cursor=1.5, ends at 1.8
    expect(result.animations[2].resolvedStart).toBe(1.5);
    expect(result.animations[2].implicitPosition).toBe(true);
  });

  it("clamps negative resolvedStart to 0", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1, duration: 0.2 });
      tl.to("#el2", { x: 100, duration: 1 }, "-=5");
    `;
    const result = parseGsapScript(script);

    expect(result.animations[1].resolvedStart).toBe(0);
  });

  it("uses GSAP default duration (0.5) for tweens with no explicit duration", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1 })
        .to("#el2", { x: 100 });
    `;
    const result = parseGsapScript(script);

    // #el1: starts at 0, duration defaults to 0.5 → cursor at 0.5
    expect(result.animations[0].resolvedStart).toBe(0);
    // #el2: starts at cursor = 0.5
    expect(result.animations[1].resolvedStart).toBe(0.5);
  });

  it("treats set() as zero-duration", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.set("#el1", { opacity: 0 });
      tl.to("#el2", { opacity: 1, duration: 1 });
    `;
    const result = parseGsapScript(script);

    // set() at 0, zero duration → cursor stays at 0
    expect(result.animations[0].resolvedStart).toBe(0);
    // next tween starts at cursor = 0
    expect(result.animations[1].resolvedStart).toBe(0);
  });
});

describe("timeline defaults inheritance", () => {
  it("inherits ease and duration from timeline defaults onto tweens", () => {
    const script = `
      const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.6 } });
      tl.from("#headline", { scale: 0.92, transformOrigin: "left center" })
        .from("#subtext", { scale: 0.92 }, "-=0.3");
    `;
    const result = parseGsapScript(script);

    expect(result.animations[0].ease).toBe("power3.out");
    expect(result.animations[0].duration).toBe(0.6);
    expect(result.animations[1].ease).toBe("power3.out");
    expect(result.animations[1].duration).toBe(0.6);
  });

  it("does not override explicit ease/duration on individual tweens", () => {
    const script = `
      const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.6 } });
      tl.to("#el1", { opacity: 1, duration: 1, ease: "none" });
    `;
    const result = parseGsapScript(script);

    expect(result.animations[0].ease).toBe("none");
    expect(result.animations[0].duration).toBe(1);
  });

  it("uses inherited duration for position resolution", () => {
    const script = `
      const tl = gsap.timeline({ defaults: { duration: 0.8 } });
      tl.from("#a", { scale: 0.5 })
        .from("#b", { scale: 0.5 });
    `;
    const result = parseGsapScript(script);

    // #a starts at 0, duration 0.8 → cursor at 0.8
    expect(result.animations[0].resolvedStart).toBe(0);
    // #b starts at cursor = 0.8
    expect(result.animations[1].resolvedStart).toBe(0.8);
  });
});

describe("property group classification", () => {
  it("classifies individual properties into groups", () => {
    expect(classifyPropertyGroup("x")).toBe("position");
    expect(classifyPropertyGroup("y")).toBe("position");
    expect(classifyPropertyGroup("xPercent")).toBe("position");
    expect(classifyPropertyGroup("scale")).toBe("scale");
    expect(classifyPropertyGroup("scaleX")).toBe("scale");
    expect(classifyPropertyGroup("width")).toBe("size");
    expect(classifyPropertyGroup("height")).toBe("size");
    expect(classifyPropertyGroup("rotation")).toBe("rotation");
    expect(classifyPropertyGroup("skewX")).toBe("rotation");
    expect(classifyPropertyGroup("opacity")).toBe("visual");
    expect(classifyPropertyGroup("autoAlpha")).toBe("visual");
    expect(classifyPropertyGroup("borderRadius")).toBe("other");
    expect(classifyPropertyGroup("fontSize")).toBe("other");
  });

  it("classifies a pure position tween", () => {
    expect(classifyTweenPropertyGroup({ x: 100, y: 50 })).toBe("position");
  });

  it("classifies a pure scale tween", () => {
    expect(classifyTweenPropertyGroup({ scale: 0.5 })).toBe("scale");
  });

  it("classifies scale + transformOrigin as scale (transformOrigin follows group)", () => {
    expect(classifyTweenPropertyGroup({ scale: 0.5, transformOrigin: "center center" })).toBe(
      "scale",
    );
  });

  it("ignores the internal `_auto` endpoint marker when classifying", () => {
    // Regression: the `_auto: 1` sentinel on auto-generated endpoint keyframes must
    // not pull a position tween into a mixed group, or drag-intercept can't resolve it.
    expect(classifyTweenPropertyGroup({ x: 100, y: 50, _auto: 1 })).toBe("position");
  });

  it("ignores the GSAP-reserved `data` key when classifying", () => {
    // Regression: `data` is GSAP-reserved (Studio stores its hold-set tag there).
    // It is not an animated property, so it must not pull a single-group tween into
    // a mixed group (which would return undefined and break group-scoped editing).
    expect(classifyTweenPropertyGroup({ x: 100, y: 50, data: "hold" })).toBe("position");
    expect(classifyTweenPropertyGroup({ scale: 0.5, data: "hold" })).toBe("scale");
  });

  it("returns undefined for mixed-group tweens", () => {
    expect(classifyTweenPropertyGroup({ x: 100, scale: 0.5 })).toBeUndefined();
    expect(classifyTweenPropertyGroup({ x: 100, opacity: 0 })).toBeUndefined();
  });

  it("classifies tweens during parsing", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#a", { x: 100, y: 50, duration: 1 }, 0);
      tl.to("#b", { scale: 0.5, duration: 0.5 }, 0);
      tl.to("#c", { x: 100, scale: 0.5, opacity: 0, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);

    expect(result.animations[0].propertyGroup).toBe("position");
    expect(result.animations[1].propertyGroup).toBe("scale");
    expect(result.animations[2].propertyGroup).toBeUndefined();
  });
});

describe("stagger/yoyo/repeat round-trip", () => {
  it("preserves stagger as extras on parse", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to(".items", { opacity: 1, duration: 0.5, stagger: 0.1 }, 0);
    `;
    const result = parseGsapScript(script);

    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].extras).toBeDefined();
    expect(result.animations[0].extras!.stagger).toBe("__raw:0.1");
    expect(result.animations[0].properties.opacity).toBe(1);
    // stagger should NOT appear in properties
    expect(result.animations[0].properties).not.toHaveProperty("stagger");
  });

  it("preserves complex stagger object on round-trip", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to(".items", { opacity: 1, duration: 0.5, stagger: { each: 0.15, from: "start" } }, 0);
    `;
    const { serialized } = parseAndSerialize(script);

    expect(serialized).toContain("stagger: {");
    expect(serialized).toContain("each: 0.15");
    expect(serialized).toContain('from: "start"');
  });

  it("preserves yoyo and repeat on round-trip", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { x: 100, duration: 1, yoyo: true, repeat: 3, repeatDelay: 0.2 }, 0);
    `;
    const { serialized } = parseAndSerialize(script);

    expect(serialized).toContain("yoyo: true");
    expect(serialized).toContain("repeat: 3");
    expect(serialized).toContain("repeatDelay: 0.2");
  });

  it("survives a full parse-edit-serialize round-trip with stagger intact", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to(".items", { opacity: 1, x: 50, duration: 0.5, stagger: 0.1, ease: "power2.out" }, 0);
    `;
    const parsed = parseGsapScript(script);
    const animId = parsed.animations[0].id;
    // Simulate an edit — change opacity to 0.5
    const updatedScript = updateAnimationInScript(script, animId, {
      properties: { opacity: 0.5, x: 50 },
    });
    // stagger should still be in the output
    expect(updatedScript).toContain("stagger: 0.1");
    expect(updatedScript).toContain("opacity: 0.5");
  });

  it("converts a static set into a keyframed to() with a duration (keyframable 3D)", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.set("#card", { rotationX: 50, rotationY: 20, immediateRender: true }, 0);
    `;
    const parsed = parseGsapScript(script);
    const animId = parsed.animations[0].id;
    const result = convertToKeyframesInScript(script, animId, undefined, 4);
    // Flips set → to, drops the hold marker, gains a duration + keyframes.
    expect(result).toContain('tl.to("#card"');
    expect(result).not.toContain("immediateRender");
    expect(result).toContain("duration: 4");
    expect(result).toContain("keyframes:");
    // Both endpoints start at the set's value (visual unchanged until edited).
    const reparsed = parseGsapScript(result).animations[0];
    expect(reparsed.keyframes).toBeTruthy();
    expect(reparsed.keyframes!.keyframes[0]!.properties.rotationX).toBe(50);
    expect(reparsed.keyframes!.keyframes.at(-1)!.properties.rotationX).toBe(50);
  });

  it("converts a GLOBAL gsap.set into a timeline-rooted to() (seekable, not gsap.to)", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      gsap.set("#card", { rotationX: 50, rotationY: 20 });
    `;
    const parsed = parseGsapScript(script);
    const animId = parsed.animations[0].id;
    expect(parsed.animations[0].global).toBe(true);
    const result = convertToKeyframesInScript(script, animId, undefined, 4);
    // Must re-root onto the master timeline (tl.to), NOT emit an off-timeline
    // gsap.to that fires once at load and can't be seeked/rendered.
    expect(result).toMatch(/tl\.to\(\s*"#card"/);
    expect(result).not.toMatch(/gsap\.to\(/);
    expect(result).toContain("duration: 4");
    expect(result).toContain("keyframes:");
    // Re-parsed tween is a real timeline keyframe tween, no longer global.
    const reparsed = parseGsapScript(result).animations[0];
    expect(reparsed.keyframes).toBeTruthy();
    expect(reparsed.global).toBeFalsy();
  });

  it("apply-to-all (resetKeyframeEases) sets easeEach and strips every per-keyframe ease", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#card", { keyframes: { "0%": { x: 0 }, "30%": { x: 50, ease: "custom(M0,0 C0.333,0 0.667,1 1,1)" }, "70%": { x: 80, ease: "power2.in" }, "100%": { x: 100 }, easeEach: "power2.out" }, duration: 1 }, 0);
    `;
    const parsed = parseGsapScript(script);
    const animId = parsed.animations[0].id;
    const result = updateAnimationInScript(script, animId, {
      easeEach: "back.out",
      resetKeyframeEases: true,
    });
    expect(result).toContain('easeEach: "back.out"');
    // Every per-keyframe override is gone — the single easeEach governs all segments.
    expect(result).not.toContain('ease: "custom');
    expect(result).not.toContain('ease: "power2.in"');
  });
});

describe("unresolvable value round-trip", () => {
  it("preserves unresolvable property values through serialize", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: someFn(), x: 50, duration: 1 }, 0);
    `;
    const { serialized } = parseAndSerialize(script);

    // The raw expression should survive — emitted without quotes
    expect(serialized).toContain("opacity: someFn()");
    expect(serialized).toContain("x: 50");
  });

  it("preserves complex unresolvable expressions", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { x: getOffset() + 10, y: 200, duration: 1 }, 0);
    `;
    const parsed = parseGsapScript(script);

    // x is unresolvable (function call in expression), y is resolvable
    expect(parsed.animations[0].properties.y).toBe(200);
    expect(String(parsed.animations[0].properties.x)).toMatch(/^__raw:/);
  });
});

describe("gsapAnimationsToKeyframes", () => {
  it("converts animations to keyframes with element start offset", () => {
    const animations: GsapAnimation[] = [
      {
        id: "anim-1",
        targetSelector: "#el1",
        method: "set",
        position: 2,
        properties: { x: 100, y: 200 },
      },
      {
        id: "anim-2",
        targetSelector: "#el1",
        method: "to",
        position: 3,
        properties: { x: 300, y: 400 },
        duration: 1,
        ease: "power2.out",
      },
    ];

    const keyframes = gsapAnimationsToKeyframes(animations, 2);

    expect(keyframes).toHaveLength(2);
    // First keyframe: time = 2 - 2 = 0
    expect(keyframes[0].time).toBe(0);
    expect(keyframes[0].properties.x).toBe(100);
    expect(keyframes[0].properties.y).toBe(200);
    // Second keyframe: time = 3 - 2 = 1
    expect(keyframes[1].time).toBe(1);
    expect(keyframes[1].properties.x).toBe(300);
    expect(keyframes[1].ease).toBe("power2.out");
  });

  it("filters supported props only", () => {
    const animations: GsapAnimation[] = [
      {
        id: "anim-1",
        targetSelector: "#el1",
        method: "to",
        position: 0,
        properties: { opacity: 1, x: 50, someUnsupportedProp: "value" } as Record<
          string,
          number | string
        >,
        duration: 1,
      },
    ];

    const keyframes = gsapAnimationsToKeyframes(animations, 0);

    expect(keyframes).toHaveLength(1);
    expect(keyframes[0].properties.opacity).toBe(1);
    expect(keyframes[0].properties.x).toBe(50);
    // String values are skipped (typeof value !== "number" check)
    expect(
      (keyframes[0].properties as Record<string, unknown>).someUnsupportedProp,
    ).toBeUndefined();
  });

  it("skips base set keyframes at time 0 when skipBaseSet is true", () => {
    const animations: GsapAnimation[] = [
      {
        id: "anim-1",
        targetSelector: "#el1",
        method: "set",
        position: 5,
        properties: { x: 0, y: 0 },
      },
      {
        id: "anim-2",
        targetSelector: "#el1",
        method: "to",
        position: 6,
        properties: { x: 100 },
        duration: 1,
      },
    ];

    const keyframes = gsapAnimationsToKeyframes(animations, 5, { skipBaseSet: true });

    expect(keyframes).toHaveLength(1);
    expect(keyframes[0].id).toBe("anim-2");
  });

  it("does NOT skip set keyframes when they have non-base values", () => {
    const animations: GsapAnimation[] = [
      {
        id: "anim-1",
        targetSelector: "#el1",
        method: "set",
        position: 5,
        properties: { x: 100, y: 0 },
      },
    ];

    const keyframes = gsapAnimationsToKeyframes(animations, 5, { skipBaseSet: true });

    // x=100 is non-base, so it should NOT be skipped
    expect(keyframes).toHaveLength(1);
    expect(keyframes[0].properties.x).toBe(100);
  });

  it("clamps negative time to zero by default", () => {
    const animations: GsapAnimation[] = [
      {
        id: "anim-1",
        targetSelector: "#el1",
        method: "set",
        position: 0,
        properties: { opacity: 1 },
      },
    ];

    // elementStartTime is 5, so relative time = 0 - 5 = -5
    const keyframes = gsapAnimationsToKeyframes(animations, 5);

    expect(keyframes[0].time).toBe(0); // Clamped to 0
  });

  it("adjusts x/y/scale relative to base values", () => {
    const animations: GsapAnimation[] = [
      {
        id: "anim-1",
        targetSelector: "#el1",
        method: "to",
        position: 2,
        properties: { x: 150, y: 200, scale: 2 },
        duration: 1,
      },
    ];

    const keyframes = gsapAnimationsToKeyframes(animations, 0, {
      baseX: 50,
      baseY: 100,
      baseScale: 2,
    });

    expect(keyframes[0].properties.x).toBe(100); // 150 - 50
    expect(keyframes[0].properties.y).toBe(100); // 200 - 100
    expect(keyframes[0].properties.scale).toBe(1); // 2 / 2
  });
});

describe("keyframesToGsapAnimations", () => {
  it("converts keyframes back to GSAP animations", () => {
    const keyframes: Keyframe[] = [
      { id: "kf-1", time: 0, properties: { opacity: 0 } },
      { id: "kf-2", time: 1, properties: { opacity: 1 }, ease: "power2.out" },
    ];

    const animations = keyframesToGsapAnimations("el1", keyframes, 2);

    expect(animations).toHaveLength(2);
    expect(animations[0].method).toBe("set");
    expect(animations[0].position).toBe(2); // elementStartTime + 0
    expect(animations[0].properties.opacity).toBe(0);
    expect(animations[1].method).toBe("to");
    expect(animations[1].position).toBe(2); // position of prev keyframe
    expect(animations[1].duration).toBe(1); // kf.time - prevKf.time
    expect(animations[1].ease).toBe("power2.out");
  });

  it("applies base x/y/scale offsets", () => {
    const keyframes: Keyframe[] = [{ id: "kf-1", time: 0, properties: { x: 10, y: 20, scale: 2 } }];

    const animations = keyframesToGsapAnimations("el1", keyframes, 0, {
      x: 50,
      y: 100,
      scale: 0.5,
    });

    expect(animations[0].properties.x).toBe(60); // baseX + value
    expect(animations[0].properties.y).toBe(120); // baseY + value
    expect(animations[0].properties.scale).toBe(1); // baseScale * value
  });
});

describe("serializeGsapAnimations", () => {
  it("serializes animations into a GSAP timeline script", () => {
    const animations: GsapAnimation[] = [
      {
        id: "anim-1",
        targetSelector: "#el1",
        method: "set",
        position: 0,
        properties: { opacity: 0 },
      },
      {
        id: "anim-2",
        targetSelector: "#el1",
        method: "to",
        position: 0.5,
        properties: { opacity: 1 },
        duration: 0.5,
        ease: "power2.out",
      },
    ];

    const result = serializeGsapAnimations(animations);

    expect(result).toContain("const tl = gsap.timeline({ paused: true });");
    expect(result).toContain('tl.set("#el1"');
    expect(result).toContain('tl.to("#el1"');
    expect(result).toContain("opacity: 0");
    expect(result).toContain("opacity: 1");
  });

  it("sorts animations by position", () => {
    const animations: GsapAnimation[] = [
      {
        id: "anim-2",
        targetSelector: "#el1",
        method: "to",
        position: 2,
        properties: { opacity: 1 },
        duration: 0.5,
      },
      {
        id: "anim-1",
        targetSelector: "#el1",
        method: "set",
        position: 0,
        properties: { opacity: 0 },
      },
    ];

    const result = serializeGsapAnimations(animations);

    const setIdx = result.indexOf("tl.set");
    const toIdx = result.indexOf("tl.to");
    expect(setIdx).toBeLessThan(toIdx);
  });

  it("serializes fromTo animations correctly", () => {
    const animations: GsapAnimation[] = [
      {
        id: "anim-1",
        targetSelector: "#el1",
        method: "fromTo",
        position: 0,
        properties: { opacity: 1 },
        fromProperties: { opacity: 0 },
        duration: 1,
      },
    ];

    const result = serializeGsapAnimations(animations);
    expect(result).toContain('tl.fromTo("#el1"');
  });

  it("uses custom timeline variable name", () => {
    const animations: GsapAnimation[] = [
      {
        id: "anim-1",
        targetSelector: "#el1",
        method: "set",
        position: 0,
        properties: { opacity: 0 },
      },
    ];

    const result = serializeGsapAnimations(animations, "myTimeline");
    expect(result).toContain("const myTimeline = gsap.timeline({ paused: true });");
    expect(result).toContain('myTimeline.set("#el1"');
  });
});

describe("validateCompositionGsap", () => {
  it("returns valid for clean scripts", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1, duration: 1 }, 0);
    `;
    const result = validateCompositionGsap(script);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("detects forbidden patterns", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1, duration: 1, onComplete: function() {} }, 0);
      setTimeout(function() {}, 100);
    `;
    const result = validateCompositionGsap(script);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("onComplete callback not allowed");
    expect(result.errors).toContain("setTimeout not allowed");
  });

  it("warns about yoyo and stagger", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to(".items", { x: 100, stagger: 0.1, yoyo: true, duration: 1 }, 0);
    `;
    const result = validateCompositionGsap(script);
    expect(result.warnings).toContain("yoyo animations may behave unexpectedly when scrubbing");
    expect(result.warnings).toContain("stagger animations may not serialize correctly");
  });

  it("detects infinite repeat", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1, duration: 1, repeat: -1 }, 0);
    `;
    const result = validateCompositionGsap(script);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Infinite repeat (repeat: -1) not allowed");
  });
});

describe("getAnimationsForElementId", () => {
  it("filters animations by element id", () => {
    const animations: GsapAnimation[] = [
      { id: "a1", targetSelector: "#el1", method: "set", position: 0, properties: { opacity: 0 } },
      {
        id: "a2",
        targetSelector: "#el2",
        method: "to",
        position: 0,
        properties: { opacity: 1 },
        duration: 1,
      },
      {
        id: "a3",
        targetSelector: "#el1",
        method: "to",
        position: 1,
        properties: { opacity: 1 },
        duration: 0.5,
      },
    ];

    const result = getAnimationsForElementId(animations, "el1");
    expect(result).toHaveLength(2);
    expect(result.every((a) => a.targetSelector === "#el1")).toBe(true);
  });

  it("returns empty array when no animations match", () => {
    const animations: GsapAnimation[] = [
      { id: "a1", targetSelector: "#el1", method: "set", position: 0, properties: { opacity: 0 } },
    ];

    const result = getAnimationsForElementId(animations, "el99");
    expect(result).toHaveLength(0);
  });
});

describe("mutation functions parse-fail safety", () => {
  const garbage = "this is not valid javascript @@@ {{{{";

  it("updateAnimationInScript returns original script on parse failure", () => {
    const result = updateAnimationInScript(garbage, "anim-1", { duration: 2 });
    expect(result).toBe(garbage);
  });

  it("addAnimationToScript returns original script on parse failure", () => {
    const result = addAnimationToScript(garbage, {
      targetSelector: "#el1",
      method: "to",
      position: 0,
      properties: { opacity: 1 },
      duration: 1,
    });
    expect(result.script).toBe(garbage);
    expect(result.id).toBe("");
  });

  it("removeAnimationFromScript returns original script on parse failure", () => {
    const result = removeAnimationFromScript(garbage, "anim-1");
    expect(result).toBe(garbage);
  });
});

describe("serializeGsapAnimations quote escaping", () => {
  it("escapes quotes and backslashes in string property values", () => {
    const animations: GsapAnimation[] = [
      {
        id: "anim-1",
        targetSelector: "#el1",
        method: "to",
        position: 0,
        properties: { content: 'say "hello"' },
        duration: 1,
      },
    ];

    const result = serializeGsapAnimations(animations);
    // JSON.stringify produces escaped quotes
    expect(result).toContain('content: "say \\"hello\\""');
  });

  it("escapes backslashes in string property values", () => {
    const animations: GsapAnimation[] = [
      {
        id: "anim-1",
        targetSelector: "#el1",
        method: "to",
        position: 0,
        properties: { path: "C:\\Users\\test" },
        duration: 1,
      },
    ];

    const result = serializeGsapAnimations(animations);
    expect(result).toContain('path: "C:\\\\Users\\\\test"');
  });

  it("serializes string position values correctly", () => {
    const animations: GsapAnimation[] = [
      {
        id: "anim-1",
        targetSelector: "#el1",
        method: "to",
        position: "+=1",
        properties: { opacity: 1 },
        duration: 0.5,
      },
    ];

    const result = serializeGsapAnimations(animations);
    expect(result).toContain('"+=1"');
  });
});

describe("SUPPORTED_PROPS", () => {
  it("includes expected properties", () => {
    expect(SUPPORTED_PROPS).toContain("opacity");
    expect(SUPPORTED_PROPS).toContain("x");
    expect(SUPPORTED_PROPS).toContain("y");
    expect(SUPPORTED_PROPS).toContain("scale");
    expect(SUPPORTED_PROPS).toContain("rotation");
    expect(SUPPORTED_PROPS).toContain("width");
    expect(SUPPORTED_PROPS).toContain("height");
  });
});

describe("SUPPORTED_EASES", () => {
  it("includes common easing functions", () => {
    expect(SUPPORTED_EASES).toContain("none");
    expect(SUPPORTED_EASES).toContain("power2.out");
    expect(SUPPORTED_EASES).toContain("bounce.out");
    expect(SUPPORTED_EASES).toContain("elastic.inOut");
  });
});

// ── Variable-target resolution + in-place mutation ──────────────────────────
//
// Real compositions (and everything the hyperframes skill generates) target
// tweens via element variables resolved from querySelector, wrapped in an IIFE,
// with gsap.set() calls interleaved between tl.to() calls. The parser must
// resolve those variable targets to selectors (read) and edits must preserve
// every surrounding statement (write).

const REAL_WORLD_SCRIPT = `(function () {
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });
  const root = document.querySelector('#cold-open');
  const kicker = root.querySelector(".co-kicker");
  const glyph = root.querySelector(".co-new");
  const items = root.querySelectorAll(".co-item");

  gsap.set(kicker, { y: 16, opacity: 0 });
  tl.to(kicker, { y: 0, opacity: 1, duration: 0.45, ease: "expo.out" }, 0.3);

  gsap.set(glyph, { rotationX: 90, opacity: 0 });
  tl.to(glyph, { rotationX: 0, opacity: 1, duration: 0.5, ease: "power3.inOut" }, 2.06);

  tl.to(items, { opacity: 1, duration: 0.4, stagger: 0.1 }, 1.0);

  window.__timelines["cold-open"] = tl;
})();`;

describe("variable-target resolution (querySelector pattern)", () => {
  it("resolves a const element variable to its selector", () => {
    const script = `
      const root = document.querySelector('#scene');
      const kicker = root.querySelector(".co-kicker");
      const tl = gsap.timeline({ paused: true });
      tl.to(kicker, { y: 0, opacity: 1, duration: 0.45, ease: "expo.out" }, 0.3);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].targetSelector).toBe(".co-kicker");
    expect(result.animations[0].properties.opacity).toBe(1);
    expect(result.animations[0].duration).toBe(0.45);
    expect(result.animations[0].ease).toBe("expo.out");
  });

  it("resolves document.querySelector and querySelectorAll targets", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      const title = document.querySelector("#title");
      const items = document.querySelectorAll(".item");
      tl.to(title, { opacity: 1, duration: 0.5 }, 0);
      tl.to(items, { y: 0, duration: 0.5, stagger: 0.1 }, 0.5);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(2);
    expect(result.animations[0].targetSelector).toBe("#title");
    expect(result.animations[1].targetSelector).toBe(".item");
  });

  it("resolves getElementById targets to an id selector", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      const el = document.getElementById("hero");
      tl.to(el, { opacity: 1, duration: 0.5 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].targetSelector).toBe("#hero");
  });

  it("resolves an inline querySelector call passed directly as the target", () => {
    const script = `
      const root = document.querySelector('#scene');
      const tl = gsap.timeline({ paused: true });
      tl.to(root.querySelector(".inline"), { opacity: 1, duration: 0.5 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].targetSelector).toBe(".inline");
  });

  it("parses mixed string-literal and variable targets in one timeline", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      const kicker = document.querySelector(".kicker");
      tl.to(".literal", { opacity: 1, duration: 0.5 }, 0);
      tl.to(kicker, { y: 0, duration: 0.5 }, 0.5);
    `;
    const result = parseGsapScript(script);
    expect(result.animations.map((a) => a.targetSelector)).toEqual([".literal", ".kicker"]);
  });

  it("parses every tween in a real-world IIFE composition with interleaved gsap.set", () => {
    const result = parseGsapScript(REAL_WORLD_SCRIPT);
    expect(result.animations.map((a) => a.targetSelector)).toEqual([
      ".co-kicker",
      ".co-new",
      ".co-item",
    ]);
    // stagger preserved as extras
    expect(result.animations[2].extras?.stagger).toBe("__raw:0.1");
  });

  it("marks unresolvable variable targets with __unresolved__ and hasUnresolvedSelector", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to(someUnknownThing, { opacity: 1, duration: 0.5 }, 0);
      tl.to(".real", { opacity: 1, duration: 0.5 }, 1);
    `;
    const result = parseGsapScript(script);
    expect(result.animations.map((a) => a.targetSelector)).toEqual(["__unresolved__", ".real"]);
    expect(result.animations[0].hasUnresolvedSelector).toBe(true);
    expect(result.animations[1].hasUnresolvedSelector).toBeUndefined();
  });
});

describe("in-place AST mutation preserves surrounding code", () => {
  it("updateAnimationInScript edits one tween and preserves gsap.set + var decls + IIFE", () => {
    const parsed = parseGsapScript(REAL_WORLD_SCRIPT);
    const kickerAnim = parsed.animations.find((a) => a.targetSelector === ".co-kicker")!;
    const updated = updateAnimationInScript(REAL_WORLD_SCRIPT, kickerAnim.id, {
      properties: { y: 0, opacity: 0.5 },
    });

    // The edit landed
    expect(updated).toContain("opacity: 0.5");
    // Surrounding code survived verbatim
    expect(updated).toContain('const kicker = root.querySelector(".co-kicker")');
    expect(updated).toContain("gsap.set(kicker, { y: 16, opacity: 0 })");
    expect(updated).toContain("gsap.set(glyph, { rotationX: 90, opacity: 0 })");
    expect(updated).toContain('window.__timelines["cold-open"] = tl;');
    expect(updated).toContain("(function () {");
    // The variable target was NOT rewritten to a string literal
    expect(updated).toContain("tl.to(kicker,");
    expect(updated).not.toContain('tl.to(".co-kicker"');
    // The other tweens are untouched
    expect(updated).toContain("tl.to(glyph,");
    expect(updated).toContain("tl.to(items,");
  });

  it("updateAnimationInScript re-parses to the edited value (round-trip)", () => {
    const parsed = parseGsapScript(REAL_WORLD_SCRIPT);
    const glyphAnim = parsed.animations.find((a) => a.targetSelector === ".co-new")!;
    const updated = updateAnimationInScript(REAL_WORLD_SCRIPT, glyphAnim.id, {
      properties: { rotationX: 0, opacity: 1, scale: 1.2 },
    });
    const reparsed = parseGsapScript(updated);
    const reGlyph = reparsed.animations.find((a) => a.targetSelector === ".co-new")!;
    expect(reGlyph.properties.scale).toBe(1.2);
    // unrelated tweens still present
    expect(reparsed.animations).toHaveLength(3);
  });

  it("update-meta edits duration/ease/position in place", () => {
    const parsed = parseGsapScript(REAL_WORLD_SCRIPT);
    const kickerAnim = parsed.animations.find((a) => a.targetSelector === ".co-kicker")!;
    const updated = updateAnimationInScript(REAL_WORLD_SCRIPT, kickerAnim.id, {
      duration: 0.9,
      ease: "power1.in",
    });
    const reparsed = parseGsapScript(updated);
    const reKicker = reparsed.animations.find((a) => a.targetSelector === ".co-kicker")!;
    expect(reKicker.duration).toBe(0.9);
    expect(reKicker.ease).toBe("power1.in");
    // surrounding code intact
    expect(updated).toContain("gsap.set(kicker, { y: 16, opacity: 0 })");
  });

  it("removeAnimationFromScript removes one tween and keeps the rest + setup", () => {
    const parsed = parseGsapScript(REAL_WORLD_SCRIPT);
    const glyphAnim = parsed.animations.find((a) => a.targetSelector === ".co-new")!;
    const updated = removeAnimationFromScript(REAL_WORLD_SCRIPT, glyphAnim.id);
    const reparsed = parseGsapScript(updated);
    expect(reparsed.animations.map((a) => a.targetSelector)).toEqual([".co-kicker", ".co-item"]);
    // the removed tween's gsap.set setup is left untouched (not the parser's job to remove)
    expect(updated).toContain('const kicker = root.querySelector(".co-kicker")');
    expect(updated).toContain('window.__timelines["cold-open"] = tl;');
  });

  it("addAnimationToScript inserts a tween and preserves the IIFE body", () => {
    const { script: updated, id } = addAnimationToScript(REAL_WORLD_SCRIPT, {
      targetSelector: "#new-el",
      method: "to",
      position: 3,
      duration: 0.5,
      ease: "power2.out",
      properties: { opacity: 1 },
    });
    expect(id).not.toBe("");
    expect(updated).toContain('window.__timelines["cold-open"] = tl;');
    expect(updated).toContain('const kicker = root.querySelector(".co-kicker")');
    const reparsed = parseGsapScript(updated);
    expect(reparsed.animations.some((a) => a.targetSelector === "#new-el")).toBe(true);
    expect(reparsed.animations).toHaveLength(4);
  });

  it("still edits classic string-literal timelines in place", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1, duration: 0.5 }, 0);
      tl.to("#el2", { x: 100, duration: 1 }, 1);
    `;
    const parsed = parseGsapScript(script);
    const updated = updateAnimationInScript(script, parsed.animations[0].id, {
      properties: { opacity: 0.25 },
    });
    expect(updated).toContain("opacity: 0.25");
    // second tween untouched
    expect(updated).toContain('tl.to("#el2", { x: 100, duration: 1 }, 1)');
  });
});

// ── Advanced target resolution + chained calls (editor limitations) ─────────

describe("array targets", () => {
  it("resolves an array of element variables to a CSS group selector", () => {
    const script = `
      const root = document.querySelector('#s');
      const face = root.querySelector(".clock-face");
      const hand = root.querySelector(".clock-hand");
      const tl = gsap.timeline({ paused: true });
      tl.to([face, hand], { opacity: 1, duration: 0.5 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].targetSelector).toBe(".clock-face, .clock-hand");
  });

  it("does not rewrite the array argument when editing the tween", () => {
    const script = `
      const a = document.querySelector(".a");
      const b = document.querySelector(".b");
      const tl = gsap.timeline({ paused: true });
      tl.to([a, b], { opacity: 1, duration: 0.5 }, 0);
    `;
    const parsed = parseGsapScript(script);
    const updated = updateAnimationInScript(script, parsed.animations[0].id, {
      properties: { opacity: 0.3 },
    });
    expect(updated).toContain("tl.to([a, b],");
    expect(updated).toContain("opacity: 0.3");
  });
});

describe("chained tween calls", () => {
  const CHAIN = `
    const tl = gsap.timeline({ paused: true });
    const flash = document.querySelector(".flash");
    tl.to(flash, { opacity: 0.5, duration: 0.16 }, 2.06)
      .to(flash, { opacity: 0, duration: 0.5 }, 2.22);
  `;

  it("captures every link of a chained call", () => {
    const result = parseGsapScript(CHAIN);
    expect(result.animations).toHaveLength(2);
    expect(result.animations.every((a) => a.targetSelector === ".flash")).toBe(true);
    expect(result.animations.map((a) => a.position).sort()).toEqual([2.06, 2.22]);
  });

  it("edits one link of a chain in place, leaving the other intact", () => {
    const parsed = parseGsapScript(CHAIN);
    const second = parsed.animations.find((a) => a.position === 2.22)!;
    const updated = updateAnimationInScript(CHAIN, second.id, { properties: { opacity: 0.9 } });
    expect(updated).toContain("opacity: 0.9");
    expect(updated).toContain("opacity: 0.5"); // first link untouched
  });

  it("deletes one link of a chain, keeping the other (chain-aware removal)", () => {
    const parsed = parseGsapScript(CHAIN);
    const first = parsed.animations.find((a) => a.position === 2.06)!;
    const updated = removeAnimationFromScript(CHAIN, first.id);
    const reparsed = parseGsapScript(updated);
    expect(reparsed.animations).toHaveLength(1);
    expect(reparsed.animations[0].position).toBe(2.22);
  });
});

describe("gsap.utils.toArray targets", () => {
  it("resolves an inline toArray selector", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to(gsap.utils.toArray(".item"), { opacity: 1, duration: 0.5, stagger: 0.1 }, 0);
    `;
    const anim = parseSingleAnimation(script);
    expect(anim.targetSelector).toBe(".item");
  });

  it("resolves a toArray result stored in a variable", () => {
    const script = `
      const items = gsap.utils.toArray(".item");
      const tl = gsap.timeline({ paused: true });
      tl.to(items, { opacity: 1, duration: 0.5 }, 0);
    `;
    const anim = parseSingleAnimation(script);
    expect(anim.targetSelector).toBe(".item");
  });
});

describe("lexical scoping of element bindings", () => {
  it("resolves the same variable name to different selectors per IIFE scope", () => {
    const script = `
      (function () {
        const tl = gsap.timeline({ paused: true });
        const kicker = document.querySelector(".scene-a-kicker");
        tl.to(kicker, { opacity: 1, duration: 0.5 }, 0);
      })();
      (function () {
        const tl = gsap.timeline({ paused: true });
        const kicker = document.querySelector(".scene-b-kicker");
        tl.to(kicker, { opacity: 1, duration: 0.5 }, 0);
      })();
    `;
    const result = parseGsapScript(script);
    const selectors = result.animations.map((a) => a.targetSelector);
    expect(selectors).toContain(".scene-a-kicker");
    expect(selectors).toContain(".scene-b-kicker");
  });
});

describe("forEach / map callback targets", () => {
  it("resolves a forEach callback param to the collection's selector", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      const items = document.querySelectorAll(".item");
      items.forEach((el) => {
        tl.to(el, { opacity: 1, duration: 0.4 }, 0);
      });
    `;
    const anim = parseSingleAnimation(script);
    expect(anim.targetSelector).toBe(".item");
  });

  it("resolves an inline querySelectorAll().forEach callback param", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      document.querySelectorAll(".dot").forEach((dot) => {
        tl.to(dot, { scale: 1, duration: 0.3 }, 0);
      });
    `;
    const anim = parseSingleAnimation(script);
    expect(anim.targetSelector).toBe(".dot");
  });
});

describe("fromTo in-place mutation", () => {
  const FROMTO = `
    const tl = gsap.timeline({ paused: true });
    const ring = document.querySelector(".ring");
    tl.fromTo(ring, { scale: 0.6, opacity: 0.65 }, { scale: 2.2, opacity: 0, duration: 0.8 }, 2.08);
  `;

  it("edits the to-vars of a fromTo in place", () => {
    const parsed = parseGsapScript(FROMTO);
    const updated = updateAnimationInScript(FROMTO, parsed.animations[0].id, {
      properties: { scale: 3, opacity: 0 },
    });
    expect(updated).toContain("scale: 3");
    // from-vars left intact, target not flattened
    expect(updated).toContain("{ scale: 0.6, opacity: 0.65 }");
    expect(updated).toContain("tl.fromTo(ring,");
  });

  it("edits the from-vars of a fromTo in place", () => {
    const parsed = parseGsapScript(FROMTO);
    const updated = updateAnimationInScript(FROMTO, parsed.animations[0].id, {
      fromProperties: { scale: 0.2, opacity: 1 },
    });
    const reparsed = parseGsapScript(updated);
    expect(reparsed.animations[0].fromProperties?.scale).toBe(0.2);
    // to-vars untouched
    expect(reparsed.animations[0].properties.scale).toBe(2.2);
  });
});

// ── Native GSAP keyframes parsing ──────────────────────────────────────────

describe("native GSAP keyframes parsing", () => {
  it("parses percentage keyframes format", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", {
        keyframes: { "0%": { x: 0, opacity: 1 }, "50%": { x: 100, ease: "power2.out" }, "100%": { x: 200 } },
        duration: 5
      }, 0);
    `;
    const anim = parseSingleAnimation(script);
    const kfs = expectKeyframesFormat(anim, "percentage", 3);

    expectKeyframe(kfs[0], 0, { x: 0, opacity: 1 });
    expectKeyframe(kfs[1], 50, { x: 100 }, "power2.out");
    expectKeyframe(kfs[2], 100, { x: 200 });
  });

  it("parses object array keyframes format", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", {
        keyframes: [
          { x: 0, opacity: 1, duration: 0.5 },
          { x: 100, duration: 1, ease: "power2.out" },
          { x: 200, duration: 0.8 }
        ]
      }, 0);
    `;
    const anim = parseSingleAnimation(script);
    const kfs = expectKeyframesFormat(anim, "object-array", 3);

    // Total duration = 0.5 + 1 + 0.8 = 2.3
    // First: cumulative = 0.5, pct = round(0.5/2.3 * 100) = 22
    expectKeyframe(kfs[0], 22, { x: 0, opacity: 1 });
    // Second: cumulative = 1.5, pct = round(1.5/2.3 * 100) = 65
    expectKeyframe(kfs[1], 65, { x: 100 }, "power2.out");
    // Third: cumulative = 2.3, pct = round(2.3/2.3 * 100) = 100
    expectKeyframe(kfs[2], 100, { x: 200 });
  });

  it("parses simple array keyframes format", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", {
        keyframes: { x: [0, 100, 200, 0], opacity: [0, 1, 1, 0], easeEach: "power2.inOut" },
        duration: 5
      }, 0);
    `;
    const anim = parseSingleAnimation(script);
    expect(anim.keyframes).toBeDefined();
    expect(anim.keyframes!.format).toBe("simple-array");
    expect(anim.keyframes!.easeEach).toBe("power2.inOut");
    expect(anim.keyframes!.keyframes).toHaveLength(4);

    // Evenly spaced: 0%, 33%, 67%, 100%
    expectKeyframe(anim.keyframes!.keyframes[0], 0, { x: 0, opacity: 0 });
    expectKeyframe(anim.keyframes!.keyframes[1], 33, { x: 100, opacity: 1 });
    expectKeyframe(anim.keyframes!.keyframes[2], 67, { x: 200, opacity: 1 });
    expectKeyframe(anim.keyframes!.keyframes[3], 100, { x: 0, opacity: 0 });
  });

  it("parses three-level easing", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", {
        keyframes: { "0%": { x: 0 }, "50%": { x: 100, ease: "back.out(1.7)" }, "100%": { x: 200 } },
        ease: "none",
        easeEach: "power2.out",
        duration: 5
      }, 0);
    `;
    const result = parseGsapScript(script);
    const anim = result.animations[0];

    // Tween-level ease
    expect(anim.ease).toBe("none");
    // easeEach on keyframes data (set from tween-level)
    expect(anim.keyframes!.easeEach).toBe("power2.out");
    // Per-keyframe ease
    expect(anim.keyframes!.keyframes[1].ease).toBe("back.out(1.7)");
  });

  it("flat tween without keyframes still works", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: 100, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].keyframes).toBeUndefined();
    expect(result.animations[0].properties.x).toBe(100);
  });

  it("keyframes tween has empty top-level properties", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", {
        keyframes: { "0%": { x: 0 }, "100%": { x: 200 } },
        duration: 5
      }, 0);
    `;
    const result = parseGsapScript(script);
    const anim = result.animations[0];
    expect(anim.keyframes).toBeDefined();
    expect(Object.keys(anim.properties)).toHaveLength(0);
  });
});

// ── Keyframe mutation functions ───────────────────────────────────────────

describe("keyframe mutations", () => {
  const KF_SCRIPT = `
    const tl = gsap.timeline({ paused: true });
    tl.to("#hero", {
      keyframes: { "0%": { x: 0, opacity: 0 }, "100%": { x: 200, opacity: 1 } },
      duration: 2
    }, 0);
  `;

  const KF_SCRIPT_3 = `
    const tl = gsap.timeline({ paused: true });
    tl.to("#hero", {
      keyframes: { "0%": { x: 0 }, "50%": { x: 100 }, "100%": { x: 200 } },
      duration: 2
    }, 0);
  `;

  function getAnimId(script: string): string {
    return parseGsapScript(script).animations[0].id;
  }

  // ── addKeyframeToScript ─────────────────────────────────────────────────

  it("addKeyframeToScript — inserts at sorted position", () => {
    const id = getAnimId(KF_SCRIPT);
    const updated = addKeyframeToScript(KF_SCRIPT, id, 50, { x: 100 });
    const reparsed = parseGsapScript(updated);
    const kfs = reparsed.animations[0].keyframes!.keyframes;
    expect(kfs).toHaveLength(3);
    expect(kfs.map((k) => k.percentage)).toEqual([0, 50, 100]);
    expect(kfs[1].properties.x).toBe(100);
  });

  it("addKeyframeToScript — updates existing percentage", () => {
    const id = getAnimId(KF_SCRIPT_3);
    const updated = addKeyframeToScript(KF_SCRIPT_3, id, 50, { x: 999 });
    const reparsed = parseGsapScript(updated);
    const kfs = reparsed.animations[0].keyframes!.keyframes;
    expect(kfs).toHaveLength(3);
    expect(kfs[1].percentage).toBe(50);
    expect(kfs[1].properties.x).toBe(999);
  });

  it("addKeyframeToScript — preserves exactly one ease when updating an eased keyframe", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", {
        keyframes: { "0%": { scale: 1 }, "60%": { scale: 1.18, ease: "power2.out" }, "100%": { scale: 1 } },
        duration: 2
      }, 0);
    `;
    const id = getAnimId(script);
    const updated = addKeyframeToScript(script, id, 60, { scale: 1.18, x: 10, y: 20 });
    const reparsed = parseGsapScript(updated);
    const keyframe = reparsed.animations[0].keyframes!.keyframes.find(
      (kf) => kf.percentage === 60,
    )!;

    expect((updated.match(/ease:\s*"power2\.out"/g) ?? []).length).toBe(1);
    expect(keyframe.ease).toBe("power2.out");
    expect(keyframe.properties).toMatchObject({ scale: 1.18, x: 10, y: 20 });
  });

  // ── backfillDefaults: editing one keyframe must not move the others ──────
  // UX invariant (CapCut/AE): keyframes are independent. Introducing a property
  // to one keyframe (e.g. `y` on an x-only tween) must backfill the other
  // keyframes at the element's base value — otherwise GSAP holds the new prop's
  // value across keyframes that omit it, dragging them to the same position.
  const X_ONLY_SCRIPT = `
    const tl = gsap.timeline({ paused: true });
    tl.to("#puck", { keyframes: { "0%": { x: 0 }, "100%": { x: -260 } }, duration: 2.2 }, 1.2);
  `;

  it("addKeyframeToScript — WITHOUT backfill, the other keyframe omits the new prop (GSAP would hold it)", () => {
    const id = getAnimId(X_ONLY_SCRIPT);
    const updated = addKeyframeToScript(X_ONLY_SCRIPT, id, 0, { x: 240, y: 780 });
    const kfs = parseGsapScript(updated).animations[0].keyframes!.keyframes;
    const kf100 = kfs.find((k) => k.percentage === 100)!;
    expect(kf100.properties.x).toBe(-260);
    expect("y" in kf100.properties).toBe(false); // <- the bug surface
  });

  it("addKeyframeToScript — WITH backfill, the new prop is added to the other keyframe at base (it stays put)", () => {
    const id = getAnimId(X_ONLY_SCRIPT);
    const updated = addKeyframeToScript(X_ONLY_SCRIPT, id, 0, { x: 240, y: 780 }, undefined, {
      x: 0,
      y: 0,
    });
    const kfs = parseGsapScript(updated).animations[0].keyframes!.keyframes;
    const kf0 = kfs.find((k) => k.percentage === 0)!;
    const kf100 = kfs.find((k) => k.percentage === 100)!;
    // edited keyframe holds the drag
    expect(kf0.properties).toMatchObject({ x: 240, y: 780 });
    // other keyframe keeps its own x and gets y at base (0) — not 780
    expect(kf100.properties.x).toBe(-260);
    expect(kf100.properties.y).toBe(0);
  });

  // ── syncPositionHoldsBeforeKeyframes (hold before first keyframe) ────────
  // UX invariant (every NLE): before the first keyframe, the element holds that
  // keyframe's value — it must NOT snap to its CSS base then jump when the tween
  // starts. Implemented as a tagged `tl.set(...,0)` kept in sync with the tween.
  describe("syncPositionHoldsBeforeKeyframes", () => {
    const posTweenAt = (start: number) =>
      `const tl = gsap.timeline({ paused: true });\n` +
      `tl.to("#p", { keyframes: { "0%": { x: -1500, y: 700 }, "100%": { x: -260, y: 0 } }, duration: 2.2 }, ${start});`;

    it("inserts a hold set holding the first keyframe's position at t=0", () => {
      const out = syncPositionHoldsBeforeKeyframes(posTweenAt(1.2));
      const anims = parseGsapScript(out).animations;
      const hold = anims.find((a) => a.method === "set");
      expect(hold).toBeDefined();
      expect(hold!.position).toBe(0);
      expect(hold!.properties).toMatchObject({ x: -1500, y: 700 });
    });

    it("is idempotent (re-running does not stack holds)", () => {
      const once = syncPositionHoldsBeforeKeyframes(posTweenAt(1.2));
      expect(syncPositionHoldsBeforeKeyframes(once)).toBe(once);
      expect((once.match(/hf-hold/g) ?? []).length).toBe(1);
    });

    it("re-syncs the hold value when the first keyframe changes", () => {
      const out1 = syncPositionHoldsBeforeKeyframes(posTweenAt(1.2));
      const moved = updateKeyframeInScript(
        out1,
        parseGsapScript(out1).animations.find((a) => a.keyframes)!.id,
        0,
        { x: 99, y: 88 },
      );
      const out2 = syncPositionHoldsBeforeKeyframes(moved);
      const hold = parseGsapScript(out2).animations.find((a) => a.method === "set");
      expect(hold!.properties).toMatchObject({ x: 99, y: 88 });
      expect((out2.match(/hf-hold/g) ?? []).length).toBe(1); // still just one
    });

    it("adds no hold for a tween that already starts at t=0", () => {
      expect(syncPositionHoldsBeforeKeyframes(posTweenAt(0))).not.toContain("hf-hold");
    });

    it("adds no hold for an opacity-only keyframed tween (position-scoped)", () => {
      const opacity =
        `const tl = gsap.timeline({ paused: true });\n` +
        `tl.to("#b", { keyframes: { "0%": { opacity: 0 }, "100%": { opacity: 1 } }, duration: 1 }, 2);`;
      expect(syncPositionHoldsBeforeKeyframes(opacity)).not.toContain("hf-hold");
    });

    it("removes an orphaned hold when its tween is gone", () => {
      const withHold = syncPositionHoldsBeforeKeyframes(posTweenAt(1.2));
      const tweenId = parseGsapScript(withHold).animations.find((a) => a.keyframes)!.id;
      const deleted = removeAnimationFromScript(withHold, tweenId);
      expect(syncPositionHoldsBeforeKeyframes(deleted)).not.toContain("hf-hold");
    });
  });

  // ── _auto endpoint updates ────────────────────────────────────────────

  const AUTO_SCRIPT = `
    const tl = gsap.timeline({ paused: true });
    tl.to("#hero", {
      keyframes: { "0%": { x: 0, y: 0, _auto: 1 }, "100%": { x: 200, y: 100, _auto: 1 } },
      duration: 2
    }, 0);
  `;

  const AUTO_5KF_SCRIPT = `
    const tl = gsap.timeline({ paused: true });
    tl.to("#hero", {
      keyframes: {
        "0%": { x: 0, y: 0, _auto: 1 },
        "25%": { x: 50, y: 25 },
        "50%": { x: 100, y: 50 },
        "75%": { x: 150, y: 75 },
        "100%": { x: 200, y: 100, _auto: 1 }
      },
      duration: 2
    }, 0);
  `;

  it("addKeyframe adjacent to auto 100% — updates 100%", () => {
    const id = getAnimId(AUTO_SCRIPT);
    const updated = addKeyframeToScript(AUTO_SCRIPT, id, 50, { x: 300, y: 200 });
    const kfs = parseGsapScript(updated).animations[0].keyframes!.keyframes;
    const kf100 = kfs.find((k) => k.percentage === 100)!;
    expect(kf100.properties.x).toBe(300);
    expect(kf100.properties.y).toBe(200);
  });

  it("addKeyframe adjacent to auto 0% — updates 0%", () => {
    const id = getAnimId(AUTO_SCRIPT);
    const updated = addKeyframeToScript(AUTO_SCRIPT, id, 50, { x: 300, y: 200 });
    const kfs = parseGsapScript(updated).animations[0].keyframes!.keyframes;
    const kf0 = kfs.find((k) => k.percentage === 0)!;
    expect(kf0.properties.x).toBe(300);
    expect(kf0.properties.y).toBe(200);
  });

  it("addKeyframe NOT adjacent to auto 100% — leaves 100% untouched", () => {
    const id = getAnimId(AUTO_5KF_SCRIPT);
    const updated = addKeyframeToScript(AUTO_5KF_SCRIPT, id, 74, { x: 999, y: 888 });
    const kfs = parseGsapScript(updated).animations[0].keyframes!.keyframes;
    const kf100 = kfs.find((k) => k.percentage === 100)!;
    expect(kf100.properties.x).toBe(200);
    expect(kf100.properties.y).toBe(100);
  });

  it("addKeyframe NOT adjacent to auto 0% — leaves 0% untouched", () => {
    const id = getAnimId(AUTO_5KF_SCRIPT);
    const updated = addKeyframeToScript(AUTO_5KF_SCRIPT, id, 30, { x: 999, y: 888 });
    const kfs = parseGsapScript(updated).animations[0].keyframes!.keyframes;
    const kf0 = kfs.find((k) => k.percentage === 0)!;
    expect(kf0.properties.x).toBe(0);
    expect(kf0.properties.y).toBe(0);
  });

  it("addKeyframe at 88% in 5-keyframe set — updates adjacent 100% only", () => {
    const id = getAnimId(AUTO_5KF_SCRIPT);
    const updated = addKeyframeToScript(AUTO_5KF_SCRIPT, id, 88, { x: 500, y: 400 });
    const kfs = parseGsapScript(updated).animations[0].keyframes!.keyframes;
    const kf100 = kfs.find((k) => k.percentage === 100)!;
    const kf0 = kfs.find((k) => k.percentage === 0)!;
    expect(kf100.properties.x).toBe(500);
    expect(kf0.properties.x).toBe(0);
  });

  it("addKeyframe at 12% in 5-keyframe set — updates adjacent 0% only", () => {
    const id = getAnimId(AUTO_5KF_SCRIPT);
    const updated = addKeyframeToScript(AUTO_5KF_SCRIPT, id, 12, { x: 500, y: 400 });
    const kfs = parseGsapScript(updated).animations[0].keyframes!.keyframes;
    const kf0 = kfs.find((k) => k.percentage === 0)!;
    const kf100 = kfs.find((k) => k.percentage === 100)!;
    expect(kf0.properties.x).toBe(500);
    expect(kf100.properties.x).toBe(200);
  });

  it("non-auto 100% is never modified", () => {
    const id = getAnimId(KF_SCRIPT);
    const updated = addKeyframeToScript(KF_SCRIPT, id, 50, { x: 999 });
    const kfs = parseGsapScript(updated).animations[0].keyframes!.keyframes;
    const kf100 = kfs.find((k) => k.percentage === 100)!;
    expect(kf100.properties.x).toBe(200);
    expect(kf100.properties.opacity).toBe(1);
  });

  // ── removeKeyframeFromScript ────────────────────────────────────────────

  it("removeKeyframeFromScript — removes one keyframe", () => {
    const id = getAnimId(KF_SCRIPT_3);
    const updated = removeKeyframeFromScript(KF_SCRIPT_3, id, 50);
    const reparsed = parseGsapScript(updated);
    const kfs = reparsed.animations[0].keyframes!.keyframes;
    expect(kfs).toHaveLength(2);
    expect(kfs.map((k) => k.percentage)).toEqual([0, 100]);
  });

  it("removeKeyframeFromScript — collapses to flat when <2 remain", () => {
    const id = getAnimId(KF_SCRIPT);
    const updated = removeKeyframeFromScript(KF_SCRIPT, id, 100);
    const reparsed = parseGsapScript(updated);
    const anim = reparsed.animations[0];
    expect(anim.keyframes).toBeUndefined();
    expect(anim.properties.x).toBe(0);
    expect(anim.properties.opacity).toBe(0);
  });

  // ── updateKeyframeInScript ──────────────────────────────────────────────

  it("updateKeyframeInScript — replaces properties", () => {
    const id = getAnimId(KF_SCRIPT);
    const updated = updateKeyframeInScript(KF_SCRIPT, id, 100, { x: 300, y: 50 });
    const reparsed = parseGsapScript(updated);
    const kf100 = reparsed.animations[0].keyframes!.keyframes.find((k) => k.percentage === 100)!;
    expect(kf100.properties.x).toBe(300);
    expect(kf100.properties.y).toBe(50);
  });

  it("updateKeyframeInScript — ease-only update preserves existing properties", () => {
    // Per-keyframe ease editing passes empty properties + an ease. The existing
    // property bag must survive (don't wipe x/opacity when only the ease changes).
    const id = getAnimId(KF_SCRIPT);
    const updated = updateKeyframeInScript(KF_SCRIPT, id, 100, {}, "power2.inOut");
    const kf100 = parseGsapScript(updated).animations[0].keyframes!.keyframes.find(
      (k) => k.percentage === 100,
    )!;
    expect(kf100.ease).toBe("power2.inOut");
    expect(kf100.properties.x).toBe(200);
    expect(kf100.properties.opacity).toBe(1);
  });

  // Array-form keyframes (`keyframes: [{x,y}, …]`) carry no percentages — GSAP
  // distributes them evenly. The motion-path overlay drags/adds by percentage,
  // which used to no-op on array-authored tweens (#puck-b / #shuttle).
  const ARRAY_KF_SCRIPT =
    "const tl = gsap.timeline();\n" +
    'tl.to("#shuttle", { keyframes: [{ x: 0, y: 0 }, { x: 520, y: 120 }, { x: 1040, y: 0 }, { x: 1480, y: 160 }], duration: 4.4, ease: "none" }, 5.2);';

  it("updateKeyframeInScript — array-form: drags node 2 (pct 33.3) by index", () => {
    const id = getAnimId(ARRAY_KF_SCRIPT);
    const updated = updateKeyframeInScript(ARRAY_KF_SCRIPT, id, 33.3, { x: 503, y: 642 });
    expect(updated).not.toBe(ARRAY_KF_SCRIPT);
    const kf = parseGsapScript(updated).animations[0].keyframes!.keyframes;
    expect([kf[1]!.properties.x, kf[1]!.properties.y]).toEqual([503, 642]);
    expect([kf[0]!.properties.x, kf[0]!.properties.y]).toEqual([0, 0]);
    expect([kf[2]!.properties.x, kf[2]!.properties.y]).toEqual([1040, 0]);
  });

  it("addKeyframeToScript — array-form: normalizes to object form + inserts 50%", () => {
    const id = getAnimId(ARRAY_KF_SCRIPT);
    const updated = addKeyframeToScript(ARRAY_KF_SCRIPT, id, 50, { x: 780, y: 60 });
    expect(updated).not.toBe(ARRAY_KF_SCRIPT);
    const kf = parseGsapScript(updated).animations[0].keyframes!.keyframes;
    expect(kf.length).toBe(5);
    const at50 = kf.find((k) => Math.abs(k.percentage - 50) < 1)!;
    expect([at50.properties.x, at50.properties.y]).toEqual([780, 60]);
  });

  it("removeKeyframeFromScript — array-form: drops node 3 (pct 66.7)", () => {
    const id = getAnimId(ARRAY_KF_SCRIPT);
    const updated = removeKeyframeFromScript(ARRAY_KF_SCRIPT, id, 66.7);
    expect(updated).not.toBe(ARRAY_KF_SCRIPT);
    const kf = parseGsapScript(updated).animations[0].keyframes!.keyframes;
    expect(kf.length).toBe(3);
  });

  it("updateKeyframeInScript — stale position-id resolves to the nearest same-selector tween", () => {
    // Tween authored at 1.0s → id "#el-to-1000-position". A client that cached the
    // pre-reposition id "#el-to-1200-position" (a gesture/convert moved it) must
    // still resolve, instead of no-op'ing.
    const script =
      "const tl = gsap.timeline();\n" +
      'tl.to("#el", { keyframes: { "0%": { x: 0, y: 0 }, "100%": { x: 50, y: 50 } }, duration: 2 }, 1);';
    const updated = updateKeyframeInScript(script, "#el-to-1200-position", 100, { x: 77, y: 88 });
    expect(updated).not.toBe(script);
    const at100 = parseGsapScript(updated).animations[0].keyframes!.keyframes.find(
      (k) => k.percentage === 100,
    )!;
    expect([at100.properties.x, at100.properties.y]).toEqual([77, 88]);
  });

  // ── updateMotionPathPointInScript ───────────────────────────────────────

  const MOTION_PATH_SCRIPT = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", {
        motionPath: {
          path: [{x: 0, y: 0}, {x: 200, y: -100}, {x: 400, y: 50}],
          curviness: 1.5
        },
        duration: 2
      }, 0);
    `;

  it("updateMotionPathPointInScript — moves one waypoint, preserves the rest and curviness", () => {
    const id = getAnimId(MOTION_PATH_SCRIPT);
    const updated = updateMotionPathPointInScript(MOTION_PATH_SCRIPT, id, 1, { x: 250, y: -140 });
    const reparsed = parseGsapScript(updated);
    const anim = reparsed.animations[0];
    const wp = anim.keyframes!.keyframes;
    expect(wp.map((k) => [k.properties.x, k.properties.y])).toEqual([
      [0, 0],
      [250, -140],
      [400, 50],
    ]);
    expect(anim.arcPath!.segments[0].curviness).toBe(1.5);
    expect(anim.arcPath!.segments[1].curviness).toBe(1.5);
  });

  it("updateMotionPathPointInScript — out-of-range index leaves the script unchanged", () => {
    const id = getAnimId(MOTION_PATH_SCRIPT);
    expect(updateMotionPathPointInScript(MOTION_PATH_SCRIPT, id, 9, { x: 1, y: 1 })).toBe(
      MOTION_PATH_SCRIPT,
    );
  });

  it("updateMotionPathPointInScript — unknown animation id leaves the script unchanged", () => {
    expect(updateMotionPathPointInScript(MOTION_PATH_SCRIPT, "nope", 0, { x: 1, y: 1 })).toBe(
      MOTION_PATH_SCRIPT,
    );
  });

  it("updateMotionPathPointInScript — moves a cubic anchor, keeps control points", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", {
        motionPath: {
          path: [
            {x: 0, y: 0},
            {x: 50, y: -80}, {x: 150, y: -120},
            {x: 200, y: -100}
          ],
          type: "cubic"
        },
        duration: 2
      }, 0);
    `;
    const id = getAnimId(script);
    const updated = updateMotionPathPointInScript(script, id, 1, { x: 220, y: -130 });
    const reparsed = parseGsapScript(updated);
    const anim = reparsed.animations[0];
    // anchor 1 moved; the segment's control points are untouched.
    expect(anim.keyframes!.keyframes[1].properties).toMatchObject({ x: 220, y: -130 });
    expect(anim.arcPath!.segments[0].cp1).toEqual({ x: 50, y: -80 });
    expect(anim.arcPath!.segments[0].cp2).toEqual({ x: 150, y: -120 });
  });

  // ── add/removeMotionPathPointInScript ───────────────────────────────────

  it("addMotionPathPointInScript — inserts a waypoint between anchors, keeps curviness", () => {
    const id = getAnimId(MOTION_PATH_SCRIPT);
    const updated = addMotionPathPointInScript(MOTION_PATH_SCRIPT, id, 1, { x: 100, y: -50 });
    const reparsed = parseGsapScript(updated);
    const anim = reparsed.animations[0];
    expect(anim.keyframes!.keyframes.map((k) => [k.properties.x, k.properties.y])).toEqual([
      [0, 0],
      [100, -50],
      [200, -100],
      [400, 50],
    ]);
    // 4 anchors → 3 segments, all curviness 1.5
    expect(anim.arcPath!.segments).toHaveLength(3);
    expect(anim.arcPath!.segments.every((s) => s.curviness === 1.5)).toBe(true);
  });

  it("addMotionPathPointInScript — refuses an index at the ends or out of range", () => {
    const id = getAnimId(MOTION_PATH_SCRIPT);
    expect(addMotionPathPointInScript(MOTION_PATH_SCRIPT, id, 0, { x: 1, y: 1 })).toBe(
      MOTION_PATH_SCRIPT,
    );
    expect(addMotionPathPointInScript(MOTION_PATH_SCRIPT, id, 3, { x: 1, y: 1 })).toBe(
      MOTION_PATH_SCRIPT,
    );
  });

  it("removeMotionPathPointInScript — drops a waypoint, preserves the rest", () => {
    const id = getAnimId(MOTION_PATH_SCRIPT);
    const updated = removeMotionPathPointInScript(MOTION_PATH_SCRIPT, id, 1);
    const reparsed = parseGsapScript(updated);
    const anim = reparsed.animations[0];
    expect(anim.keyframes!.keyframes.map((k) => [k.properties.x, k.properties.y])).toEqual([
      [0, 0],
      [400, 50],
    ]);
    expect(anim.arcPath!.segments).toHaveLength(1);
  });

  it("removeMotionPathPointInScript — refuses to drop below two anchors", () => {
    const two = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { motionPath: { path: [{x: 0, y: 0}, {x: 400, y: 50}], curviness: 1 }, duration: 2 }, 0);
    `;
    const id = getAnimId(two);
    expect(removeMotionPathPointInScript(two, id, 0)).toBe(two);
  });

  it("add/removeMotionPathPointInScript — leave cubic paths untouched", () => {
    const cubic = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { motionPath: { path: [{x:0,y:0},{x:50,y:-80},{x:150,y:-120},{x:200,y:-100}], type: "cubic" }, duration: 2 }, 0);
    `;
    const id = getAnimId(cubic);
    expect(addMotionPathPointInScript(cubic, id, 1, { x: 1, y: 1 })).toBe(cubic);
    expect(removeMotionPathPointInScript(cubic, id, 1)).toBe(cubic);
  });

  // ── addMotionPathToScript ───────────────────────────────────────────────

  it("addMotionPathToScript — authors a new 2-anchor motionPath tween", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.from("#title", { opacity: 0, duration: 0.5 }, 0);
    `;
    const { script: updated, id } = addMotionPathToScript(script, "#el", 2.0, 1.5, {
      x: 300,
      y: -100,
    });
    expect(id).not.toBeNull();
    const reparsed = parseGsapScript(updated);
    const anim = reparsed.animations.find((a) => a.targetSelector === "#el")!;
    expect(anim).toBeDefined();
    expect(anim.arcPath!.enabled).toBe(true);
    expect(anim.keyframes!.keyframes.map((k) => [k.properties.x, k.properties.y])).toEqual([
      [0, 0],
      [300, -100],
    ]);
    expect(anim.duration).toBe(1.5);
  });

  it("addMotionPathToScript — returns id:null (not '') when there is no timeline", () => {
    // No `gsap.timeline()` and no located tweens → failure. The sentinel must be
    // null so a downstream caller chaining on the id can null-check instead of
    // silently feeding an empty selector into a locate call that matches nothing.
    const { script: updated, id } = addMotionPathToScript("const x = 1;", "#el", 0, 1, {
      x: 10,
      y: 10,
    });
    expect(id).toBeNull();
    expect(updated).toBe("const x = 1;");
  });

  it("addMotionPathToScript + hold-sync — holds (0,0) at t=0 when authored past t=0", () => {
    // A motionPath authored at position > 0 parses with a first keyframe of (0,0).
    // Without a pre-tween hold the element would snap to its CSS home at frame 0 and
    // jump when the tween starts — this is why `add-motion-path` is hold-synced.
    const script = `const tl = gsap.timeline({ paused: true });`;
    const { script: withPath } = addMotionPathToScript(script, "#el", 2.0, 1.5, {
      x: 300,
      y: -100,
    });
    const synced = syncPositionHoldsBeforeKeyframes(withPath);
    const hold = parseGsapScript(synced).animations.find((a) => a.method === "set");
    expect(hold).toBeDefined();
    expect(hold!.position).toBe(0);
    expect(hold!.properties).toMatchObject({ x: 0, y: 0 });
  });

  it("addMotionPathToScript + hold-sync — adds no hold when authored at t=0", () => {
    const script = `const tl = gsap.timeline({ paused: true });`;
    const { script: withPath } = addMotionPathToScript(script, "#el", 0, 1.5, {
      x: 300,
      y: -100,
    });
    expect(syncPositionHoldsBeforeKeyframes(withPath)).not.toContain("hf-hold");
  });

  // ── convertToKeyframesInScript ──────────────────────────────────────────

  it("convertToKeyframesInScript — converts flat to() tween", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#title", { x: 100, opacity: 1, duration: 0.8, ease: "power3.out" }, 0.3);
    `;
    const id = getAnimId(script);
    const updated = convertToKeyframesInScript(script, id, { x: 0, opacity: 0 });
    const reparsed = parseGsapScript(updated);
    const anim = reparsed.animations[0];

    expect(anim.keyframes).toBeDefined();
    const kfs = anim.keyframes!.keyframes;
    expect(kfs).toHaveLength(2);

    expect(kfs[0].percentage).toBe(0);
    expect(kfs[0].properties.x).toBe(0);
    expect(kfs[0].properties.opacity).toBe(0);

    expect(kfs[1].percentage).toBe(100);
    expect(kfs[1].properties.x).toBe(100);
    expect(kfs[1].properties.opacity).toBe(1);

    expect(anim.keyframes!.easeEach).toBe("power3.out");
    expect(anim.ease).toBe("none");
    expect(anim.duration).toBe(0.8);
    expect(anim.position).toBe(0.3);
  });

  it("convertToKeyframesInScript — converts from() to to() + keyframes", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.from("#title", { x: -200, opacity: 0, duration: 0.8 }, 0.3);
    `;
    const anim = convertAndReparse(script, { x: 0, opacity: 1 });
    expect(anim.method).toBe("to");
    const kfs = expectKeyframesFormat(anim, "percentage", 2);
    expectKeyframe(kfs[0]!, 0, { x: -200, opacity: 0 });
    expectKeyframe(kfs[1]!, 100, { x: 0, opacity: 1 });
  });

  it("convertToKeyframesInScript — converts fromTo() to to() + keyframes", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#title", { x: -100 }, { x: 100, duration: 1 }, 0);
    `;
    const anim = convertAndReparse(script);
    expect(anim.method).toBe("to");
    const kfs = expectKeyframesFormat(anim, "percentage", 2);
    expect(kfs[0]!.properties.x).toBe(-100);
    expect(kfs[1]!.properties.x).toBe(100);
  });

  it("convertToKeyframesInScript — skips if already has keyframes", () => {
    const updated = convertToKeyframesInScript(KF_SCRIPT, getAnimId(KF_SCRIPT));
    expect(updated).toBe(KF_SCRIPT);
  });

  // ── removeAllKeyframesFromScript ────────────────────────────────────────

  it("removeAllKeyframesFromScript — collapses to last keyframe's props", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", {
        keyframes: { "0%": { x: 0 }, "50%": { x: 100 }, "100%": { x: 200, opacity: 1 } },
        duration: 2
      }, 0);
    `;
    const id = getAnimId(script);
    const updated = removeAllKeyframesFromScript(script, id);
    const reparsed = parseGsapScript(updated);
    const anim = reparsed.animations[0];
    expect(anim.keyframes).toBeUndefined();
    expect(anim.properties.x).toBe(200);
    expect(anim.properties.opacity).toBe(1);
    // Removing all keyframes must HOLD statically (gsap.set equivalent): zero
    // duration + immediateRender so the element does not re-animate.
    expect(anim.duration).toBe(0);
    expect(anim.extras?.immediateRender).toBe("__raw:true");
  });
});

describe("motionPath parsing", () => {
  it("parses motionPath with waypoint array and curviness", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", {
        motionPath: {
          path: [{x: 0, y: 0}, {x: 200, y: -100}, {x: 400, y: 50}],
          curviness: 1.5
        },
        duration: 2
      }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    const anim = result.animations[0];

    expect(anim.arcPath).toBeDefined();
    expect(anim.arcPath!.enabled).toBe(true);
    expect(anim.arcPath!.segments).toHaveLength(2);
    expect(anim.arcPath!.segments[0].curviness).toBe(1.5);
    expect(anim.arcPath!.segments[1].curviness).toBe(1.5);

    expect(anim.keyframes).toBeDefined();
    expect(anim.keyframes!.keyframes).toHaveLength(3);
    expect(anim.keyframes!.keyframes[0].properties.x).toBe(0);
    expect(anim.keyframes!.keyframes[0].properties.y).toBe(0);
    expect(anim.keyframes!.keyframes[1].properties.x).toBe(200);
    expect(anim.keyframes!.keyframes[1].properties.y).toBe(-100);
    expect(anim.keyframes!.keyframes[2].properties.x).toBe(400);
    expect(anim.keyframes!.keyframes[2].properties.y).toBe(50);
  });

  it("parses motionPath with type cubic and explicit control points", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", {
        motionPath: {
          path: [
            {x: 0, y: 0},
            {x: 50, y: -80}, {x: 150, y: -120},
            {x: 200, y: -100},
            {x: 250, y: -80}, {x: 350, y: 30},
            {x: 400, y: 50}
          ],
          type: "cubic"
        },
        duration: 2
      }, 0);
    `;
    const result = parseGsapScript(script);
    const anim = result.animations[0];

    expect(anim.arcPath).toBeDefined();
    expect(anim.arcPath!.segments).toHaveLength(2);

    expect(anim.arcPath!.segments[0].cp1).toEqual({ x: 50, y: -80 });
    expect(anim.arcPath!.segments[0].cp2).toEqual({ x: 150, y: -120 });

    expect(anim.arcPath!.segments[1].cp1).toEqual({ x: 250, y: -80 });
    expect(anim.arcPath!.segments[1].cp2).toEqual({ x: 350, y: 30 });

    expect(anim.keyframes!.keyframes).toHaveLength(3);
    expect(anim.keyframes!.keyframes[0].properties).toEqual({ x: 0, y: 0 });
    expect(anim.keyframes!.keyframes[1].properties).toEqual({ x: 200, y: -100 });
    expect(anim.keyframes!.keyframes[2].properties).toEqual({ x: 400, y: 50 });
  });

  it("parses motionPath with autoRotate", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", {
        motionPath: {
          path: [{x: 0, y: 0}, {x: 200, y: 100}],
          autoRotate: true
        },
        duration: 1
      }, 0);
    `;
    const result = parseGsapScript(script);
    const anim = result.animations[0];
    expect(anim.arcPath!.autoRotate).toBe(true);
  });

  it("merges motionPath waypoints into existing keyframes", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", {
        motionPath: {
          path: [{x: 0, y: 0}, {x: 200, y: 100}],
          curviness: 2
        },
        keyframes: {
          "0%": { opacity: 1 },
          "100%": { opacity: 0 }
        },
        duration: 2
      }, 0);
    `;
    const result = parseGsapScript(script);
    const anim = result.animations[0];

    expect(anim.arcPath).toBeDefined();
    expect(anim.arcPath!.segments).toHaveLength(1);
    expect(anim.arcPath!.segments[0].curviness).toBe(2);

    expect(anim.keyframes!.keyframes).toHaveLength(2);
    expect(anim.keyframes!.keyframes[0].properties).toEqual({ opacity: 1, x: 0, y: 0 });
    expect(anim.keyframes!.keyframes[1].properties).toEqual({ opacity: 0, x: 200, y: 100 });
  });

  it("skips motionPath with fewer than 2 waypoints", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", {
        motionPath: { path: [{x: 0, y: 0}] },
        duration: 1
      }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations[0].arcPath).toBeUndefined();
  });

  it("tween without motionPath parses identically to before", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: 100, y: 200, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);
    const anim = result.animations[0];
    expect(anim.arcPath).toBeUndefined();
    expect(anim.properties.x).toBe(100);
    expect(anim.properties.y).toBe(200);
  });
});

// ── addAnimationWithKeyframesToScript ──────────────────────────────────────

describe("addAnimationWithKeyframesToScript", () => {
  const BASE = `
const tl = gsap.timeline({ paused: true });
tl.to("#title", { x: 100, duration: 0.5 }, 0);
  `.trim();

  it("adds a new tween with keyframes after existing tweens", () => {
    const { script, id } = addAnimationWithKeyframesToScript(BASE, "#box", 3, 0.5, [
      { percentage: 0, properties: { x: 0 } },
      { percentage: 100, properties: { x: 200 } },
    ]);
    expect(script).toContain("#box");
    expect(script).toContain("keyframes");
    expect(script).toContain('"0%"');
    expect(script).toContain('"100%"');
    expect(id).toBeTruthy();

    const parsed = parseGsapScript(script);
    expect(parsed.animations.length).toBe(2);
    const newAnim = parsed.animations[1];
    expect(newAnim.targetSelector).toBe("#box");
    expect(newAnim.keyframes).toBeDefined();
    expect(newAnim.keyframes!.keyframes.length).toBe(2);
  });

  it("preserves existing tween code", () => {
    const { script } = addAnimationWithKeyframesToScript(BASE, "#new", 2, 1, [
      { percentage: 0, properties: { opacity: 0 } },
      { percentage: 100, properties: { opacity: 1 } },
    ]);
    expect(script).toContain("#title");
    expect(script).toContain("x: 100");
  });

  it("produces a stable ID for the new animation", () => {
    const { script, id } = addAnimationWithKeyframesToScript(BASE, "#el", 1, 1, [
      { percentage: 0, properties: { y: 0 } },
      { percentage: 100, properties: { y: 100 } },
    ]);
    expect(id).toContain("#el");
    const parsed = parseGsapScript(script);
    const match = parsed.animations.find((a) => a.id === id);
    expect(match).toBeDefined();
  });

  it("includes per-keyframe ease when provided", () => {
    const { script } = addAnimationWithKeyframesToScript(BASE, "#el", 0, 1, [
      { percentage: 0, properties: { x: 0 }, ease: "power2.out" },
      { percentage: 100, properties: { x: 100 } },
    ]);
    expect(script).toContain("power2.out");
  });

  it("returns original script on parse failure", () => {
    const { script, id } = addAnimationWithKeyframesToScript("not valid js {{", "#el", 0, 1, [
      { percentage: 0, properties: { x: 0 } },
    ]);
    expect(script).toBe("not valid js {{");
    expect(id).toBe("");
  });
});

describe("splitAnimationsInScript", () => {
  const baseScript = `const tl = gsap.timeline({ paused: true });`;
  const opts = {
    originalId: "el1",
    newId: "el1-split",
    splitTime: 2,
    elementStart: 0,
    elementDuration: 4,
  };

  const split = (script: string, o = opts) => splitAnimationsInScript(script, o).script;

  it("keeps animation entirely in first half and adds set for inherited state", () => {
    const script = `${baseScript}\ntl.to("#el1", { x: 100, duration: 1 }, 0);`;
    const result = split(script);
    const parsed = parseGsapScript(result);
    const forOriginal = parsed.animations.filter((a) => a.targetSelector === "#el1");
    const forNew = parsed.animations.filter((a) => a.targetSelector === "#el1-split");
    expect(forOriginal).toHaveLength(1);
    expect(forNew).toHaveLength(1);
    expect(forNew[0]!.method).toBe("set");
    expect(forNew[0]!.properties.x).toBe(100);
    expect(forNew[0]!.position).toBe(opts.splitTime);
  });

  it("does not pin the clone to from-values for a completed .from() before the split", () => {
    // A .from() that finished before the split leaves the element at its natural
    // state. Carrying its from-values (opacity:0) into the clone's `set` made the
    // clone invisible. The clone should get NO inherited set for those props.
    const script = `${baseScript}\ntl.from("#el1", { y: 70, opacity: 0, duration: 0.9 }, 0.4);`;
    const result = split(script);
    const parsed = parseGsapScript(result);
    const forNew = parsed.animations.filter((a) => a.targetSelector === "#el1-split");
    const inheritedSet = forNew.find((a) => a.method === "set");
    expect(inheritedSet).toBeUndefined();
    expect(result).not.toContain("#el1-split");
  });

  it("retargets animation entirely in second half to new element", () => {
    const script = `${baseScript}\ntl.to("#el1", { x: 100, duration: 1 }, 3);`;
    const selectors = parseSplitAndAssert(script, (s) => split(s), 1);
    expect(selectors[0]).toBe("#el1-split");
  });

  it("splits spanning tween with linear interpolation and fromTo on clone", () => {
    const script = `${baseScript}\ntl.to("#el1", { opacity: 1, duration: 4 }, 0);`;
    const setupOpts = { ...opts, splitTime: 2, elementDuration: 4 };
    const result = split(script, setupOpts);
    const parsed = parseGsapScript(result);
    const first = parsed.animations.find((a) => a.targetSelector === "#el1");
    const forNew = parsed.animations.filter((a) => a.targetSelector === "#el1-split");
    const continuation = forNew.find((a) => a.method === "fromTo");
    expect(first).toBeDefined();
    expect(first!.duration).toBe(2);
    expect(first!.properties.opacity).toBe(0.5);
    expect(continuation).toBeDefined();
    expect(continuation!.duration).toBe(2);
    expect(continuation!.fromProperties?.opacity).toBe(0.5);
    expect(continuation!.properties.opacity).toBe(1);
  });

  it("retargets multiple animations at the same position both after split", () => {
    const script = `${baseScript}\ntl.to("#el1", { x: 100, duration: 1 }, 3);\ntl.to("#el1", { y: 200, duration: 1 }, 3);`;
    const result = split(script);
    const parsed = parseGsapScript(result);
    const forOriginal = parsed.animations.filter((a) => a.targetSelector === "#el1");
    const forNew = parsed.animations.filter((a) => a.targetSelector === "#el1-split");
    expect(forOriginal.length).toBe(0);
    expect(forNew.length).toBe(2);
  });

  it("returns script unchanged when no matching animations", () => {
    const script = `${baseScript}\ntl.to("#other", { x: 100, duration: 1 }, 0);`;
    const result = split(script);
    expect(result).toBe(script);
  });

  it("handles multiple animations independently", () => {
    const script = `${baseScript}
tl.to("#el1", { x: 100, duration: 1 }, 0);
tl.to("#el1", { y: 200, duration: 1 }, 3);`;
    const result = split(script);
    const parsed = parseGsapScript(result);
    const forOriginal = parsed.animations.filter((a) => a.targetSelector === "#el1");
    const forNew = parsed.animations.filter((a) => a.targetSelector === "#el1-split");
    expect(forOriginal).toHaveLength(1);
    expect(forOriginal[0]!.properties.x).toBe(100);
    expect(forNew).toHaveLength(2);
    const retargeted = forNew.find((a) => a.method === "to");
    const inherited = forNew.find((a) => a.method === "set");
    expect(retargeted!.properties.y).toBe(200);
    expect(inherited!.properties.x).toBe(100);
  });

  it("interpolates fromTo properties at split point on both halves", () => {
    const script = `${baseScript}\ntl.fromTo("#el1", { opacity: 0 }, { opacity: 1, duration: 4 }, 0);`;
    const result = split(script);
    const parsed = parseGsapScript(result);
    const first = parsed.animations.find((a) => a.targetSelector === "#el1");
    const forNew = parsed.animations.filter((a) => a.targetSelector === "#el1-split");
    const continuation = forNew.find((a) => a.method === "fromTo");
    expect(first!.properties.opacity).toBe(0.5);
    expect(continuation).toBeDefined();
    expect(continuation!.fromProperties?.opacity).toBe(0.5);
    expect(continuation!.properties.opacity).toBe(1);
  });

  it("splits a mid-flight fromTo straddling the split into two fromTo halves", () => {
    // Mid-flight: pos(0) < splitTime(2) < animEnd(4). The first half keeps the
    // original on #el1 ending at the interpolated mid-value; the clone continues
    // as a fromTo from that mid-value to the original to-value.
    const script = `${baseScript}\ntl.fromTo("#el1", { x: 0 }, { x: 100, duration: 4 }, 0);`;
    const result = split(script);
    const parsed = parseGsapScript(result);
    const first = parsed.animations.find((a) => a.targetSelector === "#el1")!;
    const forNew = parsed.animations.filter((a) => a.targetSelector === "#el1-split");
    const continuation = forNew.find((a) => a.method === "fromTo")!;
    expect(first.duration).toBe(2);
    expect(first.properties.x).toBe(50);
    expect(continuation.duration).toBe(2);
    expect(continuation.fromProperties?.x).toBe(50);
    expect(continuation.properties.x).toBe(100);
  });

  it("splits a mid-flight from straddling the split (no fromProperties on source)", () => {
    // A .from() has no explicit fromProperties, so the spanning branch seeds the
    // from-value from accumulated inherited state (defaulting to 0). The clone
    // continues from the interpolated mid-value as a fromTo so both halves play
    // a contiguous range.
    const script = `${baseScript}\ntl.from("#el1", { x: 80, duration: 4 }, 0);`;
    const result = split(script);
    const parsed = parseGsapScript(result);
    const first = parsed.animations.find((a) => a.targetSelector === "#el1")!;
    const continuation = parsed.animations
      .filter((a) => a.targetSelector === "#el1-split")
      .find((a) => a.method === "fromTo")!;
    expect(first.duration).toBe(2);
    expect(first.properties.x).toBe(40);
    expect(continuation.duration).toBe(2);
    expect(continuation.fromProperties?.x).toBe(40);
    expect(continuation.properties.x).toBe(80);
  });

  it("round-trips correctly through parseGsapScript", () => {
    const script = `${baseScript}\ntl.to("#el1", { x: 100, duration: 4 }, 0);`;
    const result = split(script);
    const parsed = parseGsapScript(result);
    expect(parsed.animations.length).toBeGreaterThanOrEqual(2);
    for (const anim of parsed.animations) {
      expect(typeof anim.position).toBe("number");
      if (anim.method !== "set") expect(anim.duration).toBeGreaterThan(0);
    }
  });

  it("leaves spanning keyframes on original and warns via skippedSelectors", () => {
    const script = `${baseScript}\ntl.to("#el1", { keyframes: [{ opacity: 1, duration: 1 }, { scale: 1.2, duration: 1 }, { x: 50, duration: 1 }] }, 1);`;
    const splitOpts = {
      originalId: "el1",
      newId: "el1-split",
      splitTime: 2.5,
      elementStart: 0,
      elementDuration: 5,
    };
    const fullResult = splitAnimationsInScript(script, splitOpts);
    const parsed = parseGsapScript(fullResult.script);
    const forOriginal = parsed.animations.filter((a) => a.targetSelector === "#el1");
    const forNew = parsed.animations.filter((a) => a.targetSelector === "#el1-split");
    expect(forOriginal.length).toBe(1);
    expect(forOriginal[0]!.keyframes).toBeDefined();
    expect(forNew.length).toBe(1);
    expect(forNew[0]!.method).toBe("set");
    expect(forNew[0]!.properties.opacity).toBe(1);
    expect(fullResult.skippedSelectors).toContain("#el1 (keyframes spanning split)");
  });

  it("retargets keyframes animation entirely after split", () => {
    const script = `${baseScript}\ntl.to("#el1", { keyframes: [{ opacity: 1, duration: 0.5 }, { scale: 1.2, duration: 0.5 }] }, 4);`;
    const splitOpts = {
      originalId: "el1",
      newId: "el1-split",
      splitTime: 3,
      elementStart: 0,
      elementDuration: 5,
    };
    const result = split(script, splitOpts);
    const parsed = parseGsapScript(result);
    const forOriginal = parsed.animations.filter((a) => a.targetSelector === "#el1");
    const forNew = parsed.animations.filter((a) => a.targetSelector === "#el1-split");
    expect(forOriginal.length).toBe(0);
    expect(forNew.length).toBe(1);
    expect(forNew[0]!.keyframes).toBeDefined();
  });

  it("keeps keyframes animation entirely before split and inherits final keyframe state", () => {
    const script = `${baseScript}\ntl.to("#el1", { keyframes: [{ opacity: 1, duration: 0.5 }, { scale: 1.2, duration: 0.5 }] }, 0);\ntl.to("#el1", { y: 100, duration: 1 }, 4);`;
    const splitOpts = {
      originalId: "el1",
      newId: "el1-split",
      splitTime: 3,
      elementStart: 0,
      elementDuration: 5,
    };
    const result = split(script, splitOpts);
    const parsed = parseGsapScript(result);
    const forNew = parsed.animations.filter((a) => a.targetSelector === "#el1-split");
    const setState = forNew.find((a) => a.method === "set");
    expect(setState).toBeDefined();
    expect(setState!.properties.scale).toBe(1.2);
  });

  it("retargets set tween entirely after split", () => {
    const script = `${baseScript}\ntl.set("#el1", { opacity: 0 }, 3);`;
    const result = split(script);
    const parsed = parseGsapScript(result);
    const forOriginal = parsed.animations.filter((a) => a.targetSelector === "#el1");
    const forNew = parsed.animations.filter((a) => a.targetSelector === "#el1-split");
    expect(forOriginal.length).toBe(0);
    expect(forNew.length).toBe(1);
    expect(forNew[0]!.method).toBe("set");
    expect(forNew[0]!.position).toBe(3);
  });

  it("inserts inherited state set before other tweens targeting new element", () => {
    const script = `${baseScript}\ntl.to("#el1", { opacity: 1, x: 50, duration: 0.5 }, 0);\ntl.to("#el1", { opacity: 0, duration: 0.5 }, 5);`;
    const splitOpts = {
      originalId: "el1",
      newId: "el1-split",
      splitTime: 3,
      elementStart: 0,
      elementDuration: 6,
    };
    const result = split(script, splitOpts);
    const parsed = parseGsapScript(result);
    const forNew = parsed.animations.filter((a) => a.targetSelector === "#el1-split");
    const setState = forNew.find((a) => a.method === "set");
    const exitTween = forNew.find((a) => a.method === "to");
    expect(setState).toBeDefined();
    expect(exitTween).toBeDefined();
    expect(setState!.properties.opacity).toBe(1);
    expect(setState!.properties.x).toBe(50);
    const setIdx = parsed.animations.indexOf(setState!);
    const exitIdx = parsed.animations.indexOf(exitTween!);
    expect(setIdx).toBeLessThan(exitIdx);
  });

  it("reports skipped selectors for non-ID-based animations referencing the element", () => {
    const script = `${baseScript}\ntl.to("#el1", { x: 100, duration: 1 }, 0);\ntl.to(".el1", { opacity: 0, duration: 1 }, 1);`;
    const result = splitAnimationsInScript(script, opts);
    expect(result.skippedSelectors).toEqual([".el1"]);
  });
});

describe("splitIntoPropertyGroups", () => {
  const baseScript = `const tl = gsap.timeline({ paused: true });`;

  it("splits flat to({x, y, scale, rotation}) into 3 group tweens", () => {
    const script = `${baseScript}\ntl.to("#el", { x: 100, y: 50, scale: 1.5, rotation: 45, duration: 1 }, 0);`;
    const parsed = parseGsapScript(script);
    const animId = parsed.animations[0]!.id;

    const result = splitIntoPropertyGroups(script, animId);
    const reParsed = parseGsapScript(result.script);

    // Should produce 3 tweens: position (x,y), scale, rotation
    expect(reParsed.animations).toHaveLength(3);
    expect(result.ids).toHaveLength(3);

    const groups = new Set(reParsed.animations.map((a) => a.propertyGroup));
    expect(groups.has("position")).toBe(true);
    expect(groups.has("scale")).toBe(true);
    expect(groups.has("rotation")).toBe(true);

    const posAnim = reParsed.animations.find((a) => a.propertyGroup === "position")!;
    expect(posAnim.properties.x).toBe(100);
    expect(posAnim.properties.y).toBe(50);
    expect(posAnim.properties.scale).toBeUndefined();

    const scaleAnim = reParsed.animations.find((a) => a.propertyGroup === "scale")!;
    expect(scaleAnim.properties.scale).toBe(1.5);
    expect(scaleAnim.properties.x).toBeUndefined();

    const rotAnim = reParsed.animations.find((a) => a.propertyGroup === "rotation")!;
    expect(rotAnim.properties.rotation).toBe(45);
  });

  it("splits flat from({scale, opacity}) into 2 group tweens", () => {
    const script = `${baseScript}\ntl.from("#el", { scale: 0.5, opacity: 0, duration: 0.5 }, 1);`;
    const parsed = parseGsapScript(script);
    const animId = parsed.animations[0]!.id;

    const result = splitIntoPropertyGroups(script, animId);
    const reParsed = parseGsapScript(result.script);

    expect(reParsed.animations).toHaveLength(2);
    expect(result.ids).toHaveLength(2);

    const groups = new Set(reParsed.animations.map((a) => a.propertyGroup));
    expect(groups.has("scale")).toBe(true);
    expect(groups.has("visual")).toBe(true);
  });

  it("returns same ID for single-group tween (no split)", () => {
    const script = `${baseScript}\ntl.to("#el", { x: 100, y: 50, duration: 1 }, 0);`;
    const parsed = parseGsapScript(script);
    const animId = parsed.animations[0]!.id;

    const result = splitIntoPropertyGroups(script, animId);
    expect(result.ids).toEqual([animId]);
    // Script should be unchanged
    const reParsed = parseGsapScript(result.script);
    expect(reParsed.animations).toHaveLength(1);
  });

  it("preserves position, duration, ease on split tweens", () => {
    const script = `${baseScript}\ntl.to("#el", { x: 100, scale: 2, duration: 0.8, ease: "power2.out" }, 1.5);`;
    const parsed = parseGsapScript(script);
    const animId = parsed.animations[0]!.id;

    const result = splitIntoPropertyGroups(script, animId);
    const reParsed = parseGsapScript(result.script);

    expect(reParsed.animations).toHaveLength(2);
    for (const anim of reParsed.animations) {
      expect(anim.position).toBe(1.5);
      expect(anim.duration).toBe(0.8);
      expect(anim.ease).toBe("power2.out");
    }
  });

  it("splits keyframed tween: each group gets only its properties per keyframe", () => {
    const script = `${baseScript}\ntl.to("#el", { keyframes: { "0%": { x: 0, scale: 1 }, "50%": { x: 50, scale: 1.5 }, "100%": { x: 100, scale: 2 } }, duration: 2 }, 0);`;
    const parsed = parseGsapScript(script);
    const animId = parsed.animations[0]!.id;

    const result = splitIntoPropertyGroups(script, animId);
    const reParsed = parseGsapScript(result.script);

    expect(reParsed.animations).toHaveLength(2);
    expect(result.ids).toHaveLength(2);

    // Both tweens are keyframed — identify them by the properties inside their keyframes.
    const xAnim = reParsed.animations.find((a) =>
      a.keyframes?.keyframes.some((kf) => "x" in kf.properties),
    )!;
    const scaleAnim = reParsed.animations.find((a) =>
      a.keyframes?.keyframes.some((kf) => "scale" in kf.properties),
    )!;

    expect(xAnim).toBeDefined();
    expect(xAnim.keyframes).toBeDefined();
    expect(xAnim.keyframes!.keyframes).toHaveLength(3);
    // Position keyframes should have x but not scale
    for (const kf of xAnim.keyframes!.keyframes) {
      expect(kf.properties.x).toBeDefined();
      expect(kf.properties.scale).toBeUndefined();
    }

    expect(scaleAnim).toBeDefined();
    expect(scaleAnim.keyframes).toBeDefined();
    expect(scaleAnim.keyframes!.keyframes).toHaveLength(3);
    // Scale keyframes should have scale but not x
    for (const kf of scaleAnim.keyframes!.keyframes) {
      expect(kf.properties.scale).toBeDefined();
      expect(kf.properties.x).toBeUndefined();
    }
  });
});

describe("shiftPositionsInScript", () => {
  it("shifts all numeric positions for the target selector", () => {
    const script = `const tl = gsap.timeline({ paused: true });
tl.from("#hero", { opacity: 0, duration: 1 }, 0);
tl.to("#hero", { opacity: 0, duration: 0.5 }, 2.5);
tl.from("#bg", { scale: 0, duration: 1 }, 1);`;
    const result = shiftPositionsInScript(script, "#hero", 3);
    const parsed = parseGsapScript(result);
    const hero = parsed.animations.filter((a) => a.targetSelector === "#hero");
    expect(hero[0].position).toBe(3);
    expect(hero[1].position).toBe(5.5);
    const bg = parsed.animations.find((a) => a.targetSelector === "#bg");
    expect(bg!.position).toBe(1);
  });

  it("clamps negative-going positions to zero", () => {
    const script = `const tl = gsap.timeline({ paused: true });
tl.to("#el", { x: 100, duration: 1 }, 0.3);
tl.to("#el", { y: 50, duration: 1 }, 1.5);`;
    const result = shiftPositionsInScript(script, "#el", -1.0);
    const parsed = parseGsapScript(result);
    const anims = parsed.animations.filter((a) => a.targetSelector === "#el");
    expect(anims[0].position).toBe(0);
    expect(anims[1].position).toBe(0.5);
  });

  it("returns the original script when delta is zero", () => {
    const script = `const tl = gsap.timeline({ paused: true });
tl.to("#el", { x: 100, duration: 1 }, 2);`;
    expect(shiftPositionsInScript(script, "#el", 0)).toBe(script);
  });

  it("does not collide when two tweens have adjacent positions", () => {
    const script = `const tl = gsap.timeline({ paused: true });
tl.to("#burst", { opacity: 1, duration: 0.5 }, 1.0);
tl.to("#burst", { opacity: 0, duration: 0.5 }, 1.5);`;
    const result = shiftPositionsInScript(script, "#burst", 0.5);
    const parsed = parseGsapScript(result);
    const burst = parsed.animations.filter((a) => a.targetSelector === "#burst");
    expect(burst[0].position).toBe(1.5);
    expect(burst[1].position).toBe(2);
  });

  it("skips string positions", () => {
    const script = `const tl = gsap.timeline({ paused: true });
tl.to("#el", { x: 100, duration: 1 }, 2);
tl.to("#el", { y: 50, duration: 1 }, "+=0.5");`;
    const result = shiftPositionsInScript(script, "#el", 1);
    const parsed = parseGsapScript(result);
    expect(parsed.animations[0].position).toBe(3);
    expect(parsed.animations[1].position).toBe("+=0.5");
  });
});

describe("scalePositionsInScript", () => {
  it("scales positions and durations proportionally for the target selector", () => {
    const script = `const tl = gsap.timeline({ paused: true });
tl.from("#hero", { opacity: 0, duration: 1 }, 0);
tl.to("#hero", { opacity: 0, duration: 0.5 }, 2.5);
tl.from("#bg", { scale: 0, duration: 1 }, 1);`;
    const result = scalePositionsInScript(script, "#hero", 0, 3, 0, 2);
    const parsed = parseGsapScript(result);
    const hero = parsed.animations.filter((a) => a.targetSelector === "#hero");
    expect(hero[0].position).toBe(0);
    expect(hero[0].duration).toBeCloseTo(0.667, 2);
    expect(hero[1].position).toBeCloseTo(1.667, 2);
    expect(hero[1].duration).toBeCloseTo(0.333, 2);
    const bg = parsed.animations.find((a) => a.targetSelector === "#bg");
    expect(bg!.position).toBe(1);
    expect(bg!.duration).toBe(1);
  });

  it("handles start-edge resize (new start + shorter duration)", () => {
    const script = `const tl = gsap.timeline({ paused: true });
tl.from("#el", { opacity: 0, duration: 1 }, 0);
tl.to("#el", { y: 50, duration: 0.5 }, 2.5);`;
    const result = scalePositionsInScript(script, "#el", 0, 3, 1, 2);
    const parsed = parseGsapScript(result);
    const anims = parsed.animations.filter((a) => a.targetSelector === "#el");
    expect(anims[0].position).toBe(1);
    expect(anims[0].duration).toBeCloseTo(0.667, 2);
    expect(anims[1].position).toBeCloseTo(2.667, 2);
    expect(anims[1].duration).toBeCloseTo(0.333, 2);
  });

  it("clamps negative-going positions to zero", () => {
    const script = `const tl = gsap.timeline({ paused: true });
tl.to("#el", { x: 100, duration: 1 }, 2);`;
    const result = scalePositionsInScript(script, "#el", 2, 1, 0, 0.5);
    const parsed = parseGsapScript(result);
    expect(parsed.animations[0].position).toBe(0);
  });

  it("returns the original script when old and new timing are identical", () => {
    const script = `const tl = gsap.timeline({ paused: true });
tl.to("#el", { x: 100, duration: 1 }, 2);`;
    expect(scalePositionsInScript(script, "#el", 0, 3, 0, 3)).toBe(script);
  });

  it("skips string positions", () => {
    const script = `const tl = gsap.timeline({ paused: true });
tl.to("#el", { x: 100, duration: 1 }, 2);
tl.to("#el", { y: 50, duration: 1 }, "+=0.5");`;
    const result = scalePositionsInScript(script, "#el", 0, 3, 0, 2);
    const parsed = parseGsapScript(result);
    expect(parsed.animations[0].position).toBeCloseTo(1.333, 2);
    expect(parsed.animations[1].position).toBe("+=0.5");
  });
});

describe("base gsap.set (off-timeline global hold)", () => {
  const SCRIPT = `
    const tl = gsap.timeline({ paused: true });
    gsap.set("#box", { rotationX: 17, rotationY: 93 });
    tl.to("#box", { x: 260, duration: 1 }, 0.3);
    window.__timelines = { main: tl };
  `;

  it("parses a string-literal gsap.set as a global set animation", () => {
    const anims = parseGsapScript(SCRIPT).animations.filter((a) => a.targetSelector === "#box");
    const set = anims.find((a) => a.method === "set");
    expect(set?.global).toBe(true);
    expect(set?.properties).toEqual({ rotationX: 17, rotationY: 93 });
    expect(anims.find((a) => a.method === "to")?.global).toBeUndefined();
  });

  it("creates a base gsap.set (not tl.set) when global is set", () => {
    const base = `const tl = gsap.timeline({ paused: true });\ntl.to("#box", { x: 1, duration: 1 }, 0);\nwindow.__timelines = { main: tl };`;
    const { script } = addAnimationToScript(base, {
      targetSelector: "#box",
      method: "set",
      position: 0,
      properties: { rotationX: 30 },
      global: true,
    });
    expect(script).toContain('gsap.set("#box"');
    expect(script).not.toContain('tl.set("#box"');
  });

  it("updates a global set in place, keeping it gsap.set", () => {
    const set = parseGsapScript(SCRIPT).animations.find(
      (a) => a.targetSelector === "#box" && a.method === "set",
    )!;
    const updated = updateAnimationInScript(SCRIPT, set.id, {
      properties: { rotationX: 99, rotationY: 93 },
    });
    expect(updated).toContain('gsap.set("#box"');
    expect(updated).toContain("99");
    expect(updated).not.toContain('tl.set("#box"');
  });

  it("leaves a VARIABLE-target gsap.set as surrounding source (not parsed)", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      const el = document.querySelector("#box");
      gsap.set(el, { rotationX: 5 });
      tl.to("#box", { x: 10, duration: 1 }, 0);
      window.__timelines = { main: tl };
    `;
    const sets = parseGsapScript(script).animations.filter((a) => a.method === "set");
    expect(sets).toHaveLength(0);
  });
});

describe("single position write per element (consolidation)", () => {
  const posWritesFor = (script: string, selector: string) =>
    parseGsapScript(script).animations.filter(
      (a) => a.targetSelector === selector && a.propertyGroup === "position",
    );

  // The real corruption: a degenerate `tl.to(...,{duration:0,x,y})` AND a stray
  // `gsap.set(...,{x,y})` for the same element. The later write overrides the
  // earlier, so the element "can't move".
  const CORRUPTED = `
    const tl = gsap.timeline({ paused: true });
    tl.to("#box", { duration: 0, x: -766, y: 314, immediateRender: true }, 1.333);
    gsap.set("#box", { x: -520, y: 170 });
    gsap.set("#box", { rotation: 45 });
    tl.to("#box", { opacity: 1, duration: 1 }, 0);
  `;

  it("dedupe collapses 2+ position writes to exactly one (keeping keepId)", () => {
    expect(posWritesFor(CORRUPTED, "#box")).toHaveLength(2);
    const keepId = posWritesFor(CORRUPTED, "#box").find((a) => a.method === "to")!.id;
    const out = dedupePositionWritesInScript(CORRUPTED, "#box", keepId);
    const kept = posWritesFor(out, "#box");
    expect(kept).toHaveLength(1);
    // Kept the tl.to; stray gsap.set position is gone.
    expect(kept[0].method).toBe("to");
    expect(out).not.toMatch(/gsap\.set\("#box",\s*\{\s*x:/);
  });

  it("dedupe leaves non-position writes for the selector untouched", () => {
    const out = dedupePositionWritesInScript(CORRUPTED, "#box", undefined);
    const anims = parseGsapScript(out).animations;
    // rotation set + opacity tween survive (separate animations, not position).
    expect(anims.some((a) => a.targetSelector === "#box" && "rotation" in a.properties)).toBe(true);
    expect(anims.some((a) => a.targetSelector === "#box" && "opacity" in a.properties)).toBe(true);
    expect(posWritesFor(out, "#box")).toHaveLength(1);
  });

  it("dedupe keeps the LAST position write when keepId is stale", () => {
    const out = dedupePositionWritesInScript(CORRUPTED, "#box", "does-not-exist");
    const kept = posWritesFor(out, "#box");
    expect(kept).toHaveLength(1);
    // Last in source order is the gsap.set(x:-520) — runtime-effective one.
    expect(kept[0].method).toBe("set");
    expect(kept[0].properties.x).toBe(-520);
  });

  it("dedupe + update yields exactly one position write with the NEW value", () => {
    const keepId = posWritesFor(CORRUPTED, "#box").find((a) => a.method === "to")!.id;
    let out = dedupePositionWritesInScript(CORRUPTED, "#box", keepId);
    const surviving = posWritesFor(out, "#box")[0];
    out = updateAnimationInScript(out, surviving.id, { properties: { x: 99, y: 42 } });
    const kept = posWritesFor(out, "#box");
    expect(kept).toHaveLength(1);
    expect(kept[0].properties.x).toBe(99);
    expect(kept[0].properties.y).toBe(42);
  });

  it("remove-all-keyframes strips position residue, leaving one held set", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#box", { keyframes: { "0%": { x: 0 }, "100%": { x: 200 } }, duration: 2 }, 0);
      gsap.set("#box", { x: -520, y: 170 });
      tl.to("#box", { opacity: 1, duration: 1 }, 0);
    `;
    const kfTween = posWritesFor(script, "#box").find((a) => a.keyframes)!;
    const out = removeAllKeyframesFromScript(script, kfTween.id);
    const kept = posWritesFor(out, "#box");
    expect(kept).toHaveLength(1);
    expect(kept[0].keyframes).toBeUndefined();
    expect(kept[0].duration).toBe(0);
    // The stray gsap.set position residue is gone; opacity tween survives.
    expect(out).not.toMatch(/gsap\.set\("#box",\s*\{\s*x:/);
    expect(parseGsapScript(out).animations.some((a) => "opacity" in a.properties)).toBe(true);
  });
});

describe("recast writer never doubles vars keys", () => {
  // Regression: buildTweenStatementCode pushed `immediateRender: true` for
  // every timeline set AND appended extras — a parsed set carries the flag in
  // extras, so splitting a mixed set emitted
  // `immediateRender: true, immediateRender: true` into the file.
  const src = `window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
tl.set("#a", { z: 0, rotationX: 5, immediateRender: true, scale: 1 }, 0);
window.__timelines["main"] = tl;`;

  it("split of a mixed set emits the flag once per group", () => {
    const id = parseGsapScript(src).animations[0]!.id;
    const { script: out } = splitIntoPropertyGroups(src, id);
    const setLines = out.split("\n").filter((l) => l.includes("tl.set("));
    expect(setLines.length).toBeGreaterThan(1);
    for (const line of setLines) {
      expect(line.match(/immediateRender/g) ?? []).toHaveLength(1);
    }
  });
});
