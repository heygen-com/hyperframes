import { afterEach, describe, expect, it, vi } from "vitest";
import { gestureBase, gestureStart, withoutGsapTakeover } from "./editingGestureStart";
import { handleFor } from "./editingHandles";

type Tween = { vars: Record<string, unknown>; targets: () => unknown[]; duration: () => number };

afterEach(() => {
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "gsap");
  Reflect.deleteProperty(window, "__timelines");
  Reflect.deleteProperty(window, "DOMMatrix");
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

function gsapWith(tweens: Tween[], position: Record<string, number> = { x: 200, y: 5 }) {
  const getProperty = vi.fn((_: Element, axis: string) => position[axis]);
  Object.assign(window, {
    gsap: { getProperty },
    __timelines: { main: { getChildren: () => tweens } },
  });
  return getProperty;
}

const GSAP_RENDERS = { _gsap: { renderTransform: () => {} } };

/** jsdom has no DOMMatrix: a 2D one reading `matrix(...)` and composing as the browser's does. */
class Matrix2D {
  a = 1;
  m13 = 0;
  m23 = 0;
  m14 = 0;
  m24 = 0;
  m44 = 1;
  b = 0;
  c = 0;
  d = 1;
  constructor(init?: string) {
    const m = init ? /matrix\(([^)]+)\)/.exec(init) : null;
    if (m) [this.a, this.b, this.c, this.d] = m[1]!.split(",").map(Number);
  }
  multiply(o: Matrix2D) {
    const out = new Matrix2D();
    [out.a, out.b] = [this.a * o.a + this.c * o.b, this.b * o.a + this.d * o.b];
    [out.c, out.d] = [this.a * o.c + this.c * o.d, this.b * o.c + this.d * o.d];
    return out;
  }
}

const tween = (target: unknown, vars: Record<string, unknown>, duration = 0): Tween => ({
  vars,
  targets: () => [target],
  duration: () => duration,
});

/** A 200x100 box whose centre moves `share` of its drawn growth: 0.5 from its corner, 0 self-centred. */
function growingCard(share: number | (() => number)): HTMLElement {
  document.body.innerHTML = `<main data-composition-id="main"><div id="card" style="width: 200px"></div></main>`;
  const card = document.getElementById("card")!;
  Object.defineProperty(card, "offsetWidth", { value: 200 });
  Object.defineProperty(card, "offsetHeight", { value: 100 });
  card.getBoundingClientRect = () => {
    const width = parseFloat(card.style.width) || 200;
    const height = parseFloat(card.style.height) || 100;
    const k = typeof share === "number" ? share : share();
    const [cx, cy] = [200 + (width - 200) * k, 100 + (height - 100) * k];
    const [x, y] = [cx - width / 2, cy - height / 2];
    return {
      x,
      y,
      width,
      height,
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
    } as DOMRect;
  };
  return card;
}

describe("gesture start", () => {
  it("says how far a box's centre moves as its drawn size grows, and puts its size back", () => {
    const plain = growingCard(0.5);
    expect(gestureStart([handleFor(plain)]).elements[0]!.grow).toEqual({
      a: 0.5,
      b: 0,
      c: 0,
      d: 0.5,
    });
    expect(plain.getAttribute("style")).toBe("width: 200px;");
    const centred = growingCard(0);
    expect(gestureStart([handleFor(centred)]).elements[0]!.grow).toEqual({
      a: 0,
      b: 0,
      c: 0,
      d: 0,
    });
  });
  // fails without the fix: the probe grew a `translate: -50%` box with its % live and read 0, but the draft that pins
  // a sealed resize turns that % into px, so the box grew from its corner and drifted half its growth from the pointer.
  it("measures a %-translated box's growth as the draft draws it, its % turned into px", () => {
    // Its centre stays put while the % is live, and moves half its growth once the % is px.
    const card = growingCard(() =>
      card.style.getPropertyValue("translate").includes("%") ? 0 : 0.5,
    );
    card.style.setProperty("translate", "-50% -50%");
    expect(gestureStart([handleFor(card)]).elements[0]!.grow).toEqual({
      a: 0.5,
      b: 0,
      c: 0,
      d: 0.5,
    });
    expect(card.getAttribute("style")).toBe("width: 200px; translate: -50% -50%;");
  });
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

  // fails without the fix: a sealed resize handed to GSAP started a layer GSAP does not move at x/y 0, 0.
  it("reads GSAP's x/y for an element it does not move, without GSAP taking it over", () => {
    const card = turnedCard("");
    gsapWith([tween(document.body, { x: 10 }, 1)], { x: 40, y: 30 });
    const [start] = gestureStart([handleFor(card)]).elements;
    expect(start!.gsap).toBeNull();
    expect(start!.gsapAt).toEqual({ x: 40, y: 30 });
    expect(card.getAttribute("style")).toBe("");
    expect("_gsap" in card).toBe(false);
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
    expect(gestureStart([handleFor(card)]).elements[0]!.gsap).toEqual({
      x: 200,
      y: 5,
      moving,
      drawsTranslate: true,
    });
  });

  // fails without the fix: a sealed rotate never learned GSAP turns the element, so it saved a CSS rotate.
  it.each<[string, (card: HTMLElement) => Tween[], number | null]>([
    ["a spin tween", (card) => [tween(card, { rotation: 20 }, 2)], 12],
    ["keyframes that turn it", (card) => [tween(card, { keyframes: [{ rotate: 5 }] }, 2)], 12],
    ["a transform GSAP renders", (card) => (Object.assign(card, GSAP_RENDERS), []), 12],
    ["nothing GSAP does: its own CSS turns it", (card) => [tween(card, { opacity: 0 }, 2)], null],
  ])("says how far GSAP turns it, through %s", (_name, make, turn) => {
    const card = turnedCard("");
    const getProperty = gsapWith(make(card), { x: 0, y: 0, rotation: 12 });
    expect(gestureStart([handleFor(card)]).elements[0]!.gsapRotation).toBe(turn);
    expect(getProperty.mock.calls.some(([, name]) => name === "rotation")).toBe(turn !== null);
  });

  // fails without the fix: a sealed stand-in has no stylesheet, so a rotate started at 0 instead of 30.
  it("reads the CSS turn a layer GSAP does not turn shows, for a stand-in that cannot", () => {
    Object.assign(window, { DOMMatrix: Matrix2D });
    const card = turnedCard("transform: matrix(0.866025, 0.5, -0.5, 0.866025, 0, 0)");
    gsapWith([tween(card, { opacity: 0 }, 2)]);
    const { cssRotation } = gestureStart([handleFor(card)]).elements[0]!;
    expect(cssRotation!.angle).toBeCloseTo(30, 3);
    expect(cssRotation!.target).toMatchObject({ property: "transform", before: "" });
    gsapWith([tween(card, { rotation: 20 }, 2)], { x: 0, y: 0, rotation: 12 });
    expect(gestureStart([handleFor(card)]).elements[0]!.cssRotation).toBeNull();
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

  // fails without the fix: a sealed crop drew on the stand-in, which has no turn or scale of its own.
  it("says the turn and scale an element paints under, its own with its parent's", () => {
    Object.assign(window, { DOMMatrix: Matrix2D });
    document.body.innerHTML = `<main data-composition-id="main" style="transform: matrix(0, 1, -1, 0, 0, 0)"><div id="card" style="transform: matrix(1.5, 0, 0, 1.5, 40, 30)"></div></main>`;
    const card = document.getElementById("card")!;
    boxed(card, [0, 0, 10, 10]);
    const { elements } = gestureStart([handleFor(card)]);
    expect(elements[0]?.planar).toEqual({ a: 0, b: 1.5, c: -1.5, d: 0 });
  });

  it("answers null for an element this load does not have", () => {
    expect(gestureStart(["0123456789abcdef:999"]).elements).toEqual([null]);
  });
});

// fails without the fix: a sealed recording had no read for a layer no tween touches, so it started a static
// opacity and scale at 1 where the unsealed recorder reads them from GSAP.
describe("gestureBase", () => {
  it("reads GSAP's x, y, opacity and scale for a layer no tween touches", () => {
    const card = turnedCard("");
    gsapWith([], { x: 12, y: -4, opacity: 0.5, scaleX: 1.5 });
    expect(gestureBase(handleFor(card))).toEqual({
      x: 12,
      y: -4,
      opacity: 0.5,
      scale: 1.5,
      drawsProps: true,
    });
  });

  // fails without the fix: a page without GSAP answered null, so a sealed recording refused to start where the
  // unsealed recorder starts from x 0, y 0, opacity 1 and scale 1.
  it("answers the values at rest on a page without GSAP, as the unsealed recorder starts", () => {
    const card = turnedCard("");
    expect(gestureBase(handleFor(card))).toEqual({ x: 0, y: 0, opacity: 1, scale: 1 });
  });

  it("answers null for an element this load does not have", () => {
    gsapWith([]);
    expect(gestureBase("0123456789abcdef:999")).toBeNull();
    Reflect.deleteProperty(window, "gsap");
    expect(gestureBase("0123456789abcdef:999")).toBeNull();
  });
});

describe("withoutGsapTakeover", () => {
  type Cached = { _gsap?: Record<string, unknown> };

  it("puts back the attributes and GSAP cache a read changes on an element GSAP does not draw", () => {
    document.body.innerHTML = `<h1 id="title" style="translate: 0 -200px">Title</h1>`;
    const title = document.getElementById("title")! as HTMLElement & Cached;
    const origin = { x: 1 };
    title._gsap = { x: 0, origin };
    const value = withoutGsapTakeover(title, () => {
      title.style.translate = "none";
      title.setAttribute("data-svg-origin", "10 20");
      Object.assign(title._gsap!, { x: -200, renderTransform: () => {} });
      origin.x = 99;
      return 7;
    });
    expect(value).toBe(7);
    expect(title.getAttribute("style")).toBe("translate: 0 -200px");
    expect(title.hasAttribute("data-svg-origin")).toBe(false);
    expect(title._gsap).toEqual({ x: 0, origin: { x: 1 } });
    expect(title._gsap!.origin).toBe(origin);
  });

  it("puts back what a read changed when the read throws", () => {
    document.body.innerHTML = `<h1 id="title" style="translate: 0 -200px">Title</h1>`;
    const title = document.getElementById("title")! as HTMLElement & Cached;
    title._gsap = { x: 0 };
    expect(() =>
      withoutGsapTakeover(title, () => {
        title.style.translate = "none";
        title._gsap!.renderTransform = () => {};
        throw new Error("GSAP failed");
      }),
    ).toThrow("GSAP failed");
    expect(title.getAttribute("style")).toBe("translate: 0 -200px");
    expect(title._gsap).toEqual({ x: 0 });
  });

  it("drops a GSAP cache the read created", () => {
    document.body.innerHTML = `<h1 id="title">Title</h1>`;
    const title = document.getElementById("title")! as HTMLElement & Cached;
    withoutGsapTakeover(title, () => (title._gsap = { renderTransform: () => {} }));
    expect("_gsap" in title).toBe(false);
  });

  it("leaves an element GSAP already draws to GSAP", () => {
    document.body.innerHTML = `<h1 id="title">Title</h1>`;
    const title = document.getElementById("title")! as HTMLElement & Cached;
    const renderTransform = () => {};
    title._gsap = { renderTransform };
    withoutGsapTakeover(title, () => title.setAttribute("style", "transform: scale(2)"));
    expect(title.getAttribute("style")).toBe("transform: scale(2)");
  });
});
