import { describe, it, expect } from "vitest";
import {
  parseGsapScript,
  gsapAnimationsToKeyframes,
  SUPPORTED_PROPS,
  SUPPORTED_EASES,
  serializeGsapAnimations,
  validateCompositionGsap,
  getAnimationsForElement,
  keyframesToGsapAnimations,
  addAnimationToScript,
  removeAnimationFromScript,
  updateAnimationInScript,
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

describe("getAnimationsForElement", () => {
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

    const result = getAnimationsForElement(animations, "el1");
    expect(result).toHaveLength(2);
    expect(result.every((a) => a.targetSelector === "#el1")).toBe(true);
  });

  it("returns empty array when no animations match", () => {
    const animations: GsapAnimation[] = [
      { id: "a1", targetSelector: "#el1", method: "set", position: 0, properties: { opacity: 0 } },
    ];

    const result = getAnimationsForElement(animations, "el99");
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
