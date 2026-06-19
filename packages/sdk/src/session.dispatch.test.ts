/**
 * T4 — dispatch-boundary tests.
 *
 * Tests the full pipeline: session.dispatch() → patch event → override-set.
 * Complements mutate.test.ts (which tests applyOp directly) by verifying
 * the session wiring layer.
 */

import { describe, it, expect } from "vitest";
import { openComposition } from "./session.js";
import type { Composition, PatchEvent } from "./types.js";

const BASE_HTML = `
<div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px; background: #000" data-duration="5">
  <h1 data-hf-id="hf-title" data-start="0" data-end="3" data-track-index="0"
      style="color: #fff; font-size: 64px">Hello World</h1>
  <p data-hf-id="hf-sub" style="opacity: 0.5">subtitle</p>
</div>
`.trim();

const GSAP_HTML = `
<div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px">
  <div data-hf-id="hf-box" style="opacity: 0"></div>
  <script>var tl = gsap.timeline({ paused: true });
tl.to("[data-hf-id=\\"hf-box\\"]", { opacity: 1, duration: 0.5 }, 0);
window.__timelines = { t: tl };</script>
</div>
`.trim();

async function withPatch(html: string): Promise<{ comp: Composition; events: PatchEvent[] }> {
  const comp = await openComposition(html);
  const events: PatchEvent[] = [];
  comp.on("patch", (e) => events.push(e));
  return { comp, events };
}

function expectGsapScriptPatch(id: string, events: PatchEvent[]): void {
  expect(typeof id).toBe("string");
  expect(id.length).toBeGreaterThan(0);
  expect(events).toHaveLength(1);
  expect(events[0]!.patches.find((p) => p.path.includes("/script/gsap"))).toBeDefined();
}

// ─── patch event emission ─────────────────────────────────────────────────────

describe("dispatch emits patch event", () => {
  it("setStyle emits forward replace + inverse replace", async () => {
    const { comp, events } = await withPatch(BASE_HTML);
    comp.setStyle("hf-title", { color: "#e63946" });

    expect(events).toHaveLength(1);
    expect(events[0]!.patches[0]).toMatchObject({
      op: "replace",
      path: "/elements/hf-title/inlineStyles/color",
      value: "#e63946",
    });
    expect(events[0]!.inversePatches[0]).toMatchObject({
      op: "replace",
      path: "/elements/hf-title/inlineStyles/color",
      value: "#fff",
    });
  });

  it("no-op dispatch (same value) fires change; patch may be empty", async () => {
    const comp = await openComposition(BASE_HTML);
    const changes: number[] = [];
    comp.on("change", () => changes.push(1));

    comp.setStyle("hf-title", { color: "#fff" }); // same value already set

    expect(changes).toHaveLength(1);
  });

  it("patch event opTypes reflects dispatched op type", async () => {
    const { comp, events } = await withPatch(BASE_HTML);
    comp.setText("hf-sub", "new text");
    expect(events[0]?.opTypes).toContain("setText");
  });
});

// ─── override-set accumulation ────────────────────────────────────────────────

describe("override-set accumulation", () => {
  it("setStyle dispatch adds key to override-set", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setStyle("hf-title", { color: "#e63946" });
    expect(comp.getOverrides()["hf-title.style.color"]).toBe("#e63946");
  });

  it("setText dispatch adds text key to override-set", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setText("hf-sub", "changed");
    expect(comp.getOverrides()["hf-sub.text"]).toBe("changed");
  });

  it("setAttribute dispatch adds attr key", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.dispatch({ type: "setAttribute", target: "hf-title", name: "data-name", value: "hero" });
    expect(comp.getOverrides()["hf-title.attr.data-name"]).toBe("hero");
  });

  it("removeElement dispatch sets null removal marker in override-set", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.removeElement("hf-sub");
    // element path key should map to null marker
    const overrides = comp.getOverrides();
    const removedKey = Object.keys(overrides).find((k) => k.startsWith("hf-sub"));
    expect(removedKey).toBeDefined();
  });
});

// ─── can() structured result ──────────────────────────────────────────────────

describe("can() CanResult", () => {
  it("ok:true for valid setStyle target", async () => {
    const comp = await openComposition(BASE_HTML);
    const r = comp.can({ type: "setStyle", target: "hf-title", styles: {} });
    expect(r.ok).toBe(true);
  });

  it("ok:false / E_TARGET_NOT_FOUND for unknown id", async () => {
    const comp = await openComposition(BASE_HTML);
    const r = comp.can({ type: "setStyle", target: "hf-missing", styles: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("E_TARGET_NOT_FOUND");
      expect(r.message).toContain("hf-missing");
      expect(r.hint).toBeDefined();
    }
  });

  it("ok:false / E_NO_GSAP_SCRIPT for GSAP op on non-GSAP composition", async () => {
    const comp = await openComposition(BASE_HTML);
    const r = comp.can({ type: "removeGsapTween", animationId: "tw-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_NO_GSAP_SCRIPT");
  });

  it("ok:true for addGsapTween on GSAP composition", async () => {
    const comp = await openComposition(GSAP_HTML);
    const r = comp.can({
      type: "addGsapTween",
      target: "hf-box",
      tween: { method: "to", properties: { x: 100 } },
    });
    expect(r.ok).toBe(true);
  });

  it("ok:false / E_NO_GSAP_TIMELINE when script has no timeline var (addLabel path)", async () => {
    const noTimelineHtml = `
<div data-hf-id="hf-stage" data-hf-root style="width:1280px;height:720px">
  <div data-hf-id="hf-box"></div>
  <script>gsap.defaults({ ease: "power1.out" });
window.__timelines = {};</script>
</div>`.trim();
    const comp = await openComposition(noTimelineHtml);
    const r = comp.can({ type: "addLabel", name: "intro", position: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_NO_GSAP_TIMELINE");
  });

  it("ok:true for setCompositionMetadata always", async () => {
    const comp = await openComposition(BASE_HTML);
    expect(comp.can({ type: "setCompositionMetadata", width: 1920 }).ok).toBe(true);
  });
});

// ─── batch() emits single patch event ────────────────────────────────────────

describe("batch() patch event", () => {
  it("collapses N dispatches into one patch event with all op types", async () => {
    const { comp, events } = await withPatch(BASE_HTML);
    comp.batch(() => {
      comp.setStyle("hf-title", { color: "#111" });
      comp.setText("hf-sub", "batched");
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.patches.length).toBeGreaterThanOrEqual(2);
    expect(events[0]!.opTypes).toContain("setStyle");
    expect(events[0]!.opTypes).toContain("setText");
  });
});

// ─── addGsapTween via session API ─────────────────────────────────────────────

describe("addGsapTween via session", () => {
  it("returns animationId and emits GSAP script patch", async () => {
    const { comp, events } = await withPatch(GSAP_HTML);
    const id = comp.addGsapTween("hf-box", { method: "to", duration: 0.3, properties: { x: 200 } });

    expectGsapScriptPatch(id, events);
  });

  it("undo removes the added tween", async () => {
    const comp = await openComposition(GSAP_HTML);
    const scriptBefore = comp.serialize();
    comp.addGsapTween("hf-box", { method: "to", duration: 0.3, properties: { x: 200 } });
    comp.undo();
    expect(comp.serialize()).toBe(scriptBefore);
  });
});

// ─── addWithKeyframes / replaceWithKeyframes via session API ──────────────────

describe("keyframe ops via session", () => {
  it("addWithKeyframes returns an animationId and emits a GSAP script patch", async () => {
    const { comp, events } = await withPatch(GSAP_HTML);
    const id = comp.addWithKeyframes('[data-hf-id="hf-box"]', 0, 0.5, [
      { percentage: 0, properties: { opacity: 0 } },
      { percentage: 100, properties: { opacity: 1 } },
    ]);

    expectGsapScriptPatch(id, events);
  });

  it("replaceWithKeyframes returns the replacement id; undo restores the prior script", async () => {
    const comp = await openComposition(GSAP_HTML);
    const before = comp.serialize();
    const addId = comp.addWithKeyframes('[data-hf-id="hf-box"]', 0, 0.5, [
      { percentage: 0, properties: { opacity: 0 } },
      { percentage: 100, properties: { opacity: 1 } },
    ]);
    const newId = comp.replaceWithKeyframes(addId, '[data-hf-id="hf-box"]', 0, 0.8, [
      { percentage: 0, properties: { x: 0 } },
      { percentage: 100, properties: { x: 100 } },
    ]);

    expect(typeof newId).toBe("string");
    expect(newId.length).toBeGreaterThan(0);

    comp.undo(); // undo replace
    comp.undo(); // undo add
    expect(comp.serialize()).toBe(before);
  });
});

// ─── dispatch with explicit origin ───────────────────────────────────────────

describe("dispatch origin", () => {
  it("custom origin is propagated to patch event", async () => {
    const comp = await openComposition(BASE_HTML);
    const events: PatchEvent[] = [];
    comp.on("patch", (e) => events.push(e));

    const MY_ORIGIN = Symbol("ai-agent");
    comp.dispatch({ type: "setText", target: "hf-title", value: "AI edit" }, { origin: MY_ORIGIN });

    expect(events[0]?.origin).toBe(MY_ORIGIN);
  });
});
