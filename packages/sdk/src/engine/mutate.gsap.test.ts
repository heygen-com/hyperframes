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

// A sub-composition host: data-hf-id="hf-host" (its own leaf id) AND
// data-composition-id="sub-1" (the id studio passes when targeting the root).
function freshSubComp(script = GSAP_SCRIPT) {
  return parseMutable(
    `<div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px">
  <div data-hf-id="hf-host" data-composition-id="sub-1" style="opacity: 0"></div>
  <script>${script}</script>
</div>`.trim(),
  );
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

  it("removeGsapTween → ok:true", () => {
    expect(validateOp(fresh(), { type: "removeGsapTween", animationId: "some-id" }).ok).toBe(true);
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

  it("returns EMPTY when no GSAP script", () => {
    const noScript = parseMutable(
      `<div data-hf-id="hf-stage" data-hf-root><div data-hf-id="hf-box"></div></div>`,
    );
    const result = applyOp(noScript, {
      type: "addGsapTween",
      target: "hf-box",
      tween: { method: "to", properties: { x: 1 } },
    });
    expect(result.forward).toHaveLength(0);
  });

  // A normal data-hf-id target keeps the [data-hf-id] selector form.
  it("emits a [data-hf-id] selector for a normal element target", () => {
    const result = applyOp(fresh(), {
      type: "addGsapTween",
      target: "hf-box",
      tween: { method: "to", properties: { x: 1 } },
    });
    const script = String(result.forward[0]?.value ?? "");
    expect(script).toContain(`[data-hf-id=\\"hf-box\\"]`);
    expect(script).not.toContain("data-composition-id");
  });

  // A sub-composition ROOT is addressed by its composition id, but the SDK's
  // element↔tween attribution is data-hf-id based. So a comp-id target must
  // resolve to the host element and emit the CANONICAL [data-hf-id="<host>"]
  // form — NOT [data-composition-id] (invisible to selectorMatchesId / cascade /
  // buildAnimationIdMap) and NOT [data-hf-id="<compId>"] (matches no element).
  it("emits a canonical [data-hf-id] selector for a sub-composition root target", () => {
    const result = applyOp(freshSubComp(), {
      type: "addGsapTween",
      target: "sub-1",
      tween: { method: "to", properties: { x: 1 } },
    });
    const script = String(result.forward[0]?.value ?? "");
    expect(script).toContain(`[data-hf-id=\\"hf-host\\"]`);
    expect(script).not.toContain("data-composition-id");
    expect(script).not.toContain(`[data-hf-id=\\"sub-1\\"]`);
  });

  // validateOp/can must accept a comp-root target (resolveScoped's comp-id
  // fallback resolves it) — otherwise can/apply diverge.
  it("validateOp accepts a sub-composition root target (no E_TARGET_NOT_FOUND)", () => {
    const r = validateOp(freshSubComp(), {
      type: "addGsapTween",
      target: "sub-1",
      tween: { method: "to", properties: { x: 1 } },
    });
    expect(r.ok).toBe(true);
  });

  // setTiming on the comp-root after adding a tween updates the tween's GSAP
  // position/duration — selectorMatchesId matches the canonical host hf-id.
  it("setTiming on a comp-root syncs its tween position/duration", () => {
    // applyOp mutates parsed.document in place, so chain ops on the same parsed.
    const parsed = freshSubComp();
    applyOp(parsed, {
      type: "addGsapTween",
      target: "sub-1",
      tween: { method: "to", duration: 0.5, properties: { x: 1 } },
    });
    applyOp(parsed, { type: "setTiming", target: "sub-1", start: 2, duration: 1.5 });
    const script = getScript(parsed);
    // The host tween's GSAP position (3rd arg) is now 2 and duration 1.5.
    expect(script).toContain(`[data-hf-id=\\"hf-host\\"]`);
    expect(script).toMatch(/duration:\s*1\.5/);
    expect(script).toMatch(/\},\s*2\)/);
  });

  // removeElement on the comp-root cascade-removes its tween (not orphaned).
  it("removeElement on a comp-root cascade-removes its tween", () => {
    const parsed = freshSubComp();
    applyOp(parsed, {
      type: "addGsapTween",
      target: "sub-1",
      tween: { method: "to", properties: { x: 1 } },
    });
    expect(getScript(parsed)).toContain(`[data-hf-id=\\"hf-host\\"]`);
    applyOp(parsed, { type: "removeElement", target: "sub-1" });
    expect(getScript(parsed)).not.toContain(`[data-hf-id=\\"hf-host\\"]`);
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
    const { parseGsapScript, addKeyframeToScript } = await import("@hyperframes/core/gsap-parser");
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
  it("removes keyframe at index 1 (50%)", () => {
    const parsed = fresh(KF_SCRIPT);
    const animId = `[data-hf-id="hf-box"]-to-0-visual`;
    const result = applyOp(parsed, {
      type: "removeGsapKeyframe",
      animationId: animId,
      keyframeIndex: 1,
    });
    expect(result.forward).toHaveLength(1);
    const newScript = String(result.forward[0]?.value ?? "");
    expect(newScript).not.toContain('"50%"');
    expect(newScript).toContain('"0%"');
    expect(newScript).toContain('"100%"');
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
});
