// fallow-ignore-file code-duplication
/**
 * Correctness regressions for the SDK-cutover review (PR #1539).
 *
 * Each test asserts the REAL-WORLD-CORRECT result of a write op — NOT mere
 * agreement between the two writers. Several of these scenarios were cases where
 * both writers were identically wrong (so the recast-vs-acorn parity suite stayed
 * green); these tests pin the corrected behavior.
 */
import { describe, expect, it } from "vitest";
import {
  removeKeyframeFromScript,
  updateKeyframeInScript,
  setArcPathInScript,
  updateArcSegmentInScript,
  splitAnimationsInScript,
  unrollDynamicAnimations,
  updateAnimationInScript,
  convertToKeyframesFromScript,
} from "./gsapWriterAcorn.js";
import { parseGsapScriptAcornForWrite } from "./gsapParserAcorn.js";

// ── #2 — findKfPropByPct must hit the CLOSEST keyframe, not first-within-2% ──

const KF_DENSE = `var tl = gsap.timeline({ paused: true });
tl.to("#box", { keyframes: { "0%": { opacity: 0 }, "49%": { opacity: 0.4 }, "50%": { opacity: 0.5 }, "100%": { opacity: 1 } }, duration: 1 }, 0);`;
const KF_DENSE_ID = "#box-to-0-visual";

describe("#2 — keyframe ops target the closest percentage, not first-within-tolerance", () => {
  it("removing 50% removes 50% and KEEPS the neighboring 49%", () => {
    const result = removeKeyframeFromScript(KF_DENSE, KF_DENSE_ID, 50);
    expect(result).not.toContain('"50%"');
    expect(result).toContain('"49%"');
    expect(result).toContain("opacity: 0.4"); // 49% body intact
    expect(result).toContain('"0%"');
    expect(result).toContain('"100%"');
  });

  it("updating ~50% overwrites 50% (closest), not 49%", () => {
    const result = updateKeyframeInScript(KF_DENSE, KF_DENSE_ID, 51, { opacity: 0.99 });
    // 50% is closest to 51 (dist 1) vs 49 (dist 2) — 50% gets the new value.
    expect(result).toContain('"50%": { opacity: 0.99 }');
    // 49% must be untouched.
    expect(result).toContain('"49%": { opacity: 0.4 }');
  });
});

// ── #4 — enableArcPath on an x/y-only tween must not produce '{}' ──

describe("#4 — enableArcPath on x/y-only vars yields a real motionPath", () => {
  const XY_ONLY = `var tl = gsap.timeline({ paused: true });
tl.to("#h", { x: 100, y: 50 }, 0);`;

  it("emits a motionPath, drops x/y, and reparses with the arc enabled", () => {
    const out = setArcPathInScript(XY_ONLY, "#h-to-0-position", {
      enabled: true,
      autoRotate: false,
      segments: [],
    });
    expect(out).toContain("motionPath");
    expect(out).toContain("path:");
    // The collision bug produced a bare '{}' (no motionPath, no x/y).
    expect(out).not.toMatch(/\{\s*\}/);

    // x/y are folded into the motionPath waypoints, not left as top-level vars.
    const reparsed = parseGsapScriptAcornForWrite(out);
    const anim = reparsed?.located[0]?.animation;
    expect(anim?.arcPath?.enabled).toBe(true);
    expect("x" in (anim?.properties ?? {})).toBe(false);
    expect("y" in (anim?.properties ?? {})).toBe(false);
  });
});

// ── #5 — split midpoint uses forward baseline (earlier tweens), not reverse ──

describe("#5 — split-spanning midpoint interpolates from the forward baseline", () => {
  // A ends at x:100 (t=0..1). B runs x:?→300 over t=1..3. Split at t=2 lands at
  // B's 50% point: mid = 100 + (300-100)*0.5 = 200 (NOT 150 from a 0 baseline).
  const TWO_TWEENS = `var tl = gsap.timeline({ paused: true });
tl.to("#el", { x: 100, duration: 1 }, 0);
tl.to("#el", { x: 300, duration: 2 }, 1);`;

  it("computes midpoint x = 200 (100 + (300-100)*0.5), not 150", () => {
    const { script } = splitAnimationsInScript(TWO_TWEENS, {
      originalId: "el",
      newId: "el2",
      splitTime: 2,
    });
    expect(script).toContain("x: 200");
    expect(script).not.toContain("x: 150");
    // The new element's second half starts from the midpoint, not from 0.
    expect(script).toContain('tl.fromTo("#el2", { x: 200 }');
  });
});

// ── #9 — unroll preserves non-target statements (tl.set) per iteration ──

describe("#9 — unrollDynamicAnimations keeps sibling statements in the loop body", () => {
  const LOOP = `var tl = gsap.timeline({ paused: true });
for (let i = 0; i < 2; i++) {
  tl.set(items[i], { autoAlpha: 0 }, 0);
  tl.to(items[i], { opacity: 1, duration: 1 }, 0);
}`;

  it("the tl.set initial-state lines survive after unrolling the tl.to", () => {
    const parsed = parseGsapScriptAcornForWrite(LOOP);
    const targetId = parsed?.located.find((l) => l.animation.method === "to")?.id ?? "";
    const out = unrollDynamicAnimations(LOOP, targetId, [
      {
        selector: "#a",
        keyframes: [
          { percentage: 0, properties: { opacity: 0 } },
          { percentage: 100, properties: { opacity: 1 } },
        ],
      },
      {
        selector: "#b",
        keyframes: [
          { percentage: 0, properties: { opacity: 0 } },
          { percentage: 100, properties: { opacity: 1 } },
        ],
      },
    ]);
    // Both tl.set lines must remain (one per iteration) — the blanket-overwrite
    // bug destroyed every non-target statement in the loop body.
    expect((out.match(/tl\.set\(/g) ?? []).length).toBe(2);
    expect(out).toContain("autoAlpha: 0");
    // The for-loop itself is gone (unrolled).
    expect(out).not.toContain("for (");
    // The target tween is unrolled to static selectors.
    expect(out).toContain('tl.to("#a"');
    expect(out).toContain('tl.to("#b"');
  });

  it("an empty element list is a no-op, not an animation-deleting overwrite", () => {
    const parsed = parseGsapScriptAcornForWrite(LOOP);
    const targetId = parsed?.located.find((l) => l.animation.method === "to")?.id ?? "";
    // Empty elements has no unrolled form — overwriting the loop with zero calls
    // would silently delete the animation. Writer must return the script verbatim.
    expect(unrollDynamicAnimations(LOOP, targetId, [])).toBe(LOOP);
  });
});

// ── R3 — unsafe sibling reproduction must refuse (no-op), never corrupt/drop ──

const TWO_EL = [
  { selector: "#a", keyframes: [{ percentage: 100, properties: { opacity: 1 } }] },
  { selector: "#b", keyframes: [{ percentage: 100, properties: { opacity: 1 } }] },
];
function targetToId(script: string): string {
  return (
    parseGsapScriptAcornForWrite(script)?.located.find((l) => l.animation.method === "to")?.id ?? ""
  );
}
function parses(src: string): boolean {
  try {
    new Function(src);
    return true;
  } catch {
    return false;
  }
}

describe("R3 — unroll refuses (no-ops) when siblings can't be safely reproduced", () => {
  // R2 carried a forEach WITH a sibling tl.set to the blanket overwrite, which
  // dropped the tl.set (elements start visible instead of hidden). The numeric
  // index a `for` loop provides isn't available, so we now refuse instead.
  it("forEach with a sibling statement is left untouched, not flattened-and-dropped", () => {
    const FOREACH = `var tl = gsap.timeline({ paused: true });
items.forEach((item, i) => {
  tl.set(item, { autoAlpha: 0 }, 0);
  tl.to(item, { opacity: 1, duration: 1 }, 0);
});`;
    expect(unrollDynamicAnimations(FOREACH, targetToId(FOREACH), TWO_EL)).toBe(FOREACH);
  });

  // R3 #1 — object shorthand { i }: substituting the value yields `{ 0 }` (invalid).
  it("object shorthand using the index refuses rather than emit invalid `{ 0 }`", () => {
    const SHORTHAND = `var tl = gsap.timeline({ paused: true });
for (let i = 0; i < 2; i++) {
  tl.set(items[i], { data: { i } }, 0);
  tl.to(items[i], { opacity: 1, duration: 1 }, 0);
}`;
    const out = unrollDynamicAnimations(SHORTHAND, targetToId(SHORTHAND), TWO_EL);
    expect(out).toBe(SHORTHAND);
    expect(parses(out)).toBe(true);
  });

  // R3 #2 — a sibling that re-declares the index (nested for / shadowing).
  it("a sibling shadowing the index refuses rather than rewrite the inner binding", () => {
    const SHADOW = `var tl = gsap.timeline({ paused: true });
for (let i = 0; i < 2; i++) {
  tl.set(items[i], { onStart() { for (let i = 0; i < 3; i++) log(i); } }, 0);
  tl.to(items[i], { opacity: 1, duration: 1 }, 0);
}`;
    const out = unrollDynamicAnimations(SHADOW, targetToId(SHADOW), TWO_EL);
    expect(out).toBe(SHADOW);
    expect(parses(out)).toBe(true);
  });

  // The safe for-loop sibling case must still unroll (regression guard).
  it("a plain for-loop with an items[i] sibling still unrolls and preserves it", () => {
    const SAFE = `var tl = gsap.timeline({ paused: true });
for (let i = 0; i < 2; i++) {
  tl.set(items[i], { autoAlpha: 0 }, 0);
  tl.to(items[i], { opacity: 1, duration: 1 }, 0);
}`;
    const out = unrollDynamicAnimations(SAFE, targetToId(SAFE), TWO_EL);
    expect((out.match(/tl\.set\(/g) ?? []).length).toBe(2);
    expect(out).not.toContain("for (");
    expect(parses(out)).toBe(true);
  });
});

// ── R2 #5 — index substitution is AST-based: string literals are never corrupted ──

describe("R2 — unroll substitutes real index uses but not the index char in strings", () => {
  const LOOP_STR = `var tl = gsap.timeline({ paused: true });
for (let i = 0; i < 2; i++) {
  tl.set(items[i], { id: "row-i" }, 0);
  tl.to(items[i], { opacity: 1, duration: 1 }, 0);
}`;

  it('rewrites items[i] per iteration but leaves the "row-i" string intact', () => {
    const parsed = parseGsapScriptAcornForWrite(LOOP_STR);
    const targetId = parsed?.located.find((l) => l.animation.method === "to")?.id ?? "";
    const out = unrollDynamicAnimations(LOOP_STR, targetId, [
      { selector: "#a", keyframes: [{ percentage: 100, properties: { opacity: 1 } }] },
      { selector: "#b", keyframes: [{ percentage: 100, properties: { opacity: 1 } }] },
    ]);
    // Real uses of the index are substituted…
    expect(out).toContain("items[0]");
    expect(out).toContain("items[1]");
    // …but the literal "row-i" is untouched (the regex bug rewrote it to "row-0").
    expect(out).toContain('"row-i"');
    expect(out).not.toContain('"row-0"');
  });
});

// ── #10 — per-segment curviness survives serialization ──

describe("#10 — updateArcSegment on a non-first segment reflects its curviness", () => {
  // 3-waypoint arc, uniform curviness 1.5 → change segment 1 to curviness 3.
  const ARC = `var tl = gsap.timeline({ paused: true });
tl.to("#h", { motionPath: { path: [{x: 0, y: 0}, {x: 100, y: 50}, {x: 200, y: 0}], curviness: 1.5 }, duration: 1 }, 0);`;

  it("does not drop the second segment's curve (no longer serializes only segments[0])", () => {
    const parsed = parseGsapScriptAcornForWrite(ARC);
    const id = parsed?.located[0]?.id ?? "";
    const out = updateArcSegmentInScript(ARC, id, 1, { curviness: 3 });

    // With differing per-segment curviness, the only representation that carries
    // both is the cubic form. The simple form (which only emits one scalar
    // curviness) would silently drop segment 1's change.
    expect(out).toContain('type: "cubic"');

    // Compare against the SAME-shape arc left at uniform curviness 1.5: the
    // segment-1 control points must DIFFER, proving curviness 3 took effect.
    const uniformOut = updateArcSegmentInScript(ARC, id, 1, { curviness: 1.5 });
    expect(out).not.toBe(uniformOut);
  });
});

// ── #11 — disableArcPath recovers NEGATIVE destination coordinates ──

describe("#11 — disableArcPath restores negative waypoint coords", () => {
  it("restores x:-120, y:-40 on the flattened tween", () => {
    const XY_NEG = `var tl = gsap.timeline({ paused: true });
tl.to("#h", { x: -120, y: -40, duration: 1 }, 0);`;
    const enabled = setArcPathInScript(XY_NEG, "#h-to-0-position", {
      enabled: true,
      autoRotate: false,
      segments: [],
    });
    const reEnabled = parseGsapScriptAcornForWrite(enabled);
    const id = reEnabled?.located[0]?.id ?? "";
    const disabled = setArcPathInScript(enabled, id, {
      enabled: false,
      autoRotate: false,
      segments: [],
    });
    // The negative destination must come back — the UnaryExpression bug lost it.
    expect(disabled).toContain("x: -120");
    expect(disabled).toContain("y: -40");
    expect(disabled).not.toContain("motionPath");
  });
});

// ── #7 — updating ease on a keyframe tween routes to easeEach, not top-level ──

describe("#7 — ease update on a keyframe tween targets keyframes.easeEach", () => {
  const KF = `var tl = gsap.timeline({ paused: true });
tl.to(".a", { keyframes: { "0%": { x: 0 }, "100%": { x: 100 } }, duration: 1, ease: "none" }, 0);`;

  it("writes easeEach (per-keyframe), not a no-op top-level ease", () => {
    const id = parseGsapScriptAcornForWrite(KF)?.located[0]?.id ?? "";
    const out = updateAnimationInScript(KF, id, { ease: "power2.inOut" });
    expect(out).toContain('easeEach: "power2.inOut"');
    // The original top-level `ease: "none"` is untouched (no second top-level ease).
    expect((out.match(/ease: "power2.inOut"/g) ?? []).length).toBe(0);
  });
});

// ── #8 — convertToKeyframes preserves builtin vars like `delay` ──

describe("#8 — convertToKeyframes keeps delay (was dropped, shifting start time)", () => {
  const DELAY = `var tl = gsap.timeline({ paused: true });
tl.to(".a", { x: 100, duration: 1, delay: 0.3 }, 0);`;

  it("preserves delay on the converted vars object", () => {
    const id = parseGsapScriptAcornForWrite(DELAY)?.located[0]?.id ?? "";
    const out = convertToKeyframesFromScript(DELAY, id);
    expect(out).toContain("keyframes:");
    expect(out).toContain("delay: 0.3"); // was lost → tween started 0.3s early
    expect(out).toContain("duration: 1");
  });
});
