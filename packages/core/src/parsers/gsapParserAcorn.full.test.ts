// fallow-ignore-file code-duplication
/**
 * T6d: parse-parity suite — runs the full gsapParser.test.ts parse scenarios
 * against parseGsapScriptAcorn.  Write-path tests are it.skip'd; those live
 * in gsapWriter.acorn.test.ts.
 *
 * Trust model: assertions here trust the recast-baseline outputs from
 * gsapParser.test.ts as ground truth.  T6b (gsapParser.acorn.test.ts) carries
 * the real behavioral parity contract; this file widens coverage to the full
 * corpus without duplicating the contract commentary.
 * motionPath parity tests live in the Phase 3b commit (PR #1379) because that
 * commit adds the acorn motionPath parser itself.
 */
import { describe, it, expect } from "vitest";
import { parseGsapScriptAcorn } from "./gsapParserAcorn.js";
import { serializeGsapAnimations } from "./gsapSerialize.js";
import type { GsapAnimation, GsapPercentageKeyframe } from "./gsapSerialize.js";
import { classifyPropertyGroup, classifyTweenPropertyGroup } from "./gsapConstants.js";

const parseGsapScript = parseGsapScriptAcorn;

// ── Local helpers ─────────────────────────────────────────────────────────────

function parseAndSerialize(script: string) {
  const parsed = parseGsapScript(script);
  const serialized = serializeGsapAnimations(parsed.animations, parsed.timelineVar, {
    preamble: parsed.preamble,
    postamble: parsed.postamble,
  });
  return { parsed, serialized };
}

function parseSingleAnimation(script: string): GsapAnimation {
  const result = parseGsapScript(script);
  expect(result.animations).toHaveLength(1);
  return result.animations[0]!;
}

function expectKeyframe(
  kf: GsapPercentageKeyframe,
  percentage: number,
  properties: Record<string, number | string>,
  ease?: string,
): void {
  expect(kf.percentage).toBe(percentage);
  for (const [key, value] of Object.entries(properties)) {
    expect(kf.properties[key]).toBe(value);
  }
  if (ease !== undefined) expect(kf.ease).toBe(ease);
}

function expectKeyframesFormat(
  anim: GsapAnimation,
  format: string,
  count: number,
): GsapPercentageKeyframe[] {
  expect(anim.keyframes).toBeDefined();
  expect(anim.keyframes!.format).toBe(format);
  expect(anim.keyframes!.keyframes).toHaveLength(count);
  return anim.keyframes!.keyframes;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

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

// ── parseGsapScript ───────────────────────────────────────────────────────────

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

    expect(result1.animations[0].id).toBe(result2.animations[0].id);
    expect(result1.animations[1].id).toBe(result2.animations[1].id);

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

// ── resolvedStart ─────────────────────────────────────────────────────────────

describe("resolvedStart — timeline position resolution", () => {
  it("resolves chained from() tweens with relative positions (sdk-test pattern)", () => {
    const script = `
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from("#headline", { duration: 0.6, scale: 0.92, transformOrigin: "left center" })
        .from("#subtext",  { duration: 0.5, scale: 0.92, transformOrigin: "left center" }, "-=0.3")
        .from("#box",      { duration: 0.5, scale: 0.5,  transformOrigin: "center center" }, "-=0.3");
    `;
    const result = parseGsapScript(script);

    expect(result.animations).toHaveLength(3);
    expect(result.animations[0].targetSelector).toBe("#headline");
    expect(result.animations[1].targetSelector).toBe("#subtext");
    expect(result.animations[2].targetSelector).toBe("#box");

    expect(result.animations[0].resolvedStart).toBe(0);
    expect(result.animations[0].implicitPosition).toBe(true);

    expect(result.animations[1].resolvedStart).toBe(0.3);

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

    expect(result.animations[0].resolvedStart).toBe(1);
    expect(result.animations[1].resolvedStart).toBe(1);
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

    expect(result.animations[0].resolvedStart).toBe(0);
    expect(result.animations[0].implicitPosition).toBe(true);

    expect(result.animations[1].resolvedStart).toBe(0.5);
    expect(result.animations[1].implicitPosition).toBe(true);

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

    expect(result.animations[0].resolvedStart).toBe(0);
    expect(result.animations[1].resolvedStart).toBe(0.5);
  });

  it("treats set() as zero-duration", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.set("#el1", { opacity: 0 });
      tl.to("#el2", { opacity: 1, duration: 1 });
    `;
    const result = parseGsapScript(script);

    expect(result.animations[0].resolvedStart).toBe(0);
    expect(result.animations[1].resolvedStart).toBe(0);
  });
});

// ── timeline defaults ─────────────────────────────────────────────────────────

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

    expect(result.animations[0].resolvedStart).toBe(0);
    expect(result.animations[1].resolvedStart).toBe(0.8);
  });
});

// ── property group classification ─────────────────────────────────────────────

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

// ── stagger / yoyo / repeat ───────────────────────────────────────────────────

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

  it.skip("survives a full parse-edit-serialize round-trip with stagger intact (write-path)", () => {
    // Requires updateAnimationInScript — tested in gsapWriter.acorn.test.ts
  });
});

// ── unresolvable value round-trip ─────────────────────────────────────────────

describe("unresolvable value round-trip", () => {
  it("preserves unresolvable property values through serialize", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: someFn(), x: 50, duration: 1 }, 0);
    `;
    const { serialized } = parseAndSerialize(script);

    expect(serialized).toContain("opacity: someFn()");
    expect(serialized).toContain("x: 50");
  });

  it("preserves complex unresolvable expressions", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { x: getOffset() + 10, y: 200, duration: 1 }, 0);
    `;
    const parsed = parseGsapScript(script);

    expect(parsed.animations[0].properties.y).toBe(200);
    expect(String(parsed.animations[0].properties.x)).toMatch(/^__raw:/);
  });
});

// ── variable-target resolution ────────────────────────────────────────────────

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

// ── array targets ─────────────────────────────────────────────────────────────

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

  it.skip("does not rewrite the array argument when editing the tween (write-path)", () => {
    // Requires updateAnimationInScript — tested in gsapWriter.acorn.test.ts
  });
});

// ── chained tween calls ───────────────────────────────────────────────────────

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

  it.skip("edits one link of a chain in place, leaving the other intact (write-path)", () => {
    // Requires updateAnimationInScript — tested in gsapWriter.acorn.test.ts
  });

  it.skip("deletes one link of a chain, keeping the other (write-path)", () => {
    // Requires removeAnimationFromScript — tested in gsapWriter.acorn.test.ts
  });
});

// ── gsap.utils.toArray targets ────────────────────────────────────────────────

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

// ── lexical scoping ───────────────────────────────────────────────────────────

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

// ── forEach / map callback targets ────────────────────────────────────────────

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

// ── native GSAP keyframes parsing ─────────────────────────────────────────────

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

    expectKeyframe(kfs[0], 22, { x: 0, opacity: 1 });
    expectKeyframe(kfs[1], 65, { x: 100 }, "power2.out");
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

    expect(anim.ease).toBe("none");
    expect(anim.keyframes!.easeEach).toBe("power2.out");
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

// ── motionPath parsing ────────────────────────────────────────────────────────

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
