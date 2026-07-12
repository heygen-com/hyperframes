/**
 * Pure form-logic guards for the Variables declaration form:
 * mergeDeclarationEdit (unmodeled-key passthrough on same-type edits) and
 * declarationFromDraft (per-type parsing + validation).
 */

import { describe, it, expect } from "vitest";
import {
  mergeDeclarationEdit,
  declarationFromDraft,
  draftFromDeclaration,
  EMPTY_DRAFT,
} from "./VariablesDeclarationForm.js";
import type { CompositionVariable } from "@hyperframes/core/variables";

describe("mergeDeclarationEdit", () => {
  it("preserves unmodeled keys on a same-type edit", () => {
    // The form owns id/label/type/default/description/min/max/step/options; every
    // other key (source, brandRole, unit, maxLength, …) must ride through a Save.
    const original = {
      id: "brand",
      type: "font",
      label: "Brand font",
      default: "Inter",
      source: "brand-kit",
      default_name: "Inter",
      brandRole: "heading",
    } as unknown as CompositionVariable;
    const edited = {
      id: "brand",
      type: "font",
      label: "Brand heading font",
      default: "Inter",
    } as CompositionVariable;

    const merged = mergeDeclarationEdit(original, edited) as Record<string, unknown>;
    expect(merged.label).toBe("Brand heading font");
    expect(merged.source).toBe("brand-kit");
    expect(merged.default_name).toBe("Inter");
    expect(merged.brandRole).toBe("heading");
  });

  it("drops old type-specific metadata when the type changes", () => {
    const original = {
      id: "count",
      type: "number",
      label: "Count",
      default: 3,
      min: 0,
      max: 10,
    } as CompositionVariable;
    const edited = {
      id: "count",
      type: "string",
      label: "Count",
      default: "3",
    } as CompositionVariable;

    const merged = mergeDeclarationEdit(original, edited) as Record<string, unknown>;
    expect(merged).toEqual(edited);
    expect(merged.min).toBeUndefined();
    expect(merged.max).toBeUndefined();
  });
});

describe("declarationFromDraft", () => {
  it("requires a non-empty id", () => {
    expect(declarationFromDraft({ ...EMPTY_DRAFT, id: "  " })).toBe("Variable id is required.");
  });

  it("parses a string variable verbatim and defaults label to id", () => {
    const decl = declarationFromDraft({ ...EMPTY_DRAFT, id: "title", defaultRaw: "Hello" });
    expect(decl).toEqual({ id: "title", label: "title", type: "string", default: "Hello" });
  });

  it("rejects a non-numeric number default", () => {
    expect(
      declarationFromDraft({ ...EMPTY_DRAFT, id: "n", type: "number", defaultRaw: "abc" }),
    ).toBe("Default must be a number.");
  });

  it("parses a number variable with min/max/step and drops blank constraints", () => {
    const decl = declarationFromDraft({
      ...EMPTY_DRAFT,
      id: "n",
      type: "number",
      defaultRaw: "5",
      min: "0",
      max: "",
      step: "0.5",
    });
    expect(decl).toEqual({ id: "n", label: "n", type: "number", default: 5, min: 0, step: 0.5 });
  });

  it("rejects an enum with no options and an off-list default", () => {
    expect(declarationFromDraft({ ...EMPTY_DRAFT, id: "e", type: "enum", optionsRaw: "" })).toBe(
      "Enum needs at least one option (one per line, value:Label).",
    );
    expect(
      declarationFromDraft({
        ...EMPTY_DRAFT,
        id: "e",
        type: "enum",
        optionsRaw: "wide:Wide\ntall:Tall",
        defaultRaw: "square",
      }),
    ).toBe("Default must be one of the options.");
  });

  it("parses a boolean from the 'true' sentinel", () => {
    expect(
      declarationFromDraft({ ...EMPTY_DRAFT, id: "b", type: "boolean", defaultRaw: "true" }),
    ).toMatchObject({
      type: "boolean",
      default: true,
    });
    expect(
      declarationFromDraft({ ...EMPTY_DRAFT, id: "b", type: "boolean", defaultRaw: "" }),
    ).toMatchObject({
      default: false,
    });
  });

  it("round-trips a declaration through draftFromDeclaration → declarationFromDraft", () => {
    const original: CompositionVariable = {
      id: "count",
      type: "number",
      label: "Count",
      default: 3,
      min: 0,
      max: 10,
    };
    expect(declarationFromDraft(draftFromDeclaration(original))).toEqual(original);
  });
});
