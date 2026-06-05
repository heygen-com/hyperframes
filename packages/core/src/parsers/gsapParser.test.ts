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
  convertToKeyframesInScript,
  removeAllKeyframesFromScript,
} from "./gsapParser.js";
import type { GsapAnimation } from "./gsapParser.js";
import type { Keyframe } from "../core.types";

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
    expect(result1.animations[0].id).toBe("#el1-to-0");
    expect(result1.animations[1].id).toBe("#el2-to-1000");
  });

  it("disambiguates colliding IDs with a suffix", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 0, duration: 0.3 }, 0);
      tl.to("#el1", { opacity: 1, duration: 0.5 }, 0);
    `;
    const result = parseGsapScript(script);

    expect(result.animations[0].id).toBe("#el1-to-0");
    expect(result.animations[1].id).toBe("#el1-to-0-2");
  });

  it("uses string position in ID for relative positions", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1, duration: 0.5 }, "+=1");
    `;
    const result = parseGsapScript(script);

    expect(result.animations[0].id).toBe("#el1-to-+=1");
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
    const parsed = parseGsapScript(script);
    const serialized = serializeGsapAnimations(parsed.animations, parsed.timelineVar, {
      preamble: parsed.preamble,
      postamble: parsed.postamble,
    });

    expect(serialized).toContain("stagger: {");
    expect(serialized).toContain("each: 0.15");
    expect(serialized).toContain('from: "start"');
  });

  it("preserves yoyo and repeat on round-trip", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { x: 100, duration: 1, yoyo: true, repeat: 3, repeatDelay: 0.2 }, 0);
    `;
    const parsed = parseGsapScript(script);
    const serialized = serializeGsapAnimations(parsed.animations, parsed.timelineVar, {
      preamble: parsed.preamble,
      postamble: parsed.postamble,
    });

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
});

describe("unresolvable value round-trip", () => {
  it("preserves unresolvable property values through serialize", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: someFn(), x: 50, duration: 1 }, 0);
    `;
    const parsed = parseGsapScript(script);
    const serialized = serializeGsapAnimations(parsed.animations, parsed.timelineVar, {
      preamble: parsed.preamble,
      postamble: parsed.postamble,
    });

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
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].targetSelector).toBe(".item");
  });

  it("resolves a toArray result stored in a variable", () => {
    const script = `
      const items = gsap.utils.toArray(".item");
      const tl = gsap.timeline({ paused: true });
      tl.to(items, { opacity: 1, duration: 0.5 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations[0].targetSelector).toBe(".item");
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
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].targetSelector).toBe(".item");
  });

  it("resolves an inline querySelectorAll().forEach callback param", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      document.querySelectorAll(".dot").forEach((dot) => {
        tl.to(dot, { scale: 1, duration: 0.3 }, 0);
      });
    `;
    const result = parseGsapScript(script);
    expect(result.animations[0].targetSelector).toBe(".dot");
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
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    const anim = result.animations[0];
    expect(anim.keyframes).toBeDefined();
    expect(anim.keyframes!.format).toBe("percentage");
    expect(anim.keyframes!.keyframes).toHaveLength(3);

    expect(anim.keyframes!.keyframes[0].percentage).toBe(0);
    expect(anim.keyframes!.keyframes[0].properties.x).toBe(0);
    expect(anim.keyframes!.keyframes[0].properties.opacity).toBe(1);

    expect(anim.keyframes!.keyframes[1].percentage).toBe(50);
    expect(anim.keyframes!.keyframes[1].properties.x).toBe(100);
    expect(anim.keyframes!.keyframes[1].ease).toBe("power2.out");

    expect(anim.keyframes!.keyframes[2].percentage).toBe(100);
    expect(anim.keyframes!.keyframes[2].properties.x).toBe(200);
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
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    const anim = result.animations[0];
    expect(anim.keyframes).toBeDefined();
    expect(anim.keyframes!.format).toBe("object-array");
    expect(anim.keyframes!.keyframes).toHaveLength(3);

    // Total duration = 0.5 + 1 + 0.8 = 2.3
    expect(anim.keyframes!.keyframes[0].percentage).toBe(0);
    expect(anim.keyframes!.keyframes[0].properties.x).toBe(0);
    expect(anim.keyframes!.keyframes[0].properties.opacity).toBe(1);

    // Second: cumulative = 0.5, pct = round(0.5/2.3 * 100) = 22
    expect(anim.keyframes!.keyframes[1].percentage).toBe(22);
    expect(anim.keyframes!.keyframes[1].properties.x).toBe(100);
    expect(anim.keyframes!.keyframes[1].ease).toBe("power2.out");

    // Third: cumulative = 1.5, pct = round(1.5/2.3 * 100) = 65
    expect(anim.keyframes!.keyframes[2].percentage).toBe(65);
    expect(anim.keyframes!.keyframes[2].properties.x).toBe(200);
  });

  it("parses simple array keyframes format", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", {
        keyframes: { x: [0, 100, 200, 0], opacity: [0, 1, 1, 0], easeEach: "power2.inOut" },
        duration: 5
      }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    const anim = result.animations[0];
    expect(anim.keyframes).toBeDefined();
    expect(anim.keyframes!.format).toBe("simple-array");
    expect(anim.keyframes!.easeEach).toBe("power2.inOut");
    expect(anim.keyframes!.keyframes).toHaveLength(4);

    // Evenly spaced: 0%, 33%, 67%, 100%
    expect(anim.keyframes!.keyframes[0].percentage).toBe(0);
    expect(anim.keyframes!.keyframes[0].properties.x).toBe(0);
    expect(anim.keyframes!.keyframes[0].properties.opacity).toBe(0);

    expect(anim.keyframes!.keyframes[1].percentage).toBe(33);
    expect(anim.keyframes!.keyframes[1].properties.x).toBe(100);
    expect(anim.keyframes!.keyframes[1].properties.opacity).toBe(1);

    expect(anim.keyframes!.keyframes[2].percentage).toBe(67);
    expect(anim.keyframes!.keyframes[2].properties.x).toBe(200);
    expect(anim.keyframes!.keyframes[2].properties.opacity).toBe(1);

    expect(anim.keyframes!.keyframes[3].percentage).toBe(100);
    expect(anim.keyframes!.keyframes[3].properties.x).toBe(0);
    expect(anim.keyframes!.keyframes[3].properties.opacity).toBe(0);
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
    const id = getAnimId(script);
    const updated = convertToKeyframesInScript(script, id, { x: 0, opacity: 1 });
    const reparsed = parseGsapScript(updated);
    const anim = reparsed.animations[0];

    expect(anim.method).toBe("to");
    expect(anim.keyframes).toBeDefined();
    const kfs = anim.keyframes!.keyframes;
    expect(kfs[0].properties.x).toBe(-200);
    expect(kfs[0].properties.opacity).toBe(0);
    expect(kfs[1].properties.x).toBe(0);
    expect(kfs[1].properties.opacity).toBe(1);
  });

  it("convertToKeyframesInScript — converts fromTo() to to() + keyframes", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#title", { x: -100 }, { x: 100, duration: 1 }, 0);
    `;
    const id = getAnimId(script);
    const updated = convertToKeyframesInScript(script, id);
    const reparsed = parseGsapScript(updated);
    const anim = reparsed.animations[0];

    expect(anim.method).toBe("to");
    expect(anim.keyframes).toBeDefined();
    const kfs = anim.keyframes!.keyframes;
    expect(kfs[0].properties.x).toBe(-100);
    expect(kfs[1].properties.x).toBe(100);
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
  });
});
