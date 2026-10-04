// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { pressBelongsToLayer, pressSelectedLayer } from "./motionPathLayerNode";

// Keyframe nodes at x 60 and 120 (y 30); GSAP renders the layer at the first.
const atLayer = { x: 60, y: 30 };
const other = { x: 120, y: 30 };
const live = { x: 60, y: 30 };

const box = document.createElement("div");
box.setAttribute("data-dom-edit-selection-box", "true");
const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
document.body.append(box, circle);

/** A press on `circle`, with `under` what the document hit-tests there. */
function press(under: Element[]) {
  document.elementsFromPoint = () => [circle, ...under];
  return { currentTarget: circle, clientX: 0, clientY: 0 } as unknown as React.PointerEvent;
}

it("the node GSAP renders the layer at is the layer, inside the box or out", () => {
  expect(pressBelongsToLayer(press([box]), atLayer, live)).toBe(true);
  expect(pressBelongsToLayer(press([]), atLayer, live)).toBe(true);
});

it("inside the layer's box any other node is the layer's, so a drag from its middle moves it", () => {
  expect(pressBelongsToLayer(press([box]), other, live)).toBe(true);
  expect(pressBelongsToLayer(press([box]), other, null)).toBe(true);
});

it("outside the layer's box a node is the node's", () => {
  expect(pressBelongsToLayer(press([]), other, live)).toBe(false);
});

it("hands a press to the selected layer's box with its pointer and position", () => {
  const got: number[][] = [];
  const listen = (e: Event) => {
    const p = e as PointerEvent;
    got.push([p.pointerId, p.clientX, p.clientY, p.button]);
    e.preventDefault();
  };
  box.addEventListener("pointerdown", listen);
  const nativeEvent = new PointerEvent("pointerdown", {
    pointerId: 7,
    clientX: 12,
    clientY: 34,
    button: 0,
    bubbles: true,
    cancelable: true,
  });
  const down = { currentTarget: circle, nativeEvent } as unknown as React.PointerEvent;
  expect(pressSelectedLayer(down)).toBe(true);
  expect(got).toEqual([[7, 12, 34, 0]]);
  box.removeEventListener("pointerdown", listen);
  box.remove();
  expect(pressSelectedLayer(down)).toBe(false);
  document.body.append(box);
});

it("keeps the press when the box does not start a gesture with it, or takes no pointer", () => {
  let got = 0;
  const listen = () => void got++;
  box.addEventListener("pointerdown", listen);
  const nativeEvent = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
  const down = { currentTarget: circle, nativeEvent } as unknown as React.PointerEvent;
  expect(pressSelectedLayer(down)).toBe(false);
  expect(got).toBe(1);
  box.style.pointerEvents = "none";
  expect(pressSelectedLayer(down)).toBe(false);
  expect(got).toBe(1);
  box.style.pointerEvents = "";
  box.removeEventListener("pointerdown", listen);
});
