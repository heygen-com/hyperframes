import { afterEach, describe, expect, it } from "vitest";
import { elementHome, motionPathHome, transformWDivisor } from "./motionPathHome";

afterEach(() => {
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "MotionPathPlugin");
});

function define(el: HTMLElement, props: Record<string, unknown>) {
  for (const [key, value] of Object.entries(props)) Object.defineProperty(el, key, { value });
}

/** A 100x50 layer inside a wrapper inside the composition root; jsdom lays out nothing, so the box is given by hand. */
function layer(wrapperTransform: string) {
  document.body.innerHTML = `<div data-composition-id="main"><div id="wrap"><div id="box"></div></div></div>`;
  const root = document.querySelector<HTMLElement>("[data-composition-id]")!;
  const wrap = document.getElementById("wrap")!;
  const box = document.getElementById("box")!;
  wrap.style.transform = wrapperTransform;
  define(box, {
    offsetLeft: 10,
    offsetTop: 20,
    offsetWidth: 100,
    offsetHeight: 50,
    offsetParent: wrap,
  });
  define(wrap, { offsetLeft: 0, offsetTop: 0, offsetParent: root });
  return box;
}

describe("elementHome", () => {
  it.each([
    ["no transform", "none", 60, 45],
    ["a 2D matrix", "matrix(1, 0, 0, 1, 30, 40)", 90, 85],
    ["a 3D matrix", "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 50, 60, 0, 1)", 110, 105],
  ])("adds a wrapper's translate from %s", (_name, transform, x, y) => {
    const home = elementHome(layer(transform));

    expect({ x: home.x, y: home.y, w: home.w, h: home.h }).toEqual({ x, y, w: 100, h: 50 });
  });
});

describe("transformWDivisor", () => {
  it("is the element's own m44, and 1 without a 3D transform", () => {
    const box = layer("none");
    expect(transformWDivisor(box)).toBe(1);
    box.style.transform = "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2)";
    expect(transformWDivisor(box)).toBe(2);
  });
});

describe("motionPathHome", () => {
  it("answers no home for a selector that matches nothing", () => {
    expect(motionPathHome("#missing")).toEqual({
      home: null,
      perspective: 1,
      visible: true,
      plugin: false,
    });
  });

  it("answers the first match's home and whether the frame loaded MotionPathPlugin", () => {
    layer("none");
    Object.assign(window, { MotionPathPlugin: {} });

    const answer = motionPathHome("#box");

    expect(answer.plugin).toBe(true);
    expect(answer.home).toMatchObject({ x: 60, y: 45, w: 100, h: 50 });
    expect(answer.perspective).toBe(1);
  });
});
