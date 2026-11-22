import { afterEach, describe, expect, it } from "vitest";
import { drawDrafts } from "./editingDraft";
import { handleFor } from "./editingHandles";

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as { gsap?: unknown }).gsap;
});

function card(style: string): { element: HTMLElement; handle: string } {
  document.body.innerHTML = `<div id="card" style="${style}"></div>`;
  const element = document.getElementById("card")!;
  return { element, handle: handleFor(element) };
}

// The test DOM keeps a calc() unsimplified, so each axis is read back as the sum of its px terms.
const shown = (element: HTMLElement) =>
  element.style.translate
    .split(/ (?![^(]*\))/)
    .map((axis) =>
      [...axis.matchAll(/-?[\d.]+px/g)].reduce((sum, [px]) => sum + parseFloat(px), 0),
    );

// fails without the fix: a sealed frame never turned the element a rotate gesture drew.
describe("rotation drafts", () => {
  const turned = (element: HTMLElement) => element.style.getPropertyValue("rotate");

  it("turns by the rotate property, leaves the turn to drafts that don't name it, and takes back only it", () => {
    const { element, handle } = card("rotate: 5deg; width: 50px");
    const moved = { handle, translate: { x: 5, y: 0 }, size: null };
    drawDrafts([{ ...moved, rotate: { angle: 30, route: "css" } }]);
    expect(turned(element)).toBe("30deg");
    drawDrafts([moved]);
    expect(turned(element)).toBe("30deg");
    drawDrafts([{ ...moved, rotate: null }]);
    expect([turned(element), shown(element)]).toEqual(["5deg", [5, 0]]);
    drawDrafts([
      { ...moved, rotate: { angle: 45, route: "css" } },
      { handle, end: "keep" },
    ]);
    expect([turned(element), shown(element)]).toEqual(["45deg", [5, 0]]);
  });

  it("turns inside a translating transform and puts the transform back on a cancel", () => {
    const { element, handle } = card("transform: translate(-50%, -50%); width: 50px");
    const value = "translate(-50%, -50%) rotate(20deg)";
    drawDrafts([
      { handle, translate: null, size: null, rotate: { angle: 20, route: "transform", value } },
    ]);
    expect(element.style.transform).toBe(value);
    drawDrafts([{ handle, end: "restore" }]);
    expect(element.style.transform).toBe("translate(-50%, -50%)");
  });

  it("turns by the frame's own GSAP and puts its rotation back on a cancel", () => {
    const { element, handle } = card("width: 50px");
    const rotation = new Map<Element, number>([[element, 12]]);
    (window as { gsap?: unknown }).gsap = {
      getProperty: (el: Element) => rotation.get(el) ?? 0,
      set: (el: Element, props: { rotation: number }) => rotation.set(el, props.rotation),
    };
    drawDrafts([{ handle, translate: null, size: null, rotate: { angle: 40, route: "gsap" } }]);
    expect([rotation.get(element), turned(element)]).toEqual([40, "none"]);
    drawDrafts([{ handle, end: "restore" }]);
    expect([rotation.get(element), turned(element)]).toEqual([12, ""]);
  });
});

describe("drafts", () => {
  it("adds a drag to the translate the element had, and restores it on a cancel", () => {
    const { element, handle } = card("translate: 10px 20px; width: 50px");
    expect(drawDrafts([{ handle, translate: { x: 5, y: -4 }, size: null }])).toMatchObject({
      drawn: 1,
    });
    expect(shown(element)).toEqual([15, 16]);
    drawDrafts([{ handle, translate: { x: 30, y: 0 }, size: null }]);
    expect(shown(element)).toEqual([40, 20]);
    drawDrafts([{ handle, end: "restore" }]);
    expect(element.getAttribute("style")).toBe("translate: 10px 20px; width: 50px;");
  });

  it("draws a resize's box and centring shift, and keeps both once the edit is saved", () => {
    const { element, handle } = card("width: 50px; min-width: 40px");
    drawDrafts([{ handle, translate: { x: -25, y: -10 }, size: { width: 100, height: 70 } }]);
    expect(shown(element)).toEqual([-25, -10]);
    expect(element.style.width).toBe("100px");
    expect(element.style.height).toBe("70px");
    expect(element.style.minWidth).toBe("0px");
    expect(element.style.boxSizing).toBe("border-box");
    drawDrafts([{ handle, end: "keep" }]);
    expect(element.style.width).toBe("100px");
    drawDrafts([{ handle, translate: { x: 5, y: 0 }, size: null }]);
    expect(shown(element)).toEqual([-20, -10]);
    expect(element.style.width).toBe("100px");
    drawDrafts([{ handle, translate: null, size: null }]);
    expect(shown(element)).toEqual([-25, -10]);
  });

  it("adds a resize's shift to the px a % translate is at its start, so the new size can't move it", () => {
    const { element, handle } = card("width: 200px; height: 100px; translate: -50% -50%");
    drawDrafts([{ handle, translate: { x: -50, y: 0 }, size: { width: 300, height: 100 } }]);
    expect(shown(element)).toEqual([-150, -50]);
    drawDrafts([{ handle, end: "restore" }]);
    expect(element.style.translate).toBe("-50% -50%");
  });

  it("puts back only the part a draft stops drawing", () => {
    const { element, handle } = card("height: 30px");
    drawDrafts([{ handle, translate: { x: 1, y: 2 }, size: { width: 10, height: 10 } }]);
    drawDrafts([{ handle, translate: { x: 1, y: 2 }, size: null }]);
    expect(element.style.height).toBe("30px");
    expect(element.style.width).toBe("");
    expect(shown(element)).toEqual([1, 2]);
  });

  it("skips a handle this load does not have", () => {
    expect(drawDrafts([{ handle: "0123456789abcdef:999", end: "restore" }])).toEqual({
      drawn: 0,
      drafts: {},
    });
  });
});

// fails without the fix: a sealed resize's end went as {translate:null} then {end:keep}, two frame tasks.
describe("draft ends by number", () => {
  it("answers each draw with its draft's number, the same until the draft ends", () => {
    const { handle } = card("width: 50px");
    const first = drawDrafts([{ handle, translate: { x: 1, y: 0 }, size: null }]).drafts[handle];
    expect(drawDrafts([{ handle, translate: { x: 2, y: 0 }, size: null }]).drafts[handle]).toBe(
      first,
    );
    drawDrafts([{ handle, end: "keep" }]);
    const next = drawDrafts([{ handle, translate: { x: 3, y: 0 }, size: null }]).drafts[handle];
    expect(next).toBeGreaterThan(first!);
  });

  it("keep-size drops the drawn translate and keeps the drawn size in one end", () => {
    const { element, handle } = card("translate: 10px 20px; width: 50px");
    const { drafts } = drawDrafts([
      { handle, translate: { x: 5, y: 5 }, size: { width: 80, height: 40 } },
    ]);

    drawDrafts([{ handle, draft: drafts[handle]!, end: "keep-size" }]);

    expect([element.style.translate, element.style.width, element.style.height]).toEqual([
      "10px 20px",
      "80px",
      "40px",
    ]);
  });

  it("an end for an older draft leaves the newer one drawn and restorable", () => {
    const { element, handle } = card("width: 50px");
    const old = drawDrafts([{ handle, translate: { x: 5, y: 0 }, size: null }]).drafts[handle]!;
    drawDrafts([{ handle, end: "restore" }]);
    drawDrafts([{ handle, translate: { x: 9, y: 0 }, size: null }]);

    drawDrafts([{ handle, draft: old, end: "restore" }]);
    expect(shown(element)).toEqual([9, 0]);
    drawDrafts([{ handle, end: "restore" }]);
    expect(element.style.translate).toBe("");
  });
});
