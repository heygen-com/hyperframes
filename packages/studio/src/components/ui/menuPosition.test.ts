// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { menuAnchor, placeMenu, pointAnchor } from "./menuPosition";

const view = { width: 900, height: 600 };
const size = { width: 200, height: 150 };

describe("placeMenu", () => {
  it("opens below its anchor when it fits", () => {
    expect(placeMenu({ left: 10, top: 100, bottom: 124 }, size, view)).toEqual({
      left: 10,
      top: 124,
    });
  });

  it("opens above an anchor near the window's bottom, its bottom at the anchor's top", () => {
    const anchor = { left: 10, top: 540, bottom: 564 };
    const { top } = placeMenu(anchor, size, view);
    expect(top).toBe(390);
    expect(top + size.height).toBeLessThanOrEqual(anchor.top);
  });

  it("flips above a pointer near the window's bottom instead of sliding over it", () => {
    expect(placeMenu(pointAnchor(10, 550), size, view).top).toBe(400);
  });

  it("clamps inside the window only when it fits neither below nor above", () => {
    expect(placeMenu(pointAnchor(10, 100), { width: 200, height: 550 }, view).top).toBe(42);
    expect(placeMenu(pointAnchor(10, 100), { width: 200, height: 700 }, view).top).toBe(8);
  });

  it("opens leftward when it would cross the window's right edge", () => {
    expect(placeMenu(pointAnchor(800, 10), size, view).left).toBe(600);
  });
});

describe("menuAnchor", () => {
  it("is the box of the pressed element's data-menu-anchor ancestor", () => {
    const button = document.createElement("button");
    button.setAttribute("data-menu-anchor", "");
    const icon = document.createElement("span");
    button.appendChild(icon);
    const box = { left: 30, top: 540, bottom: 564 } as DOMRect;
    button.getBoundingClientRect = () => box;
    expect(menuAnchor(icon, 35, 550)).toBe(box);
  });

  it("is the pointer's point without one", () => {
    expect(menuAnchor(document.createElement("div"), 35, 550)).toEqual(pointAnchor(35, 550));
    expect(menuAnchor(null, 35, 550)).toEqual(pointAnchor(35, 550));
  });
});
