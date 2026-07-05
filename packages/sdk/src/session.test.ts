/**
 * Session-level behavior: history coalescing invariants and T3 override replay.
 */

import { describe, it, expect } from "vitest";
import { openComposition } from "./session.js";
import type { DraftProps, ElementAtPointResult, PreviewAdapter } from "./adapters/types.js";

const BASE_HTML = `
<div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px" data-duration="5">
  <h1 data-hf-id="hf-title" data-start="0" data-end="3" style="color: #fff; font-size: 64px">Hello World</h1>
  <p data-hf-id="hf-sub" style="opacity: 0.5">subtitle</p>
  <img data-hf-id="hf-logo" src="/logo.png" alt="Logo" />
</div>
`.trim();

class TestPreviewAdapter implements PreviewAdapter {
  private selectionHandlers: Array<(ids: string[]) => void> = [];

  // fallow-ignore-next-line code-duplication
  elementAtPoint(_x: number, _y: number, _opts?: { atTime?: number }): ElementAtPointResult | null {
    return null;
  }

  applyDraft(_id: string, _props: DraftProps): void {
    // Test adapter tracks selection only.
  }

  commitPreview(): void {
    // Test adapter tracks selection only.
  }

  cancelPreview(): void {
    // Test adapter tracks selection only.
  }

  select(ids: string[], _opts?: { additive?: boolean }): void {
    this.emitSelection(ids);
  }

  on(_event: "selection", handler: (ids: string[]) => void): () => void {
    this.selectionHandlers.push(handler);
    return () => {
      this.selectionHandlers = this.selectionHandlers.filter((h) => h !== handler);
    };
  }

  emitSelection(ids: readonly string[]): void {
    const snapshot = [...ids];
    for (const handler of this.selectionHandlers) {
      handler([...snapshot]);
    }
  }

  listenerCount(): number {
    return this.selectionHandlers.length;
  }
}

// ─── Preview selection bridge ────────────────────────────────────────────────

describe("preview selection bridge", () => {
  it("mirrors preview selection into session state and notifies subscribers", async () => {
    const preview = new TestPreviewAdapter();
    const comp = await openComposition(BASE_HTML, { preview });
    const events: string[][] = [];

    comp.on("selectionchange", (ids) => events.push([...ids]));
    preview.select(["hf-title"]);

    expect(comp.getSelection()).toEqual(["hf-title"]);
    expect(comp.selection().ids).toEqual(["hf-title"]);
    expect(events).toEqual([["hf-title"]]);
  });

  it("selection proxy applies edits to ids selected by the preview", async () => {
    const preview = new TestPreviewAdapter();
    const comp = await openComposition(BASE_HTML, { preview });

    preview.select(["hf-title", "hf-sub"]);
    comp.selection().setStyle({ color: "#123456" });

    expect(comp.getElement("hf-title")?.inlineStyles["color"]).toBe("#123456");
    expect(comp.getElement("hf-sub")?.inlineStyles["color"]).toBe("#123456");
  });

  it("dispose unsubscribes from preview selection events", async () => {
    const preview = new TestPreviewAdapter();
    const comp = await openComposition(BASE_HTML, { preview });

    expect(preview.listenerCount()).toBe(1);
    comp.dispose();
    expect(preview.listenerCount()).toBe(0);

    preview.select(["hf-title"]);
    expect(comp.getSelection()).toEqual([]);
  });
});

// ─── History coalescing ───────────────────────────────────────────────────────

describe("history coalescing", () => {
  it("rapid edits to the SAME property coalesce into one undo entry", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setStyle("hf-title", { color: "#111" });
    comp.setStyle("hf-title", { color: "#222" });
    comp.setStyle("hf-title", { color: "#333" });

    comp.undo();
    const el = comp.getElement("hf-title");
    expect(el?.inlineStyles["color"]).toBe("#fff"); // back to original in ONE step
  });

  it("rapid edits to DIFFERENT elements do NOT coalesce — undo reverts only the last edit", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setStyle("hf-title", { color: "#111" });
    comp.setStyle("hf-sub", { opacity: "1" });

    comp.undo();
    expect(comp.getElement("hf-sub")?.inlineStyles["opacity"]).toBe("0.5"); // last edit reverted
    expect(comp.getElement("hf-title")?.inlineStyles["color"]).toBe("#111"); // first edit intact

    comp.undo();
    expect(comp.getElement("hf-title")?.inlineStyles["color"]).toBe("#fff");
  });

  it("rapid edits to different properties of the same element do not coalesce", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setStyle("hf-title", { color: "#111" });
    comp.setStyle("hf-title", { fontSize: "96px" });

    comp.undo();
    expect(comp.getElement("hf-title")?.inlineStyles["fontSize"]).toBe("64px");
    expect(comp.getElement("hf-title")?.inlineStyles["color"]).toBe("#111");
  });
});

// ─── T3 override replay ───────────────────────────────────────────────────────

describe("override-set replay on open", () => {
  it("applies style, text, and attribute overrides to the base document", async () => {
    const comp = await openComposition(BASE_HTML, {
      overrides: {
        "hf-title.style.color": "#e63946",
        "hf-title.text": "Edited headline",
        "hf-logo.attr.src": "/new-logo.png",
      },
    });

    const title = comp.getElement("hf-title");
    expect(title?.inlineStyles["color"]).toBe("#e63946");
    expect(title?.text).toBe("Edited headline");
    expect(comp.getElement("hf-logo")?.attributes["src"]).toBe("/new-logo.png");

    const html = comp.serialize();
    expect(html).toContain("Edited headline");
    expect(html).toContain("/new-logo.png");
    expect(html).toContain("#e63946");
  });

  it("applies timing overrides (computed absolute end)", async () => {
    const comp = await openComposition(BASE_HTML, {
      overrides: { "hf-title.timing.end": 4.5 },
    });
    expect(comp.serialize()).toContain('data-end="4.5"');
  });

  it("removes elements marked with the null removal marker", async () => {
    const comp = await openComposition(BASE_HTML, {
      overrides: { "hf-sub": null },
    });
    expect(comp.getElement("hf-sub")).toBeNull();
    expect(comp.serialize()).not.toContain("subtitle");
  });

  it("treats property-level null as a deletion marker — removes the property from the base", async () => {
    // Null in the override-set is emitted only from patchRemove (explicit deletion).
    // On replay against a base that has the property set, it must be removed.
    const comp = await openComposition(BASE_HTML, {
      overrides: { "hf-title.style.color": null },
    });
    expect(comp.getElement("hf-title")?.inlineStyles["color"]).toBeUndefined();
  });

  it("null removal override on non-existent property is a safe no-op", async () => {
    // backgroundColor doesn't exist on hf-title in the base; removing it must not throw.
    const comp = await openComposition(BASE_HTML, {
      overrides: { "hf-title.style.backgroundColor": null },
    });
    expect(comp.getElement("hf-title")).not.toBeNull();
    expect(comp.getElement("hf-title")?.inlineStyles["backgroundColor"]).toBeUndefined();
  });

  it("getOverrides returns the set the session was opened with", async () => {
    const overrides = { "hf-title.style.color": "#e63946" };
    const comp = await openComposition(BASE_HTML, { overrides });
    expect(comp.getOverrides()).toEqual(overrides);
  });
});

// ─── batch() transactional rollback ───────────────────────────────────────────

describe("batch rollback on throw", () => {
  it("reverts DOM mutations and override-set when the callback throws", async () => {
    const comp = await openComposition(BASE_HTML);
    const htmlBefore = comp.serialize();

    expect(() =>
      comp.batch(() => {
        comp.setStyle("hf-title", { color: "#e63946" });
        comp.setText("hf-sub", "changed");
        throw new Error("user cancelled");
      }),
    ).toThrowError("user cancelled");

    expect(comp.getElement("hf-title")?.inlineStyles["color"]).toBe("#fff");
    expect(comp.getElement("hf-sub")?.text).toBe("subtitle");
    expect(comp.serialize()).toBe(htmlBefore);
    expect(comp.getOverrides()).toEqual({});
  });

  it("a throwing batch leaves no history entry — undo is a no-op", async () => {
    const comp = await openComposition(BASE_HTML);
    try {
      comp.batch(() => {
        comp.setStyle("hf-title", { color: "#e63946" });
        throw new Error("boom");
      });
    } catch {
      // expected
    }
    comp.undo();
    expect(comp.getElement("hf-title")?.inlineStyles["color"]).toBe("#fff");
  });
});

// ─── canUndo / canRedo ────────────────────────────────────────────────────────

describe("canUndo / canRedo", () => {
  it("returns false before any mutation", async () => {
    const comp = await openComposition(BASE_HTML);
    expect(comp.canUndo()).toBe(false);
    expect(comp.canRedo()).toBe(false);
  });

  it("canUndo true after a mutation, false after undoing back to start", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setStyle("hf-title", { color: "#ff0000" });
    expect(comp.canUndo()).toBe(true);
    expect(comp.canRedo()).toBe(false);

    comp.undo();
    expect(comp.canUndo()).toBe(false);
    expect(comp.canRedo()).toBe(true);
  });

  it("canRedo cleared after a new mutation", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setStyle("hf-title", { color: "#ff0000" });
    comp.undo();
    expect(comp.canRedo()).toBe(true);

    comp.setStyle("hf-title", { color: "#00ff00" });
    expect(comp.canRedo()).toBe(false);
  });

  it("returns false in embedded (T3) mode — no history", async () => {
    const comp = await openComposition(BASE_HTML, { overrides: {} });
    comp.setStyle("hf-title", { color: "#ff0000" });
    expect(comp.canUndo()).toBe(false);
    expect(comp.canRedo()).toBe(false);
  });
});

// ─── override-set orphan cleanup ──────────────────────────────────────────────

describe("override-set orphan cleanup on removeElement", () => {
  it("purges property keys for removed element from the override-set", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setStyle("hf-title", { color: "#ff0000", fontSize: "96px" });
    expect(Object.keys(comp.getOverrides())).toContain("hf-title.style.color");

    comp.removeElement("hf-title");
    const overrides = comp.getOverrides();
    // removal marker present
    expect(overrides["hf-title"]).toBeNull();
    // orphan property keys gone
    expect(Object.keys(overrides)).not.toContain("hf-title.style.color");
    expect(Object.keys(overrides)).not.toContain("hf-title.style.fontSize");
  });

  it("property keys for other elements are unaffected", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setStyle("hf-title", { color: "#ff0000" });
    comp.setStyle("hf-sub", { opacity: "1" });
    comp.removeElement("hf-title");
    const overrides = comp.getOverrides();
    expect(overrides["hf-sub.style.opacity"]).toBe("1");
  });
});

describe("single-dispatch undo reverses the inverse patch list", () => {
  // A single dispatch that emits order-dependent inverse patches (here a nested
  // parent+child removeElement) must undo in reverse application order. Without
  // the reverse, undo replays 'add child' before 'add parent' → the child has no
  // parent to attach to and is dropped.
  it("removeElement([child, parent]) undo restores both, child included", async () => {
    const NESTED = `<div data-hf-id="hf-root" data-hf-root data-duration="5">
  <div data-hf-id="hf-parent"><span data-hf-id="hf-child">x</span></div>
</div>`;
    const comp = await openComposition(NESTED);
    comp.dispatch({ type: "removeElement", target: ["hf-child", "hf-parent"] });
    expect(comp.getElement("hf-parent")).toBeNull();
    expect(comp.getElement("hf-child")).toBeNull();

    comp.undo();
    expect(comp.getElement("hf-parent")).not.toBeNull();
    expect(comp.getElement("hf-child")).not.toBeNull();
  });

  // Defense-in-depth: an aliased multi-target (the same element twice) makes the
  // 2nd id capture the value the 1st already wrote; undo must replay the inverse
  // in reverse to land on the ORIGINAL, not the intermediate.
  it("setStyle with a duplicate target undoes to the original, not the intermediate", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.dispatch({
      type: "setStyle",
      target: ["hf-title", "hf-title"],
      styles: { fontSize: "96px" },
    });
    expect(comp.getElement("hf-title")?.inlineStyles.fontSize).toBe("96px");
    comp.undo();
    expect(comp.getElement("hf-title")?.inlineStyles.fontSize).toBe("64px");
  });
});

// ─── setSelection / getSelection / selectionchange ───────────────────────────

describe("setSelection", () => {
  it("getSelection returns empty array before any setSelection call", async () => {
    const comp = await openComposition(BASE_HTML);
    expect(comp.getSelection()).toEqual([]);
  });

  it("setSelection updates getSelection", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setSelection(["hf-title"]);
    expect(comp.getSelection()).toEqual(["hf-title"]);
  });

  it("setSelection with multiple ids", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setSelection(["hf-title", "hf-sub"]);
    expect(comp.getSelection()).toEqual(["hf-title", "hf-sub"]);
  });

  it("setSelection([]) clears selection", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setSelection(["hf-title"]);
    comp.setSelection([]);
    expect(comp.getSelection()).toEqual([]);
  });

  it("setSelection fires selectionchange with new ids", async () => {
    const comp = await openComposition(BASE_HTML);
    const calls: string[][] = [];
    comp.on("selectionchange", (ids) => calls.push(ids));
    comp.setSelection(["hf-title"]);
    expect(calls).toEqual([["hf-title"]]);
  });

  it("setSelection fires selectionchange with empty array when clearing", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setSelection(["hf-title"]);
    const calls: string[][] = [];
    comp.on("selectionchange", (ids) => calls.push(ids));
    comp.setSelection([]);
    expect(calls).toEqual([[]]);
  });

  it("selectionchange listener receives a fresh copy each call", async () => {
    const comp = await openComposition(BASE_HTML);
    const snapshots: string[][] = [];
    comp.on("selectionchange", (ids) => snapshots.push(ids));
    comp.setSelection(["hf-title"]);
    comp.setSelection(["hf-sub"]);
    expect(snapshots[0]).toEqual(["hf-title"]);
    expect(snapshots[1]).toEqual(["hf-sub"]);
  });

  it("unsubscribed listener does not fire", async () => {
    const comp = await openComposition(BASE_HTML);
    const calls: string[][] = [];
    const off = comp.on("selectionchange", (ids) => calls.push(ids));
    off();
    comp.setSelection(["hf-title"]);
    expect(calls).toHaveLength(0);
  });

  it("selection() proxy operates on ids at call time", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setSelection(["hf-title"]);
    const proxy = comp.selection();
    expect(proxy.ids).toEqual(["hf-title"]);
  });

  it("setSelection does not affect undo stack", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setStyle("hf-title", { color: "#ff0000" });
    comp.setSelection(["hf-sub"]);
    expect(comp.canUndo()).toBe(true);
    comp.undo();
    // selection must not have been pushed to history
    expect(comp.canUndo()).toBe(false);
  });

  it("setSelection does not emit a patch event", async () => {
    const comp = await openComposition(BASE_HTML);
    const patches: unknown[] = [];
    comp.on("patch", (e) => patches.push(e));
    comp.setSelection(["hf-title"]);
    expect(patches).toHaveLength(0);
  });

  // fallow-ignore-next-line code-duplication
  it("setSelection with same ids does not fire selectionchange again", async () => {
    const comp = await openComposition(BASE_HTML);
    const calls: string[][] = [];
    comp.on("selectionchange", (ids) => calls.push(ids));
    comp.setSelection(["hf-title"]);
    comp.setSelection(["hf-title"]); // same ids — must be a no-op
    expect(calls).toHaveLength(1);
  });

  it("setSelection with same ids in different order fires selectionchange", async () => {
    const comp = await openComposition(BASE_HTML);
    const calls: string[][] = [];
    comp.on("selectionchange", (ids) => calls.push(ids));
    comp.setSelection(["hf-title", "hf-sub"]);
    comp.setSelection(["hf-sub", "hf-title"]); // order differs — must fire
    expect(calls).toHaveLength(2);
  });

  it("setSelection de-duplicates repeated ids", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setSelection(["hf-title", "hf-title", "hf-sub", "hf-title"]);
    expect(comp.getSelection()).toEqual(["hf-title", "hf-sub"]);
  });

  it("setSelection with duplicates matching stored selection does not fire selectionchange", async () => {
    const comp = await openComposition(BASE_HTML);
    const calls: string[][] = [];
    comp.on("selectionchange", (ids) => calls.push(ids));
    comp.setSelection(["hf-title"]);
    comp.setSelection(["hf-title", "hf-title"]); // de-duped = ["hf-title"] — no change
    expect(calls).toHaveLength(1);
  });
});

describe("animationIds population", () => {
  const GSAP_HTML = `
<div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px">
  <div data-hf-id="hf-box" style="opacity: 0">box</div>
  <div data-hf-id="hf-plain">plain</div>
  <script>var tl = gsap.timeline({ paused: true });
tl.to("[data-hf-id=\\"hf-box\\"]", { opacity: 1, duration: 0.5 }, 0.2);
window.__timelines["t"] = tl;</script>
</div>`.trim();

  it("attaches the parser's stable tween id to the targeted element", async () => {
    const comp = await openComposition(GSAP_HTML);
    const box = comp.getElement("hf-box");
    expect(box?.animationIds.length).toBe(1);
    // Stable id-space shared with studio-api / GSAP ops: targetSelector-method-position.
    expect(box?.animationIds[0]).toContain("hf-box");
    expect(box?.animationIds[0]).toContain("-to-");
  });

  it("leaves untargeted elements with an empty animationIds", async () => {
    const comp = await openComposition(GSAP_HTML);
    expect(comp.getElement("hf-plain")?.animationIds).toEqual([]);
  });

  it("the populated id is dispatchable as a removeGsapTween target", async () => {
    const comp = await openComposition(GSAP_HTML);
    const id = comp.getElement("hf-box")?.animationIds[0];
    expect(id).toBeDefined();
    if (id) expect(comp.can({ type: "removeGsapTween", animationId: id }).ok).toBe(true);
  });

  it("attaches multiple distinct tween ids when one element has several tweens", async () => {
    const html = `
<div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px">
  <div data-hf-id="hf-box" style="opacity: 0">box</div>
  <script>var tl = gsap.timeline({ paused: true });
tl.to("[data-hf-id=\\"hf-box\\"]", { opacity: 1, duration: 0.5 }, 0);
tl.from("[data-hf-id=\\"hf-box\\"]", { x: -100, duration: 0.5 }, 1);
window.__timelines["t"] = tl;</script>
</div>`.trim();
    const ids = (await openComposition(html)).getElement("hf-box")?.animationIds ?? [];
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(2); // distinct
  });

  it("fans a shared-selector tween out to every matched element", async () => {
    const html = `
<div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px">
  <div data-hf-id="hf-a" class="fade">a</div>
  <div data-hf-id="hf-b" class="fade">b</div>
  <script>var tl = gsap.timeline({ paused: true });
tl.to(".fade", { opacity: 1, duration: 0.5 }, 0);
window.__timelines["t"] = tl;</script>
</div>`.trim();
    const comp = await openComposition(html);
    const a = comp.getElement("hf-a")?.animationIds ?? [];
    const b = comp.getElement("hf-b")?.animationIds ?? [];
    expect(a.length).toBe(1);
    expect(b).toEqual(a); // same tween id on both matched elements
  });
});

describe("getAllAnimationIds", () => {
  it("includes a tween id even when its selector matches no live DOM element", async () => {
    const html = /* html */ `<!DOCTYPE html>
<html><body>
  <div data-hf-id="hf-box" style="color: red">Hello</div>
  <script>var tl = gsap.timeline({ paused: true }); tl.to("#does-not-exist", { x: 100, duration: 1 }, 3);</script>
</body></html>`;
    const comp = await openComposition(html);
    const flatIds = comp.getAllAnimationIds();
    expect(flatIds.size).toBeGreaterThan(0);
    const [unmatchedId] = [...flatIds];
    // Confirms the bug this fixes: no element's animationIds contains this id,
    // because "#does-not-exist" never CSS-matches anything in the document.
    expect(comp.getElements().some((el) => el.animationIds.includes(unmatchedId ?? ""))).toBe(
      false,
    );
  });

  it("returns an empty set when the composition has no GSAP script", async () => {
    const html = /* html */ `<!DOCTYPE html>
<html><body><div data-hf-id="hf-box">Hello</div></body></html>`;
    const comp = await openComposition(html);
    expect(comp.getAllAnimationIds().size).toBe(0);
  });

  it("still includes ids for tweens that DO match a live DOM element", async () => {
    const html = /* html */ `<!DOCTYPE html>
<html><body>
  <div data-hf-id="hf-box" style="color: red">Hello</div>
  <script>var tl = gsap.timeline({ paused: true }); tl.to("[data-hf-id=\\"hf-box\\"]", { x: 100, duration: 1 }, 0);</script>
</body></html>`;
    const comp = await openComposition(html);
    const realId = comp.getElements().flatMap((e) => [...e.animationIds])[0] ?? "";
    expect(realId).not.toBe("");
    expect(comp.getAllAnimationIds().has(realId)).toBe(true);
  });
});
