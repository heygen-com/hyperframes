import { describe, it, expect } from "vitest";
import { openComposition, createMemoryAdapter } from "./index.js";
import type { FontValue, ImageValue, JsonPatchOp } from "./index.js";

const FONT: FontValue = { name: "Brand Sans", source: "assets/brand.css" };
const IMAGE: ImageValue = { url: "assets/logo.svg", alt: "Brand logo", fit: "contain" };
const DECLARATIONS = [
  { id: "font", type: "font", label: "Font", default: "serif", source: "fallback.css" },
  { id: "logo", type: "image", label: "Logo", default: "fallback.svg", brandRole: "logo:primary" },
];
const HTML = `<!doctype html><html data-composition-variables='${JSON.stringify(DECLARATIONS)}'><body><div data-hf-root data-hf-id="hf-stage" data-duration="2"></div></body></html>`;
const OBJECT_DECLARATIONS = [
  { ...DECLARATIONS[0], default: FONT },
  { ...DECLARATIONS[1], default: IMAGE },
];

describe("font/image object defaults", () => {
  it("keeps documented object edits declared and validated after saving and reopening", async () => {
    const persist = createMemoryAdapter();
    const comp = await openComposition(HTML, { persist });
    comp.setVariableValue("font", FONT);
    comp.setVariableValue("logo", IMAGE);
    expect(comp.getVariableDeclarations()).toEqual(OBJECT_DECLARATIONS);
    expect(comp.listVariables()).toEqual(OBJECT_DECLARATIONS);
    expect(comp.validateVariableValues({ font: FONT, logo: IMAGE })).toEqual([]);
    expect(comp.getVariableValue("font", { base: true })).toBe("serif");
    await comp.flush();
    const saved = await persist.read("composition.html");
    expect(saved).toBe(comp.serialize());
    if (saved === undefined) throw new Error("Composition was not saved");
    const reopened = await openComposition(saved);
    expect(reopened.getVariableDeclarations()).toEqual(OBJECT_DECLARATIONS);
    expect(reopened.getVariableValues()).toEqual({ font: FONT, logo: IMAGE });
    expect(reopened.validateVariableValues({ font: FONT, logo: IMAGE })).toEqual([]);
    comp.dispose();
    reopened.dispose();
  });

  it("preserves declarations and CSS compatibility across string/object edits and undo/redo", async () => {
    const comp = await openComposition(HTML, { coalesceMs: 0 });
    comp.batch(() => {
      comp.setVariableValue("font", "monospace");
      comp.setVariableValue("logo", "first.svg");
    });
    comp.batch(() => {
      comp.setVariableValue("font", FONT);
      comp.setVariableValue("logo", IMAGE);
    });
    expect(comp.getVariableDeclarations()).toEqual(OBJECT_DECLARATIONS);
    expect(comp.getElement("hf-stage")?.inlineStyles["--font"]).toBeUndefined();
    expect(comp.getElement("hf-stage")?.inlineStyles["--logo"]).toBeUndefined();
    comp.undo();
    expect(comp.getVariableValues()).toEqual({ font: "monospace", logo: "first.svg" });
    expect(comp.getElement("hf-stage")?.inlineStyles["--font"]).toBe("monospace");
    comp.redo();
    expect(comp.getVariableDeclarations()).toEqual(OBJECT_DECLARATIONS);
    comp.batch(() => {
      comp.setVariableValue("font", "sans-serif");
      comp.setVariableValue("logo", "last.svg");
    });
    expect(comp.getVariableDeclarations().map((declaration) => declaration.default)).toEqual([
      "sans-serif",
      "last.svg",
    ]);
    expect(comp.getElement("hf-stage")?.inlineStyles["--font"]).toBe("sans-serif");
    expect(comp.getElement("hf-stage")?.inlineStyles["--logo"]).toBe("last.svg");
    comp.undo();
    expect(comp.getVariableDeclarations()).toEqual(OBJECT_DECLARATIONS);
    comp.dispose();
  });

  it("replays whole objects through overrides and forward/inverse patches", async () => {
    const comp = await openComposition(HTML, { overrides: {} });
    const forward: JsonPatchOp[] = [];
    const inverse: JsonPatchOp[] = [];
    comp.on("patch", (event) => {
      forward.push(...event.patches);
      inverse.unshift(...event.inversePatches);
    });
    comp.setVariableValue("font", FONT);
    comp.setVariableValue("logo", IMAGE);
    const replayed = await openComposition(HTML, { overrides: comp.getOverrides() });
    expect(replayed.getVariableDeclarations()).toEqual(OBJECT_DECLARATIONS);
    expect(replayed.getVariableValue("font", { base: true })).toBe("serif");
    const patched = await openComposition(HTML);
    patched.applyPatches(forward);
    expect(patched.getVariableDeclarations()).toEqual(OBJECT_DECLARATIONS);
    patched.applyPatches(inverse);
    expect(patched.getVariableDeclarations()).toEqual(DECLARATIONS);
    comp.dispose();
    replayed.dispose();
    patched.dispose();
  });

  it("restores object defaults when a batch rolls back", async () => {
    const comp = await openComposition(HTML, {
      overrides: { "var.font": FONT, "var.logo": IMAGE },
    });
    expect(() =>
      comp.batch(() => {
        comp.setVariableValue("font", "serif");
        comp.setVariableValue("logo", "other.svg");
        throw new Error("abort");
      }),
    ).toThrow("abort");
    expect(comp.getVariableDeclarations()).toEqual(OBJECT_DECLARATIONS);
    expect(comp.getOverrides()).toEqual({ "var.font": FONT, "var.logo": IMAGE });
    comp.dispose();
  });

  it("accepts object declarations without creating undeclared variables", async () => {
    const comp = await openComposition(HTML);
    const declaration = {
      id: "other-font",
      type: "font",
      label: "Other font",
      default: FONT,
    } as const;
    expect(comp.can({ type: "declareVariable", declaration })).toEqual({ ok: true });
    comp.declareVariable(declaration);
    expect(comp.getVariableDeclarations()).toContainEqual(declaration);
    comp.setVariableValue("missing", IMAGE);
    expect(comp.getVariableValue("missing")).toBeUndefined();
    expect(comp.validateVariableValues({ missing: IMAGE })).toEqual([
      { kind: "undeclared", variableId: "missing" },
    ]);
    comp.dispose();
  });
});
