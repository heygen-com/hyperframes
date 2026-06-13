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
