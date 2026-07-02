/**
 * Motion-introspection eval regressions (the `hyperframes motion` read path).
 *
 * Each block targets one bug the tooling eval surfaced where the parser was
 * blind to authored motion. Minimal inline scripts reproduce the wrong output,
 * then assert the fixed behavior.
 */
import { describe, it, expect } from "vitest";
import { parseGsapScriptAcorn } from "./gsapParserAcorn.js";

const start = (a: { resolvedStart?: number }): number | undefined => a.resolvedStart;

// ── Bug #2: constant expression folding (member / array-index / Math.*) ───────

describe("motion eval — constant expression folding (#2)", () => {
  it("folds object-member access (H.bar0 / 200)", () => {
    const { animations } = parseGsapScriptAcorn(`
      const H = { bar0: 100, bar1: 50 };
      const tl = gsap.timeline({ paused: true });
      tl.to("#bar0", { scaleY: H.bar0 / 200, duration: 0.7 }, 0.3);
    `);
    expect(animations[0]!.properties.scaleY).toBe(0.5);
  });

  it("folds nested array index (SPARK[0][1])", () => {
    const { animations } = parseGsapScriptAcorn(`
      const SPARK = [[10, 20], [30, 40]];
      const tl = gsap.timeline({ paused: true });
      tl.to("#m", { x: SPARK[0][1], y: SPARK[1][0], duration: 0.3 }, 0);
    `);
    expect(animations[0]!.properties.x).toBe(20);
    expect(animations[0]!.properties.y).toBe(30);
  });

  it("folds whitelisted Math.* over constant args", () => {
    const { animations } = parseGsapScriptAcorn(`
      const tl = gsap.timeline({ paused: true });
      tl.to("#m", { x: Math.round(2.6), y: Math.max(3, 7), r: Math.PI, duration: 0.3 }, 0);
    `);
    expect(animations[0]!.properties.x).toBe(3);
    expect(animations[0]!.properties.y).toBe(7);
    expect(animations[0]!.properties.r).toBeCloseTo(Math.PI);
  });

  it("leaves genuinely runtime-dynamic values as __raw", () => {
    const { animations } = parseGsapScriptAcorn(`
      const tl = gsap.timeline({ paused: true });
      tl.to("#m", { x: someFn(), duration: 0.3 }, 0);
    `);
    expect(String(animations[0]!.properties.x)).toMatch(/^__raw:/);
  });
});

// ── Bug #1: gsap.set() pre-state seeds the next tween's from-keyframe ──────────

describe("motion eval — set() seeds tween start (#1)", () => {
  it("seeds scaleY:0 from gsap.set before a .to(scaleY:1)", () => {
    const { animations } = parseGsapScriptAcorn(`
      gsap.set("#bar", { scaleY: 0 });
      const tl = gsap.timeline({ paused: true });
      tl.to("#bar", { scaleY: 1, duration: 0.7 }, 0.3);
    `);
    const grow = animations.find((a) => a.targetSelector === "#bar" && a.method === "to")!;
    expect(grow.fromProperties?.scaleY).toBe(0);
  });

  it("uses the most recent set() value and only for omitted from-props", () => {
    const { animations } = parseGsapScriptAcorn(`
      gsap.set("#x", { opacity: 0, y: 8 });
      const tl = gsap.timeline({ paused: true });
      tl.set("#x", { opacity: 0.2 }, 0);
      tl.to("#x", { opacity: 1, y: 0, duration: 0.5 }, 0.3);
    `);
    const t = animations.find((a) => a.method === "to")!;
    expect(t.fromProperties?.opacity).toBe(0.2); // most recent set wins
    expect(t.fromProperties?.y).toBe(8);
  });
});

// ── Bug #3: labels & label-relative positions ─────────────────────────────────

describe("motion eval — label-relative positions (#3)", () => {
  it("resolves numeric-label and label+=n positions to absolute times", () => {
    const { animations } = parseGsapScriptAcorn(`
      const tl = gsap.timeline({ paused: true });
      tl.to("#c", { x: 10, duration: 1.1 }, 0);
      tl.addLabel("press", 1.1);
      tl.to("#c", { x: 20, duration: 0.12 }, "press");
      tl.to("#b", { scale: 1, duration: 0.32 }, "press+=0.12");
      tl.addLabel("loading", "press+=0.18");
      tl.to("#l", { opacity: 1, duration: 0.2 }, "loading");
    `);
    const bySel = (s: string, i = 0) => animations.filter((a) => a.targetSelector === s)[i]!;
    expect(start(bySel("#c", 1))).toBeCloseTo(1.1);
    expect(start(bySel("#b"))).toBeCloseTo(1.22);
    expect(start(bySel("#l"))).toBeCloseTo(1.28); // press(1.1)+0.18
  });
});

// ── Bug #4: collection aliases (slice / index) keep the selector ──────────────

describe("motion eval — collection aliases (#4)", () => {
  it("resolves selector for glyphs.slice() / glyphs[0] aliases of toArray()", () => {
    const { animations } = parseGsapScriptAcorn(`
      const glyphs = gsap.utils.toArray(".glyph");
      const lead = glyphs[0];
      const rest = glyphs.slice(1);
      const tl = gsap.timeline({ paused: true });
      tl.to(lead, { y: 0, duration: 0.5 }, 0.2);
      tl.to(rest, { y: 0, duration: 0.6, stagger: 0.085 }, 0.5);
    `);
    expect(animations[0]!.targetSelector).toBe(".glyph");
    expect(animations[1]!.targetSelector).toBe(".glyph");
    expect(animations[1]!.hasUnresolvedSelector).toBeUndefined();
    // stagger still preserved in extras
    expect(animations[1]!.extras?.stagger).toBeDefined();
  });
});

// ── Bug: staggered collection tweens read as flat no-ops ──────────────────────

describe("motion eval — staggered collection tweens are honest", () => {
  it("surfaces real from/to + stagger for a staggered .from reveal (not a flat no-op)", () => {
    const { animations } = parseGsapScriptAcorn(`
      const tl = gsap.timeline({ paused: true });
      tl.from(".glyph", { yPercent: 120, stagger: 0.08, duration: 0.5 }, 0);
    `);
    const a = animations[0]!;
    // Surfaced as keyframes so the `motion` text shows real per-element motion.
    const kfs = a.keyframes?.keyframes ?? [];
    expect(kfs.length).toBeGreaterThan(0);
    // from() plays vars → rest: 120 → 0, a real non-no-op move.
    expect(kfs[0]!.properties.yPercent).toBe(120);
    expect(kfs.at(-1)!.properties.yPercent).toBe(0);
    // The per-element stagger is noted on the surfaced keyframes.
    expect(kfs.every((k) => k.properties.stagger === 0.08)).toBe(true);
    // Per-element duration preserved; selector + extras untouched (round-trip safe).
    expect(a.duration).toBe(0.5);
    expect(a.targetSelector).toBe(".glyph");
    expect(a.extras?.stagger).toBeDefined();
  });

  it("notes the stagger even when a .to lands on the rest pose (1→1 case)", () => {
    // to(rest-pose) reads as 1→1; without the stagger note it looks like a no-op.
    const { animations } = parseGsapScriptAcorn(`
      const tl = gsap.timeline({ paused: true });
      tl.to(".glyph", { scaleY: 1, scaleX: 1, yPercent: 0, duration: 0.18,
        stagger: { each: 0.012, from: "center" } }, 0);
    `);
    const a = animations[0]!;
    const kfs = a.keyframes?.keyframes ?? [];
    expect(kfs.length).toBeGreaterThan(0);
    // The collection still reads as animating: the per-element stagger is shown.
    expect(kfs.every((k) => k.properties.stagger === 0.012)).toBe(true);
    expect(a.duration).toBe(0.18);
  });

  it("leaves a non-staggered single tween untouched (no synthetic keyframes)", () => {
    const { animations } = parseGsapScriptAcorn(`
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", { x: 100, duration: 0.4 }, 0);
    `);
    expect(animations[0]!.targetSelector).toBe("#hero");
    expect(animations[0]!.keyframes).toBeUndefined();
  });
});

// ── Bug #11 / #5: dwell tweens & onUpdate proxy clarity ───────────────────────

describe("motion eval — dwell / proxy targets (#11, #5)", () => {
  it("labels empty-target dwell tweens instead of __unresolved__", () => {
    const { animations } = parseGsapScriptAcorn(`
      const tl = gsap.timeline({ paused: true });
      tl.to({}, { duration: 2.8 }, 2.2);
    `);
    const dwell = animations[0]!;
    expect(dwell.targetSelector).not.toBe("__unresolved__");
    expect(dwell.targetSelector).toContain("dwell");
    expect(dwell.duration).toBe(2.8);
  });

  it("labels an onUpdate proxy tween with its driven DOM property", () => {
    const { animations } = parseGsapScriptAcorn(`
      const tl = gsap.timeline({ paused: true });
      const s = { u: 0 };
      tl.to(s, { u: 1, duration: 2.2, onUpdate: function () {
        document.querySelector("#trace").setAttribute("stroke-dashoffset", s.u);
      } }, 0.2);
    `);
    const drv = animations[0]!;
    expect(drv.targetSelector).not.toBe("__unresolved__");
    expect(drv.targetSelector).toContain("stroke-dashoffset");
  });
});
