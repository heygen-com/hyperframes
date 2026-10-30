import { describe, it, expect } from "vitest";
import { isCompositionVariable, parseCompositionVariables } from "./compositionVariables.js";
import type { CompositionVariable } from "./types.js";

describe("font/image declaration defaults", () => {
  it("reads string fallbacks and typed objects without losing metadata", () => {
    const declarations: CompositionVariable[] = [
      {
        id: "font",
        type: "font",
        label: "Font",
        default: { name: "Brand", source: "brand.css" },
        default_name: "serif",
      },
      {
        id: "image",
        type: "image",
        label: "Image",
        default: { url: "logo.svg", alt: "Logo", fit: "contain" },
        brandRole: "logo:primary",
      },
      { id: "font-fallback", type: "font", label: "Fallback", default: "serif" },
      { id: "image-fallback", type: "image", label: "Fallback", default: "logo.svg" },
    ];
    const element = document.createElement("div");
    element.setAttribute("data-composition-variables", JSON.stringify(declarations));
    expect(parseCompositionVariables(element)).toEqual(declarations);
  });

  it.each([
    ["font", {}],
    ["font", { name: "Brand" }],
    ["font", { name: 1, source: "" }],
    ["font", []],
    ["font", null],
    ["image", {}],
    ["image", { url: 1 }],
    ["image", { url: "logo.svg", alt: 1 }],
    ["image", { url: "logo.svg", fit: "stretch" }],
    ["image", []],
    ["image", null],
    ["string", { url: "logo.svg" }],
    ["color", { name: "red", source: "" }],
    ["number", "2"],
    ["boolean", "true"],
  ])("rejects a malformed %s default %j", (type, value) => {
    const declaration = { id: "invalid", label: "Invalid", type, default: value };
    expect(isCompositionVariable(declaration)).toBe(false);
    const element = document.createElement("div");
    element.setAttribute("data-composition-variables", JSON.stringify([declaration]));
    expect(parseCompositionVariables(element)).toEqual([]);
  });
});
