import { describe, expect, it } from "vitest";
import { getPositionEditsRenderScript } from "./position-edits-render-inline";

describe("getPositionEditsRenderScript", () => {
  it("returns a non-empty IIFE string built from the real algorithm", () => {
    const script = getPositionEditsRenderScript();
    expect(script.length).toBeGreaterThan(0);
    expect(script).toContain("data-hf-edit-base-x");
  });

  it("is a safe no-op without position-edit markers", () => {
    document.body.innerHTML = "<h1>no edits</h1>";
    expect(() => new Function(getPositionEditsRenderScript())()).not.toThrow();
    expect(document.querySelector("h1")?.style.getPropertyValue("translate")).toBe("");
  });

  it("applies the translate delta when markers are present", () => {
    document.body.innerHTML =
      '<h1 data-x="10" data-y="0" data-hf-edit-base-x="0" data-hf-edit-base-y="0">hi</h1>';
    new Function(getPositionEditsRenderScript())();
    expect(document.querySelector("h1")?.style.getPropertyValue("translate")).toBe("10px 0px");
  });
});
