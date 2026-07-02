import { describe, expect, it } from "vitest";
import {
  EDIT_BASE_X_ATTR,
  EDIT_BASE_Y_ATTR,
  EDIT_ORIGINAL_TRANSLATE_ATTR,
  applyPositionEditToElement,
  applyPositionEdits,
  composeTranslate,
} from "./positionEdits";

function makeElement(attrs: Record<string, string>, style = ""): HTMLElement {
  const el = document.createElement("div");
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  if (style) el.setAttribute("style", style);
  document.body.appendChild(el);
  return el;
}

describe("composeTranslate", () => {
  it("returns the delta alone when there is no original", () => {
    expect(composeTranslate("", "10px", "20px")).toBe("10px 20px");
    expect(composeTranslate("none", "10px", "20px")).toBe("10px 20px");
  });

  it("adds px values numerically", () => {
    expect(composeTranslate("5px 6px", "10px", "20px")).toBe("15px 26px");
    expect(composeTranslate("-5.5px 6px", "10px", "-20px")).toBe("4.5px -14px");
  });

  it("treats a single-part original as x-only", () => {
    expect(composeTranslate("5px", "10px", "20px")).toBe("15px 20px");
  });

  it("falls back to calc() for non-px units and preserves z", () => {
    expect(composeTranslate("10% 6px", "10px", "20px")).toBe("calc(10% + 10px) 26px");
    expect(composeTranslate("1px 2px 3px", "10px", "20px")).toBe("11px 22px 3px");
  });
});

describe("applyPositionEdits", () => {
  it("ignores unmarked elements", () => {
    const el = makeElement({ "data-x": "100", "data-y": "50" });
    expect(applyPositionEdits(document)).toBe(0);
    expect(el.style.getPropertyValue("translate")).toBe("");
    el.remove();
  });

  it("applies the delta between data-x/y and the captured baseline", () => {
    const el = makeElement({
      "data-x": "150",
      "data-y": "-30",
      [EDIT_BASE_X_ATTR]: "100",
      [EDIT_BASE_Y_ATTR]: "20",
    });
    expect(applyPositionEdits(document)).toBe(1);
    expect(el.style.getPropertyValue("translate")).toBe("50px -50px");
    expect(el.getAttribute(EDIT_ORIGINAL_TRANSLATE_ATTR)).toBe("");
    el.remove();
  });

  it("treats missing data-x/y or baseline attributes as 0", () => {
    const el = makeElement({ "data-x": "40", [EDIT_BASE_X_ATTR]: "0" });
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("40px 0px");
    el.remove();
  });

  it("composes with a pre-existing inline translate and stays idempotent", () => {
    const el = makeElement(
      { "data-x": "10", "data-y": "20", [EDIT_BASE_X_ATTR]: "0", [EDIT_BASE_Y_ATTR]: "0" },
      "translate: 5px 6px",
    );
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("15px 26px");
    expect(el.getAttribute(EDIT_ORIGINAL_TRANSLATE_ATTR)).toBe("5px 6px");
    // Second application must not compound.
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("15px 26px");
    el.remove();
  });

  it("recomputes from the same baseline after data-x changes", () => {
    const el = makeElement({
      "data-x": "10",
      "data-y": "0",
      [EDIT_BASE_X_ATTR]: "0",
      [EDIT_BASE_Y_ATTR]: "0",
    });
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("10px 0px");
    el.setAttribute("data-x", "70");
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("70px 0px");
    el.remove();
  });

  it("never re-captures the original translate once set", () => {
    const el = makeElement({
      "data-x": "10",
      "data-y": "0",
      [EDIT_BASE_X_ATTR]: "0",
      [EDIT_BASE_Y_ATTR]: "0",
      [EDIT_ORIGINAL_TRANSLATE_ATTR]: "3px 4px",
    });
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("13px 4px");
    el.remove();
  });

  it("counts and applies multiple marked elements", () => {
    const a = makeElement({ "data-x": "1", [EDIT_BASE_X_ATTR]: "0" });
    const b = makeElement({ "data-y": "2", [EDIT_BASE_Y_ATTR]: "0" });
    expect(applyPositionEdits(document)).toBe(2);
    a.remove();
    b.remove();
  });

  it("skips re-apply when the written translate was consumed externally (GSAP fold)", () => {
    const el = makeElement({
      "data-x": "10",
      "data-y": "20",
      [EDIT_BASE_X_ATTR]: "0",
      [EDIT_BASE_Y_ATTR]: "0",
    });
    applyPositionEdits(document);
    expect(el.style.getPropertyValue("translate")).toBe("10px 20px");
    // GSAP folding the translate into its cached transform writes "none".
    el.style.setProperty("translate", "none");
    applyPositionEdits(document);
    // Re-setting would double the offset on non-animated axes — must skip.
    expect(el.style.getPropertyValue("translate")).toBe("none");
    el.remove();
  });

  it("force re-applies over a clobbered translate (editor commit path)", () => {
    const el = makeElement({
      "data-x": "10",
      "data-y": "20",
      [EDIT_BASE_X_ATTR]: "0",
      [EDIT_BASE_Y_ATTR]: "0",
    });
    applyPositionEditToElement(el);
    // A drag draft overwrites the translate; the commit must recompute.
    el.style.setProperty("translate", "999px 999px");
    el.setAttribute("data-x", "30");
    applyPositionEditToElement(el, { force: true });
    expect(el.style.getPropertyValue("translate")).toBe("30px 20px");
    el.remove();
  });
});
