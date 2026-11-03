import { describe, expect, it } from "vitest";
import { readMoverFrames } from "./frames";
import { IDENTITY, translate } from "./pose";

/** Fixed layout for jsdom: an element's offset box and its client rect. */
function laidOut(el: HTMLElement, w: number, h: number, rect: [number, number, number, number]) {
  Object.defineProperty(el, "offsetWidth", { value: w, configurable: true });
  Object.defineProperty(el, "offsetHeight", { value: h, configurable: true });
  const [left, top, right, bottom] = rect;
  el.getBoundingClientRect = () =>
    ({ left, top, right, bottom, width: right - left, height: bottom - top }) as DOMRect;
}

describe("readMoverFrames", () => {
  // A wordmark in a 540 px box whose one-line text runs to 1528 px: the box is the layout, the
  // text is the picture. Cropping to the box drew "HyperFra" for "HyperFrames Studio".
  it("sizes the redraw to content that overflows the mover's box", () => {
    const scene = document.createElement("div");
    const brand = document.createElement("div");
    const word = document.createElement("div");
    brand.append(word);
    scene.append(brand);
    document.body.append(scene);
    laidOut(scene, 1920, 1080, [0, 0, 1920, 1080]);
    laidOut(brand, 540, 240, [100, 50, 640, 290]);
    laidOut(word, 1528, 240, [100, 50, 1628, 290]);
    const pose = translate(IDENTITY, 100, 50);
    const reader = { pose: () => pose, reset: () => {} };
    let x = 0;
    const { frames } = readMoverFrames({
      movers: [brand],
      reader: reader as never,
      seek: (t) => {
        x = t;
      },
      t: 0.5,
      reads: 2,
      shutterSeconds: 1 / 45,
      taps: 4,
      frameW: 1920,
      frameH: 1080,
      scene,
    });
    expect(x).toBe(0.5);
    expect(frames[0]?.w).toBeGreaterThanOrEqual(1528);
    expect(frames[0]?.h).toBeGreaterThanOrEqual(240);
    document.body.innerHTML = "";
  });

  it("keeps the box as it is when its content stays inside", () => {
    const scene = document.createElement("div");
    const box = document.createElement("div");
    const child = document.createElement("span");
    box.append(child);
    scene.append(box);
    document.body.append(scene);
    laidOut(scene, 1920, 1080, [0, 0, 1920, 1080]);
    laidOut(box, 200, 100, [10, 10, 210, 110]);
    laidOut(child, 50, 20, [20, 20, 70, 40]);
    const pose = translate(IDENTITY, 10, 10);
    const { frames } = readMoverFrames({
      movers: [box],
      reader: { pose: () => pose, reset: () => {} } as never,
      seek: () => {},
      t: 0.5,
      reads: 2,
      shutterSeconds: 1 / 45,
      taps: 4,
      frameW: 1920,
      frameH: 1080,
      scene,
    });
    expect(frames[0]).toMatchObject({ w: 200, h: 100, now: pose });
    document.body.innerHTML = "";
  });
});
