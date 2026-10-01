import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import { readCssRotation } from "../../hooks/draggedGsapPosition";
import { applyRotationDraft, readRotationBase } from "./rotationDraft";

describe("rotate in a composition without GSAP", () => {
  it("starts from the authored CSS rotation and drafts the absolute angle the commit writes", () => {
    const window = new Window();
    window.document.head.innerHTML = "<style>#title { rotate: 30deg; }</style>";
    const element = window.document.createElement("h1");
    element.id = "title";
    window.document.body.append(element);
    const base = readRotationBase(element, true);
    expect(base).toBeCloseTo(30);
    applyRotationDraft(element, 55, readCssRotation(element, false));
    expect(element.style.getPropertyValue("rotate")).toBe("55deg");
  });

  it("drafts only the part of the angle the CSS rotate owns, leaving transform and scale theirs", () => {
    const cases: Array<[string, number, number]> = [
      ["transform: rotate(30deg);", 30, 25],
      ["rotate: 20deg; transform: rotate(10deg);", 30, 45],
      ["scale: -1 1;", 180, 25],
      ["transform: scaleX(-1);", 180, 25],
    ];
    for (const [css, base, drafted] of cases) {
      const window = new Window();
      window.document.head.innerHTML = `<style>#title { ${css} }</style>`;
      const element = window.document.createElement("h1");
      element.id = "title";
      window.document.body.append(element);
      expect({ css, base: readRotationBase(element, true) }).toEqual({
        css,
        base: expect.closeTo(base),
      });
      applyRotationDraft(element, base + 25, readCssRotation(element, false));
      const rotate = Number.parseFloat(element.style.getPropertyValue("rotate"));
      expect({ css, rotate }).toEqual({ css, rotate: expect.closeTo(drafted) });
    }
  });

  it("never asks GSAP, nor restyles per frame, when GSAP turns nothing on the element", () => {
    const window = new Window();
    const gsap = { set: vi.fn(), getProperty: vi.fn(() => 0) };
    Object.assign(window, { gsap });
    window.document.head.innerHTML = "<style>#title { rotate: 30deg; }</style>";
    const element = window.document.createElement("h1");
    element.id = "title";
    window.document.body.append(element);
    expect(readRotationBase(element, true)).toBeCloseTo(30);
    const share = readCssRotation(element, false);
    const styleReads = vi.spyOn(window, "getComputedStyle");
    applyRotationDraft(element, 55, share);
    expect(styleReads).not.toHaveBeenCalled();
    expect(element.style.getPropertyValue("rotate")).toBe("55deg");
    expect(gsap.set).not.toHaveBeenCalled();
    expect(gsap.getProperty).not.toHaveBeenCalled();
    applyRotationDraft(element, 55, null);
    expect(element.style.getPropertyValue("rotate")).toBe("none");
    expect(gsap.set).toHaveBeenCalledWith(element, { rotation: 55 });
  });
});
