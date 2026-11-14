import { afterEach, describe, expect, it, vi } from "vitest";
import { gestureStart } from "./editingGestureStart";
import { handleFor } from "./editingHandles";

type Tween = { vars: Record<string, unknown>; targets: () => unknown[]; duration: () => number };

afterEach(() => {
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "gsap");
  Reflect.deleteProperty(window, "__timelines");
});

/** Each translate axis as the sum of its px terms (the test DOM keeps a calc() unsimplified). */
const translatePx = (element: HTMLElement) =>
  element.style.translate
    .split(/ (?![^(]*\))/)
    .map((axis) =>
      [...axis.matchAll(/-?[\d.]+px/g)].reduce((sum, [px]) => sum + parseFloat(px), 0),
    );

function boxed(element: Element, [x, y, width, height]: number[]): void {
  element.getBoundingClientRect = () =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }) as DOMRect;
}

/** An element under a parent turned a quarter and drawn at half size: translate x goes down, y goes left. */
function turnedCard(style: string): HTMLElement {
  document.body.innerHTML = `<main data-composition-id="main"><div id="card" style="${style}"></div></main>`;
  const card = document.getElementById("card")!;
  Object.defineProperty(card, "offsetWidth", { value: 200 });
  Object.defineProperty(card, "offsetHeight", { value: 100 });
  card.getBoundingClientRect = () => {
    const [tx = 0, ty = 0] = translatePx(card);
    const [cx, cy] = [500 - ty / 2, 300 + tx / 2];
    return {
      x: cx - 25,
      y: cy - 50,
      width: 50,
      height: 100,
      left: cx - 25,
      top: cy - 50,
    } as DOMRect;
  };
  return card;
}

function gsapWith(tweens: Tween[], position = { x: 200, y: 5 }) {
  const getProperty = vi.fn((_: Element, axis: string) => position[axis as "x" | "y"]);
  Object.assign(window, {
    gsap: { getProperty },
    __timelines: { main: { getChildren: () => tweens } },
  });
  return getProperty;
}

const tween = (target: unknown, vars: Record<string, unknown>, duration = 0): Tween => ({
  vars,
  targets: () => [target],
  duration: () => duration,
});

describe("gesture start", () => {
  it("reads a GSAP-held element's x/y, its layout size and how it moves, and puts its translate back", () => {
    const card = turnedCard("translate: 10px 20px");
    Object.assign(card, { _gsap: { renderTransform: () => {} } });
    gsapWith([]);
    const { elements } = gestureStart([handleFor(card)]);
    expect(elements[0]).toMatchObject({
      layout: { width: 200, height: 100 },
      move: { a: 0, b: 0.5, c: -0.5, d: 0 },
      gsap: { x: 200, y: 5, moving: false },
      rect: { x: 465, y: 255, width: 50, height: 100 },
    });
    expect(card.getAttribute("style")).toBe("translate: 10px 20px;");
  });

  it("leaves GSAP out of an element it does not move, without asking it for x", () => {
    const card = turnedCard("");
    const getProperty = gsapWith([tween(document.body, { x: 10 }, 1)]);
    const [start] = gestureStart([handleFor(card)]).elements;
    expect(start!.gsap).toBeNull();
    expect(getProperty).not.toHaveBeenCalled();
    expect(card.getAttribute("style")).toBe("");
  });

  it.each<[string, (card: HTMLElement) => Tween, boolean]>([
    ["a hold at its x", (card) => tween(card, { x: 40 }), false],
    [
      "a tween along keyframes, named by id",
      () => tween({ id: "card" }, { keyframes: [{ y: 1 }] }, 2),
      true,
    ],
    ["a motion path", (card) => tween(card, { motionPath: { path: "M0 0" } }, 2), true],
  ])("owns its position through %s", (_name, make, moving) => {
    const card = turnedCard("");
    gsapWith([make(card), tween(card, { opacity: 0 }, 3)]);
    expect(gestureStart([handleFor(card)]).elements[0]!.gsap).toEqual({ x: 200, y: 5, moving });
  });

  it("does not own a box that only fades", () => {
    const card = turnedCard("");
    gsapWith([tween(card, { opacity: 0, keyframes: { "50%": { scale: 2 } } }, 3)]);
    expect(gestureStart([handleFor(card)]).elements[0]!.gsap).toBeNull();
  });

  it("says it cannot measure a move for an element with no box", () => {
    const card = turnedCard("");
    boxed(card, [0, 0, 0, 0]);
    expect(gestureStart([handleFor(card)]).elements[0]!.move).toBeNull();
  });

  it("lists the boxes a move can snap to: rendered, not pressed, not inside a nested composition", () => {
    document.body.innerHTML = `
      <main data-composition-id="main">
        <div id="a"><b id="a1"></b></div>
        <div id="pressed"><b id="inside"></b></div>
        <div id="hidden" style="display: none"><b id="under"></b></div>
        <div id="nested" data-composition-id="sub"><b id="sub1"></b></div>
        <script></script>
        <div id="z"></div>
      </main>`;
    const ids = ["a", "a1", "pressed", "inside", "under", "sub1", "z"];
    ids.forEach((id, i) => boxed(document.getElementById(id)!, [i * 10, 0, 5, 5]));
    const pressed = document.getElementById("pressed")!;
    const { snap } = gestureStart([handleFor(pressed), "0123456789abcdef:999"]);
    expect(snap.map((box) => box.rect.x)).toEqual([0, 10, 60]);
  });

  it("answers null for an element this load does not have", () => {
    expect(gestureStart(["0123456789abcdef:999"]).elements).toEqual([null]);
  });
});
