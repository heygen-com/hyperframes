// fallow-ignore-file code-duplication
/**
 * T6c — acorn write path with magic-string offset-splice.
 *
 * Verifies that each write op touches only the intended byte span and leaves
 * every other character identical to the original source.
 */
import { describe, expect, it } from "vitest";
import {
  addAnimationToScript,
  addKeyframeToScript,
  convertToKeyframesFromScript,
  removeAnimationFromScript,
  removeKeyframeFromScript,
  updateAnimationInScript,
  updateKeyframeInScript,
} from "./gsapWriterAcorn.js";
import { parseGsapScript } from "./gsapParser.js";

// ---------------------------------------------------------------------------
// Fixture scripts
// ---------------------------------------------------------------------------

const SCRIPT_A = `\
var tl = gsap.timeline({ paused: true });
tl.to("#hero", { opacity: 1, duration: 0.5, ease: "power3.out" }, 0.2);
window.__timelines["t"] = tl;`;

const SCRIPT_B = `\
var tl = gsap.timeline({ paused: true });
tl.to("#hero", { opacity: 1, duration: 0.5, ease: "power3.out" }, 0);
tl.to("#hero", { opacity: 0, duration: 0.3, ease: "power3.in" }, 1);
window.__timelines["t"] = tl;`;

const SCRIPT_C = `\
var tl = gsap.timeline({ paused: true });
tl.from(".a", { opacity: 0, duration: 0.5 }, 0)
  .from(".b", { opacity: 0, duration: 0.3 }, 0.5);
window.__timelines["t"] = tl;`;

// 3-keyframe script so removal leaves ≥2 kfs (no collapse needed)
const SCRIPT_D = `\
var tl = gsap.timeline({ paused: true });
tl.to("#box", { keyframes: { "0%": { opacity: 0 }, "50%": { opacity: 0.7 }, "100%": { opacity: 1 } }, duration: 0.5 }, 0.2);
window.__timelines["t"] = tl;`;

// ---------------------------------------------------------------------------
// No-op identity
// ---------------------------------------------------------------------------

describe("T6c — no-op identity", () => {
  it("updateAnimationInScript with empty updates returns identical script", () => {
    const result = updateAnimationInScript(SCRIPT_A, "#hero-to-200-visual", {});
    expect(result).toBe(SCRIPT_A);
  });

  it("updateAnimationInScript with unknown ID returns identical script", () => {
    const result = updateAnimationInScript(SCRIPT_A, "not-a-real-id", { ease: "power2.in" });
    expect(result).toBe(SCRIPT_A);
  });
});

// ---------------------------------------------------------------------------
// updateAnimationInScript
// ---------------------------------------------------------------------------

describe("T6c — updateAnimationInScript", () => {
  it("updates ease value in-place", () => {
    const result = updateAnimationInScript(SCRIPT_A, "#hero-to-200-visual", {
      ease: "power2.in",
    });
    expect(result).toContain('"power2.in"');
    expect(result).not.toContain('"power3.out"');
    // Preamble + postamble unchanged
    expect(result).toContain("var tl = gsap.timeline({ paused: true });");
    expect(result).toContain('window.__timelines["t"] = tl;');
  });

  it("updates duration value in-place", () => {
    const result = updateAnimationInScript(SCRIPT_A, "#hero-to-200-visual", {
      duration: 1.2,
    });
    expect(result).toContain("duration: 1.2");
    expect(result).not.toContain("duration: 0.5");
    expect(result).toContain('"power3.out"');
  });

  it("updates position arg in-place", () => {
    const result = updateAnimationInScript(SCRIPT_A, "#hero-to-200-visual", {
      position: 0.5,
    });
    expect(result).toContain("}, 0.5)");
    expect(result).not.toContain("}, 0.2)");
    expect(result).toContain("opacity: 1");
  });

  it("inserts ease when property was absent", () => {
    const noEase = `\
var tl = gsap.timeline({ paused: true });
tl.to("#hero", { opacity: 1, duration: 0.5 }, 0.2);
window.__timelines["t"] = tl;`;
    const result = updateAnimationInScript(noEase, "#hero-to-200-visual", {
      ease: "power3.out",
    });
    expect(result).toContain('ease: "power3.out"');
    // Duration, opacity, position unchanged
    expect(result).toContain("duration: 0.5");
    expect(result).toContain("opacity: 1");
    expect(result).toContain("}, 0.2)");
  });

  it("updates fromTo — ease on toVars", () => {
    const fromTo = `\
var tl = gsap.timeline({ paused: true });
tl.fromTo("#hero", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power3.out" }, 0.1);
window.__timelines["t"] = tl;`;
    // ID: target="#hero", method="fromTo", pos=0.1 → posKey=100, propertyGroup=visual
    const result = updateAnimationInScript(fromTo, "#hero-fromTo-100-visual", {
      ease: "back.out",
    });
    expect(result).toContain('"back.out"');
    expect(result).not.toContain('"power3.out"');
    expect(result).toContain("opacity: 0");
  });

  it("byte-identity outside edited ease span", () => {
    const result = updateAnimationInScript(SCRIPT_A, "#hero-to-200-visual", {
      ease: "power2.in",
    });
    const oldEaseStart = SCRIPT_A.indexOf('"power3.out"');
    const newEaseStart = result.indexOf('"power2.in"');
    // Everything before the ease value is identical
    expect(result.slice(0, newEaseStart)).toBe(SCRIPT_A.slice(0, oldEaseStart));
    // Everything after the ease value close-quote is identical
    const oldAfter = SCRIPT_A.slice(oldEaseStart + '"power3.out"'.length);
    const newAfter = result.slice(newEaseStart + '"power2.in"'.length);
    expect(newAfter).toBe(oldAfter);
  });
});

// ---------------------------------------------------------------------------
// removeAnimationFromScript
// ---------------------------------------------------------------------------

describe("T6c — removeAnimationFromScript", () => {
  it("removes a standalone tween statement", () => {
    const result = removeAnimationFromScript(SCRIPT_B, "#hero-to-0-visual");
    expect(result).not.toContain("power3.out");
    expect(result).toContain("power3.in");
    expect(result).toContain('window.__timelines["t"] = tl;');
  });

  it("removes last chain link (outer call)", () => {
    // SCRIPT_C: tl.from(".a",...,0).from(".b",...,0.5)
    // Remove .b (outermost call = last in source)
    const result = removeAnimationFromScript(SCRIPT_C, ".b-from-500-visual");
    expect(result).toContain('.from(".a"');
    expect(result).not.toContain('.from(".b"');
    // The statement should still end with ; (no dangling chain)
    expect(result).toContain("}, 0);");
  });

  it("removes inner chain link", () => {
    // SCRIPT_C: tl.from(".a",...,0).from(".b",...,0.5)
    // Remove .a (innermost call = first in source)
    const result = removeAnimationFromScript(SCRIPT_C, ".a-from-0-visual");
    expect(result).not.toContain('.from(".a"');
    expect(result).toContain('.from(".b"');
    // Chain is still rooted at tl (whitespace between tl and .from is valid JS)
    expect(result).toMatch(/tl[\s.]*from\("\.b"/);
  });

  it("unknown ID returns script unchanged", () => {
    const result = removeAnimationFromScript(SCRIPT_A, "nonexistent-id");
    expect(result).toBe(SCRIPT_A);
  });
});

// ---------------------------------------------------------------------------
// addAnimationToScript
// ---------------------------------------------------------------------------

describe("T6c — addAnimationToScript", () => {
  it("inserts new tween after last existing tween", () => {
    const { script: result } = addAnimationToScript(SCRIPT_A, {
      targetSelector: "#new",
      method: "to",
      position: 0.5,
      duration: 0.3,
      properties: { x: 100 },
    });
    expect(result).toContain('tl.to("#new"');
    expect(result).toContain("x: 100");
    expect(result).toContain("duration: 0.3");
    // Original content preserved
    expect(result).toContain('tl.to("#hero"');
    expect(result).toContain('window.__timelines["t"] = tl;');
    // New tween comes after hero tween
    expect(result.indexOf('tl.to("#new"')).toBeGreaterThan(result.indexOf('tl.to("#hero"'));
  });

  it("returns a non-empty stable id for the new animation", () => {
    const { id } = addAnimationToScript(SCRIPT_A, {
      targetSelector: "#new",
      method: "to",
      position: 0.5,
      duration: 0.3,
      properties: { x: 100 },
    });
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("inserts after timeline declaration when script has no tweens", () => {
    const empty = `var tl = gsap.timeline({ paused: true });\nwindow.__timelines["t"] = tl;`;
    const { script: result } = addAnimationToScript(empty, {
      targetSelector: "#hero",
      method: "to",
      position: 0,
      duration: 0.5,
      properties: { opacity: 1 },
    });
    expect(result).toContain('tl.to("#hero"');
    // Inserted after timeline declaration
    expect(result.indexOf('tl.to("#hero"')).toBeGreaterThan(result.indexOf("gsap.timeline"));
  });

  it("inserts a global gsap.set BEFORE the timeline declaration", () => {
    // A base set emitted after the tween calls is wiped by GSAP's from()-init
    // revert on the first backwards render (studio soft-reload rebind) — it
    // must precede the timeline so the from() records it as pre-tween state.
    const script = `\
var tl = gsap.timeline({ paused: true });
tl.from("#hero", { scale: 0.9, duration: 0.5 }, 0.2);
window.__timelines["t"] = tl;`;
    const { script: result, id } = addAnimationToScript(script, {
      targetSelector: "#hero",
      method: "set",
      position: 0,
      properties: { x: 267, y: 20 },
      global: true,
    });
    expect(result).toContain('gsap.set("#hero", { x: 267, y: 20 });');
    expect(result.indexOf('gsap.set("#hero"')).toBeLessThan(result.indexOf("gsap.timeline"));
    expect(id).toBeTruthy();
    // Round-trip: the id resolves back to the inserted set
    const updated = updateAnimationInScript(result, id, { properties: { x: 300, y: 20 } });
    expect(updated).toContain("x: 300");
  });
});

// ---------------------------------------------------------------------------
// Legacy global-set relocation
// ---------------------------------------------------------------------------

describe("T6c — updateAnimationInScript relocates legacy trailing global set", () => {
  const LEGACY = `\
var tl = gsap.timeline({ paused: true });
tl.from("#hero", { scale: 0.9, duration: 0.5 }, 0.2);
gsap.set("#hero", { x: 267, y: 20 });
window.__timelines["t"] = tl;`;

  it("moves a post-timeline global set above the declaration when updated", () => {
    const result = updateAnimationInScript(LEGACY, "#hero-set-0-position", {
      properties: { x: 300, y: 20 },
    });
    expect(result).toContain("x: 300");
    expect(result.indexOf("gsap.set(")).toBeLessThan(result.indexOf("gsap.timeline"));
    expect(result).toContain('window.__timelines["t"] = tl;');
  });

  it("leaves an already-hoisted global set in place", () => {
    const hoisted = `\
gsap.set("#hero", { x: 267, y: 20 });
var tl = gsap.timeline({ paused: true });
tl.from("#hero", { scale: 0.9, duration: 0.5 }, 0.2);
window.__timelines["t"] = tl;`;
    const result = updateAnimationInScript(hoisted, "#hero-set-0-position", {
      properties: { x: 300, y: 20 },
    });
    expect(result).toContain("x: 300");
    expect(result.indexOf("gsap.set(")).toBeLessThan(result.indexOf("gsap.timeline"));
  });
});

// ---------------------------------------------------------------------------
// Keyframe write ops
// ---------------------------------------------------------------------------

describe("T6c — keyframe write ops", () => {
  it("updateKeyframeInScript replaces keyframe value at given percentage", () => {
    // Update 50% from { opacity: 0.7 } to { opacity: 0.5 }
    const result = updateKeyframeInScript(SCRIPT_D, "#box-to-200-visual", 50, { opacity: 0.5 });
    expect(result).toContain("opacity: 0.5");
    expect(result).not.toContain("opacity: 0.7");
    // Other keyframes unchanged
    expect(result).toContain('"0%": { opacity: 0 }');
    expect(result).toContain('"100%": { opacity: 1 }');
  });

  it("updateKeyframeInScript preserves bytes outside the edited value", () => {
    const result = updateKeyframeInScript(SCRIPT_D, "#box-to-200-visual", 100, {
      opacity: 0.9,
    });
    // The 50% keyframe is untouched
    expect(result).toContain('"50%": { opacity: 0.7 }');
    // Duration and position are unchanged
    expect(result).toContain("duration: 0.5");
    expect(result).toContain("}, 0.2)");
  });

  it("updateKeyframeInScript edits ARRAY-form keyframes by percentage→index (the #shuttle case)", () => {
    // Array-form keyframes carry no explicit percentages; GSAP distributes 4 of
    // them evenly → 0 / 33.3 / 66.7 / 100. Dragging the 2nd motion-path node
    // (pct 33.3) must rewrite array index 1 — not no-op (regression: array form
    // bailed the ObjectExpression check, so the drag committed nothing).
    const script =
      "const tl = gsap.timeline();\n" +
      'tl.to("#shuttle", { keyframes: [{ x: 0, y: 0 }, { x: 520, y: 120 }, { x: 1040, y: 0 }, { x: 1480, y: 160 }], duration: 4.4, ease: "none" }, 5.2);';
    const result = updateKeyframeInScript(script, "#shuttle-to-5200-position", 33.3, {
      x: 503,
      y: 642,
    });
    expect(result).not.toBe(script); // actually changed (not a no-op)
    expect(result).toContain("x: 503");
    expect(result).toContain("y: 642");
    expect(result).not.toContain("x: 520"); // index 1 replaced
    // Sibling array entries untouched.
    expect(result).toContain("{ x: 0, y: 0 }");
    expect(result).toContain("{ x: 1040, y: 0 }");
    expect(result).toContain("{ x: 1480, y: 160 }");
  });

  it("updateAnimationInScript apply-to-all sets easeEach and strips per-keyframe eases", () => {
    const script =
      "const tl = gsap.timeline();\n" +
      'tl.to("#box", { keyframes: { "0%": { x: 0 }, "50%": { x: 50, ease: "power2.in" }, "100%": { x: 100, ease: "back.out" }, easeEach: "none" }, duration: 1 }, 0);';
    const id = parseGsapScript(script).animations[0]!.id;
    const result = updateAnimationInScript(script, id, {
      easeEach: "power2.out",
      resetKeyframeEases: true,
    });
    // easeEach updated to the chosen ease …
    expect(result).toContain('easeEach: "power2.out"');
    // … and every per-keyframe override is gone, so all segments use easeEach.
    expect(result).not.toContain('ease: "power2.in"');
    expect(result).not.toContain('ease: "back.out"');
    // keyframe property values are preserved.
    const kf = parseGsapScript(result).animations[0]!.keyframes!;
    expect(kf.easeEach).toBe("power2.out");
    expect(kf.keyframes.every((k) => k.ease === undefined)).toBe(true);
    expect(kf.keyframes.map((k) => k.properties.x)).toEqual([0, 50, 100]);
  });

  it("addKeyframeToScript — ARRAY-form normalizes to object form + inserts 50%", () => {
    const script =
      "const tl = gsap.timeline();\n" +
      'tl.to("#shuttle", { keyframes: [{ x: 0, y: 0 }, { x: 520, y: 120 }, { x: 1040, y: 0 }, { x: 1480, y: 160 }], duration: 4.4, ease: "none" }, 5.2);';
    const result = addKeyframeToScript(script, "#shuttle-to-5200-position", 50, { x: 780, y: 60 });
    expect(result).not.toBe(script); // not a no-op
    expect(result).toContain('"50%"'); // converted to percentage-object form
    expect(result).toContain("x: 780");
    // Original even-distribution stops preserved as percentage keys.
    expect(result).toContain('"0%"');
    expect(result).toContain('"100%"');
  });

  it("addKeyframeToScript inserts new percentage in sorted order", () => {
    const result = addKeyframeToScript(SCRIPT_D, "#box-to-200-visual", 25, { opacity: 0.3 });
    expect(result).toContain('"25%"');
    expect(result).toContain("opacity: 0.3");
    // Original keyframes preserved
    expect(result).toContain('"0%": { opacity: 0 }');
    expect(result).toContain('"50%": { opacity: 0.7 }');
    // 25% appears before 50% in the string
    expect(result.indexOf('"25%"')).toBeLessThan(result.indexOf('"50%"'));
  });

  it("addKeyframeToScript replaces value when percentage already exists", () => {
    const result = addKeyframeToScript(SCRIPT_D, "#box-to-200-visual", 50, { opacity: 0.99 });
    expect(result).toContain("opacity: 0.99");
    expect(result).not.toContain("opacity: 0.7");
    // Only one "50%" in the result
    expect((result.match(/"50%"/g) ?? []).length).toBe(1);
  });

  it("addKeyframeToScript merges a new property into an existing keyframe, preserving siblings", () => {
    // 50% already holds { opacity: 0.7 }; adding x must NOT drop opacity.
    const result = addKeyframeToScript(SCRIPT_D, "#box-to-200-visual", 50, { x: 100 });
    expect(result).toContain("opacity: 0.7");
    expect(result).toContain("x: 100");
    expect((result.match(/"50%"/g) ?? []).length).toBe(1);
  });

  it("removeKeyframeFromScript removes the target percentage", () => {
    // Remove 50% from 0%/50%/100% → leaves 0%/100% (no collapse in T6c)
    const result = removeKeyframeFromScript(SCRIPT_D, "#box-to-200-visual", 50);
    expect(result).not.toContain('"50%"');
    expect(result).toContain('"0%"');
    expect(result).toContain('"100%"');
  });

  it("updateKeyframeInScript on unknown id returns script unchanged", () => {
    const result = updateKeyframeInScript(SCRIPT_D, "bad-id", 50, { opacity: 0.5 });
    expect(result).toBe(SCRIPT_D);
  });
});

describe("T6c — convertToKeyframesFromScript: global gsap.set", () => {
  const SCRIPT_GLOBAL_SET = `\
var tl = gsap.timeline({ paused: true });
gsap.set("#card", { rotationX: 50, rotationY: 20 });
window.__timelines["t"] = tl;`;

  it("re-roots a global gsap.set onto the timeline (tl.to + position), not gsap.to", () => {
    const animId = parseGsapScript(SCRIPT_GLOBAL_SET).animations[0].id;
    const result = convertToKeyframesFromScript(SCRIPT_GLOBAL_SET, animId, undefined, 4);
    // Off-timeline gsap.to would fire once at load and be unseekable; must be tl.to.
    expect(result).toMatch(/tl\.to\(\s*"#card"/);
    expect(result).not.toMatch(/gsap\.to\(/);
    expect(result).toContain("keyframes:");
    const reparsed = parseGsapScript(result).animations[0];
    expect(reparsed.keyframes).toBeTruthy();
    expect(reparsed.global).toBeFalsy();
  });
});
