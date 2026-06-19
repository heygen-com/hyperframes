// fallow-ignore-file code-duplication
/**
 * Recast-vs-acorn GSAP-writer differential suite (WS-3.F cutover gate).
 *
 * The SDK's browser-safe acorn writer (gsapWriterAcorn.ts) must produce output
 * equivalent to the server's recast writer (gsapParser.ts) for every write op,
 * so that making the acorn writer authoritative (retiring recast) is behavior-
 * preserving. The two formatters differ (recast pretty-prints, acorn splices),
 * so we never compare bytes — we apply each op via BOTH writers, parse both
 * outputs with the shared `parseGsapScriptAcorn`, and assert the resulting
 * animation models match structurally.
 *
 * Until this suite, only `addKeyframeToScript` had a true differential test
 * (gsapWriterParity.acorn.test.ts). This file extends parity coverage to the
 * five previously standalone-only ops:
 *   updateAnimationInScript, addAnimationToScript, removeAnimationFromScript,
 *   updateKeyframeInScript, removeKeyframeFromScript.
 * Plus correctness tests for the acorn-only label ops (addLabelToScript /
 * removeLabelFromScript), which have no recast oracle to diff against.
 *
 * The harness (`runParity`, `modelOf`) is exported so the follow-up WS-3 op-PR
 * workflow can reuse it to gate each cut-over op.
 */
import { describe, expect, it } from "vitest";
import {
  updateAnimationInScript as updateAnimAcorn,
  addAnimationToScript as addAnimAcorn,
  removeAnimationFromScript as removeAnimAcorn,
  updateKeyframeInScript as updateKfAcorn,
  removeKeyframeFromScript as removeKfAcorn,
  addLabelToScript,
  removeLabelFromScript,
} from "./gsapWriterAcorn.js";
import {
  updateAnimationInScript as updateAnimRecast,
  addAnimationToScript as addAnimRecast,
  removeAnimationFromScript as removeAnimRecast,
  updateKeyframeInScript as updateKfRecast,
  removeKeyframeFromScript as removeKfRecast,
  parseGsapScript,
} from "./gsapParser.js";
import { parseGsapScriptAcorn } from "./gsapParserAcorn.js";
import type { GsapAnimation } from "./gsapSerialize.js";

// ── Reusable differential harness (exported for the WS-3 op-PR workflow) ───────

/**
 * Fields that are incidental metadata — derived per-parse rather than authored —
 * and so must be excluded from a structural comparison: stable ids are content-
 * derived (and recast's addAnimation id is a `Date.now()` placeholder), and the
 * rest are computed analysis (resolved start, group classification, provenance).
 */
const IGNORED_FIELDS = new Set<keyof GsapAnimation | string>([
  "id",
  "resolvedStart",
  "implicitPosition",
  "propertyGroup",
  "provenance",
  "hasUnresolvedKeyframes",
  "hasUnresolvedSelector",
]);

type NormalizedAnimation = Record<string, unknown>;

/**
 * Parse a GSAP script and reduce each animation to its authored shape: target,
 * method, position, properties, fromProperties, duration, ease, extras,
 * keyframes — dropping per-parse metadata. Both writers' outputs go through this
 * SAME parser, so any model difference is a genuine writer divergence, not a
 * parser artifact.
 */
export function modelOf(script: string): NormalizedAnimation[] {
  return parseGsapScriptAcorn(script).animations.map((anim) => {
    const out: NormalizedAnimation = {};
    for (const [key, value] of Object.entries(anim)) {
      if (IGNORED_FIELDS.has(key) || value === undefined) continue;
      out[key] = value;
    }
    return out;
  });
}

/**
 * Apply an op via BOTH writers and assert the parsed animation models match.
 * `recast`/`acorn` each receive the original script and must return the rewritten
 * script. Returns the recast-written script so callers can chain ops.
 */
export function runParity(
  script: string,
  recast: (s: string) => string,
  acorn: (s: string) => string,
): string {
  const recastOut = recast(script);
  const acornOut = acorn(script);
  expect(modelOf(acornOut), "acorn model must equal recast model").toEqual(modelOf(recastOut));
  return recastOut;
}

/** The id of the i-th animation in a script (recast parser — the op oracle). */
function idAt(script: string, index = 0): string {
  const id = parseGsapScript(script).animations[index]?.id;
  if (!id) throw new Error(`no animation at index ${index} in fixture`);
  return id;
}

// ── Corpus ─────────────────────────────────────────────────────────────────────
//
// Real registry scripts (literal-tween portions extracted verbatim from
// registry/blocks and registry/components, trimmed to the editable tweens) plus
// synthetic scripts covering breadth the single-op test lacks: to/from/fromTo,
// multi-tween, keyframes, labels, numeric + label-relative + symbolic positions,
// stagger/repeat/yoyo extras, and sub-composition selectors.

// REAL — registry/blocks/macos-notification: two plain .to() tweens, numeric pos.
const REAL_MACOS = `\
window.__timelines = window.__timelines || {};
var tl = gsap.timeline({ paused: true });
tl.to("#notification", { x: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 0.2);
tl.to("#notification", { x: 420, opacity: 0, duration: 0.3, ease: "power3.in" }, 4.2);
window.__timelines["macos-notification"] = tl;`;

// REAL — registry/blocks/flowchart: multi .to() with strokeDashoffset + back ease.
const REAL_FLOWCHART = `\
window.__timelines = window.__timelines || {};
var tl = gsap.timeline({ paused: true });
tl.to("#node-root", { scale: 1, duration: 0.4, ease: "back.out(2)" }, 0.2);
tl.to("#node-yes", { scale: 1, duration: 0.3, ease: "back.out(2)" }, 0.5);
tl.to("#path-1-L", { strokeDashoffset: 0, duration: 0.6, ease: "power2.inOut" }, 0.8);
window.__timelines["flowchart"] = tl;`;

// REAL — registry/components/caption-kinetic-slam: .fromTo() entrances + .to() exit.
const REAL_CAPTION = `\
var tl = gsap.timeline({ paused: true });
tl.fromTo("#kt-w-0", { y: -120, opacity: 0 }, { y: 0, opacity: 1, duration: 0.22, ease: "back.out(1.7)" }, 0.5);
tl.fromTo("#kt-w-1", { x: -300, opacity: 0 }, { x: 0, opacity: 1, duration: 0.2, ease: "expo.out" }, 1.2);
tl.to("#kt-w-0", { opacity: 0, duration: 0.1, ease: "power2.in" }, 2.5);
window.__timelines["caption-kinetic-slam"] = tl;`;

// SYNTH — single plain to().
const SYN_SINGLE = `\
var tl = gsap.timeline({ paused: true });
tl.to("#hero", { opacity: 1, x: 100, duration: 0.5, ease: "power3.out" }, 0.2);
window.__timelines["t"] = tl;`;

// SYNTH — to + from + fromTo, mixed positions (numeric, symbolic "<", numeric).
const SYN_MIXED_METHODS = `\
var tl = gsap.timeline({ paused: true });
tl.from("#title", { opacity: 0, y: 30, duration: 0.6, ease: "power2.out" }, 0);
tl.to("#title", { opacity: 0, duration: 0.4 }, 1.2);
tl.fromTo(".card", { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5 }, "<");
window.__timelines["t"] = tl;`;

// SYNTH — extras: stagger / repeat / yoyo / repeatDelay must survive every op.
const SYN_EXTRAS = `\
var tl = gsap.timeline({ paused: true });
tl.to(".dot", { y: -20, duration: 0.3, stagger: 0.08, repeat: 2, yoyo: true, repeatDelay: 0.1 }, 0);
tl.from("#panel", { opacity: 0, duration: 0.5, ease: "sine.out" }, 0.4);
window.__timelines["t"] = tl;`;

// SYNTH — labels + label-relative positions ("intro", "intro+=0.3").
const SYN_LABELED = `\
var tl = gsap.timeline({ paused: true });
tl.addLabel("intro", 0);
tl.to("#a", { opacity: 1, duration: 0.5 }, "intro");
tl.to("#b", { opacity: 1, duration: 0.5 }, "intro+=0.3");
window.__timelines["t"] = tl;`;

// SYNTH — sub-composition / nested selectors (scoped descendant + attribute).
const SYN_NESTED = `\
var tl = gsap.timeline({ paused: true });
tl.to("#scene-2 .headline", { y: 0, opacity: 1, duration: 0.5 }, 0);
tl.from('[data-hf-id="scene-2"] .sub', { opacity: 0, duration: 0.4 }, 0.3);
window.__timelines["t"] = tl;`;

// SYNTH — percentage keyframes (3 kfs).
const SYN_KF3 = `\
var tl = gsap.timeline({ paused: true });
tl.to("#box", { keyframes: { "0%": { opacity: 0 }, "50%": { opacity: 0.7 }, "100%": { opacity: 1 } }, duration: 0.5 }, 0.2);
window.__timelines["t"] = tl;`;

// SYNTH — percentage keyframes (2 kfs) — removal collapses to flat.
const SYN_KF2 = `\
var tl = gsap.timeline({ paused: true });
tl.to("#box", { keyframes: { "0%": { opacity: 0, x: 0 }, "100%": { opacity: 1, x: 40 } }, duration: 0.5, delay: 0.1 }, 0.2);
window.__timelines["t"] = tl;`;

// SYNTH — keyframes carrying per-keyframe ease + easeEach.
const SYN_KF_EASE = `\
var tl = gsap.timeline({ paused: true });
tl.to("#box", { keyframes: { "0%": { y: 0 }, "50%": { y: 30, ease: "power2.in" }, "100%": { y: 0 }, easeEach: "power1.inOut" }, duration: 0.8 }, 0);
window.__timelines["t"] = tl;`;

// SYNTH — chained tweens (tl.from(...).from(...)) for chain-link removal.
const SYN_CHAIN = `\
var tl = gsap.timeline({ paused: true });
tl.from(".a", { opacity: 0, duration: 0.5 }, 0)
  .from(".b", { opacity: 0, duration: 0.3 }, 0.5)
  .to(".a", { x: 10, duration: 0.2 }, 1);
window.__timelines["t"] = tl;`;

// ── 1. updateAnimationInScript ──────────────────────────────────────────────────

describe("parity — updateAnimationInScript", () => {
  it("updates duration + ease on a real two-tween block (macos)", () => {
    const id = idAt(REAL_MACOS, 1);
    const u = { duration: 0.9, ease: "power1.in" };
    runParity(
      REAL_MACOS,
      (s) => updateAnimRecast(s, id, u),
      (s) => updateAnimAcorn(s, id, u),
    );
  });

  it("updates duration on a real .to() with a back.out ease (flowchart)", () => {
    const id = idAt(REAL_FLOWCHART, 0);
    const u = { duration: 0.7 };
    runParity(
      REAL_FLOWCHART,
      (s) => updateAnimRecast(s, id, u),
      (s) => updateAnimAcorn(s, id, u),
    );
  });

  it("REPLACES the editable property set (props absent from update are dropped)", () => {
    const id = idAt(SYN_MIXED_METHODS, 0);
    const u = { properties: { x: 50, rotation: 10 } };
    runParity(
      SYN_MIXED_METHODS,
      (s) => updateAnimRecast(s, id, u),
      (s) => updateAnimAcorn(s, id, u),
    );
  });

  it("REPLACES fromTo from-vars (props absent from update are dropped)", () => {
    const id = idAt(SYN_MIXED_METHODS, 2);
    const u = { fromProperties: { scale: 0.5 } };
    runParity(
      SYN_MIXED_METHODS,
      (s) => updateAnimRecast(s, id, u),
      (s) => updateAnimAcorn(s, id, u),
    );
  });

  it("replaces props while preserving extras (stagger/repeat/yoyo)", () => {
    const id = idAt(SYN_EXTRAS, 0);
    const u = { properties: { y: -40 } };
    runParity(
      SYN_EXTRAS,
      (s) => updateAnimRecast(s, id, u),
      (s) => updateAnimAcorn(s, id, u),
    );
  });

  it("updates props + duration + ease together in one op", () => {
    const id = idAt(SYN_SINGLE, 0);
    const u = { properties: { x: 9 }, duration: 1.1, ease: "sine.in" };
    runParity(
      SYN_SINGLE,
      (s) => updateAnimRecast(s, id, u),
      (s) => updateAnimAcorn(s, id, u),
    );
  });

  it("changes numeric position to a label-relative string position", () => {
    const id = idAt(SYN_MIXED_METHODS, 0);
    const u = { position: "intro+=0.5" };
    runParity(
      SYN_MIXED_METHODS,
      (s) => updateAnimRecast(s, id, u),
      (s) => updateAnimAcorn(s, id, u),
    );
  });

  it("changes a symbolic '<' position to a numeric position", () => {
    const id = idAt(SYN_MIXED_METHODS, 2);
    const u = { position: 3 };
    runParity(
      SYN_MIXED_METHODS,
      (s) => updateAnimRecast(s, id, u),
      (s) => updateAnimAcorn(s, id, u),
    );
  });

  it("updates a tween whose position is a label name (labeled fixture)", () => {
    const id = idAt(SYN_LABELED, 1);
    const u = { duration: 0.9 };
    runParity(
      SYN_LABELED,
      (s) => updateAnimRecast(s, id, u),
      (s) => updateAnimAcorn(s, id, u),
    );
  });

  it("inserts ease when absent on a nested-selector tween", () => {
    const id = idAt(SYN_NESTED, 0);
    const u = { ease: "power3.out" };
    runParity(
      SYN_NESTED,
      (s) => updateAnimRecast(s, id, u),
      (s) => updateAnimAcorn(s, id, u),
    );
  });
});

// ── 2. addAnimationToScript ──────────────────────────────────────────────────────

describe("parity — addAnimationToScript", () => {
  const add =
    (animation: Omit<GsapAnimation, "id">) =>
    (writer: (s: string, a: Omit<GsapAnimation, "id">) => { script: string }) =>
    (s: string) =>
      writer(s, animation).script;

  it("appends a plain to() after the last real tween (macos)", () => {
    const anim: Omit<GsapAnimation, "id"> = {
      targetSelector: "#new",
      method: "to",
      position: 5,
      duration: 0.3,
      properties: { x: 100 },
      ease: "sine.in",
    };
    const build = add(anim);
    runParity(REAL_MACOS, build(addAnimRecast), build(addAnimAcorn));
  });

  it("appends a fromTo() with extras (repeat/yoyo)", () => {
    const anim: Omit<GsapAnimation, "id"> = {
      targetSelector: "#x",
      method: "fromTo",
      position: 2,
      duration: 0.4,
      properties: { opacity: 1 },
      fromProperties: { opacity: 0 },
      extras: { repeat: 2, yoyo: true },
    };
    const build = add(anim);
    runParity(SYN_MIXED_METHODS, build(addAnimRecast), build(addAnimAcorn));
  });

  it("appends a from() with a symbolic '<' position", () => {
    const anim: Omit<GsapAnimation, "id"> = {
      targetSelector: ".card",
      method: "from",
      position: "<",
      duration: 0.5,
      properties: { y: 20, opacity: 0 },
    };
    const build = add(anim);
    runParity(SYN_EXTRAS, build(addAnimRecast), build(addAnimAcorn));
  });

  it("appends a tween with a label-relative position", () => {
    const anim: Omit<GsapAnimation, "id"> = {
      targetSelector: "#c",
      method: "to",
      position: "intro+=0.6",
      duration: 0.4,
      properties: { opacity: 1 },
    };
    const build = add(anim);
    runParity(SYN_LABELED, build(addAnimRecast), build(addAnimAcorn));
  });

  it("appends a tween onto a chained-tween timeline", () => {
    const anim: Omit<GsapAnimation, "id"> = {
      targetSelector: ".c",
      method: "to",
      position: 1.5,
      duration: 0.3,
      properties: { scale: 1.2 },
    };
    const build = add(anim);
    runParity(SYN_CHAIN, build(addAnimRecast), build(addAnimAcorn));
  });

  it("appends with a nested sub-composition selector", () => {
    const anim: Omit<GsapAnimation, "id"> = {
      targetSelector: "#scene-2 .footer",
      method: "to",
      position: 0.8,
      duration: 0.3,
      properties: { opacity: 1 },
    };
    const build = add(anim);
    runParity(SYN_NESTED, build(addAnimRecast), build(addAnimAcorn));
  });

  it("inserts after the timeline decl when the script has no tweens", () => {
    const empty = `var tl = gsap.timeline({ paused: true });\nwindow.__timelines["t"] = tl;`;
    const anim: Omit<GsapAnimation, "id"> = {
      targetSelector: "#hero",
      method: "to",
      position: 0,
      duration: 0.5,
      properties: { opacity: 1 },
    };
    const build = add(anim);
    runParity(empty, build(addAnimRecast), build(addAnimAcorn));
  });
});

// ── 3. removeAnimationFromScript ─────────────────────────────────────────────────

describe("parity — removeAnimationFromScript", () => {
  it("removes a standalone tween statement (real macos, first tween)", () => {
    const id = idAt(REAL_MACOS, 0);
    runParity(
      REAL_MACOS,
      (s) => removeAnimRecast(s, id),
      (s) => removeAnimAcorn(s, id),
    );
  });

  it("removes the middle standalone tween of a 3-tween block (flowchart)", () => {
    const id = idAt(REAL_FLOWCHART, 1);
    runParity(
      REAL_FLOWCHART,
      (s) => removeAnimRecast(s, id),
      (s) => removeAnimAcorn(s, id),
    );
  });

  it("removes the only tween (timeline left empty)", () => {
    const id = idAt(SYN_SINGLE, 0);
    runParity(
      SYN_SINGLE,
      (s) => removeAnimRecast(s, id),
      (s) => removeAnimAcorn(s, id),
    );
  });

  it("removes a fromTo tween (real caption block)", () => {
    const id = idAt(REAL_CAPTION, 1);
    runParity(
      REAL_CAPTION,
      (s) => removeAnimRecast(s, id),
      (s) => removeAnimAcorn(s, id),
    );
  });

  it("removes the inner-most chain link", () => {
    const id = idAt(SYN_CHAIN, 0);
    runParity(
      SYN_CHAIN,
      (s) => removeAnimRecast(s, id),
      (s) => removeAnimAcorn(s, id),
    );
  });

  it("removes the outer-most chain link", () => {
    const id = idAt(SYN_CHAIN, 2);
    runParity(
      SYN_CHAIN,
      (s) => removeAnimRecast(s, id),
      (s) => removeAnimAcorn(s, id),
    );
  });

  it("removes a labeled-position tween (label statement preserved)", () => {
    const id = idAt(SYN_LABELED, 0);
    runParity(
      SYN_LABELED,
      (s) => removeAnimRecast(s, id),
      (s) => removeAnimAcorn(s, id),
    );
  });

  it("removes a tween carrying extras", () => {
    const id = idAt(SYN_EXTRAS, 0);
    runParity(
      SYN_EXTRAS,
      (s) => removeAnimRecast(s, id),
      (s) => removeAnimAcorn(s, id),
    );
  });
});

// ── 4. updateKeyframeInScript ────────────────────────────────────────────────────

describe("parity — updateKeyframeInScript", () => {
  it("replaces the 50% keyframe value", () => {
    const id = idAt(SYN_KF3, 0);
    runParity(
      SYN_KF3,
      (s) => updateKfRecast(s, id, 50, { opacity: 0.5 }),
      (s) => updateKfAcorn(s, id, 50, { opacity: 0.5 }),
    );
  });

  it("replaces a keyframe value AND sets a per-keyframe ease", () => {
    const id = idAt(SYN_KF3, 0);
    runParity(
      SYN_KF3,
      (s) => updateKfRecast(s, id, 50, { opacity: 0.4 }, "power2.in"),
      (s) => updateKfAcorn(s, id, 50, { opacity: 0.4 }, "power2.in"),
    );
  });

  it("replaces the endpoint (100%) keyframe value", () => {
    const id = idAt(SYN_KF3, 0);
    runParity(
      SYN_KF3,
      (s) => updateKfRecast(s, id, 100, { opacity: 0.9 }),
      (s) => updateKfAcorn(s, id, 100, { opacity: 0.9 }),
    );
  });

  it("replaces a keyframe that carried a per-keyframe ease (ease dropped when omitted)", () => {
    const id = idAt(SYN_KF_EASE, 0);
    runParity(
      SYN_KF_EASE,
      (s) => updateKfRecast(s, id, 50, { y: 25 }),
      (s) => updateKfAcorn(s, id, 50, { y: 25 }),
    );
  });

  it("replaces with multiple props on a keyframes-with-easeEach fixture", () => {
    const id = idAt(SYN_KF_EASE, 0);
    runParity(
      SYN_KF_EASE,
      (s) => updateKfRecast(s, id, 100, { y: 5, opacity: 1 }),
      (s) => updateKfAcorn(s, id, 100, { y: 5, opacity: 1 }),
    );
  });
});

// ── 5. removeKeyframeFromScript ──────────────────────────────────────────────────

describe("parity — removeKeyframeFromScript", () => {
  it("removes the interior keyframe, leaving ≥2 (no collapse)", () => {
    const id = idAt(SYN_KF3, 0);
    runParity(
      SYN_KF3,
      (s) => removeKfRecast(s, id, 50),
      (s) => removeKfAcorn(s, id, 50),
    );
  });

  it("collapses to a flat tween when removal leaves a single keyframe", () => {
    const id = idAt(SYN_KF2, 0);
    runParity(
      SYN_KF2,
      (s) => removeKfRecast(s, id, 0),
      (s) => removeKfAcorn(s, id, 0),
    );
  });

  it("collapses to flat preserving the remaining keyframe's props (remove 100%)", () => {
    const id = idAt(SYN_KF2, 0);
    runParity(
      SYN_KF2,
      (s) => removeKfRecast(s, id, 100),
      (s) => removeKfAcorn(s, id, 100),
    );
  });

  it("collapses a keyframes-with-easeEach fixture (drops easeEach + per-kf ease)", () => {
    // SYN_KF_EASE has 3 kfs; remove two so only one remains → collapse.
    const id1 = idAt(SYN_KF_EASE, 0);
    const afterFirst = runParity(
      SYN_KF_EASE,
      (s) => removeKfRecast(s, id1, 50),
      (s) => removeKfAcorn(s, id1, 50),
    );
    const id2 = idAt(afterFirst, 0);
    runParity(
      afterFirst,
      (s) => removeKfRecast(s, id2, 0),
      (s) => removeKfAcorn(s, id2, 0),
    );
  });
});

// ── 6. Label correctness (acorn-only ops — no recast oracle to diff) ─────────────
//
// addLabelToScript / removeLabelFromScript exist only on the acorn writer, so we
// cannot parity-test them. Instead we verify the source-level contract directly.

describe("correctness — addLabelToScript / removeLabelFromScript", () => {
  function labelCallCount(script: string, name: string): number {
    const re = new RegExp(`\\.addLabel\\(\\s*"${name}"`, "g");
    return (script.match(re) ?? []).length;
  }

  it("adds an addLabel(name, pos) call after the last located tween", () => {
    const out = addLabelToScript(SYN_SINGLE, "mid", 1.5);
    expect(out).toContain('tl.addLabel("mid", 1.5);');
    // The label sits after the hero tween and before the postamble.
    expect(out.indexOf('addLabel("mid"')).toBeGreaterThan(out.indexOf('tl.to("#hero"'));
    expect(out.indexOf('addLabel("mid"')).toBeLessThan(out.indexOf("window.__timelines"));
  });

  it("adds a label to an empty (tween-less) timeline after the declaration", () => {
    const empty = `var tl = gsap.timeline({ paused: true });\nwindow.__timelines["t"] = tl;`;
    const out = addLabelToScript(empty, "start", 0.8);
    expect(out).toContain('tl.addLabel("start", 0.8);');
    expect(out.indexOf('addLabel("start"')).toBeGreaterThan(out.indexOf("gsap.timeline"));
  });

  it("removes a previously-added label (round-trip back to original)", () => {
    const empty = `var tl = gsap.timeline({ paused: true });\nwindow.__timelines["t"] = tl;`;
    const added = addLabelToScript(empty, "start", 0.8);
    const removed = removeLabelFromScript(added, "start");
    expect(removed).toBe(empty);
  });

  it("removes a hand-authored label, leaving the tweens intact", () => {
    const out = removeLabelFromScript(SYN_LABELED, "intro");
    expect(labelCallCount(out, "intro")).toBe(0);
    expect(out).toContain('tl.to("#a"');
    expect(out).toContain('tl.to("#b"');
  });

  it("is idempotent: removing an absent label is a no-op", () => {
    expect(removeLabelFromScript(SYN_SINGLE, "nope")).toBe(SYN_SINGLE);
  });

  it("adding the same label twice MOVES it instead of duplicating (dedup contract)", () => {
    // A second addLabel for an existing name must not append a duplicate —
    // duplicates make removeLabel over-remove. It moves the label's position.
    const once = addLabelToScript(SYN_SINGLE, "mid", 1.0);
    const twice = addLabelToScript(once, "mid", 2.0);
    expect(labelCallCount(twice, "mid")).toBe(1);
    expect(twice).toContain('tl.addLabel("mid", 2)');
  });

  it("removeLabel deletes ALL matching addLabel calls for the name (hand-authored dups)", () => {
    const dup = `var tl = gsap.timeline({ paused: true });\ntl.addLabel("mid", 1);\ntl.addLabel("mid", 2);\nwindow.__timelines["t"] = tl;`;
    expect(labelCallCount(dup, "mid")).toBe(2);
    expect(labelCallCount(removeLabelFromScript(dup, "mid"), "mid")).toBe(0);
  });

  it("the added label is observable by the parser when a tween references it", () => {
    // Tween at numeric 0; add a label at 1.0; a follow-up tween positioned at the
    // label parses without error and is located alongside the others.
    const withLabel = addLabelToScript(SYN_SINGLE, "beat", 1.0);
    const parsed = parseGsapScriptAcorn(withLabel);
    expect(parsed.animations.length).toBe(1);
    expect(withLabel).toContain('tl.addLabel("beat", 1);');
  });

  it("returns the script unchanged when there is no timeline to anchor to", () => {
    const noTl = `console.log("no timeline here");`;
    expect(addLabelToScript(noTl, "x", 1)).toBe(noTl);
    expect(removeLabelFromScript(noTl, "x")).toBe(noTl);
  });
});
