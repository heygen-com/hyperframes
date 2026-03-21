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

  it("parseObjectLiteral does not match negative numbers (known limitation)", () => {
    // The regex in parseObjectLiteral only matches [\d.]+, not negative numbers.
    // Negative values like x: -100 won't be parsed by the object literal parser.
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#el5", { opacity: 0, x: -100 }, { opacity: 1, x: 0, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);

    expect(result.animations).toHaveLength(1);
    const anim = result.animations[0];
    expect(anim.fromProperties).toBeDefined();
    expect(anim.fromProperties?.opacity).toBe(0);
    // -100 is not parseable by the regex, so x won't be in fromProperties
    expect(anim.fromProperties?.x).toBeUndefined();
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

  it("filters out unsupported properties from animations", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1, backgroundColor: "red", x: 50, duration: 0.5 }, 0);
    `;
    const result = parseGsapScript(script);

    expect(result.animations[0].properties.opacity).toBe(1);
    expect(result.animations[0].properties.x).toBe(50);
    // backgroundColor is not in SUPPORTED_PROPS, so it's filtered out
    expect(result.animations[0].properties.backgroundColor).toBeUndefined();
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
        properties: { opacity: 1, x: 50, someUnsupportedProp: "value" } as Record<string, number | string>,
        duration: 1,
      },
    ];

    const keyframes = gsapAnimationsToKeyframes(animations, 0);

    expect(keyframes).toHaveLength(1);
    expect(keyframes[0].properties.opacity).toBe(1);
    expect(keyframes[0].properties.x).toBe(50);
    // String values are skipped (typeof value !== "number" check)
    expect((keyframes[0].properties as Record<string, unknown>).someUnsupportedProp).toBeUndefined();
  });

  it("skips base set keyframes at time 0 when skipBaseSet is true", () => {
    const animations: GsapAnimation[] = [
      {
        id: "anim-1",
        targetSelector: "#el1",
        method: "set",
        position: 5,
        properties: { x: 0, y: 0, scale: 1 },
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

    // The set at position 5 (time=0) with x=0, y=0, scale=1 (base values) should be skipped
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
    const keyframes: Keyframe[] = [
      { id: "kf-1", time: 0, properties: { x: 10, y: 20, scale: 2 } },
    ];

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
      { id: "a2", targetSelector: "#el2", method: "to", position: 0, properties: { opacity: 1 }, duration: 1 },
      { id: "a3", targetSelector: "#el1", method: "to", position: 1, properties: { opacity: 1 }, duration: 0.5 },
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
