/**
 * T4 — Op contract tests for the Phase 3a dispatch boundary.
 *
 * Tests verify: correct DOM mutation, correct RFC 6902 forward patches,
 * correct inverse patches (applying them restores the original state),
 * and override-set key mapping.
 */

import { describe, it, expect } from "vitest";
import { parseMutable, getElementStyles, setElementStyles } from "./model.js";
import { applyOp, validateOp } from "./mutate.js";
import { applyPatchesToDocument, applyOverrideSet } from "./apply-patches.js";
import { pathToKey } from "./patches.js";
import { serializeDocument } from "./serialize.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

// No trailing semicolons in style attrs — serializeStyleAttr never adds them.
const BASE_HTML = `
<div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px; background: #000" data-duration="5">
  <h1 data-hf-id="hf-title" data-start="0" data-end="3" data-track-index="0"
      style="color: #fff; font-size: 64px">Hello World</h1>
  <img data-hf-id="hf-logo" src="/logo.png" alt="Logo" />
  <div data-hf-id="hf-sub">
    <span data-hf-id="hf-span" style="opacity: 0.5">sub text</span>
  </div>
</div>
`.trim();

function fresh() {
  return parseMutable(BASE_HTML);
}

/** Full HTML fixture with data-composition-variables for B1/B2 tests. */
const VARIABLES_HTML = `<!DOCTYPE html>
<html data-composition-id="c1" data-composition-duration="5" data-composition-variables='${JSON.stringify(
  [
    { id: "brand-color-primary", type: "color", label: "Primary color", default: "#0066cc" },
    {
      id: "brand-font",
      type: "font",
      label: "Brand font",
      default: "Inter",
      source: "https://fonts.googleapis.com/css2?family=Inter",
      default_name: "sans-serif",
      default_source: "",
    },
    { id: "brand-logo", type: "image", label: "Brand logo", default: "/logo.png" },
  ],
)}'>
<body>
<div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px" data-duration="5">
</div>
</body></html>`;

function freshWithVars() {
  return parseMutable(VARIABLES_HTML);
}

/** Read the default value for a variable id from the parsed document. */
function readVarDefault(parsed: ReturnType<typeof parseMutable>, id: string): unknown {
  const raw = parsed.document.documentElement?.getAttribute("data-composition-variables");
  if (!raw) return undefined;
  const arr = JSON.parse(raw) as Array<{ id: string; default: unknown }>;
  return arr.find((v) => v.id === id)?.default;
}

// ─── setStyle ────────────────────────────────────────────────────────────────

describe("setStyle", () => {
  it("mutates existing style prop and emits replace patches", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setStyle",
      target: "hf-title",
      styles: { fontSize: "96px" },
    });
    expect(result.forward).toHaveLength(1);
    expect(result.forward[0]).toEqual({
      op: "replace",
      path: "/elements/hf-title/inlineStyles/fontSize",
      value: "96px",
    });
    expect(result.inverse[0]).toEqual({
      op: "replace",
      path: "/elements/hf-title/inlineStyles/fontSize",
      value: "64px",
    });
    // DOM mutated
    const el = parsed.document.querySelector('[data-hf-id="hf-title"]');
    expect(el?.getAttribute("style")).toContain("font-size: 96px");
  });

  it("adds new style prop and emits add patch", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setStyle",
      target: "hf-logo",
      styles: { opacity: "0.8" },
    });
    expect(result.forward[0]?.op).toBe("add");
    expect(result.inverse[0]?.op).toBe("remove");
  });

  it("removes style prop when value is null", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setStyle",
      target: "hf-title",
      styles: { color: null },
    });
    expect(result.forward[0]?.op).toBe("remove");
    expect(result.inverse[0]?.op).toBe("add");
    expect(result.inverse[0]?.value).toBe("#fff");
  });

  it("inverse patches restore original state", () => {
    const parsed = fresh();
    const before = serializeDocument(parsed);
    const { inverse } = applyOp(parsed, {
      type: "setStyle",
      target: "hf-title",
      styles: { fontSize: "96px", color: "#f00" },
    });
    applyPatchesToDocument(parsed, inverse);
    expect(serializeDocument(parsed)).toBe(before);
  });

  it("applies to multiple targets", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setStyle",
      target: ["hf-title", "hf-span"],
      styles: { opacity: "1" },
    });
    expect(result.forward).toHaveLength(2);
  });

  it("override-set key maps correctly", () => {
    const key = pathToKey("/elements/hf-title/inlineStyles/fontSize");
    expect(key).toBe("hf-title.style.fontSize");
  });

  // Regression: a HYPHENATED (kebab) style key must derive its inverse against
  // the camelCase-keyed store, or oldValue is null → undo deletes the prior
  // value instead of restoring it, and a removal skips the inverse entirely.
  it("derives correct inverse for a kebab style key (change)", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setStyle",
      target: "hf-title",
      styles: { "font-size": "96px" },
    });
    // inverse restores the prior 64px (replace), not a remove
    expect(result.inverse[0]).toEqual({
      op: "replace",
      path: "/elements/hf-title/inlineStyles/fontSize",
      value: "64px",
    });
  });

  it("emits the inverse for a kebab style removal (no DOM/patch desync)", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setStyle",
      target: "hf-title",
      styles: { "font-size": null },
    });
    // removal must be recorded (forward remove + inverse add restoring 64px)
    expect(result.forward[0]?.op).toBe("remove");
    expect(result.inverse[0]).toEqual({
      op: "add",
      path: "/elements/hf-title/inlineStyles/fontSize",
      value: "64px",
    });
    const el = parsed.document.querySelector('[data-hf-id="hf-title"]');
    expect(el?.getAttribute("style") ?? "").not.toContain("font-size");
  });
});

// ─── setText ─────────────────────────────────────────────────────────────────

describe("setText", () => {
  it("updates text content and emits replace patch", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setText",
      target: "hf-title",
      value: "Goodbye World",
    });
    expect(result.forward[0]).toEqual({
      op: "replace",
      path: "/elements/hf-title/text",
      value: "Goodbye World",
    });
    const el = parsed.document.querySelector('[data-hf-id="hf-title"]');
    // text node should contain new value
    expect(el?.textContent).toContain("Goodbye World");
  });

  it("inverse patches restore original text", () => {
    const parsed = fresh();
    const before = serializeDocument(parsed);
    const { inverse } = applyOp(parsed, {
      type: "setText",
      target: "hf-title",
      value: "Changed",
    });
    applyPatchesToDocument(parsed, inverse);
    expect(serializeDocument(parsed)).toBe(before);
  });

  it("creates text node when element has no existing text node", () => {
    const parsed = parseMutable(
      '<div data-hf-id="hf-s" data-hf-root><span data-hf-id="hf-empty"></span></div>',
    );
    const result = applyOp(parsed, { type: "setText", target: "hf-empty", value: "Added" });
    const el = parsed.document.querySelector('[data-hf-id="hf-empty"]');
    expect(el?.textContent).toBe("Added");
    expect(result.forward[0]?.op).toBe("replace");
    expect(result.forward[0]?.value).toBe("Added");
  });

  it("matches legacy single-child text targeting", () => {
    const parsed = parseMutable(
      '<button data-hf-id="hf-target"><span data-hf-id="hf-child">Old</span></button>',
    );
    const result = applyOp(parsed, { type: "setText", target: "hf-target", value: "New" });
    expect(serializeDocument(parsed)).toContain(
      '<button data-hf-id="hf-target"><span data-hf-id="hf-child">New</span></button>',
    );
    expect(result.inverse[0]?.value).toBe("Old");
  });

  it("preserves parent text when the legacy target is a single child", () => {
    const parsed = parseMutable(
      '<div data-hf-id="hf-target">Lead <span data-hf-id="hf-child">Old</span></div>',
    );
    applyOp(parsed, { type: "setText", target: "hf-target", value: "New" });
    expect(serializeDocument(parsed)).toContain(
      '<div data-hf-id="hf-target">Lead <span data-hf-id="hf-child">New</span></div>',
    );
  });

  it("keeps non-HTML single children out of the child text shortcut", () => {
    const parsed = parseMutable(
      '<div data-hf-id="hf-target"><svg data-hf-id="hf-child"><text>Old</text></svg></div>',
    );
    applyOp(parsed, { type: "setText", target: "hf-target", value: "New" });
    const html = serializeDocument(parsed);
    expect(html).toContain('<svg data-hf-id="hf-child"><text');
    expect(html).toContain("Old</text></svg>New</div>");
  });

  it("override-set key maps correctly", () => {
    expect(pathToKey("/elements/hf-title/text")).toBe("hf-title.text");
  });
});

// ─── setAttribute ─────────────────────────────────────────────────────────────

describe("setAttribute", () => {
  it("sets a new attribute and emits add patch", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setAttribute",
      target: "hf-logo",
      name: "src",
      value: "/new-logo.png",
    });
    expect(result.forward[0]).toEqual({
      op: "replace",
      path: "/elements/hf-logo/attributes/src",
      value: "/new-logo.png",
    });
  });

  it("removes attribute when value is null", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setAttribute",
      target: "hf-logo",
      name: "alt",
      value: null,
    });
    expect(result.forward[0]?.op).toBe("remove");
    expect(result.inverse[0]?.value).toBe("Logo");
  });

  it("inverse patches restore original attribute", () => {
    const parsed = fresh();
    const before = serializeDocument(parsed);
    const { inverse } = applyOp(parsed, {
      type: "setAttribute",
      target: "hf-logo",
      name: "src",
      value: "/changed.png",
    });
    applyPatchesToDocument(parsed, inverse);
    expect(serializeDocument(parsed)).toBe(before);
  });
});

// ─── setTiming ────────────────────────────────────────────────────────────────

describe("setTiming", () => {
  it("updates start and recalculates end", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setTiming",
      target: "hf-title",
      start: 1,
    });
    const el = parsed.document.querySelector('[data-hf-id="hf-title"]');
    expect(el?.getAttribute("data-start")).toBe("1");
    // duration was 3 (0→3), so end = 1+3 = 4
    expect(el?.getAttribute("data-end")).toBe("4");
    const startPatch = result.forward.find((p) => p.path.endsWith("/start"));
    expect(startPatch?.value).toBe(1);
  });

  it("updates duration and recalculates end", () => {
    const parsed = fresh();
    applyOp(parsed, { type: "setTiming", target: "hf-title", duration: 2 });
    const el = parsed.document.querySelector('[data-hf-id="hf-title"]');
    expect(el?.getAttribute("data-end")).toBe("2"); // start=0, duration=2 → end=2
  });

  it("inverse patches restore original timing", () => {
    const parsed = fresh();
    const before = serializeDocument(parsed);
    const { inverse } = applyOp(parsed, {
      type: "setTiming",
      target: "hf-title",
      start: 1,
      duration: 2,
      trackIndex: 1,
    });
    applyPatchesToDocument(parsed, inverse);
    expect(serializeDocument(parsed)).toBe(before);
  });
});

// ─── removeElement ───────────────────────────────────────────────────────────

describe("removeElement", () => {
  it("removes element from DOM and emits remove patch", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "removeElement",
      target: "hf-span",
    });
    expect(result.forward[0]?.op).toBe("remove");
    expect(result.forward[0]?.path).toBe("/elements/hf-span");
    expect(parsed.document.querySelector('[data-hf-id="hf-span"]')).toBeNull();
  });

  it("inverse patch carries html and restore position", () => {
    const parsed = fresh();
    const { inverse } = applyOp(parsed, {
      type: "removeElement",
      target: "hf-span",
    });
    expect(inverse[0]?.op).toBe("add");
    const val = inverse[0]?.value as {
      html: string;
      parentId: string | null;
      siblingIndex: number;
    };
    expect(val.html).toContain("hf-span");
    expect(val.parentId).toBe("hf-sub");
    expect(val.siblingIndex).toBe(0);
  });

  it("applying inverse patch restores the element in correct parent", () => {
    const parsed = fresh();
    const { inverse } = applyOp(parsed, {
      type: "removeElement",
      target: "hf-span",
    });
    applyPatchesToDocument(parsed, inverse);
    const restored = parsed.document.querySelector('[data-hf-id="hf-span"]');
    expect(restored).not.toBeNull();
    expect(restored?.parentElement?.getAttribute("data-hf-id")).toBe("hf-sub");
    expect(restored?.getAttribute("style")).toBe("opacity: 0.5");
    expect(restored?.textContent).toBe("sub text");
  });
});

// ─── addElement ───────────────────────────────────────────────────────────────

describe("addElement", () => {
  it("inserts element at specified parent+index and resolves via getElement-style lookup", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "addElement",
      parent: "hf-stage",
      index: 0,
      html: '<p class="new">inserted</p>',
    });
    expect(result.meta?.newId).toBeTruthy();
    const newId = result.meta!.newId!;
    const el = parsed.document.querySelector(`[data-hf-id="${newId}"]`);
    expect(el).not.toBeNull();
    expect(el?.tagName.toLowerCase()).toBe("p");
    // Inserted at index 0 → first child of hf-stage
    const stage = parsed.document.querySelector('[data-hf-id="hf-stage"]');
    expect(stage?.firstElementChild?.getAttribute("data-hf-id")).toBe(newId);
  });

  it("insert at index >= childCount appends to parent", () => {
    const parsed = fresh();
    const stage = parsed.document.querySelector('[data-hf-id="hf-stage"]');
    const countBefore = stage ? Array.from(stage.children).length : 0;
    const result = applyOp(parsed, {
      type: "addElement",
      parent: "hf-stage",
      index: 9999,
      html: '<span class="tail">tail</span>',
    });
    const newId = result.meta!.newId!;
    const stageAfter = parsed.document.querySelector('[data-hf-id="hf-stage"]');
    expect(stageAfter?.lastElementChild?.getAttribute("data-hf-id")).toBe(newId);
    expect(Array.from(stageAfter?.children ?? []).length).toBe(countBefore + 1);
  });

  it("minted id is unique vs all existing doc ids", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "addElement",
      parent: "hf-stage",
      index: 0,
      html: '<div class="unique-new">content</div>',
    });
    const newId = result.meta!.newId!;
    // Must not collide with any pre-existing id
    const existingIds = ["hf-stage", "hf-title", "hf-logo", "hf-sub", "hf-span"];
    expect(existingIds).not.toContain(newId);
    // Must appear exactly once in the document
    const all = Array.from(parsed.document.querySelectorAll(`[data-hf-id="${newId}"]`));
    expect(all).toHaveLength(1);
  });

  it("content-collision with existing element yields a distinct rehashed id", () => {
    // Insert a fragment with identical content to an existing element → dup-rehash must yield a distinct id
    const parsed = fresh();
    // hf-logo is <img data-hf-id="hf-logo" src="/logo.png" alt="Logo" />
    // Insert the same HTML without the data-hf-id so mintHfId runs fresh
    const result = applyOp(parsed, {
      type: "addElement",
      parent: "hf-stage",
      index: 0,
      html: '<img src="/logo.png" alt="Logo" />',
    });
    const newId = result.meta!.newId!;
    expect(newId).not.toBe("hf-logo");
    expect(newId.startsWith("hf-")).toBe(true);
    const el = parsed.document.querySelector(`[data-hf-id="${newId}"]`);
    expect(el).not.toBeNull();
  });

  it("nested fragment: all new nodes get unique ids; root id returned", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "addElement",
      parent: "hf-stage",
      index: 0,
      html: '<div class="outer"><span class="inner-a">a</span><span class="inner-b">b</span></div>',
    });
    const rootId = result.meta!.newId!;
    const root = parsed.document.querySelector(`[data-hf-id="${rootId}"]`);
    expect(root).not.toBeNull();
    // All children must have data-hf-id
    const children = root ? Array.from(root.querySelectorAll("*")) : [];
    for (const child of children) {
      expect(child.getAttribute("data-hf-id")).toBeTruthy();
    }
    // All ids must be distinct
    const allIds = [rootId, ...children.map((c) => c.getAttribute("data-hf-id") as string)];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("forward patch is patchAdd; inverse patch is patchRemove — symmetry with removeElement", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "addElement",
      parent: "hf-sub",
      index: 0,
      html: '<em class="em">em text</em>',
    });
    expect(result.forward).toHaveLength(1);
    expect(result.inverse).toHaveLength(1);
    expect(result.forward[0]?.op).toBe("add");
    expect(result.inverse[0]?.op).toBe("remove");
    const newId = result.meta!.newId!;
    expect(result.forward[0]?.path).toBe(`/elements/${newId}`);
    expect(result.inverse[0]?.path).toBe(`/elements/${newId}`);
  });

  it("applying inverse patch removes the added element (undo)", () => {
    const parsed = fresh();
    const { inverse, meta } = applyOp(parsed, {
      type: "addElement",
      parent: "hf-stage",
      index: 0,
      html: '<div class="to-undo">undo me</div>',
    });
    const newId = meta!.newId!;
    expect(parsed.document.querySelector(`[data-hf-id="${newId}"]`)).not.toBeNull();
    applyPatchesToDocument(parsed, inverse);
    expect(parsed.document.querySelector(`[data-hf-id="${newId}"]`)).toBeNull();
  });

  it("add → undo → redo: element returns with the same id (id stability)", () => {
    const parsed = fresh();
    // add
    const { forward, inverse, meta } = applyOp(parsed, {
      type: "addElement",
      parent: "hf-stage",
      index: 1,
      html: '<section class="redo-test">redo</section>',
    });
    const newId = meta!.newId!;
    // undo
    applyPatchesToDocument(parsed, inverse);
    expect(parsed.document.querySelector(`[data-hf-id="${newId}"]`)).toBeNull();
    // redo (replay forward patches)
    applyPatchesToDocument(parsed, forward);
    const restored = parsed.document.querySelector(`[data-hf-id="${newId}"]`);
    expect(restored).not.toBeNull();
    expect(restored?.getAttribute("data-hf-id")).toBe(newId);
  });

  it("parent: null inserts at document body root level", () => {
    // Use a simple fragment doc
    const parsed = parseMutable(
      '<div data-hf-id="hf-root" data-hf-root style="width:100px;height:100px"></div>',
    );
    const result = applyOp(parsed, {
      type: "addElement",
      parent: null,
      index: 1,
      html: '<aside class="body-child">aside</aside>',
    });
    const newId = result.meta!.newId!;
    const el = parsed.document.querySelector(`[data-hf-id="${newId}"]`);
    expect(el).not.toBeNull();
    expect(el?.parentElement?.tagName.toLowerCase()).toBe("body");
  });

  it("serialize round-trip: addElement survives serialize()", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "addElement",
      parent: "hf-sub",
      index: 0,
      html: '<b class="bold">bold</b>',
    });
    const newId = result.meta!.newId!;
    const serialized = serializeDocument(parsed);
    expect(serialized).toContain(`data-hf-id="${newId}"`);
    expect(serialized).toContain("bold");
  });

  // ─── validateOp ─────────────────────────────────────────────────────────────

  it("validateOp: missing parent → E_TARGET_NOT_FOUND", () => {
    const parsed = fresh();
    const r = validateOp(parsed, {
      type: "addElement",
      parent: "hf-nonexistent",
      index: 0,
      html: "<div>x</div>",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_TARGET_NOT_FOUND");
  });

  it("validateOp: negative index → E_INVALID_ARGS", () => {
    const parsed = fresh();
    const r = validateOp(parsed, {
      type: "addElement",
      parent: "hf-stage",
      index: -1,
      html: "<div>x</div>",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_INVALID_ARGS");
  });

  it("validateOp: empty html → E_INVALID_HTML", () => {
    const parsed = fresh();
    const r = validateOp(parsed, {
      type: "addElement",
      parent: "hf-stage",
      index: 0,
      html: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_INVALID_HTML");
  });

  it("validateOp: html with only text / zero element nodes → E_INVALID_HTML", () => {
    const parsed = fresh();
    const r = validateOp(parsed, {
      type: "addElement",
      parent: "hf-stage",
      index: 0,
      html: "just text no element",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_INVALID_HTML");
  });

  it("validateOp: html containing <script> → E_INVALID_HTML", () => {
    const parsed = fresh();
    const r = validateOp(parsed, {
      type: "addElement",
      parent: "hf-stage",
      index: 0,
      html: "<div><script>alert(1)</scr" + "ipt></div>",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_INVALID_HTML");
  });

  it("validateOp: parent: null is valid", () => {
    const parsed = fresh();
    const r = validateOp(parsed, {
      type: "addElement",
      parent: null,
      index: 0,
      html: "<div>body-level</div>",
    });
    expect(r.ok).toBe(true);
  });

  // The dispatch path runs applyOp WITHOUT validateOp, so the handler must
  // re-enforce these guards itself (return EMPTY) rather than crash or insert.
  it.each([
    { name: "unknown parent id (no crash)", parent: "hf-does-not-exist", html: "<div>x</div>" },
    {
      name: "fragment with <script> (never inserts raw markup)",
      parent: "hf-stage",
      html: "<div><scr" + "ipt>alert(1)</scr" + "ipt></div>",
    },
    {
      name: "multi-root fragment (no silent drop of extra roots)",
      parent: "hf-stage",
      html: "<p>a</p><p>b</p>",
    },
  ])("handler guard: $name → no-op", ({ parent, html }) => {
    const result = applyOp(fresh(), { type: "addElement", parent, index: 0, html });
    expect(result.forward).toHaveLength(0);
    expect(result.meta?.newId).toBeUndefined();
  });

  // Regression: a scoped sub-comp parent ("hf-host/hf-leaf") whose bare leaf id
  // also exists at top level. The forward patch must keep the scoped path so
  // redo/replay re-inserts under the SAME parent (resolveScoped), not the
  // canonical top-level dup.
  it("scoped parent: forward patch keeps the scoped path so redo targets the right parent", () => {
    const parsed = parseMutable(
      '<div data-hf-id="hf-stage" data-hf-root style="width:100px;height:100px">' +
        '<div data-hf-id="hf-host"><p data-hf-id="hf-leaf">in host</p></div>' +
        '<p data-hf-id="hf-leaf">top-level dup</p>' +
        "</div>",
    );
    const result = applyOp(parsed, {
      type: "addElement",
      parent: "hf-host/hf-leaf",
      index: 0,
      html: '<span class="ins">x</span>',
    });
    expect((result.forward[0]!.value as { parentId: string }).parentId).toBe("hf-host/hf-leaf");
    const newId = result.meta!.newId!;
    // undo, then redo: the element must return under the HOST's leaf, not the dup.
    applyPatchesToDocument(parsed, result.inverse);
    applyPatchesToDocument(parsed, result.forward);
    const host = parsed.document.querySelector('[data-hf-id="hf-host"]');
    const inserted = parsed.document.querySelector(`[data-hf-id="${newId}"]`);
    expect(inserted).not.toBeNull();
    expect(host?.contains(inserted as Node)).toBe(true);
  });
});

// ─── setElementStyles (model helper) ──────────────────────────────────────────

describe("setElementStyles key normalization", () => {
  function elWith(style: string): Element {
    const parsed = parseMutable(`<div data-hf-id="hf-x" data-hf-root style="${style}"></div>`);
    const el = parsed.document.querySelector('[data-hf-id="hf-x"]');
    if (!el) throw new Error("fixture element missing");
    return el;
  }

  it("removes a hyphenated property when value is null", () => {
    const el = elWith("transform-origin: center center; opacity: 0.5");
    setElementStyles(el, { "transform-origin": null });
    const styles = getElementStyles(el);
    expect(styles.transformOrigin).toBeUndefined();
    expect(el.getAttribute("style")).not.toContain("transform-origin");
    // sibling prop untouched
    expect(styles.opacity).toBe("0.5");
  });

  it("removes a CSS custom property when value is null", () => {
    const el = elWith("--brand-color: #f00; opacity: 0.5");
    setElementStyles(el, { "--brand-color": null });
    const styles = getElementStyles(el);
    expect(styles["--brand-color"]).toBeUndefined();
    expect(el.getAttribute("style")).not.toContain("--brand-color");
    expect(styles.opacity).toBe("0.5");
  });

  it("sets a camelCase property and keeps existing props", () => {
    const el = elWith("color: #fff");
    setElementStyles(el, { fontSize: "96px" });
    const styles = getElementStyles(el);
    expect(styles.fontSize).toBe("96px");
    expect(styles.color).toBe("#fff");
  });

  it("sets a hyphenated property under its camelCase key", () => {
    const el = elWith("");
    setElementStyles(el, { "transform-origin": "top left" });
    expect(getElementStyles(el).transformOrigin).toBe("top left");
  });

  it("preserves semicolon-bearing CSS values when updating another property", () => {
    const el = elWith("background: url(data:image/svg+xml;utf8,<svg></svg>); color: red");
    setElementStyles(el, { color: "blue" });
    expect(el.getAttribute("style")).toContain("background: url(data:image/svg+xml;utf8");
    expect(el.getAttribute("style")).toContain("color: blue");
  });

  it("handles escaped quotes inside CSS string values", () => {
    const el = elWith("color: red");
    el.setAttribute("style", 'content: "a\\";b"; color: red');
    setElementStyles(el, { color: "blue" });
    expect(getElementStyles(el).content).toBe('"a\\";b"');
    expect(getElementStyles(el).color).toBe("blue");
  });
});

// ─── setVariableValue ─────────────────────────────────────────────────────────

describe("setVariableValue", () => {
  it("sets CSS custom property on root element (fragment doc — compat)", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "setVariableValue",
      id: "brand-color-primary",
      value: "#ff0000",
    });
    expect(result.forward[0]?.path).toBe("/variables/brand-color-primary");
    expect(result.forward[0]?.value).toBe("#ff0000");
    const root = parsed.document.querySelector("[data-hf-root]");
    expect(root?.getAttribute("style")).toContain("--brand-color-primary: #ff0000");
  });

  it("override-set key maps correctly", () => {
    expect(pathToKey("/variables/brand-color-primary")).toBe("var.brand-color-primary");
  });

  // B1 — drives the JSON model (data-composition-variables)

  it("B1: scalar color round-trips through override-set and runtime JSON model", () => {
    const parsed = freshWithVars();
    const before = serializeDocument(parsed);
    const result = applyOp(parsed, {
      type: "setVariableValue",
      id: "brand-color-primary",
      value: "#ff0000",
    });
    expect(result.forward[0]?.path).toBe("/variables/brand-color-primary");
    expect(result.forward[0]?.value).toBe("#ff0000");
    // JSON model updated
    expect(readVarDefault(parsed, "brand-color-primary")).toBe("#ff0000");
    // CSS compat prop also written
    const root = parsed.document.querySelector("[data-hf-root]");
    expect(root?.getAttribute("style")).toContain("--brand-color-primary: #ff0000");
    // inverse restores
    applyPatchesToDocument(parsed, result.inverse);
    expect(serializeDocument(parsed)).toBe(before);
  });

  it("B1: scalar inverse patch restores prior value (replace → old value)", () => {
    const parsed = freshWithVars();
    // Set once
    applyOp(parsed, { type: "setVariableValue", id: "brand-color-primary", value: "#ff0000" });
    const snap = serializeDocument(parsed);
    // Set again
    const result2 = applyOp(parsed, {
      type: "setVariableValue",
      id: "brand-color-primary",
      value: "#00ff00",
    });
    expect(readVarDefault(parsed, "brand-color-primary")).toBe("#00ff00");
    applyPatchesToDocument(parsed, result2.inverse);
    expect(serializeDocument(parsed)).toBe(snap);
  });

  // B2 — object-valued font variable

  it("B2: font {name,source} object round-trips through JSON model (no CSS prop)", () => {
    const parsed = freshWithVars();
    const fontValue = { name: "Roboto", source: "https://fonts.googleapis.com/css2?family=Roboto" };
    const result = applyOp(parsed, {
      type: "setVariableValue",
      id: "brand-font",
      value: fontValue,
    });
    expect(result.forward[0]?.path).toBe("/variables/brand-font");
    expect(result.forward[0]?.value).toEqual(fontValue);
    // JSON model updated
    expect(readVarDefault(parsed, "brand-font")).toEqual(fontValue);
    // NO CSS custom prop for object values
    const root = parsed.document.querySelector("[data-hf-root]");
    const style = root?.getAttribute("style") ?? "";
    expect(style).not.toContain("--brand-font");
    // override-set key holds the object (one var.{id} key, no sub-key explosion)
    expect(pathToKey("/variables/brand-font")).toBe("var.brand-font");
  });

  it("B2: font inverse restores prior default (object → object)", () => {
    const parsed = freshWithVars();
    const before = serializeDocument(parsed);
    const fontValue = { name: "Roboto", source: "https://fonts.googleapis.com/css2?family=Roboto" };
    const result = applyOp(parsed, {
      type: "setVariableValue",
      id: "brand-font",
      value: fontValue,
    });
    expect(readVarDefault(parsed, "brand-font")).toEqual(fontValue);
    applyPatchesToDocument(parsed, result.inverse);
    expect(serializeDocument(parsed)).toBe(before);
  });

  it("B2: image {url} object round-trips through JSON model (no CSS prop)", () => {
    const parsed = freshWithVars();
    const imgValue = { url: "https://example.com/brand-logo.png" };
    const result = applyOp(parsed, {
      type: "setVariableValue",
      id: "brand-logo",
      value: imgValue,
    });
    expect(result.forward[0]?.path).toBe("/variables/brand-logo");
    expect(result.forward[0]?.value).toEqual(imgValue);
    expect(readVarDefault(parsed, "brand-logo")).toEqual(imgValue);
    const root = parsed.document.querySelector("[data-hf-root]");
    expect(root?.getAttribute("style") ?? "").not.toContain("--brand-logo");
  });

  it("B2: image inverse restores prior default", () => {
    const parsed = freshWithVars();
    const before = serializeDocument(parsed);
    const result = applyOp(parsed, {
      type: "setVariableValue",
      id: "brand-logo",
      value: { url: "https://example.com/new-logo.png" },
    });
    applyPatchesToDocument(parsed, result.inverse);
    expect(serializeDocument(parsed)).toBe(before);
  });

  it("B1/batch: multiple setVariableValue calls fold to independent overrides", () => {
    const parsed = freshWithVars();
    applyOp(parsed, { type: "setVariableValue", id: "brand-color-primary", value: "#ff0000" });
    applyOp(parsed, {
      type: "setVariableValue",
      id: "brand-font",
      value: { name: "Roboto", source: "https://fonts.googleapis.com/css2?family=Roboto" },
    });
    expect(readVarDefault(parsed, "brand-color-primary")).toBe("#ff0000");
    expect(readVarDefault(parsed, "brand-font")).toEqual({
      name: "Roboto",
      source: "https://fonts.googleapis.com/css2?family=Roboto",
    });
  });

  // Regression: a variable declared WITHOUT a `default` key. The forward set adds
  // the default; undo must DELETE it (restore the no-default state), not strand
  // the set value (apply-patches previously no-op'd the remove).
  it("B1: undo of a set on a default-less variable restores the no-default state", () => {
    const html = `<!DOCTYPE html><html data-composition-id="c1" data-composition-duration="5" data-composition-variables='${JSON.stringify(
      [{ id: "brand-x", type: "color", label: "X" }],
    )}'><body><div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px" data-duration="5"></div></body></html>`;
    const parsed = parseMutable(html);
    const before = serializeDocument(parsed);
    const result = applyOp(parsed, { type: "setVariableValue", id: "brand-x", value: "#ff0000" });
    expect(readVarDefault(parsed, "brand-x")).toBe("#ff0000");
    applyPatchesToDocument(parsed, result.inverse);
    expect(readVarDefault(parsed, "brand-x")).toBeUndefined();
    expect(serializeDocument(parsed)).toBe(before);
  });

  // #9: a legacy override set (only the `var.{id}` key, no paired style key, as
  // written before the model/CSS split) must still restore the --{id} CSS prop
  // on replay so `var(--{id})` bindings rehydrate. Object values write no CSS.
  it("B1: applyOverrideSet derives the --{id} CSS prop from a var.{id}-only override", () => {
    const parsed = freshWithVars();
    applyOverrideSet(parsed, { "var.brand-color-primary": "#ff0000" });
    expect(readVarDefault(parsed, "brand-color-primary")).toBe("#ff0000");
    const root = parsed.document.querySelector("[data-hf-root]");
    expect(root?.getAttribute("style")).toContain("--brand-color-primary: #ff0000");
  });

  it("B2: applyOverrideSet writes NO CSS prop for an object (font) override", () => {
    const parsed = freshWithVars();
    applyOverrideSet(parsed, { "var.brand-font": { name: "Roboto", source: "x" } });
    expect(readVarDefault(parsed, "brand-font")).toEqual({ name: "Roboto", source: "x" });
    const root = parsed.document.querySelector("[data-hf-root]");
    expect(root?.getAttribute("style") ?? "").not.toContain("--brand-font");
  });
});

// ─── setCompositionMetadata ───────────────────────────────────────────────────

describe("setCompositionMetadata", () => {
  it("updates width, height, duration on root element", () => {
    const parsed = fresh();
    applyOp(parsed, {
      type: "setCompositionMetadata",
      width: 1920,
      height: 1080,
      duration: 10,
    });
    const root = parsed.document.querySelector("[data-hf-root]");
    expect(root?.getAttribute("style")).toContain("width: 1920px");
    expect(root?.getAttribute("style")).toContain("height: 1080px");
    expect(root?.getAttribute("data-duration")).toBe("10");
  });

  it("inverse patches restore original metadata", () => {
    const parsed = fresh();
    const before = serializeDocument(parsed);
    const { inverse } = applyOp(parsed, {
      type: "setCompositionMetadata",
      width: 1920,
      height: 1080,
      duration: 10,
    });
    applyPatchesToDocument(parsed, inverse);
    expect(serializeDocument(parsed)).toBe(before);
  });
});

// ─── moveElement ─────────────────────────────────────────────────────────────

describe("moveElement", () => {
  it("sets data-x and data-y attributes (HF positioning convention)", () => {
    const parsed = fresh();
    const result = applyOp(parsed, {
      type: "moveElement",
      target: "hf-title",
      x: 100,
      y: 200,
    });
    const el = parsed.document.querySelector('[data-hf-id="hf-title"]');
    expect(el?.getAttribute("data-x")).toBe("100");
    expect(el?.getAttribute("data-y")).toBe("200");
    expect(result.forward.some((p) => p.path.endsWith("/data-x"))).toBe(true);
    expect(result.forward.some((p) => p.path.endsWith("/data-y"))).toBe(true);
  });

  it("inverse restores prior data-x/data-y", () => {
    const parsed = fresh();
    const el = parsed.document.querySelector('[data-hf-id="hf-title"]') as Element;
    el.setAttribute("data-x", "50");
    el.setAttribute("data-y", "75");
    const result = applyOp(parsed, { type: "moveElement", target: "hf-title", x: 100, y: 200 });
    applyPatchesToDocument(parsed, result.inverse);
    expect(el.getAttribute("data-x")).toBe("50");
    expect(el.getAttribute("data-y")).toBe("75");
  });

  it("captures the pre-edit baseline on first move only", () => {
    const parsed = fresh();
    const el = parsed.document.querySelector('[data-hf-id="hf-title"]') as Element;
    el.setAttribute("data-x", "50");
    applyOp(parsed, { type: "moveElement", target: "hf-title", x: 100, y: 200 });
    // Baseline = the values before the first edit (absent data-y → "0").
    expect(el.getAttribute("data-hf-edit-base-x")).toBe("50");
    expect(el.getAttribute("data-hf-edit-base-y")).toBe("0");
    // A second move keeps the original baseline.
    applyOp(parsed, { type: "moveElement", target: "hf-title", x: 300, y: 400 });
    expect(el.getAttribute("data-hf-edit-base-x")).toBe("50");
    expect(el.getAttribute("data-hf-edit-base-y")).toBe("0");
    expect(el.getAttribute("data-x")).toBe("300");
    expect(el.getAttribute("data-y")).toBe("400");
  });

  it("inverse of the first move removes the baseline attributes", () => {
    const parsed = fresh();
    const el = parsed.document.querySelector('[data-hf-id="hf-title"]') as Element;
    const result = applyOp(parsed, { type: "moveElement", target: "hf-title", x: 100, y: 200 });
    applyPatchesToDocument(parsed, result.inverse);
    expect(el.getAttribute("data-hf-edit-base-x")).toBeNull();
    expect(el.getAttribute("data-hf-edit-base-y")).toBeNull();
    expect(el.getAttribute("data-x")).toBeNull();
    expect(el.getAttribute("data-y")).toBeNull();
  });
});

// ─── validateOp (can()) ───────────────────────────────────────────────────────

describe("validateOp", () => {
  it("returns ok:true for existing element", () => {
    expect(validateOp(fresh(), { type: "setStyle", target: "hf-title", styles: {} }).ok).toBe(true);
  });

  it("returns ok:false / E_TARGET_NOT_FOUND for unknown element id", () => {
    const r = validateOp(fresh(), { type: "setStyle", target: "hf-unknown", styles: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_TARGET_NOT_FOUND");
  });

  it("returns ok:true for setCompositionMetadata (no target)", () => {
    expect(validateOp(fresh(), { type: "setCompositionMetadata", width: 100 }).ok).toBe(true);
  });
});

// ─── Phase 3b ops — graceful when no GSAP script, feature-detectable ────────

describe("Phase 3b ops", () => {
  it("applyOp throws when no GSAP script is present", () => {
    expect(() =>
      applyOp(fresh(), {
        type: "addGsapTween",
        target: "hf-title",
        tween: { method: "from", properties: { opacity: 0 } },
      }),
    ).toThrow();
  });

  it("validateOp returns ok:false / E_NO_GSAP_SCRIPT when no GSAP script present", () => {
    const r1 = validateOp(fresh(), { type: "removeGsapTween", animationId: "tw-1" });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe("E_NO_GSAP_SCRIPT");
    const r2 = validateOp(fresh(), {
      type: "addGsapTween",
      target: "hf-title",
      tween: { method: "from", properties: { opacity: 0 } },
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("E_NO_GSAP_SCRIPT");
  });

  it("unrollDynamicAnimations rejects an empty element list (would delete the animation)", () => {
    const parsed = parseMutable(
      `<div data-hf-id="hf-r" data-hf-root></div>` +
        `<script>var tl = gsap.timeline({ paused: true }); tl.to("#x", { x: 1 }, 0);</script>`,
    );
    const r = validateOp(parsed, {
      type: "unrollDynamicAnimations",
      animationId: "#x-to-0-position",
      elements: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_INVALID_ARGS");
  });

  it("materializeKeyframes rejects an empty keyframe list (would empty the animation)", () => {
    const parsed = parseMutable(
      `<div data-hf-id="hf-r" data-hf-root></div>` +
        `<script>var tl = gsap.timeline({ paused: true }); tl.to("#x", { x: 1 }, 0);</script>`,
    );
    const r = validateOp(parsed, {
      type: "materializeKeyframes",
      animationId: "#x-to-0-position",
      keyframes: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_INVALID_ARGS");
  });

  it("setClassStyle no longer throws — implemented in Phase 3b", () => {
    expect(() =>
      applyOp(fresh(), {
        type: "setClassStyle",
        selector: ".box",
        styles: { color: "red" },
      }),
    ).not.toThrow();
  });
});

// ─── setCompositionMetadata — data-width/data-height forced override ─────────

describe("setCompositionMetadata data-* channel", () => {
  const ATTR_HTML = `
<div data-hf-id="hf-stage" data-hf-root data-width="1280" data-height="720" style="width: 1280px; height: 720px">
  <h1 data-hf-id="hf-title">Hi</h1>
</div>
`.trim();

  it("updates data-width/data-height when the composition carries them", () => {
    const parsed = parseMutable(ATTR_HTML);
    applyOp(parsed, { type: "setCompositionMetadata", width: 1920, height: 1080 });
    const root = parsed.document.querySelector("[data-hf-root]");
    expect(root?.getAttribute("data-width")).toBe("1920");
    expect(root?.getAttribute("data-height")).toBe("1080");
    expect(root?.getAttribute("style")).toContain("width: 1920px");
  });

  it("inverse restores both channels", () => {
    const parsed = parseMutable(ATTR_HTML);
    const before = serializeDocument(parsed);
    const { inverse } = applyOp(parsed, { type: "setCompositionMetadata", width: 1920 });
    applyPatchesToDocument(parsed, inverse);
    expect(serializeDocument(parsed)).toBe(before);
  });

  it("does not mint data-* attributes on compositions without them", () => {
    const parsed = fresh();
    applyOp(parsed, { type: "setCompositionMetadata", width: 1920 });
    const root = parsed.document.querySelector("[data-hf-root]");
    expect(root?.hasAttribute("data-width")).toBe(false);
    expect(root?.getAttribute("style")).toContain("width: 1920px");
  });
});

// ─── reorderElements ─────────────────────────────────────────────────────────

describe("reorderElements", () => {
  it("sets zIndex on each entry", () => {
    const parsed = fresh();
    applyOp(parsed, {
      type: "reorderElements",
      entries: [
        { target: "hf-title", zIndex: 2 },
        { target: "hf-logo", zIndex: 1 },
      ],
    });
    const title = parsed.document.querySelector("[data-hf-id='hf-title']") as HTMLElement | null;
    const logo = parsed.document.querySelector("[data-hf-id='hf-logo']") as HTMLElement | null;
    expect(title?.style.zIndex).toBe("2");
    expect(logo?.style.zIndex).toBe("1");
  });

  it("inverse restores original zIndex values", () => {
    const parsed = fresh();
    const before = serializeDocument(parsed);
    const { inverse } = applyOp(parsed, {
      type: "reorderElements",
      entries: [{ target: "hf-title", zIndex: 5 }],
    });
    applyPatchesToDocument(parsed, inverse);
    expect(serializeDocument(parsed)).toBe(before);
  });

  it("validateOp returns ok:true for existing targets", () => {
    const r = validateOp(fresh(), {
      type: "reorderElements",
      entries: [{ target: "hf-title", zIndex: 1 }],
    });
    expect(r.ok).toBe(true);
  });

  it("validateOp returns E_TARGET_NOT_FOUND for unknown target", () => {
    const r = validateOp(fresh(), {
      type: "reorderElements",
      entries: [{ target: "hf-unknown", zIndex: 1 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("E_TARGET_NOT_FOUND");
  });

  it("duplicate target collapses to last-wins and inverse restores cleanly", () => {
    const parsed = fresh();
    const before = serializeDocument(parsed);
    const { forward, inverse } = applyOp(parsed, {
      type: "reorderElements",
      entries: [
        { target: "hf-title", zIndex: 2 },
        { target: "hf-title", zIndex: 9 },
      ],
    });
    const title = parsed.document.querySelector("[data-hf-id='hf-title']") as HTMLElement | null;
    expect(title?.style.zIndex).toBe("9"); // last write wins
    expect(forward.length).toBe(1); // one patch, not two on the same path
    // Inverse must be applied in reverse order (session reverses single-dispatch
    // inverse) to land back on the original, not the intermediate "2".
    applyPatchesToDocument(parsed, [...inverse].reverse());
    expect(serializeDocument(parsed)).toBe(before);
  });
});
