import { describe, expect, it, vi } from "vitest";
import type { DomEditSelection, DomEditTextField } from "./domEditingTypes";

const editable = vi.hoisted(() => ({ current: true }));
vi.mock("./domEditingLayers", () => ({
  isTextEditableSelection: () => editable.current,
}));

const { canEditTextInline } = await import("./domEditInlineText");

function field(key: string): DomEditTextField {
  return {
    key,
    label: key,
    value: "text",
    tagName: "SPAN",
    attributes: [],
    inlineStyles: {},
    computedStyles: {},
    source: "self",
  };
}

function selection(partial: Partial<DomEditSelection> = {}): DomEditSelection {
  return {
    label: "Heading",
    tagName: "H1",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    textFields: [field("self")],
    ...partial,
  } as DomEditSelection;
}

describe("canEditTextInline", () => {
  it("allows an element the panel would let you edit text on", () => {
    editable.current = true;
    expect(canEditTextInline(selection())).toBe(true);
  });

  // The bar is the panel's bar: nothing becomes editable here that is not
  // editable there.
  it("refuses an element whose text the panel cannot edit either", () => {
    editable.current = false;
    expect(canEditTextInline(selection())).toBe(false);
  });

  // Editing the whole element would flatten its children into one string.
  it("refuses an element with several text fields", () => {
    editable.current = true;
    expect(canEditTextInline(selection({ textFields: [field("a"), field("b")] }))).toBe(false);
  });

  it("allows an element with no separate text fields", () => {
    editable.current = true;
    expect(canEditTextInline(selection({ textFields: [] }))).toBe(true);
  });

  it("refuses the composition host, which is the document rather than copy", () => {
    editable.current = true;
    expect(canEditTextInline(selection({ isCompositionHost: true }))).toBe(false);
  });

  it("refuses anything inside a locked composition", () => {
    editable.current = true;
    expect(canEditTextInline(selection({ isInsideLockedComposition: true }))).toBe(false);
  });

  it("refuses nothing at all", () => {
    editable.current = true;
    expect(canEditTextInline(null)).toBe(false);
  });
});
