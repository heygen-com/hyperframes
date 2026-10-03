// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { pressIsLayers, pressSelectedLayer } from "./motionPathLayerNode";

// Keyframe nodes at x 60 and 120 (y 30), drawn from home (500, 400); dots of radius 6.
const atLayer = { x: 60, y: 30, ax: 560, ay: 430 };
const other = { x: 120, y: 30, ax: 620, ay: 430 };
const live = { x: 60, y: 30 };

const box = document.createElement("div");
box.setAttribute("data-dom-edit-selection-box", "true");
const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
document.body.append(box, circle);

/** A press on `circle` at (x, y), with `under` what the document hit-tests there. */
function press(x: number, y: number, under: Element[]) {
  vi.spyOn(document, "elementsFromPoint").mockReturnValue([circle, ...under]);
  return { currentTarget: circle, clientX: x, clientY: y } as unknown as React.PointerEvent;
}

afterEach(() => vi.restoreAllMocks());

it("the node GSAP renders the layer at is the layer, inside the box or out", () => {
  expect(pressIsLayers(press(562, 431, [box]), { x: 562, y: 431 }, atLayer, 6, live)).toBe(true);
  expect(pressIsLayers(press(570, 440, []), { x: 570, y: 440 }, atLayer, 6, live)).toBe(true);
});

it("inside the layer's box another node's grab ring is the layer's; its dot stays the node's", () => {
  expect(pressIsLayers(press(610, 430, [box]), { x: 610, y: 430 }, other, 6, live)).toBe(true);
  expect(pressIsLayers(press(617, 430, [box]), { x: 617, y: 430 }, other, 6, live)).toBe(false);
});

it("outside the layer's box a node's whole grab ring is the node's", () => {
  expect(pressIsLayers(press(610, 430, []), { x: 610, y: 430 }, other, 6, live)).toBe(false);
  expect(pressIsLayers(press(610, 430, [box]), { x: 610, y: 430 }, other, 6, null)).toBe(true);
});

it("hands a press to the selected layer's box with its pointer and position", () => {
  const got: number[][] = [];
  const listen = (e: Event) => {
    const p = e as PointerEvent;
    got.push([p.pointerId, p.clientX, p.clientY, p.button]);
  };
  box.addEventListener("pointerdown", listen);
  const nativeEvent = new PointerEvent("pointerdown", {
    pointerId: 7,
    clientX: 12,
    clientY: 34,
    button: 0,
    bubbles: true,
  });
  const down = { currentTarget: circle, nativeEvent } as unknown as React.PointerEvent;
  expect(pressSelectedLayer(down)).toBe(true);
  expect(got).toEqual([[7, 12, 34, 0]]);
  box.removeEventListener("pointerdown", listen);
  box.remove();
  expect(pressSelectedLayer(down)).toBe(false);
  document.body.append(box);
});
