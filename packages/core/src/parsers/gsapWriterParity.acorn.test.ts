// fallow-ignore-file code-duplication
/**
 * Regression tests for addKeyframeToScript (acorn writer).
 *
 * These were originally acorn-vs-recast parity tests (WS-3.C gate). With recast
 * retired (WS-3.F), they are kept as acorn-only regression tests to ensure the
 * writer continues to produce correct keyframe arrays.
 */
import { describe, expect, it } from "vitest";
import { addKeyframeToScript as addAcorn } from "./gsapWriterAcorn.js";
import { parseGsapScriptAcorn as parseGsapScript } from "./gsapParserAcorn.js";

// These fixtures hold exactly one tween. We look it up by index rather than by
// id because the stable id is content-derived: adding/backfilling a property
// changes the id, so a hardcoded lookup would spuriously return null.
function keyframesOf(script: string) {
  const parsed = parseGsapScript(script);
  const anim = parsed.animations[0];
  const kf = anim?.keyframes;
  if (!kf || kf.format !== "percentage") return null;
  return kf.keyframes
    .slice()
    .sort((a, b) => a.percentage - b.percentage)
    .map((k) => ({ percentage: k.percentage, properties: k.properties, ease: k.ease }));
}

// Script whose 0% / 100% endpoints carry the synthetic `_auto: 1` marker the
// parser emits for auto-derived endpoints.
const AUTO_SCRIPT = `\
var tl = gsap.timeline({ paused: true });
tl.to("#box", { keyframes: { "0%": { opacity: 1, _auto: 1 }, "100%": { opacity: 0, _auto: 1 } }, duration: 0.5 }, 0.2);
window.__timelines["t"] = tl;`;

// Script with three plain keyframes (no _auto), used for the backfill case.
const PLAIN_SCRIPT = `\
var tl = gsap.timeline({ paused: true });
tl.to("#box", { keyframes: { "0%": { opacity: 0 }, "50%": { opacity: 0.7 }, "100%": { opacity: 1 } }, duration: 0.5 }, 0.2);
window.__timelines["t"] = tl;`;

// _auto endpoints with an interior 25% plain keyframe (0/25/100). Exercises the
// "interior keyframe adjacent to a 100% _auto endpoint" path that crashed.
const AUTO_THREE_SCRIPT = `\
var tl = gsap.timeline({ paused: true });
tl.to("#box", { keyframes: { "0%": { opacity: 1, _auto: 1 }, "25%": { opacity: 0.5 }, "100%": { opacity: 0, _auto: 1 } }, duration: 0.5 }, 0.2);
window.__timelines["t"] = tl;`;

// An existing keyframe carrying extra props + a per-keyframe ease. Re-touching
// one prop must MERGE (preserve the others + the ease), not replace wholesale.
const MERGE_SCRIPT = `\
var tl = gsap.timeline({ paused: true });
tl.to("#box", { keyframes: { "0%": { opacity: 0, x: 0 }, "50%": { opacity: 0.7, x: 30, scale: 2, ease: "power2.in" }, "100%": { opacity: 1, x: 60 } }, duration: 0.5 }, 0.2);
window.__timelines["t"] = tl;`;

// An existing keyframe keyed "50.0%" (not byte-equal to "50%").
const DECIMAL_KEY_SCRIPT = `\
var tl = gsap.timeline({ paused: true });
tl.to("#box", { keyframes: { "0%": { opacity: 0 }, "50.0%": { opacity: 0.7 }, "100%": { opacity: 1 } }, duration: 0.5 }, 0.2);
window.__timelines["t"] = tl;`;

// Flat tweens (no keyframes object) — the first keyframe-add must convert them.
const FLAT_TO_SCRIPT = `\
var tl = gsap.timeline({ paused: true });
tl.to("#box", { opacity: 0.5, x: 100, duration: 0.5, ease: "power2.out" }, 0.2);
window.__timelines["t"] = tl;`;

const FLAT_FROMTO_SCRIPT = `\
var tl = gsap.timeline({ paused: true });
tl.fromTo("#box", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5 }, 0.2);
window.__timelines["t"] = tl;`;

function animId(script: string): string {
  const id = parseGsapScript(script).animations[0]?.id;
  if (!id) throw new Error("no animation in fixture");
  return id;
}

describe("acorn addKeyframeToScript regression", () => {
  it("rewrites an _auto 100% endpoint when the inserted keyframe is its left neighbor", () => {
    const id = animId(AUTO_SCRIPT);
    const props = { opacity: 0.3, x: 50 };
    const acorn = addAcorn(AUTO_SCRIPT, id, 60, props);
    const kfs = keyframesOf(acorn);
    expect(kfs).not.toBeNull();
    const pcts = kfs!.map((k) => k.percentage);
    expect(pcts).toContain(60);
  });

  it("rewrites an _auto 0% endpoint when the inserted keyframe is its right neighbor", () => {
    const id = animId(AUTO_SCRIPT);
    const props = { opacity: 0.8, scale: 2 };
    const acorn = addAcorn(AUTO_SCRIPT, id, 40, props);
    const kfs = keyframesOf(acorn);
    expect(kfs).not.toBeNull();
    const pcts = kfs!.map((k) => k.percentage);
    expect(pcts).toContain(40);
  });

  it("backfills a NEW property into the other keyframes with its default value", () => {
    const id = animId(PLAIN_SCRIPT);
    const props = { opacity: 0.3, x: 120 };
    const backfill = { opacity: 1, x: 0 };
    const acorn = addAcorn(PLAIN_SCRIPT, id, 25, props, undefined, backfill);
    const kfs = keyframesOf(acorn);
    expect(kfs).not.toBeNull();
    // 4 keyframes: 0, 25, 50, 100
    expect(kfs).toHaveLength(4);
  });

  it("no backfill arg → new prop is added only at the target keyframe", () => {
    const id = animId(PLAIN_SCRIPT);
    const props = { opacity: 0.3, x: 120 };
    const acorn = addAcorn(PLAIN_SCRIPT, id, 25, props);
    const kfs = keyframesOf(acorn);
    expect(kfs).not.toBeNull();
    expect(kfs).toHaveLength(4);
  });

  it("plain insert in sorted order stays parseable", () => {
    const id = animId(PLAIN_SCRIPT);
    const props = { opacity: 0.3 };
    const acorn = addAcorn(PLAIN_SCRIPT, id, 25, props);
    expect(keyframesOf(acorn)).not.toBeNull();
  });

  // ── Bug 1: crash — _auto endpoint sync + backfill of a new prop together ──────
  it("syncs an _auto 100% endpoint AND backfills a new prop (2-endpoint, the crash)", () => {
    const id = animId(AUTO_SCRIPT);
    const props = { opacity: 0.3, x: 50 };
    const backfill = { opacity: 1, x: 0 };
    const acorn = addAcorn(AUTO_SCRIPT, id, 60, props, undefined, backfill);
    const kfs = keyframesOf(acorn);
    expect(kfs).not.toBeNull();
    expect(kfs!.every((k) => "opacity" in k.properties && "x" in k.properties)).toBe(true);
  });

  it("syncs _auto endpoint AND backfills a new prop (0/25/100 interior, the crash)", () => {
    const id = animId(AUTO_THREE_SCRIPT);
    const props = { opacity: 0.4, x: 80 };
    const backfill = { opacity: 1, x: 0 };
    const acorn = addAcorn(AUTO_THREE_SCRIPT, id, 60, props, undefined, backfill);
    const kfs = keyframesOf(acorn);
    expect(kfs).not.toBeNull();
    expect(kfs!.every((k) => "x" in k.properties)).toBe(true);
  });

  // ── Bug 2: no-comma corruption — backfill ≥2 props into an empty {} keyframe ──
  it("backfills ≥2 new props into an empty {} keyframe without dropping the comma", () => {
    const EMPTY_KF = `\
var tl = gsap.timeline({ paused: true });
tl.to("#box", { keyframes: { "0%": {}, "100%": { x: 100, y: 50 } }, duration: 0.5 }, 0.2);
window.__timelines["t"] = tl;`;
    const id = animId(EMPTY_KF);
    const props = { x: 40, y: 20 };
    const backfill = { x: 0, y: 0 };
    const acorn = addAcorn(EMPTY_KF, id, 50, props, undefined, backfill);
    const kfs = keyframesOf(acorn);
    expect(kfs).not.toBeNull();
    expect(kfs).toHaveLength(3);
  });

  // ── Bug 4 + 7: merge — preserve untouched props AND existing ease ──────────────
  it("merges new props over an existing keyframe, preserving its other props + ease", () => {
    const id = animId(MERGE_SCRIPT);
    const props = { opacity: 0.9 };
    const acorn = addAcorn(MERGE_SCRIPT, id, 50, props);
    const kfs = keyframesOf(acorn);
    expect(kfs).not.toBeNull();
    const kf50 = kfs!.find((k) => k.percentage === 50);
    expect(kf50).toBeDefined();
    // merged value
    expect(kf50!.properties.opacity).toBe(0.9);
    // preserved from original
    expect(kf50!.properties.x).toBe(30);
    expect(kf50!.properties.scale).toBe(2);
    expect(kf50!.ease).toBe("power2.in");
  });

  // ── Bug 5: convert-flat — first keyframe-add on a flat tween ──────────────────
  it("converts a flat to() tween to keyframes on the first keyframe add", () => {
    const id = animId(FLAT_TO_SCRIPT);
    const props = { opacity: 0.8 };
    const backfill = { opacity: 1 };
    const acorn = addAcorn(FLAT_TO_SCRIPT, id, 50, props, undefined, backfill);
    expect(keyframesOf(acorn)).not.toBeNull();
  });

  it("converts a flat fromTo() tween to keyframes on the first keyframe add", () => {
    const id = animId(FLAT_FROMTO_SCRIPT);
    const props = { y: 10 };
    const backfill = { y: 0 };
    const acorn = addAcorn(FLAT_FROMTO_SCRIPT, id, 50, props, undefined, backfill);
    expect(keyframesOf(acorn)).not.toBeNull();
  });

  // ── Bug 3: existing "50.0%" key, add at 50 (non-byte-equal % key) ─────────────
  it("merges into a non-byte-equal '50.0%' key when adding at 50", () => {
    const id = animId(DECIMAL_KEY_SCRIPT);
    const props = { opacity: 0.9 };
    const acorn = addAcorn(DECIMAL_KEY_SCRIPT, id, 50, props);
    const kfs = keyframesOf(acorn);
    expect(kfs).not.toBeNull();
    // Should still have 3 keyframes (merge, not insert)
    expect(kfs).toHaveLength(3);
  });

  // ── Bug 8: %-tolerance — existing 50, add 51 should MERGE (PCT_TOLERANCE=2) ────
  it("treats a near-coincident percentage (50 vs 51) as the same keyframe (merge)", () => {
    const id = animId(PLAIN_SCRIPT);
    const props = { opacity: 0.9 };
    const acorn = addAcorn(PLAIN_SCRIPT, id, 51, props);
    const kfs = keyframesOf(acorn);
    expect(kfs).not.toBeNull();
    // Merge: still 3 keyframes
    expect(kfs).toHaveLength(3);
  });

  // ── Bug 7: adding ONTO a 0/100 _auto endpoint preserves the _auto marker ──────
  it("preserves the _auto marker when adding a prop directly onto a 0% _auto endpoint", () => {
    const id = animId(AUTO_SCRIPT);
    const props = { x: 25 };
    const acorn = addAcorn(AUTO_SCRIPT, id, 0, props);
    const kfs = keyframesOf(acorn);
    expect(kfs).not.toBeNull();
    const kf0 = kfs!.find((k) => k.percentage === 0);
    expect(kf0).toBeDefined();
    expect(kf0!.properties.x).toBe(25);
  });
});
