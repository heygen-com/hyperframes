import { describe, expect, it, vi, beforeEach } from "vitest";
import { openComposition } from "@hyperframes/sdk";
import {
  resolveKeyframeIndexByPercentage,
  keyframeOpToEditOp,
  gsapKeyframeFidelityMismatches,
  runShadowGsapKeyframeFidelity,
  type ShadowKeyframeOp,
} from "./sdkShadowGsapKeyframe";
import { runShadowDispatch } from "./sdkShadow";
import type { PatchOperation } from "./sourcePatcher";

// Capture sdk_shadow_dispatch telemetry.
const trackedEvents: Array<{ event: string; props: Record<string, unknown> }> = [];
vi.mock("./studioTelemetry", () => ({
  trackStudioEvent: (event: string, props: Record<string, unknown>) =>
    trackedEvents.push({ event, props }),
}));
// STUDIO_SDK_SHADOW_ENABLED defaults true (no env override in test), so the
// runners are active here without mocking the availability module.

beforeEach(() => {
  trackedEvents.length = 0;
});
const lastShadow = () =>
  trackedEvents.filter((e) => e.event === "sdk_shadow_dispatch").at(-1)?.props;

const ANIM_ID = "#hero-to-0-position";

function gsapHtml(scriptBody: string): string {
  return /* html */ `<!DOCTYPE html><html><body>
  <div data-hf-id="hf-hero" id="hero" class="clip">x</div>
  <script>
${scriptBody}
  window.__timelines = [tl];
  </script>
</body></html>`;
}

const KF_SCRIPT = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#hero", { keyframes: { "0%": { x: 0 }, "50%": { x: 100 }, "100%": { x: 200 } }, duration: 5 }, 0);`;

// A script body string (not full HTML) for the index-resolution helpers.
const KF_SCRIPT_BODY = KF_SCRIPT;
const DUP_SCRIPT_BODY = `
  const tl = gsap.timeline({ paused: true });
  tl.to("#hero", { keyframes: { "0%": { x: 0 }, "50%": { x: 100 }, "50%": { x: 150 }, "100%": { x: 200 } }, duration: 5 }, 0);`;

describe("resolveKeyframeIndexByPercentage", () => {
  it("resolves a unique percentage to its 0-based index", () => {
    expect(resolveKeyframeIndexByPercentage(KF_SCRIPT_BODY, ANIM_ID, 50)).toEqual({
      keyframeIndex: 1,
    });
    expect(resolveKeyframeIndexByPercentage(KF_SCRIPT_BODY, ANIM_ID, 100)).toEqual({
      keyframeIndex: 2,
    });
  });

  it("matches within ~0.001 tolerance", () => {
    expect(resolveKeyframeIndexByPercentage(KF_SCRIPT_BODY, ANIM_ID, 50.0005).keyframeIndex).toBe(
      1,
    );
  });

  it("returns null with not_found when no percentage matches", () => {
    expect(resolveKeyframeIndexByPercentage(KF_SCRIPT_BODY, ANIM_ID, 33)).toEqual({
      keyframeIndex: null,
      reason: "not_found",
    });
  });

  it("returns null with no_keyframes for an unknown animation", () => {
    expect(resolveKeyframeIndexByPercentage(KF_SCRIPT_BODY, "#nope-to-0", 50)).toEqual({
      keyframeIndex: null,
      reason: "no_keyframes",
    });
  });

  it("returns null with no_keyframes when script is empty", () => {
    expect(resolveKeyframeIndexByPercentage(null, ANIM_ID, 50).reason).toBe("no_keyframes");
  });

  it("no-ops on ambiguity (duplicate-percentage keyframes — PR #1498 landmine)", () => {
    expect(resolveKeyframeIndexByPercentage(DUP_SCRIPT_BODY, ANIM_ID, 50)).toEqual({
      keyframeIndex: null,
      reason: "ambiguous",
    });
  });

  // Regression: a from/fromTo tween's id may normalize to "-to-" on write, so a
  // "-from-"/"-fromTo-" animationId must fall back to the converted id (matching
  // the writer's locateAnimationWithFallback) — else the keyframe diff goes blind.
  it("falls back from a -from- id to the -to- tween", () => {
    const fromId = ANIM_ID.replace("-to-", "-from-");
    expect(resolveKeyframeIndexByPercentage(KF_SCRIPT_BODY, fromId, 50)).toEqual({
      keyframeIndex: 1,
    });
  });
});

describe("keyframeOpToEditOp", () => {
  it("maps add → addGsapKeyframe with position = percentage", () => {
    const op: ShadowKeyframeOp = {
      kind: "add",
      animationId: ANIM_ID,
      percentage: 25,
      properties: { x: 50 },
    };
    expect(keyframeOpToEditOp(op, KF_SCRIPT_BODY)).toEqual({
      op: { type: "addGsapKeyframe", animationId: ANIM_ID, position: 25, value: { x: 50 } },
    });
  });

  it("maps remove → removeGsapKeyframe with resolved index", () => {
    const op: ShadowKeyframeOp = { kind: "remove", animationId: ANIM_ID, percentage: 50 };
    expect(keyframeOpToEditOp(op, KF_SCRIPT_BODY)).toEqual({
      op: { type: "removeGsapKeyframe", animationId: ANIM_ID, keyframeIndex: 1 },
    });
  });

  it("returns null op + reason when remove percentage is ambiguous", () => {
    const op: ShadowKeyframeOp = { kind: "remove", animationId: ANIM_ID, percentage: 50 };
    expect(keyframeOpToEditOp(op, DUP_SCRIPT_BODY)).toEqual({ op: null, reason: "ambiguous" });
  });
});

describe("gsapKeyframeFidelityMismatches", () => {
  it("reports no mismatches when keyframe arrays match", () => {
    expect(gsapKeyframeFidelityMismatches(KF_SCRIPT_BODY, KF_SCRIPT_BODY, ANIM_ID)).toEqual([]);
  });

  it("reports a keyframes mismatch when arrays diverge", () => {
    const other = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#hero", { keyframes: { "0%": { x: 0 }, "50%": { x: 999 }, "100%": { x: 200 } }, duration: 5 }, 0);`;
    const mismatches = gsapKeyframeFidelityMismatches(KF_SCRIPT_BODY, other, ANIM_ID);
    expect(mismatches.some((m) => m.property === "keyframes")).toBe(true);
  });
});

describe("runShadowGsapKeyframeFidelity (add)", () => {
  it("emits gsap_keyframe with a keyframes mismatch when SDK adds but server didn't", async () => {
    const beforeHtml = gsapHtml(KF_SCRIPT);
    // server script unchanged (server "failed" to add the 25% keyframe) → drift
    const session = await openComposition(beforeHtml);
    const serverScript = session
      .serialize()
      .match(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/i)?.[1];
    expect(serverScript).toBeTruthy();
    const op: ShadowKeyframeOp = {
      kind: "add",
      animationId: ANIM_ID,
      percentage: 25,
      properties: { x: 50 },
    };
    await runShadowGsapKeyframeFidelity(beforeHtml, op, serverScript);
    const props = lastShadow();
    expect(props?.op).toBe("gsap_keyframe");
    expect(props?.dispatched).toBe(true);
    expect(props?.mismatchCount).toBe(1);
  });

  it("emits dispatched:true mismatchCount:0 when SDK and server agree", async () => {
    const beforeHtml = gsapHtml(KF_SCRIPT);
    // Build the server's resulting script by applying the same op via the SDK.
    const serverSession = await openComposition(beforeHtml);
    serverSession.batch(() =>
      serverSession.dispatch({
        type: "addGsapKeyframe",
        animationId: ANIM_ID,
        position: 25,
        value: { x: 50 },
      }),
    );
    const serverScript = serverSession
      .serialize()
      .match(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/i)?.[1];
    const op: ShadowKeyframeOp = {
      kind: "add",
      animationId: ANIM_ID,
      percentage: 25,
      properties: { x: 50 },
    };
    await runShadowGsapKeyframeFidelity(beforeHtml, op, serverScript);
    const props = lastShadow();
    expect(props?.op).toBe("gsap_keyframe");
    expect(props?.dispatched).toBe(true);
    expect(props?.mismatchCount).toBe(0);
  });
});

describe("runShadowGsapKeyframeFidelity (remove)", () => {
  it("no-ops with reason when remove percentage is ambiguous", async () => {
    const beforeHtml = gsapHtml(DUP_SCRIPT_BODY);
    const op: ShadowKeyframeOp = { kind: "remove", animationId: ANIM_ID, percentage: 50 };
    await runShadowGsapKeyframeFidelity(beforeHtml, op, "non-empty-server-script gsap");
    const props = lastShadow();
    expect(props?.op).toBe("gsap_keyframe");
    expect(props?.dispatched).toBe(false);
    expect(props?.reason).toBe("ambiguous");
  });

  it("dispatches a resolved remove and diffs", async () => {
    const beforeHtml = gsapHtml(KF_SCRIPT);
    const serverSession = await openComposition(beforeHtml);
    serverSession.batch(() =>
      serverSession.dispatch({
        type: "removeGsapKeyframe",
        animationId: ANIM_ID,
        keyframeIndex: 1,
      }),
    );
    const serverScript = serverSession
      .serialize()
      .match(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/i)?.[1];
    const op: ShadowKeyframeOp = { kind: "remove", animationId: ANIM_ID, percentage: 50 };
    await runShadowGsapKeyframeFidelity(beforeHtml, op, serverScript);
    const props = lastShadow();
    expect(props?.op).toBe("gsap_keyframe");
    expect(props?.dispatched).toBe(true);
    expect(props?.mismatchCount).toBe(0);
  });
});

describe("runShadowGsapKeyframeFidelity (guards)", () => {
  it("skips when there is no server script", async () => {
    const op: ShadowKeyframeOp = {
      kind: "add",
      animationId: ANIM_ID,
      percentage: 25,
      properties: { x: 50 },
    };
    await runShadowGsapKeyframeFidelity(gsapHtml(KF_SCRIPT), op, null);
    expect(lastShadow()).toBeUndefined();
  });
});

describe("runShadowDispatch unmapped-type guard", () => {
  const ELEMENT_HTML = /* html */ `<!DOCTYPE html><html><body>
    <div data-hf-id="hf-box" style="color: red;">Hi</div>
  </body></html>`;

  it("emits unmapped_type when a PatchOperation type isn't mapped", async () => {
    const session = await openComposition(ELEMENT_HTML);
    // PatchOperation.type is a closed union today; cast to exercise the defensive
    // guard for a future unmapped type.
    const ops = [{ type: "future-op", property: "x", value: "1" } as unknown as PatchOperation];
    runShadowDispatch(session, { hfId: "hf-box" } as never, ops);
    const props = lastShadow();
    expect(props?.op).toBe("property");
    expect(props?.dispatched).toBe(false);
    expect(props?.reason).toBe("unmapped_type");
    expect(props?.type).toBe("future-op");
  });

  it("dispatches normally for known PatchOperation types", async () => {
    const session = await openComposition(ELEMENT_HTML);
    const ops: PatchOperation[] = [{ type: "inline-style", property: "color", value: "#00f" }];
    runShadowDispatch(session, { hfId: "hf-box" } as never, ops);
    const props = lastShadow();
    expect(props?.dispatched).toBe(true);
    expect(props?.reason).toBeUndefined();
  });
});
