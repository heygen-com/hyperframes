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
  it.each([
    { key: "hf-title.timing.bogus", value: 2 },
    { key: "meta.fps", value: 30 },
    { key: "style.foo", value: "x" },
    { key: "future.element", value: { html: '<p data-hf-id="hf-extra">Extra</p>' } },
    { key: "future.element", value: { siblingIndex: 0 } },
  ])("ignores an unrecognized non-snapshot override: $key", async ({ key, value }) => {
    const base = await openComposition(BASE_HTML);
    const reopened = await openComposition(BASE_HTML, { overrides: { [key]: value } });

    expect(reopened.serialize()).toBe(base.serialize());
  });

  it.each([false, true])("replays edits with dotted IDs, scoped: %s", async (scoped) => {
    const title = '<h1 data-hf-id="hf-title.main" style="color:red" title="Original">Original</h1>';
    const html = `<div data-hf-id="hf-stage" data-hf-root>${
      scoped
        ? `<div data-hf-id="hf-host.one" data-composition-file="scene.html">${title}</div>`
        : title
    }</div>`;
    const id = scoped ? "hf-host.one/hf-title.main" : "hf-title.main";
    const comp = await openComposition(html, { overrides: {} });
    comp.setText(id, "Updated");
    comp.setStyle(id, { color: "blue" });
    comp.setAttribute(id, "title", null);
    comp.setAttribute(id, "data-app.attr.label", "Saved");
    comp.setTiming(id, { start: 1, duration: 2 });
    comp.setHold(id, { start: 0.5, end: 0.25, fill: "freeze" });

    const reopened = await openComposition(html, {
      overrides: JSON.parse(JSON.stringify(comp.getOverrides())),
    });

    expect(reopened.getElement(id)?.text).toBe("Updated");
    expect(reopened.getElement(id)?.inlineStyles["color"]).toBe("blue");
    expect(reopened.getElement(id)?.attributes["title"]).toBeUndefined();
    expect(reopened.getElement(id)?.attributes["data-app.attr.label"]).toBe("Saved");
    expect(reopened.getElement(id)?.attributes).toMatchObject({
      "data-hold-start": "0.5",
      "data-hold-end": "0.25",
      "data-hold-fill": "freeze",
    });
    expect(reopened.getElementTimings()[id]).toMatchObject({ enterAt: 1, exitAt: 3 });
    expect(reopened.serialize()).toBe(comp.serialize());
  });

  it("replays a removal marker for a dotted element ID", async () => {
    const html = '<div data-hf-root><p data-hf-id="hf-copy.main">Remove me</p></div>';
    const comp = await openComposition(html, { overrides: {} });
    comp.removeElement("hf-copy.main");

    const reopened = await openComposition(html, {
      overrides: JSON.parse(JSON.stringify(comp.getOverrides())),
    });

    expect(reopened.getElement("hf-copy.main")).toBeNull();
    expect(reopened.serialize()).toBe(comp.serialize());
  });

  it("keeps edit-family words inside an attribute name", async () => {
    const comp = await openComposition(BASE_HTML, { overrides: {} });
    comp.setAttribute("hf-title", "data-app.style.color", "Saved");
    comp.setAttribute("hf-title", "data-app.text", "Label");

    const reopened = await openComposition(BASE_HTML, { overrides: comp.getOverrides() });

    expect(reopened.getElement("hf-title")?.attributes["data-app.style.color"]).toBe("Saved");
    expect(reopened.getElement("hf-title")?.attributes["data-app.text"]).toBe("Label");
    expect(reopened.serialize()).toBe(comp.serialize());
  });

  it("keeps ordinary element edits ahead of the variable namespace", async () => {
    const html = '<div data-hf-root><p data-hf-id="var">Original</p></div>';
    const comp = await openComposition(html, { overrides: {} });
    comp.setText("var", "Updated");
    comp.setStyle("var", { color: "blue" });

    const reopened = await openComposition(html, { overrides: comp.getOverrides() });

    expect(reopened.getElement("var")?.text).toBe("Updated");
    expect(reopened.getElement("var")?.inlineStyles["color"]).toBe("blue");
  });

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

  it("restores added elements and their later edits from the stored override set", async () => {
    const comp = await openComposition(BASE_HTML, { overrides: {} });
    const id = comp.addElement("hf-stage", 1, "<p>Available today</p>");
    comp.setText(id, "Available worldwide");

    const reopened = await openComposition(BASE_HTML, { overrides: comp.getOverrides() });

    expect(reopened.getElement(id)?.text).toBe("Available worldwide");
    expect(reopened.getElement("hf-stage")?.children.map((child) => child.id)).toEqual([
      "hf-title",
      id,
      "hf-sub",
      "hf-logo",
    ]);
    expect(reopened.serialize()).toBe(comp.serialize());
  });

  it("replaces the base element once when reopening an undone removal", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.setText("hf-title", "Edited headline");
    comp.removeElement("hf-title");
    comp.undo();

    const reopened = await openComposition(BASE_HTML, { overrides: comp.getOverrides() });

    expect(reopened.getElement("hf-title")?.text).toBe("Edited headline");
    expect(reopened.getElements().filter((element) => element.id === "hf-title")).toHaveLength(1);
    expect(reopened.serialize()).toBe(comp.serialize());
  });

  it("keeps a restored base element after siblings removed before its latest snapshot", async () => {
    const comp = await openComposition(BASE_HTML);
    comp.removeElement("hf-logo");
    comp.undo();
    comp.removeElement("hf-title");
    comp.removeElement("hf-logo");
    comp.undo();

    const reopened = await openComposition(BASE_HTML, { overrides: comp.getOverrides() });

    expect(reopened.getElement("hf-stage")?.children.map((child) => child.id)).toEqual([
      "hf-sub",
      "hf-logo",
    ]);
    expect(reopened.serialize()).toBe(comp.serialize());
  });

  it("keeps an added element's position after removing a sibling and undoing its removal", async () => {
    const comp = await openComposition(BASE_HTML);
    const id = comp.addElement("hf-stage", 2, "<p>Available today</p>");
    comp.removeElement("hf-title");
    comp.removeElement(id);
    comp.undo();

    const reopened = await openComposition(BASE_HTML, { overrides: comp.getOverrides() });

    expect(reopened.getElement("hf-stage")?.children.map((child) => child.id)).toEqual([
      "hf-sub",
      id,
      "hf-logo",
    ]);
    expect(reopened.serialize()).toBe(comp.serialize());
  });

  it("keeps child edits made after restoring an added parent", async () => {
    const comp = await openComposition(BASE_HTML);
    const parent = comp.addElement("hf-stage", 1, "<section>Details</section>");
    const child = comp.addElement(parent, 0, "<p>Original</p>");
    comp.setText(child, "Before removal");
    comp.removeElement(parent);
    comp.undo();
    comp.setText(child, "After restore");

    const reopened = await openComposition(BASE_HTML, { overrides: comp.getOverrides() });

    expect(reopened.getElement(child)?.text).toBe("After restore");
    expect(reopened.getElements().filter((element) => element.id === child)).toHaveLength(1);
    expect(reopened.serialize()).toBe(comp.serialize());
  });

  it.each(["session", "host"] as const)(
    "keeps later %s edits to a child after restoring its base parent",
    async (origin) => {
      const html =
        '<div data-hf-id="hf-stage" data-hf-root><section data-hf-id="hf-box"><p data-hf-id="hf-in">In</p></section></div>';
      const comp = await openComposition(html, { coalesceMs: 0 });
      comp.setText("hf-in", "Before removal");
      comp.removeElement("hf-box");
      comp.undo();
      if (origin === "session") comp.setText("hf-in", "After restore");
      else
        comp.applyPatches([
          { op: "replace", path: "/elements/hf-in/text", value: "After restore" },
        ]);

      const reopened = await openComposition(html, {
        overrides: JSON.parse(JSON.stringify(comp.getOverrides())),
      });

      expect(reopened.getElement("hf-in")?.text).toBe("After restore");
      expect(reopened.serialize()).toBe(comp.serialize());
    },
  );

  it.each(["base", "added"] as const)(
    "keeps a restored %s element's position after removing a temporary sibling",
    async (kind) => {
      const comp = await openComposition(BASE_HTML, { coalesceMs: 0 });
      const id = kind === "base" ? "hf-sub" : comp.addElement("hf-stage", 1, "<p>Keep</p>");
      const temporary = comp.addElement("hf-stage", 1, "<p>Temporary</p>");
      comp.removeElement(id);
      comp.undo();
      comp.removeElement(temporary);

      const reopened = await openComposition(BASE_HTML, {
        overrides: JSON.parse(JSON.stringify(comp.getOverrides())),
      });

      expect(reopened.getElement("hf-stage")?.children.map((child) => child.id)).toEqual(
        kind === "base" ? ["hf-title", "hf-sub", "hf-logo"] : ["hf-title", id, "hf-sub", "hf-logo"],
      );
      expect(reopened.serialize()).toBe(comp.serialize());
    },
  );

  it("positions an added element after replaying later sibling removals", async () => {
    const comp = await openComposition(BASE_HTML);
    const id = comp.addElement("hf-stage", 2, "<p>Keep</p>");
    comp.removeElement("hf-title");

    const reopened = await openComposition(BASE_HTML, {
      overrides: JSON.parse(JSON.stringify(comp.getOverrides())),
    });

    expect(reopened.getElement("hf-stage")?.children.map((child) => child.id)).toEqual([
      "hf-sub",
      id,
      "hf-logo",
    ]);
    expect(reopened.serialize()).toBe(comp.serialize());
  });

  it("restores several saved positions without shifting a previously restored sibling", async () => {
    const ids = ["hf-c", "hf-b", "hf-first", "hf-last", "hf-a"];
    const html = `<div data-hf-id="hf-stage" data-hf-root>${ids.map((id) => `<p data-hf-id="${id}">${id}</p>`).join("")}</div>`;
    const comp = await openComposition(html);
    comp.applyPatches([
      ...["hf-c", "hf-b", "hf-a"].map((id) => ({ op: "remove", path: `/elements/${id}` })),
      ...["hf-a", "hf-b", "hf-c"].map((id, index) => ({
        op: "add",
        path: `/elements/${id}`,
        value: {
          html: `<p data-hf-id="${id}">${id}</p>`,
          parentId: "hf-stage",
          siblingIndex: index + 1,
        },
      })),
    ]);

    const reopened = await openComposition(html, {
      overrides: JSON.parse(JSON.stringify(comp.getOverrides())),
    });

    expect(reopened.getElement("hf-stage")?.children.map((child) => child.id)).toEqual([
      "hf-first",
      "hf-a",
      "hf-b",
      "hf-c",
      "hf-last",
    ]);
    expect(reopened.serialize()).toBe(comp.serialize());
  });

  it.each([false, true])(
    "keeps text around restored inline elements, with temporary sibling: %s",
    async (withTemporary) => {
      const html =
        '<p data-hf-id="hf-stage" data-hf-root>Start <b data-hf-id="hf-a">A</b> middle <i data-hf-id="hf-b">B</i> end <span data-hf-id="hf-c">C</span>.</p>';
      const comp = await openComposition(html, { coalesceMs: 0 });
      const temporary = withTemporary ? comp.addElement("hf-stage", 0, "<u>Temporary</u>") : null;
      comp.removeElement("hf-a");
      comp.undo();
      comp.removeElement("hf-b");
      comp.undo();
      if (temporary) comp.removeElement(temporary);

      const reopened = await openComposition(html, {
        overrides: JSON.parse(JSON.stringify(comp.getOverrides())),
      });

      expect(reopened.serialize()).toBe(comp.serialize());
    },
  );

  it("replays element snapshots with only an element sibling index", async () => {
    const comp = await openComposition(BASE_HTML, {
      overrides: {
        "hf-added": {
          html: '<p data-hf-id="hf-added">Original</p>',
          parentId: "hf-stage",
          siblingIndex: 1,
        },
        "hf-added.text": "Updated",
      },
    });

    expect(comp.getElement("hf-stage")?.children.map((child) => child.id)).toEqual([
      "hf-title",
      "hf-added",
      "hf-sub",
      "hf-logo",
    ]);
    expect(comp.getElement("hf-added")?.text).toBe("Updated");
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

// ─── getVariableValue / listVariables / declareVariable / removeVariable ──────

const VARIABLES_HTML = `<!DOCTYPE html>
<html data-composition-id="c1" data-composition-duration="5" data-composition-variables='${JSON.stringify(
  [{ id: "brand-color", type: "color", label: "Brand color", default: "#0066cc" }],
)}'>
<body>${BASE_HTML}</body>
</html>`;

describe("variable declarations (Composition API)", () => {
  it("getVariableValue reads a declared variable's current default", async () => {
    const comp = await openComposition(VARIABLES_HTML);
    expect(comp.getVariableValue("brand-color")).toBe("#0066cc");
  });

  it("getVariableValue returns undefined for an undeclared id", async () => {
    const comp = await openComposition(VARIABLES_HTML);
    expect(comp.getVariableValue("never-declared")).toBeUndefined();
  });

  it("listVariables returns every declared variable's full schema", async () => {
    const comp = await openComposition(VARIABLES_HTML);
    expect(comp.listVariables()).toEqual([
      { id: "brand-color", type: "color", label: "Brand color", default: "#0066cc" },
    ]);
  });

  it("listVariables returns [] when the composition declares none", async () => {
    const comp = await openComposition(BASE_HTML);
    expect(comp.listVariables()).toEqual([]);
  });

  it("declareVariable creates a new declaration a variables panel can list immediately", async () => {
    const comp = await openComposition(VARIABLES_HTML);
    comp.declareVariable({ id: "brand-title", type: "string", label: "Title", default: "Hi" });
    expect(comp.getVariableValue("brand-title")).toBe("Hi");
    expect(comp.listVariables()).toHaveLength(2);
  });

  it("declareVariable can create where setVariableValue's model write silently no-ops", async () => {
    // Full document (not a fragment): declareVariable refuses fragment sources,
    // whose synthetic <html> is stripped on serialize. No declarations yet.
    const comp = await openComposition(`<!DOCTYPE html><html><body>${BASE_HTML}</body></html>`);
    comp.setVariableValue("never-declared", "x");
    expect(comp.getVariableValue("never-declared")).toBeUndefined();
    comp.declareVariable({ id: "never-declared", type: "string", label: "New", default: "x" });
    expect(comp.getVariableValue("never-declared")).toBe("x");
  });

  it("removeVariable removes the declaration; listVariables reflects it immediately", async () => {
    const comp = await openComposition(VARIABLES_HTML);
    comp.removeVariable("brand-color");
    expect(comp.listVariables()).toEqual([]);
    expect(comp.getVariableValue("brand-color")).toBeUndefined();
  });

  it("declareVariable / removeVariable both support undo", async () => {
    const comp = await openComposition(VARIABLES_HTML);
    comp.declareVariable({ id: "brand-title", type: "string", label: "Title", default: "Hi" });
    expect(comp.listVariables()).toHaveLength(2);
    comp.undo();
    expect(comp.listVariables()).toHaveLength(1);

    comp.removeVariable("brand-color");
    expect(comp.listVariables()).toEqual([]);
    comp.undo();
    expect(comp.listVariables()).toEqual([
      { id: "brand-color", type: "color", label: "Brand color", default: "#0066cc" },
    ]);
  });

  it("declareVariable / removeVariable both support redo after undo", async () => {
    const comp = await openComposition(VARIABLES_HTML);

    comp.declareVariable({ id: "brand-title", type: "string", label: "Title", default: "Hi" });
    comp.undo();
    comp.redo();
    expect(comp.listVariables()).toEqual([
      { id: "brand-color", type: "color", label: "Brand color", default: "#0066cc" },
      { id: "brand-title", type: "string", label: "Title", default: "Hi" },
    ]);

    comp.removeVariable("brand-color");
    comp.undo();
    comp.redo();
    expect(comp.listVariables()).toEqual([
      { id: "brand-title", type: "string", label: "Title", default: "Hi" },
    ]);
  });
});
