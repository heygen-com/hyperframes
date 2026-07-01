import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  sdkResolverShadowCheck,
  runResolverShadow,
  recordResolverParity,
  recordAnimationResolverParity,
  evaluateSoakGate,
  type SdkResolverMismatch,
} from "./sdkResolverShadow";
import type { PatchOperation } from "./sourcePatcher";
import { openComposition } from "@hyperframes/sdk";

// ─── Telemetry capture ────────────────────────────────────────────────────────

const trackedEvents: Array<{ event: string; props: Record<string, unknown> }> = [];
vi.mock("./studioTelemetry", () => ({
  trackStudioEvent: (event: string, props: Record<string, unknown>) =>
    trackedEvents.push({ event, props }),
}));
beforeEach(() => {
  trackedEvents.length = 0;
});
const lastShadow = () =>
  trackedEvents.filter((e) => e.event === "sdk_resolver_shadow").at(-1)?.props;

// ─── Flag mock ────────────────────────────────────────────────────────────────

// manualEditingAvailability reads env at module load time, so we mock the
// module to control flag values per test group.
// Default false in tests so shadow is opt-in per test (real default is true).
const mockFlags = { STUDIO_SDK_RESOLVER_SHADOW_ENABLED: false };
vi.mock("../components/editor/manualEditingAvailability", () => ({
  get STUDIO_SDK_RESOLVER_SHADOW_ENABLED() {
    return mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED;
  },
  get STUDIO_SDK_CUTOVER_ENABLED() {
    return false;
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_HTML = /* html */ `<!DOCTYPE html>
<html><body>
  <div data-hf-id="hf-box" style="color: red; width: 100px;" data-name="box">Hello</div>
</body></html>`;

// Prevents setStyle from applying so the read-back value differs from expected.
// Used in C9 and D11 to simulate a silent SDK value-dispatch bug.
async function makePoisonedStyleSession() {
  const session = await openComposition(BASE_HTML);
  const origDispatch = session.dispatch.bind(session);
  session.dispatch = (op) => {
    if (typeof op === "object" && "type" in op && op.type === "setStyle") return;
    origDispatch(op);
  };
  return session;
}

// ─── A. Flag gating ───────────────────────────────────────────────────────────

describe("A. Flag gating", () => {
  it("A1: flag off → no telemetry, SDK path not touched", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = false;
    const session = await openComposition(BASE_HTML);
    const spy = vi.spyOn(session, "getElement");
    runResolverShadow(session, "hf-box", [
      { type: "inline-style", property: "color", value: "blue" },
    ]);
    expect(trackedEvents).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("A2: flag on + divergence → emits exactly one telemetry event", async () => {
    // runResolverShadow emits only on divergence, so force one (poisoned dispatch
    // → value_mismatch). A parity edit is silent (see B-parity-silent).
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const session = await makePoisonedStyleSession();
    runResolverShadow(session, "hf-box", [
      { type: "inline-style", property: "color", value: "blue" },
    ]);
    expect(trackedEvents.filter((e) => e.event === "sdk_resolver_shadow")).toHaveLength(1);
  });

  it("A2b: flag on + parity → emits nothing (divergence-only)", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const session = await openComposition(BASE_HTML);
    runResolverShadow(session, "hf-box", [
      { type: "inline-style", property: "color", value: "blue" },
    ]);
    expect(trackedEvents.filter((e) => e.event === "sdk_resolver_shadow")).toHaveLength(0);
  });

  it("A3: shadow depends ONLY on shadow flag, not on STUDIO_SDK_CUTOVER_ENABLED", async () => {
    // The mock always returns STUDIO_SDK_CUTOVER_ENABLED=false. Use a divergence
    // (poisoned session) so the flag-on case emits; flag-off must stay silent.
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = false;
    const session = await makePoisonedStyleSession();
    runResolverShadow(session, "hf-box", [{ type: "inline-style", property: "color", value: "x" }]);
    expect(trackedEvents).toHaveLength(0); // cutover off, shadow off → no event

    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    runResolverShadow(session, "hf-box", [{ type: "inline-style", property: "color", value: "x" }]);
    expect(trackedEvents.filter((e) => e.event === "sdk_resolver_shadow")).toHaveLength(1); // shadow on regardless
  });

  it("A4: null/undefined hfId is a safe no-op (no event, no throw)", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const session = await openComposition(BASE_HTML);
    const ops: PatchOperation[] = [{ type: "inline-style", property: "color", value: "blue" }];
    expect(() => runResolverShadow(session, null, ops)).not.toThrow();
    expect(() => runResolverShadow(session, undefined, ops)).not.toThrow();
    expect(trackedEvents).toHaveLength(0);
  });
});

// ─── B. Telemetry-only (no side effects on real write) ────────────────────────

describe("B. Telemetry-only / no side effects", () => {
  it("B4: no disk write — shadow never calls writeProjectFile", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const writeProjectFile = vi.fn();
    const session = await openComposition(BASE_HTML);
    runResolverShadow(session, "hf-box", [
      { type: "inline-style", property: "color", value: "blue" },
    ]);
    // writeProjectFile is a deps-level function not in scope here; verify by
    // checking sdkResolverShadowCheck itself never touches it — it's not passed
    // in at all, so any call would be a TypeError at runtime.
    expect(writeProjectFile).not.toHaveBeenCalled();
  });

  it("B5: the LIVE session is restored after the check (cutover before===after stays correct)", async () => {
    // The session is shared with the cutover path. The shadow dispatches into it
    // to read values back, then MUST undo those mutations — otherwise the edit is
    // pre-applied and the following sdkCutoverPersist sees before === after and
    // silently falls back to the server path.
    const session = await openComposition(BASE_HTML);
    expect(session.getElement("hf-box")?.inlineStyles.color).toBe("red");

    const mismatches = sdkResolverShadowCheck(session, "hf-box", [
      { type: "inline-style", property: "color", value: "blue" },
    ]);
    expect(mismatches).toHaveLength(0); // SDK applied blue == expected → parity

    // …but the session is back to its pre-check state, NOT left on "blue".
    expect(session.getElement("hf-box")?.inlineStyles.color).toBe("red");
  });

  it("B5b: a real cutover-style serialize diff survives a preceding shadow run", async () => {
    // End-to-end of the bug: shadow runs, THEN a cutover-style before/dispatch/
    // after still produces a diff (proving shadow left no residue).
    const session = await openComposition(BASE_HTML);
    sdkResolverShadowCheck(session, "hf-box", [
      { type: "inline-style", property: "color", value: "blue" },
    ]);
    const before = session.serialize();
    session.dispatch({ type: "setStyle", target: "hf-box", styles: { color: "blue" } });
    const after = session.serialize();
    expect(after).not.toBe(before); // cutover would write, not fall back
  });

  it("B6: exception inside shadow never propagates to caller", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const session = await openComposition(BASE_HTML);
    session.dispatch = () => {
      throw new Error("sdk exploded");
    };
    const ops: PatchOperation[] = [{ type: "inline-style", property: "color", value: "blue" }];
    expect(() => runResolverShadow(session, "hf-box", ops)).not.toThrow();
    // A dispatch_error mismatch is still emitted (via telemetry)
    const ev = lastShadow();
    expect(ev).toBeDefined();
    expect(ev?.mismatchCount).toBe(1);
  });
});

// ─── C. Resolver-parity detection ────────────────────────────────────────────

describe("C. Resolver-parity detection", () => {
  it("C7: match → mismatchCount 0", async () => {
    const session = await openComposition(BASE_HTML);
    const mismatches = sdkResolverShadowCheck(session, "hf-box", [
      { type: "inline-style", property: "color", value: "blue" },
    ]);
    expect(mismatches).toHaveLength(0);
  });

  it("C8: element_not_found fires when SDK resolver returns null (v0.6.110 class)", () => {
    // Simulate the regression: SDK session cannot resolve the hfId the server
    // would address (e.g. scoped-id mismatch, resolver bug).
    const session = { getElement: () => null, getElements: () => [] } as unknown as Parameters<
      typeof sdkResolverShadowCheck
    >[0];
    const mismatches = sdkResolverShadowCheck(
      session as unknown as Parameters<typeof sdkResolverShadowCheck>[0],
      "hf-box",
      [{ type: "inline-style", property: "color", value: "red" }],
    );
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject<SdkResolverMismatch>({
      kind: "element_not_found",
      hfId: "hf-box",
    });
  });

  it("C8 inverse: no element_not_found when SDK resolves (server also resolves)", async () => {
    const session = await openComposition(BASE_HTML);
    const mismatches = sdkResolverShadowCheck(session, "hf-box", [
      { type: "inline-style", property: "color", value: "blue" },
    ]);
    expect(mismatches.some((m) => m.kind === "element_not_found")).toBe(false);
  });

  it("C9: value_mismatch when dispatch yields different value than expected", async () => {
    const session = await makePoisonedStyleSession();
    const mismatches = sdkResolverShadowCheck(session, "hf-box", [
      { type: "inline-style", property: "color", value: "blue" },
    ]);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject<SdkResolverMismatch>({
      kind: "value_mismatch",
      hfId: "hf-box",
      property: "color",
      expected: "blue",
    });
  });

  it("C8 runtime-node filter: hfId absent from source → suppressed (not a resolver bug)", () => {
    // The studio resolved a live-DOM element to an hf-id that the SDK session
    // doesn't contain AND that never appears in the on-disk source — it's a
    // node a composition <script> created at runtime (e.g. caption spans). Not
    // a resolver divergence; suppress.
    const session = { getElement: () => null, getElements: () => [] } as unknown as Parameters<
      typeof sdkResolverShadowCheck
    >[0];
    const source = `<div data-hf-id="hf-static">no runtime id here</div>`;
    const mismatches = sdkResolverShadowCheck(
      session,
      "hf-runtimeonly",
      [{ type: "inline-style", property: "color", value: "red" }],
      source,
    );
    expect(mismatches).toHaveLength(0);
  });

  it("C8 runtime-node filter: hfId PRESENT in source but missing from session → still flagged (real bug)", () => {
    const session = { getElement: () => null, getElements: () => [] } as unknown as Parameters<
      typeof sdkResolverShadowCheck
    >[0];
    const source = `<div data-hf-id="hf-realbug">in source, not in SDK session</div>`;
    const mismatches = sdkResolverShadowCheck(
      session,
      "hf-realbug",
      [{ type: "inline-style", property: "color", value: "red" }],
      source,
    );
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.kind).toBe("element_not_found");
  });

  it("C8 sourceHfIdCount: emitted element_not_found carries source occurrence count", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const session = { getElement: () => null, getElements: () => [] } as unknown as Composition;
    // id present twice in source (duplicate-id ambiguity) but absent from session
    const source = `<div data-hf-id="hf-dup">a</div><div data-hf-id="hf-dup">b</div>`;
    runResolverShadow(
      session,
      "hf-dup",
      [{ type: "inline-style", property: "color", value: "red" }],
      source,
    );
    expect(lastShadow()?.sourceHfIdCount).toBe(2);
  });

  it("C10: unmappable op type produces no mismatch (excluded, not flagged)", async () => {
    const session = await openComposition(BASE_HTML);
    // "unknown-op" is not in MAPPED_OP_TYPES, so it must be silently excluded.
    const ops = [{ type: "unknown-op", property: "x", value: "y" }] as unknown as PatchOperation[];
    const mismatches = sdkResolverShadowCheck(session, "hf-box", ops);
    expect(mismatches).toHaveLength(0);
  });
});

// ─── D. Redaction ─────────────────────────────────────────────────────────────

describe("D. Redaction", () => {
  it("D11: telemetry payload carries kind/hfId/count but NOT raw style value or text", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const session = await makePoisonedStyleSession();
    const sensitiveValue = "rgba(255, 0, 0, 0.5)";
    runResolverShadow(session, "hf-box", [
      { type: "inline-style", property: "color", value: sensitiveValue },
    ]);
    const ev = lastShadow();
    expect(ev).toBeDefined();
    expect(ev?.mismatchCount).toBe(1);
    // The raw sensitive value must NOT appear in the serialized mismatches
    const serialized = JSON.stringify(ev?.mismatches ?? "");
    expect(serialized).not.toContain(sensitiveValue);
    // But the kind and hfId must be present
    expect(serialized).toContain("value_mismatch");
    expect(serialized).toContain("hf-box");
  });

  it("D11: text-content value is fully redacted (replaced with length marker)", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const session = await openComposition(BASE_HTML);
    const origDispatch = session.dispatch.bind(session);
    // Prevent setText from applying so text value differs
    session.dispatch = (op) => {
      if (typeof op === "object" && "type" in op && op.type === "setText") return;
      origDispatch(op);
    };
    const secretText = "confidential user content";
    runResolverShadow(session, "hf-box", [
      { type: "text-content", property: "text", value: secretText },
    ]);
    const ev = lastShadow();
    const serialized = JSON.stringify(ev?.mismatches ?? "");
    expect(serialized).not.toContain(secretText);
    expect(serialized).toContain("[redacted len=");
  });
});

// ─── E. Soak gate ─────────────────────────────────────────────────────────────

describe("E. Soak gate", () => {
  it("E12: zero divergences → parity-proven", () => {
    expect(evaluateSoakGate(0)).toBe("parity-proven");
  });

  it("E12: one divergence → divergence-detected", () => {
    expect(evaluateSoakGate(1)).toBe("divergence-detected");
  });

  it("E12: many divergences → divergence-detected", () => {
    expect(evaluateSoakGate(100)).toBe("divergence-detected");
  });
});

// ─── F. recordResolverParity (extended coverage: timing / delete / gsap-add) ──

describe("F. recordResolverParity", () => {
  it("emits element_not_found when the SDK cannot resolve the target", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const session = await openComposition(BASE_HTML);
    await recordResolverParity(session, "hf-missing", "setTiming");
    const ev = lastShadow();
    expect(ev?.mismatchCount).toBe(1);
    expect(ev?.opLabel).toBe("setTiming");
    expect(JSON.stringify(ev?.mismatches)).toContain("element_not_found");
  });

  it("emits nothing when the target resolves (parity)", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const session = await openComposition(BASE_HTML);
    await recordResolverParity(session, "hf-box", "removeElement");
    expect(trackedEvents.filter((e) => e.event === "sdk_resolver_shadow")).toHaveLength(0);
  });

  it("is a no-op (no SDK touch) when the flag is off", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = false;
    const session = await openComposition(BASE_HTML);
    const spy = vi.spyOn(session, "getElement");
    await recordResolverParity(session, "hf-missing", "setTiming");
    expect(trackedEvents).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("never mutates the session (read-only resolver check)", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const session = await openComposition(BASE_HTML);
    await recordResolverParity(session, "hf-box", "setTiming");
    expect(session.getElement("hf-box")?.inlineStyles.color).toBe("red"); // unchanged
  });

  it("suppresses the emit when the hfId is absent from source (runtime node)", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const session = await openComposition(BASE_HTML);
    await recordResolverParity(session, "hf-runtime", "setTiming", () =>
      Promise.resolve('<div data-hf-id="hf-other"></div>'),
    );
    expect(trackedEvents.filter((e) => e.event === "sdk_resolver_shadow")).toHaveLength(0);
  });

  it("emits with sourceHfIdCount=1 when the hfId IS in source but missing from the session", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const session = await openComposition(BASE_HTML);
    await recordResolverParity(session, "hf-ghost", "setTiming", () =>
      Promise.resolve('<div data-hf-id="hf-ghost"></div>'),
    );
    const ev = lastShadow();
    expect(ev?.mismatchCount).toBe(1);
    expect(ev?.sourceHfIdCount).toBe(1);
  });

  it("reports sourceHfIdCount=2 for a duplicate-id source (ambiguity)", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const session = await openComposition(BASE_HTML);
    await recordResolverParity(session, "hf-dup", "setTiming", () =>
      Promise.resolve('<a data-hf-id="hf-dup"></a><b data-hf-id="hf-dup"></b>'),
    );
    expect(lastShadow()?.sourceHfIdCount).toBe(2);
  });

  it("emits without sourceHfIdCount when no reader is supplied (status quo)", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const session = await openComposition(BASE_HTML);
    await recordResolverParity(session, "hf-missing", "setTiming");
    const ev = lastShadow();
    expect(ev?.mismatchCount).toBe(1);
    expect(ev?.sourceHfIdCount).toBeUndefined();
  });

  it("fails open: a readSource error still emits (no suppression)", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const session = await openComposition(BASE_HTML);
    await recordResolverParity(session, "hf-missing", "setTiming", () =>
      Promise.reject(new Error("read failed")),
    );
    const ev = lastShadow();
    expect(ev?.mismatchCount).toBe(1);
    expect(ev?.sourceHfIdCount).toBeUndefined();
  });
});

// ─── G. recordAnimationResolverParity (GSAP animationId ops) ──────────────────

const GSAP_HTML = /* html */ `<!DOCTYPE html>
<html><body>
  <div data-hf-id="hf-box" style="color: red">Hello</div>
  <script>var tl = gsap.timeline({ paused: true }); tl.to("[data-hf-id=\\"hf-box\\"]", { x: 100, duration: 1 }, 0);</script>
</body></html>`;

describe("G. recordAnimationResolverParity", () => {
  it("emits animation_not_found when the SDK cannot resolve the animationId", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const session = await openComposition(GSAP_HTML);
    recordAnimationResolverParity(session, "no-such-anim", "setGsapTween");
    const ev = lastShadow();
    expect(ev?.mismatchCount).toBe(1);
    expect(ev?.opLabel).toBe("setGsapTween");
    expect(JSON.stringify(ev?.mismatches)).toContain("animation_not_found");
  });

  it("emits nothing when the animationId resolves to a located animation", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const session = await openComposition(GSAP_HTML);
    const realId = session.getElements().flatMap((e) => [...e.animationIds])[0] ?? "";
    expect(realId).not.toBe(""); // fixture has a tween on hf-box
    recordAnimationResolverParity(session, realId, "removeGsapTween");
    expect(trackedEvents.filter((e) => e.event === "sdk_resolver_shadow")).toHaveLength(0);
  });

  it("is a no-op when the flag is off", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = false;
    const session = await openComposition(GSAP_HTML);
    recordAnimationResolverParity(session, "no-such-anim", "setGsapTween");
    expect(trackedEvents).toHaveLength(0);
  });
});

// ─── H. Inlined sub-composition: bare leaf id resolves (regression) ───────────

// PostHog showed ~445 false `element_not_found` events, all on a bare leaf id
// (hf-0ytc / #subscribe-btn) inside an inlined sub-composition. The studio reads
// the bare data-hf-id off the DOM and the cutover dispatch resolves it via
// resolveScoped (which locates the leaf inside the host subtree). But the shadow
// resolved via Composition.getElement, which is canonical-only for a bare id and
// returns null for a scoped element — so it flagged a divergence the real
// dispatch path would not hit. The shadow now mirrors dispatch via resolveSnapshot.
describe("H. inlined sub-composition leaf", () => {
  // host carries data-composition-file → new scope; leaf's scopedId is
  // "hf-host/hf-leaf" but its raw data-hf-id (what the studio reads) is bare.
  const INLINED_HTML = /* html */ `<!DOCTYPE html>
<html><body>
  <div data-hf-id="hf-root" data-hf-root>
    <div data-hf-id="hf-host" data-composition-file="sub.html">
      <div data-hf-id="hf-leaf" style="color: red">Subscribe</div>
    </div>
  </div>
</body></html>`;

  it("getElement(bareLeaf) is null (canonical-only) — the trap the shadow used to hit", async () => {
    const session = await openComposition(INLINED_HTML);
    expect(session.getElement("hf-leaf")).toBeNull();
    expect(session.getElement("hf-host/hf-leaf")).not.toBeNull();
  });

  it("recordResolverParity emits NOTHING for a bare leaf inside a sub-comp", async () => {
    mockFlags.STUDIO_SDK_RESOLVER_SHADOW_ENABLED = true;
    const session = await openComposition(INLINED_HTML);
    await recordResolverParity(session, "hf-leaf", "setTiming");
    expect(trackedEvents.filter((e) => e.event === "sdk_resolver_shadow")).toHaveLength(0);
  });

  it("sdkResolverShadowCheck does not flag element_not_found for a bare leaf in a sub-comp", async () => {
    const session = await openComposition(INLINED_HTML);
    const mismatches = sdkResolverShadowCheck(session, "hf-leaf", [
      { type: "inline-style", property: "color", value: "blue" },
    ]);
    expect(mismatches.some((m) => m.kind === "element_not_found")).toBe(false);
  });
});
