/**
 * Phase 3b — GSAP mutation handler tests.
 *
 * Verifies the 8 parser-backed ops: addGsapTween, setGsapTween, removeGsapTween,
 * setGsapKeyframe, addGsapKeyframe, removeGsapKeyframe, addLabel, removeLabel.
 */

import { describe, it, expect } from "vitest";
import { parseMutable } from "./model.js";
import { applyOp, validateOp } from "./mutate.js";
import { applyPatchesToDocument } from "./apply-patches.js";
import { serializeDocument } from "./serialize.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const GSAP_SCRIPT = `var tl = gsap.timeline({ paused: true });
tl.to("[data-hf-id=\\"hf-box\\"]", { opacity: 1, duration: 0.5, ease: "power2.out" }, 0.2);
window.__timelines["t"] = tl;`;

const KF_SCRIPT = `var tl = gsap.timeline({ paused: true });
tl.to("[data-hf-id=\\"hf-box\\"]", { keyframes: { "0%": { opacity: 0 }, "50%": { opacity: 0.7 }, "100%": { opacity: 1 } }, duration: 1 }, 0);
window.__timelines["t"] = tl;`;

function makeHtml(script: string) {
  return `<div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px">
  <div data-hf-id="hf-box" style="opacity: 0"></div>
  <script>${script}</script>
</div>`.trim();
}

function fresh(script = GSAP_SCRIPT) {
  return parseMutable(makeHtml(script));
}

function getScript(parsed: ReturnType<typeof parseMutable>): string {
  const doc = serializeDocument(parsed);
  const m = /<script>([\s\S]*?)<\/script>/i.exec(doc);
  return m ? m[1]!.trim() : "";
}

// ─── validateOp gating on timeline existence ──────────────────────────────────

const NO_TIMELINE_SCRIPT = `gsap.defaults({ ease: "power1.out" });
window.__timelines = {};`;

describe("validateOp — no gsap.timeline() declaration", () => {
  function freshNoTimeline() {
    return parseMutable(makeHtml(NO_TIMELINE_SCRIPT));
  }

  it("addGsapTween → ok:false / E_NO_GSAP_TIMELINE when script has no timeline", () => {
    const r = validateOp(freshNoTimeline(), {
      type: "addGsapTween",
      target: "hf-box",
      tween: { method: "to", properties: { x: 100 } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_NO_GSAP_TIMELINE");
  });

  it("addLabel → ok:false / E_NO_GSAP_TIMELINE when script has no timeline", () => {
    const r = validateOp(freshNoTimeline(), { type: "addLabel", name: "start", position: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_NO_GSAP_TIMELINE");
  });

  it("addGsapTween dispatch returns EMPTY when no timeline — no dangling tl call emitted", () => {
    const parsed = freshNoTimeline();
    const scriptBefore = getScript(parsed);
    const result = applyOp(parsed, {
      type: "addGsapTween",
      target: "hf-box",
      tween: { method: "to", properties: { x: 100 } },
    });
    expect(result.forward).toHaveLength(0);
    expect(getScript(parsed)).toBe(scriptBefore);
  });
});

// ─── validateOp returns true when GSAP script present ─────────────────────────

describe("validateOp with GSAP script", () => {
  it("addGsapTween → ok:true", () => {
    expect(
      validateOp(fresh(), {
        type: "addGsapTween",
        target: "hf-box",
        tween: { method: "to", duration: 0.3, properties: { x: 100 } },
      }).ok,
    ).toBe(true);
  });

  it("removeGsapTween → ok:true for a resolvable id", () => {
    expect(validateOp(fresh(), { type: "removeGsapTween", animationId: TWEEN_ANIM_ID }).ok).toBe(
      true,
    );
  });

  it("removeGsapTween → E_TARGET_NOT_FOUND for an unresolved id (can/apply agreement)", () => {
    const r = validateOp(fresh(), { type: "removeGsapTween", animationId: "no-such-id" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_TARGET_NOT_FOUND");
  });

  it("addLabel → ok:true", () => {
    expect(validateOp(fresh(), { type: "addLabel", name: "start", position: 0 }).ok).toBe(true);
  });
});

// ─── addGsapTween ─────────────────────────────────────────────────────────────

describe("addGsapTween", () => {
  it("inserts new tween and returns animationId in meta", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "addGsapTween",
      target: "hf-box",
      tween: { method: "to", duration: 0.3, properties: { x: 100 } },
    });
    expect(result.forward).toHaveLength(1);
    expect(result.forward[0]?.path).toBe("/script/gsap");
    expect(result.meta?.animationId).toBeTruthy();
    expect(typeof result.meta?.animationId).toBe("string");
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).toContain("x: 100");
    expect(newScript).toContain("duration: 0.3");
  });

  it("inverse patch restores original script", () => {
    const parsed = fresh();
    const original = getScript(parsed);
    const result = applyOp(parsed, {
      type: "addGsapTween",
      target: "hf-box",
      tween: { method: "to", duration: 0.3, properties: { x: 100 } },
    });
    applyPatchesToDocument(parsed, result.inverse);
    expect(getScript(parsed)).toBe(original);
  });

  it("adds repeat/yoyo as extras", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "addGsapTween",
      target: "hf-box",
      tween: { method: "to", duration: 1, properties: { y: 50 }, repeat: -1, yoyo: true },
    });
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).toContain("repeat: -1");
    expect(newScript).toContain("yoyo: true");
  });

  it("serializes stagger object as JSON, not [object Object]", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "addGsapTween",
      target: "hf-box",
      tween: {
        method: "to",
        duration: 1,
        properties: { opacity: 1 },
        stagger: { amount: 0.5, from: "center" } as any,
      },
    });
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).not.toContain("[object Object]");
    expect(newScript).toContain("amount");
  });

  it("adds fromTo tween with fromProperties and toProperties", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "addGsapTween",
      target: "hf-box",
      tween: {
        method: "fromTo",
        duration: 0.5,
        fromProperties: { opacity: 0 },
        toProperties: { opacity: 1 },
      },
    });
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).toContain("fromTo(");
    expect(newScript).toContain("opacity: 0");
    expect(newScript).toContain("opacity: 1");
  });

  it("R5 #1: fromTo destination supplied via `properties` (Studio add path) is not dropped", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "addGsapTween",
      target: "hf-box",
      tween: {
        method: "fromTo",
        duration: 0.5,
        fromProperties: { opacity: 0 },
        // Studio's add path puts the destination in `properties`, not `toProperties`.
        properties: { x: 400, opacity: 1 },
      },
    });
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).toContain("fromTo(");
    // Regression: fromTo previously read only `toProperties` and wrote empty
    // to-vars, so the destination vanished.
    expect(newScript).toContain("x: 400");
  });
});

// ─── Tween op test helpers ────────────────────────────────────────────────────

const TWEEN_ANIM_ID = `[data-hf-id="hf-box"]-to-200-visual`;

function assertEmptyForUnknownId(op: Parameters<typeof applyOp>[1]) {
  const result = applyOp(fresh(), op);
  expect(result.forward).toHaveLength(0);
}

function assertInverseRestoresScript(op: Parameters<typeof applyOp>[1]) {
  const parsed = fresh();
  const original = getScript(parsed);
  applyPatchesToDocument(parsed, applyOp(parsed, op).inverse);
  expect(getScript(parsed)).toBe(original);
}

// ─── setGsapTween ─────────────────────────────────────────────────────────────

describe("setGsapTween", () => {
  it("updates ease in existing tween", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setGsapTween",
      animationId: TWEEN_ANIM_ID,
      properties: { ease: "power3.in" },
    });
    expect(result.forward).toHaveLength(1);
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).toContain('"power3.in"');
    expect(newScript).not.toContain('"power2.out"');
  });

  it("updates duration in existing tween", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setGsapTween",
      animationId: TWEEN_ANIM_ID,
      properties: { duration: 1.5 },
    });
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).toContain("duration: 1.5");
    expect(newScript).not.toContain("duration: 0.5");
  });

  it("returns EMPTY for unknown animationId", () => {
    assertEmptyForUnknownId({
      type: "setGsapTween",
      animationId: "nonexistent-id",
      properties: { ease: "power1.in" },
    });
  });

  it("inverse restores original script", () => {
    assertInverseRestoresScript({
      type: "setGsapTween",
      animationId: TWEEN_ANIM_ID,
      properties: { ease: "power3.in" },
    });
  });
});

// ─── removeGsapTween ──────────────────────────────────────────────────────────

describe("removeGsapTween", () => {
  it("removes tween by animationId", () => {
    const parsed = fresh();
    const result = applyOp(parsed, { type: "removeGsapTween", animationId: TWEEN_ANIM_ID });
    expect(result.forward).toHaveLength(1);
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).not.toContain("opacity: 1");
  });

  it("returns EMPTY for unknown animationId", () => {
    assertEmptyForUnknownId({ type: "removeGsapTween", animationId: "no-such-id" });
  });

  it("inverse restores original script", () => {
    assertInverseRestoresScript({ type: "removeGsapTween", animationId: TWEEN_ANIM_ID });
  });
});

// ─── Keyframe ops ─────────────────────────────────────────────────────────────

describe("addGsapKeyframe", () => {
  it("inserts new keyframe at given percentage", () => {
    const parsed = fresh(KF_SCRIPT);
    const animId = `[data-hf-id="hf-box"]-to-0-visual`;
    const result = applyOp(parsed, {
      type: "addGsapKeyframe",
      animationId: animId,
      position: 25,
      value: { opacity: 0.3 },
    });
    expect(result.forward).toHaveLength(1);
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).toContain('"25%"');
    expect(newScript).toContain("opacity: 0.3");
  });

  it("backfills a NEW property into the other keyframes, matching the recast writer", async () => {
    const parsed = fresh(KF_SCRIPT);
    const animId = `[data-hf-id="hf-box"]-to-0-visual`;
    const result = applyOp(parsed, {
      type: "addGsapKeyframe",
      animationId: animId,
      position: 25,
      // `x` is brand-new to this keyframe set: it must be backfilled into the
      // existing keyframes so GSAP interpolates rather than snaps.
      value: { opacity: 0.3, x: 120 },
    });
    expect(result.forward).toHaveLength(1);
    const newScript = String(result.forward[0]?.value ?? "");

    // Parse the SDK-written script and compare against the recast writer fed the
    // same backfillDefaults the studio always sends (`PROPERTY_DEFAULTS[k] ?? 0`).
    const { parseGsapScript } = await import("@hyperframes/core/gsap-parser");
    const { addKeyframeToScript } = await import("@hyperframes/core/gsap-writer-acorn");
    const recast = addKeyframeToScript(KF_SCRIPT, animId, 25, { opacity: 0.3, x: 120 }, undefined, {
      opacity: 1,
      x: 0,
    });
    const kfOf = (s: string) =>
      parseGsapScript(s)
        .animations[0]?.keyframes?.keyframes?.slice()
        .sort((a, b) => a.percentage - b.percentage)
        .map((k) => ({ percentage: k.percentage, properties: k.properties }));
    expect(kfOf(newScript)).toEqual(kfOf(recast));

    // Every keyframe carries `x` (the new prop backfilled at its default 0).
    expect(newScript).toContain("x: 0");
  });
});

describe("setGsapKeyframe", () => {
  it("updates keyframe value at index 1 (50%)", () => {
    const parsed = fresh(KF_SCRIPT);
    const animId = `[data-hf-id="hf-box"]-to-0-visual`;
    const result = applyOp(parsed, {
      type: "setGsapKeyframe",
      animationId: animId,
      keyframeIndex: 1,
      value: { opacity: 0.5 },
    });
    expect(result.forward).toHaveLength(1);
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).toContain("opacity: 0.5");
    expect(newScript).not.toContain("opacity: 0.7");
  });

  it("returns EMPTY for out-of-range keyframeIndex", () => {
    const parsed = fresh(KF_SCRIPT);
    const result = applyOp(parsed, {
      type: "setGsapKeyframe",
      animationId: `[data-hf-id="hf-box"]-to-0-visual`,
      keyframeIndex: 99,
      value: { opacity: 0 },
    });
    expect(result.forward).toHaveLength(0);
  });

  it("position-only move preserves existing properties — does not delete keyframe", () => {
    const parsed = fresh(KF_SCRIPT);
    const animId = `[data-hf-id="hf-box"]-to-0-visual`;
    const result = applyOp(parsed, {
      type: "setGsapKeyframe",
      animationId: animId,
      keyframeIndex: 1,
      position: 60,
    });
    expect(result.forward).toHaveLength(1);
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).toContain('"60%"');
    expect(newScript).not.toContain('"50%"');
    expect(newScript).toContain("opacity: 0.7");
  });

  it("move with a new prop threads backfill defaults into sibling keyframes (matches add path)", async () => {
    const parsed = fresh(KF_SCRIPT);
    const animId = `[data-hf-id="hf-box"]-to-0-visual`;
    // Move the 50% keyframe to 60% while introducing a NEW prop `x`. The move
    // path (remove + re-add) must seed `x` into the other keyframes with its
    // default, exactly like the add path does.
    const result = applyOp(parsed, {
      type: "setGsapKeyframe",
      animationId: animId,
      keyframeIndex: 1,
      position: 60,
      value: { opacity: 0.5, x: 120 },
    });
    expect(result.forward).toHaveLength(1);
    const newScript = String(result.forward[0]?.value ?? "");

    // The 0% and 100% keyframes should now carry `x` backfilled at its default 0.
    const { parseGsapScript } = await import("@hyperframes/core/gsap-parser");
    const kfs = parseGsapScript(newScript)
      .animations[0]?.keyframes?.keyframes?.slice()
      .sort((a, b) => a.percentage - b.percentage);
    expect(kfs?.map((k) => k.percentage)).toEqual([0, 60, 100]);
    expect(kfs?.find((k) => k.percentage === 0)?.properties.x).toBe(0);
    expect(kfs?.find((k) => k.percentage === 100)?.properties.x).toBe(0);
    expect(kfs?.find((k) => k.percentage === 60)?.properties.x).toBe(120);
  });

  it("ease-only update (same position, no value) does not corrupt keyframe", () => {
    const kfWithEase = KF_SCRIPT.replace(
      '"0%": { opacity: 0 }',
      '"0%": { opacity: 0, ease: "power1.in" }',
    );
    const parsed = fresh(kfWithEase);
    const animId = `[data-hf-id="hf-box"]-to-0-visual`;
    const result = applyOp(parsed, {
      type: "setGsapKeyframe",
      animationId: animId,
      keyframeIndex: 0,
      ease: "power2.out",
    });
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).toContain('"0%"');
    expect(newScript).toContain("opacity: 0");
  });
});

describe("removeGsapKeyframe", () => {
  it("removes keyframe at 50%", () => {
    const parsed = fresh(KF_SCRIPT);
    const animId = `[data-hf-id="hf-box"]-to-0-visual`;
    const result = applyOp(parsed, {
      type: "removeGsapKeyframe",
      animationId: animId,
      percentage: 50,
    });
    expect(result.forward).toHaveLength(1);
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).not.toContain('"50%"');
    expect(newScript).toContain('"0%"');
    expect(newScript).toContain('"100%"');
  });
});

describe("removeAllKeyframes", () => {
  it("collapses keyframed to() tween to last keyframe's props", () => {
    const parsed = fresh(KF_SCRIPT);
    const animId = `[data-hf-id="hf-box"]-to-0-visual`;
    const result = applyOp(parsed, { type: "removeAllKeyframes", animationId: animId });
    expect(result.forward).toHaveLength(1);
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).not.toContain("keyframes");
    expect(newScript).not.toContain('"50%"');
    expect(newScript).toContain("opacity: 1");
  });

  it("no-op (empty patch) when animation id not found", () => {
    const parsed = fresh(KF_SCRIPT);
    const result = applyOp(parsed, { type: "removeAllKeyframes", animationId: "nope" });
    expect(result.forward).toHaveLength(0);
  });

  it("no-op when tween has no keyframes", () => {
    const parsed = fresh(GSAP_SCRIPT);
    const animId = `[data-hf-id="hf-box"]-to-0-visual`;
    const result = applyOp(parsed, { type: "removeAllKeyframes", animationId: animId });
    expect(result.forward).toHaveLength(0);
  });
});

// ─── materializeKeyframes ──────────────────────────────────────────────────────

describe("materializeKeyframes", () => {
  // dispatch bypasses validateOp, so the writer guard is the protection: an empty
  // keyframe list must no-op rather than rebuild vars with an empty keyframes
  // object (which would empty the animation). Uses the real anim id so the no-op
  // is attributable to the empty list, not an unresolved id.
  it("empty keyframe list no-ops on the dispatch path (writer guard)", () => {
    const parsed = fresh();
    const before = getScript(parsed);
    const result = applyOp(parsed, {
      type: "materializeKeyframes",
      animationId: TWEEN_ANIM_ID,
      keyframes: [],
    });
    expect(result.forward).toHaveLength(0);
    expect(getScript(parsed)).toBe(before);
  });
});

// ─── convertToKeyframes ────────────────────────────────────────────────────────

describe("convertToKeyframes", () => {
  // GSAP_SCRIPT: position 0.2 → id suffix "200"; opacity = visual group
  it("converts flat to() tween to percentage keyframes", () => {
    const parsed = fresh();
    const result = applyOp(parsed, { type: "convertToKeyframes", animationId: TWEEN_ANIM_ID });
    expect(result.forward).toHaveLength(1);
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).toContain("keyframes");
    expect(newScript).toContain('"0%"');
    expect(newScript).toContain('"100%"');
    expect(newScript).toContain("easeEach");
    expect(newScript).toContain('ease: "none"');
  });

  it("passes resolvedFromValues into 0% endpoint", () => {
    const script = `var tl = gsap.timeline({ paused: true });
tl.to("[data-hf-id=\\"hf-box\\"]", { x: 200, duration: 1 }, 0);
window.__timelines["t"] = tl;`;
    const parsed = fresh(script);
    // position 0 → "0"; x = position group
    const animId = `[data-hf-id="hf-box"]-to-0-position`;
    const result = applyOp(parsed, {
      type: "convertToKeyframes",
      animationId: animId,
      resolvedFromValues: { x: 42 },
    });
    expect(result.forward).toHaveLength(1);
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).toContain("42");
  });

  it("no-op when animation already has keyframes", () => {
    const parsed = fresh(KF_SCRIPT);
    const animId = `[data-hf-id="hf-box"]-to-0-visual`;
    const result = applyOp(parsed, { type: "convertToKeyframes", animationId: animId });
    expect(result.forward).toHaveLength(0);
  });

  it("no-op when animation id not found", () => {
    const parsed = fresh();
    const result = applyOp(parsed, { type: "convertToKeyframes", animationId: "nope" });
    expect(result.forward).toHaveLength(0);
  });
});

// ─── materializeKeyframes ─────────────────────────────────────────────────────

describe("materializeKeyframes", () => {
  it("adds keyframes property to flat tween", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "materializeKeyframes",
      animationId: TWEEN_ANIM_ID,
      keyframes: [
        { percentage: 0, properties: { opacity: 0 } },
        { percentage: 100, properties: { opacity: 1 } },
      ],
    });
    expect(result.forward).toHaveLength(1);
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).toContain("keyframes");
    expect(newScript).toContain('"0%"');
    expect(newScript).toContain('"100%"');
  });

  it("injects easeEach into keyframes object", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "materializeKeyframes",
      animationId: TWEEN_ANIM_ID,
      keyframes: [
        { percentage: 0, properties: { opacity: 0 } },
        { percentage: 100, properties: { opacity: 1 } },
      ],
      easeEach: "power2.out",
    });
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).toContain("easeEach");
    expect(newScript).toContain("power2.out");
  });

  it("no-op when animation id not found", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "materializeKeyframes",
      animationId: "nope",
      keyframes: [{ percentage: 0, properties: { opacity: 0 } }],
    });
    expect(result.forward).toHaveLength(0);
  });
});

// ─── splitIntoPropertyGroups ──────────────────────────────────────────────────

describe("splitIntoPropertyGroups", () => {
  it("splits mixed tween into multiple group tweens", () => {
    const script = `var tl = gsap.timeline({ paused: true });
tl.to("[data-hf-id=\\"hf-box\\"]", { x: 100, opacity: 0.5, duration: 1 }, 0);
window.__timelines["t"] = tl;`;
    const parsed = fresh(script);
    // mixed tween has no propertyGroup → no group suffix in id
    const animId = `[data-hf-id="hf-box"]-to-0`;
    const result = applyOp(parsed, { type: "splitIntoPropertyGroups", animationId: animId });
    expect(result.forward).toHaveLength(1);
    const newScript = String(result.forward[0]?.value ?? "");
    // x is position group, opacity is visual group — expect 2 tweens
    const toCount = (newScript.match(/\.to\(/g) ?? []).length;
    expect(toCount).toBe(2);
  });

  it("no-op when animation id not found", () => {
    const parsed = fresh();
    const result = applyOp(parsed, { type: "splitIntoPropertyGroups", animationId: "nope" });
    expect(result.forward).toHaveLength(0);
  });

  it("no-op when tween has only one property group", () => {
    // x + y = same "position" group → nothing to split
    const script = `var tl = gsap.timeline({ paused: true });
tl.to("[data-hf-id=\\"hf-box\\"]", { x: 100, y: 50, duration: 1 }, 0);
window.__timelines["t"] = tl;`;
    const parsed = fresh(script);
    const animId = `[data-hf-id="hf-box"]-to-0-position`;
    const result = applyOp(parsed, { type: "splitIntoPropertyGroups", animationId: animId });
    expect(result.forward).toHaveLength(0);
  });
});

// ─── splitAnimations ──────────────────────────────────────────────────────────

describe("splitAnimations", () => {
  const SPLIT_SCRIPT = `var tl = gsap.timeline({ paused: true });
tl.to("#hero", { x: 200, duration: 4 }, 0);
window.__timelines["t"] = tl;`;

  function freshSplit() {
    return parseMutable(`<div data-hf-id="hf-stage" data-hf-root style="width:1280px;height:720px">
  <div data-hf-id="hf-hero"></div>
  <script>${SPLIT_SCRIPT}</script>
</div>`);
  }

  it("retargets post-split tween to newId", () => {
    const parsed = freshSplit();
    const result = applyOp(parsed, {
      type: "splitAnimations",
      originalId: "hero",
      newId: "hero-2",
      splitTime: 3,
      elementStart: 0,
      elementDuration: 4,
    });
    expect(result.forward).toHaveLength(1);
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).toContain("#hero-2");
  });

  it("spanning tween produces fromTo on new element", () => {
    const parsed = freshSplit();
    const result = applyOp(parsed, {
      type: "splitAnimations",
      originalId: "hero",
      newId: "hero-2",
      splitTime: 2,
      elementStart: 0,
      elementDuration: 4,
    });
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).toContain(".fromTo(");
    expect(newScript).toContain("#hero-2");
  });

  it("no-op when originalId not found", () => {
    const parsed = freshSplit();
    const result = applyOp(parsed, {
      type: "splitAnimations",
      originalId: "nonexistent",
      newId: "x",
      splitTime: 2,
      elementStart: 0,
      elementDuration: 4,
    });
    expect(result.forward).toHaveLength(0);
  });
});

// ─── setTiming — per-tween GSAP shift/scale (review #3) ───────────────────────

describe("setTiming — GSAP sync shifts/scales each tween (not absolute)", () => {
  // Two staggered tweens on ONE element: positions 2.0 and 5.0, clip [2, 7].
  const STAGGER_SCRIPT = `var tl = gsap.timeline({ paused: true });
tl.to("[data-hf-id=\\"hf-box\\"]", { x: 100, duration: 1 }, 2);
tl.to("[data-hf-id=\\"hf-box\\"]", { x: 200, duration: 1 }, 5);
window.__timelines["t"] = tl;`;

  function freshStagger() {
    return parseMutable(`<div data-hf-id="hf-stage" data-hf-root style="width:1280px;height:720px">
  <div data-hf-id="hf-box" data-start="2" data-end="7"></div>
  <script>${STAGGER_SCRIPT}</script>
</div>`);
  }

  function gsapPatch(result: ReturnType<typeof applyOp>): string {
    const v = result.forward
      .map((p) => p.value)
      .find((val) => typeof val === "string" && val.includes("tl."));
    return typeof v === "string" ? v : "";
  }

  it("moving the clip +1 shifts BOTH tweens by the delta, preserving the stagger", () => {
    const result = applyOp(freshStagger(), { type: "setTiming", target: "hf-box", start: 3 });
    const script = gsapPatch(result);
    // 2.0 → 3.0 and 5.0 → 6.0 — NOT both collapsed onto the new absolute start.
    expect(script).toContain("{ x: 100, duration: 1 }, 3)");
    expect(script).toContain("{ x: 200, duration: 1 }, 6)");
    // The stagger gap (3s) is preserved; durations are untouched.
    expect(script).not.toContain("duration: 5");
  });

  it("resizing the clip x2 scales each tween's duration by the ratio (not full clip)", () => {
    // duration 5 → 10 (ratio 2); positions remap about the clip start (2).
    const result = applyOp(freshStagger(), { type: "setTiming", target: "hf-box", duration: 10 });
    const script = gsapPatch(result);
    // pos 2 (offset 0) stays 2; pos 5 → 2 + (5-2)*2 = 8. durations 1 → 2.
    expect(script).toContain("{ x: 100, duration: 2 }, 2)");
    expect(script).toContain("{ x: 200, duration: 2 }, 8)");
    // The bug blew every duration up to the full clip duration (10).
    expect(script).not.toContain("duration: 10");
  });
});

// ─── Label ops ────────────────────────────────────────────────────────────────

describe("addLabel", () => {
  it("inserts addLabel call into script", () => {
    const parsed = fresh();
    const result = applyOp(parsed, { type: "addLabel", name: "intro", position: 0.5 });
    expect(result.forward).toHaveLength(1);
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).toContain('addLabel("intro"');
    expect(newScript).toContain("0.5");
  });

  it("addLabel output is not blocked by GSAP validator", async () => {
    const { validateCompositionGsap } = await import("@hyperframes/core/gsap-parser");
    const parsed = fresh();
    const result = applyOp(parsed, { type: "addLabel", name: "scene1", position: 1.0 });
    const newScript = String(result.forward[0]?.value ?? "");
    const { errors } = validateCompositionGsap(newScript);
    const labelError = errors.find((e) => /addLabel/i.test(e));
    expect(labelError).toBeUndefined();
  });

  it("inverse restores original script", () => {
    const parsed = fresh();
    const original = getScript(parsed);
    const result = applyOp(parsed, { type: "addLabel", name: "intro", position: 0.5 });
    applyPatchesToDocument(parsed, result.inverse);
    expect(getScript(parsed)).toBe(original);
  });
});

describe("removeLabel", () => {
  it("removes addLabel call from script", () => {
    const withLabel = GSAP_SCRIPT.replace(
      'window.__timelines["t"] = tl;',
      'tl.addLabel("intro", 0.5);\nwindow.__timelines["t"] = tl;',
    );
    const parsed = fresh(withLabel);
    const result = applyOp(parsed, { type: "removeLabel", name: "intro" });
    expect(result.forward).toHaveLength(1);
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).not.toContain("addLabel");
  });

  it("returns EMPTY when label not found", () => {
    const parsed = fresh();
    const result = applyOp(parsed, { type: "removeLabel", name: "nonexistent" });
    expect(result.forward).toHaveLength(0);
  });
});

// ─── removeElement GSAP cascade ──────────────────────────────────────────────

describe("removeElement — GSAP cascade", () => {
  it("removes animations targeting the removed element from the script", () => {
    const parsed = fresh();
    const result = applyOp(parsed, { type: "removeElement", target: "hf-box" });
    // forward: [remove_element, replace_script]
    expect(result.forward).toHaveLength(2);
    expect(result.forward[0]).toEqual({ op: "remove", path: "/elements/hf-box" });
    const newScript = String(result.forward[1]?.value ?? "");
    expect(newScript).not.toContain("hf-box");
  });

  it("inverse restores element AND script", () => {
    const parsed = fresh();
    const { inverse } = applyOp(parsed, { type: "removeElement", target: "hf-box" });
    // inverse[0] = restore element, inverse[1] = restore script
    expect(inverse).toHaveLength(2);
    expect(inverse[0]?.op).toBe("add");
    expect(inverse[0]?.path).toBe("/elements/hf-box");
    expect(inverse[1]?.op).toBe("replace");
    expect(inverse[1]?.path).toBe("/script/gsap");
    const restoredScript = String(inverse[1]?.value ?? "");
    expect(restoredScript).toContain("hf-box");
  });

  it("applying inverse restores element and GSAP script to original", () => {
    const parsed = fresh();
    const origScript = getScript(parsed);
    const { inverse } = applyOp(parsed, { type: "removeElement", target: "hf-box" });
    applyPatchesToDocument(parsed, inverse);
    expect(parsed.document.querySelector('[data-hf-id="hf-box"]')).not.toBeNull();
    expect(getScript(parsed)).toBe(origScript);
  });

  it("emits only element patch when composition has no GSAP script", () => {
    const noScriptHtml = `<div data-hf-id="hf-stage" data-hf-root style="width:1280px;height:720px">
  <div data-hf-id="hf-box"></div>
</div>`.trim();
    const parsed = parseMutable(noScriptHtml);
    const result = applyOp(parsed, { type: "removeElement", target: "hf-box" });
    expect(result.forward).toHaveLength(1);
    expect(result.forward[0]?.op).toBe("remove");
  });

  it("does not remove animations targeting other elements", () => {
    const twoTweenScript = `var tl = gsap.timeline({ paused: true });
tl.to("[data-hf-id=\\"hf-box\\"]", { opacity: 1, duration: 0.5 }, 0);
tl.to("[data-hf-id=\\"hf-stage\\"]", { scale: 1.05, duration: 1 }, 0);
window.__timelines["t"] = tl;`;
    const parsed = fresh(twoTweenScript);
    const result = applyOp(parsed, { type: "removeElement", target: "hf-box" });
    const newScript = String(result.forward[1]?.value ?? "");
    expect(newScript).not.toContain("hf-box");
    expect(newScript).toContain("hf-stage");
  });

  it("strips ALL tweens for the element, not just the first (positional-id renumber)", () => {
    // Two tweens on the same element: removing the first renumbers the survivor's
    // count-based id, so a single up-front parse left the second tween orphaned.
    const twoOwnTweens = `var tl = gsap.timeline({ paused: true });
tl.to("[data-hf-id=\\"hf-box\\"]", { x: 100, duration: 1 }, 0);
tl.to("[data-hf-id=\\"hf-box\\"]", { x: 200, duration: 1 }, 1);
window.__timelines["t"] = tl;`;
    const parsed = fresh(twoOwnTweens);
    const result = applyOp(parsed, { type: "removeElement", target: "hf-box" });
    const newScript = String(result.forward[1]?.value ?? "");
    expect(newScript).not.toContain("hf-box");
    expect(newScript).not.toContain("x: 100");
    expect(newScript).not.toContain("x: 200");
  });
});

// ─── GSAP ops on composition with no script block ────────────────────────────

const NO_SCRIPT_HTML = `<div data-hf-id="hf-stage" data-hf-root style="width:1280px;height:720px">
  <div data-hf-id="hf-box" style="opacity:0"></div>
</div>`.trim();

describe("GSAP ops on composition with no GSAP script block", () => {
  function freshNoScript() {
    return parseMutable(NO_SCRIPT_HTML);
  }

  it("addGsapTween throws instead of silent no-op", () => {
    expect(() =>
      applyOp(freshNoScript(), {
        type: "addGsapTween",
        target: "hf-box",
        tween: { method: "to", properties: { x: 100 } },
      }),
    ).toThrow();
  });

  it("setGsapTween throws instead of silent no-op", () => {
    expect(() =>
      applyOp(freshNoScript(), {
        type: "setGsapTween",
        animationId: "anim-1",
        properties: { ease: "power2.out" },
      }),
    ).toThrow();
  });

  it("removeGsapTween throws instead of silent no-op", () => {
    expect(() =>
      applyOp(freshNoScript(), { type: "removeGsapTween", animationId: "anim-1" }),
    ).toThrow();
  });

  it("addGsapKeyframe throws when script element is null", () => {
    expect(() =>
      applyOp(freshNoScript(), {
        type: "addGsapKeyframe",
        animationId: "a1",
        percentage: 0,
        value: { opacity: 0 },
      }),
    ).toThrow("No GSAP script block found");
  });
});

// ─── arc path ops ─────────────────────────────────────────────────────────────

const ARC_SCRIPT = `var tl = gsap.timeline({ paused: true });
tl.to('[data-hf-id="hf-hero"]', { x: 100, y: 50, duration: 2 }, 0);
window.__timelines["t"] = tl;`;
const ARC_ANIM_ID = `[data-hf-id="hf-hero"]-to-0-position`;
const ARC_ENABLED_CONFIG = {
  enabled: true as const,
  autoRotate: false as const,
  segments: [{ curviness: 1 }],
};

function freshArc() {
  return parseMutable(makeHtml(ARC_SCRIPT));
}

function enableArc(parsed: ReturnType<typeof parseMutable>) {
  applyOp(parsed, { type: "setArcPath", animationId: ARC_ANIM_ID, config: ARC_ENABLED_CONFIG });
}

describe("setArcPath", () => {
  it("enabled: true adds motionPath to script", () => {
    const parsed = freshArc();
    enableArc(parsed);
    expect(getScript(parsed)).toContain("motionPath");
  });

  it("enabled: false removes motionPath and restores x/y", () => {
    const parsed = freshArc();
    enableArc(parsed);
    applyOp(parsed, {
      type: "setArcPath",
      animationId: ARC_ANIM_ID,
      config: { enabled: false, autoRotate: false, segments: [] },
    });
    const s = getScript(parsed);
    expect(s).not.toContain("motionPath");
  });

  it("no-op when animation not found", () => {
    const parsed = freshArc();
    const before = getScript(parsed);
    applyOp(parsed, { type: "setArcPath", animationId: "nonexistent", config: ARC_ENABLED_CONFIG });
    expect(getScript(parsed)).toBe(before);
  });
});

describe("updateArcSegment", () => {
  it("changes curviness of segment", () => {
    const parsed = freshArc();
    enableArc(parsed);
    applyOp(parsed, {
      type: "updateArcSegment",
      animationId: ARC_ANIM_ID,
      segmentIndex: 0,
      update: { curviness: 2 },
    });
    expect(getScript(parsed)).toContain("motionPath");
  });
});

describe("removeArcPath", () => {
  it("removes motionPath from script", () => {
    const parsed = freshArc();
    enableArc(parsed);
    applyOp(parsed, { type: "removeArcPath", animationId: ARC_ANIM_ID });
    expect(getScript(parsed)).not.toContain("motionPath");
  });
});

// ─── R3 #6 — validateOp rejects unappliable arc-segment edits ─────────────────

describe("validateOp updateArcSegment (R3 #6)", () => {
  it("E_ARC_NOT_ENABLED when the tween has no enabled arc path", () => {
    const r = validateOp(freshArc(), {
      type: "updateArcSegment",
      animationId: ARC_ANIM_ID,
      segmentIndex: 0,
      update: { curviness: 2 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_ARC_NOT_ENABLED");
  });

  it("E_INVALID_ARGS when the segment index is out of range", () => {
    const parsed = freshArc();
    enableArc(parsed);
    const r = validateOp(parsed, {
      type: "updateArcSegment",
      animationId: ARC_ANIM_ID,
      segmentIndex: 9,
      update: { curviness: 2 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_INVALID_ARGS");
  });
});

// ─── R3 #13b — deleteAllForSelector matches across quote styles ────────────────

describe("deleteAllForSelector quote-insensitive match (R3 #13b)", () => {
  it("removes a tween authored with double quotes when given a single-quoted selector", () => {
    const html = `<div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px">
  <div data-hf-id="hf-box"></div>
  <script>var tl = gsap.timeline({ paused: true }); tl.to("[data-hf-id=\\"hf-box\\"]", { x: 1, duration: 1 }, 0); window.__timelines["t"] = tl;</script>
</div>`;
    const parsed = parseMutable(html);
    const result = applyOp(parsed, {
      type: "deleteAllForSelector",
      selector: `[data-hf-id='hf-box']`,
    });
    expect(result.forward.length).toBeGreaterThan(0);
    expect(getScript(parsed)).not.toContain("tl.to(");
  });
});

// ─── CF2 #15/#16 — handleSetTiming syncs #domId tweens + resizes data-duration ─

describe("handleSetTiming GSAP sync (CF2 #15/#16)", () => {
  function timingDoc(attrs: string, tween: string) {
    return parseMutable(
      `<div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px">
  <div id="box" data-hf-id="hf-box" ${attrs}></div>
  <script>var tl = gsap.timeline({ paused: true }); ${tween} window.__timelines["t"] = tl;</script>
</div>`,
    );
  }

  it("#15: a #domId-targeted tween shifts when the clip moves", () => {
    const parsed = timingDoc(
      `data-start="2" data-end="5"`,
      `tl.to("#box", { x: 100, duration: 1 }, 2);`,
    );
    applyOp(parsed, { type: "setTiming", target: "hf-box", start: 5 });
    // position remapped 2 → 5 (delta +3); the bug left it at 2.
    expect(getScript(parsed)).toMatch(/tl\.to\("#box",[^)]*\}, 5\)/);
  });

  it("#16: a data-duration clip updates data-duration and scales its tween", () => {
    const parsed = timingDoc(
      `data-start="2" data-duration="4"`,
      `tl.to("#box", { x: 100, duration: 4 }, 2);`,
    );
    applyOp(parsed, { type: "setTiming", target: "hf-box", duration: 8 });
    const el = parsed.document.querySelector('[data-hf-id="hf-box"]');
    // data-duration updated (not a stale value beside a fresh data-end).
    expect(el?.getAttribute("data-duration")).toBe("8");
    expect(el?.getAttribute("data-end")).toBeNull();
    // tween duration scaled 4 → 8 (ratio 2).
    expect(getScript(parsed)).toContain("duration: 8");
  });

  it("R5 #3: a start-less clip (no data-start) still shifts its tween (implicit start 0)", () => {
    const parsed = timingDoc(`data-duration="4"`, `tl.to("#box", { x: 100, duration: 1 }, 2);`);
    applyOp(parsed, { type: "setTiming", target: "hf-box", start: 3 });
    // oldStart defaults to 0, so position remaps 2 → 3 + (2 − 0) = 5.
    // The bug skipped the whole sync block when data-start was absent.
    expect(getScript(parsed)).toMatch(/tl\.to\("#box",[^)]*\}, 5\)/);
  });

  it("R5 #3: a malformed data-start never writes position: NaN", () => {
    const parsed = timingDoc(
      `data-start="" data-duration="4"`,
      `tl.to("#box", { x: 100, duration: 1 }, 2);`,
    );
    applyOp(parsed, { type: "setTiming", target: "hf-box", start: 3 });
    const script = getScript(parsed);
    expect(script).not.toContain("NaN");
    expect(script).toMatch(/tl\.to\("#box",[^)]*\}, 5\)/);
  });

  it("R5 #2: an implicit-position tween is not collapsed to an absolute position on move", () => {
    const parsed = timingDoc(
      `data-start="2" data-end="5"`,
      `tl.to("#box", { x: 100, duration: 1 });`,
    );
    applyOp(parsed, { type: "setTiming", target: "hf-box", start: 5 });
    const script = getScript(parsed);
    // The tween had no position arg (auto-sequenced); it must stay that way —
    // appending an absolute position would collapse the stagger.
    expect(script).toContain('tl.to("#box", { x: 100, duration: 1 })');
    expect(script).not.toMatch(/tl\.to\("#box",[^)]*\}, \d/);
  });

  it("R5 #7: a clip with BOTH data-duration and data-end keeps data-end in sync on move", () => {
    const parsed = timingDoc(
      `data-start="1" data-duration="2" data-end="3"`,
      `tl.to("#box", { x: 1, duration: 2 }, 1);`,
    );
    applyOp(parsed, { type: "setTiming", target: "hf-box", start: 5 });
    const el = parsed.document.querySelector('[data-hf-id="hf-box"]');
    expect(el?.getAttribute("data-start")).toBe("5");
    expect(el?.getAttribute("data-duration")).toBe("2");
    // data-end recomputed (5 + 2); the bug left it stale at 3 → inverted clip.
    expect(el?.getAttribute("data-end")).toBe("7");
  });
});

// ─── WS-3.C dispatch-path guards (validateOp is advisory; handlers self-guard) ──

describe("addWithKeyframes / replaceWithKeyframes — handler self-guards", () => {
  const KFS = [
    { percentage: 0, properties: { opacity: 0 } },
    { percentage: 100, properties: { opacity: 1 } },
  ];
  const SEL = '[data-hf-id="hf-box"]';

  // Dispatch skips validateOp, so each handler must self-guard: no degenerate
  // `keyframes: {}` tween (empty list), and no silent degrade-to-add when the
  // replace target id resolves to nothing.
  it.each([
    {
      name: "addWithKeyframes with empty keyframes",
      op: {
        type: "addWithKeyframes",
        targetSelector: SEL,
        position: 0,
        duration: 1,
        keyframes: [],
      },
    },
    {
      name: "replaceWithKeyframes with an unknown animationId",
      op: {
        type: "replaceWithKeyframes",
        animationId: "does-not-exist",
        targetSelector: SEL,
        position: 0,
        duration: 1,
        keyframes: KFS,
      },
    },
  ] as const)("$name is a no-op (script unchanged)", ({ op }) => {
    const parsed = fresh();
    const before = getScript(parsed);
    const result = applyOp(parsed, op);
    expect(result.forward).toHaveLength(0);
    expect(getScript(parsed)).toBe(before);
  });

  // #11: a stale positional id that re-points to a tween on a DIFFERENT selector
  // must NOT be silently replaced; only an id still targeting the caller's
  // selector applies.
  it("replaceWithKeyframes: stale id whose tween targets another selector is a no-op", () => {
    const parsed = fresh();
    const sel = '[data-hf-id="hf-box"]';
    const add = applyOp(parsed, {
      type: "addWithKeyframes",
      targetSelector: sel,
      position: 0,
      duration: 1,
      keyframes: KFS,
    });
    const id = add.meta!.animationId!;
    const before = getScript(parsed);
    // Same id, but the caller now claims a different selector → bail.
    const wrong = applyOp(parsed, {
      type: "replaceWithKeyframes",
      animationId: id,
      targetSelector: '[data-hf-id="hf-other"]',
      position: 0,
      duration: 1,
      keyframes: KFS,
    });
    expect(wrong.forward).toHaveLength(0);
    expect(getScript(parsed)).toBe(before);
    // Correct selector → the replace applies.
    const right = applyOp(parsed, {
      type: "replaceWithKeyframes",
      animationId: id,
      targetSelector: sel,
      position: 0,
      duration: 1,
      keyframes: KFS,
    });
    expect(right.forward.length).toBeGreaterThan(0);
  });
});
