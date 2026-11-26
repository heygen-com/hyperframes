import { describe, expect, it } from "vitest";
import type { GestureState } from "./domEditOverlayGestures";
import { resizeRemainderShift } from "./domEditResizeLocal";
import { resizeAnchor } from "./resizeDraft";

const gesture = (resizeGrow?: GestureState["resizeGrow"]) =>
  ({
    actualWidth: 240,
    actualHeight: 160,
    editScaleX: 0.5,
    editScaleY: 0.5,
    ...{ contentScaleX: 1, contentScaleY: 1 },
    ...{ actualRotation: 0, centerX: 0, centerY: 0, startX: 60, startY: 40 },
    resizeGrow,
  }) as GestureState;
const written = { width: 340, height: 220 };

describe("a sealed resize's centre pin", () => {
  it("takes back only as much as the frame measured the centre moving", () => {
    const plain = resizeAnchor(gesture({ a: 0.25, b: 0, c: 0, d: 0.25 }), written);
    expect(plain).toEqual({ dx: -25, dy: -15 });
    const centred = resizeAnchor(gesture({ a: 0, b: 0, c: 0, d: 0 }), written);
    expect([centred.dx, centred.dy].map(Math.abs)).toEqual([0, 0]);
  });

  it("pins half the growth when the frame did not measure it", () => {
    expect(resizeAnchor(gesture(), written)).toEqual({ dx: -25, dy: -15 });
  });
});

// fails without the fix: the sealed pin ignored the wanted size, so the grabbed corner sat up to half a px short of the
// pointer where an unsealed draft, which measures the corners, shifts the box by half the rounding remainder.
// A box drawn 1.5x on screen, all of it Studio's zoom or most of it the element's own scale.
it.each([
  [1.5, 1],
  [0.5, 3],
])("moves a sealed box by the same rounding remainder an unsealed draft measures", (edit, own) => {
  const angle = 30 * (Math.PI / 180);
  const g = {
    ...gesture(),
    ...{ actualWidth: 300, actualHeight: 150, editScaleX: edit, editScaleY: edit },
    ...{ contentScaleX: own, contentScaleY: own },
    ...{ actualRotation: 30, centerX: 400, centerY: 300, startX: 680, startY: 500 },
  } as GestureState;
  const sizes = { wanted: { width: 300.6, height: 150.3 }, written: { width: 301, height: 150 } };
  const at = (u: number, v: number) => ({
    x: 400 + 1.5 * (u * Math.cos(angle) - v * Math.sin(angle)),
    y: 300 + 1.5 * (u * Math.sin(angle) + v * Math.cos(angle)),
  });
  const [w, h] = [301 / 2, 150 / 2];
  const measured = { nw: at(-w, -h), ne: at(w, -h), sw: at(-w, h), se: at(w, h) };
  const unsealed = resizeRemainderShift(measured, { x: 280, y: 200 }, sizes);
  const pinned = resizeAnchor(g, sizes.written, sizes.wanted);
  const plain = resizeAnchor(g, sizes.written);
  expect(Math.hypot(unsealed.x, unsealed.y)).toBeGreaterThan(0.1);
  expect(Math.abs(pinned.dx - plain.dx - unsealed.x)).toBeLessThan(0.07);
  expect(Math.abs(pinned.dy - plain.dy - unsealed.y)).toBeLessThan(0.07);
});
