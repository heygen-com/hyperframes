import { afterEach, describe, expect, it } from "vitest";
import { gsapSet } from "./editing/gsapSet";
import { patchTweens } from "./editing/patchTween";
import { drawDrafts } from "./editingDraft";
import { handleFor } from "./editingHandles";

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
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

  // fails without the fix: a sealed scale resize's cancel of its size draft put back the transform GSAP had at the
  // gesture's start, so the new scale and position GSAP drew were wiped and the box showed off its drop until a reload.
  it("leaves a transform it never drew to GSAP when it puts the rest back", () => {
    const { element, handle } = card("transform: translate(10px, 0px); width: 50px");
    drawDrafts([{ handle, translate: { x: 5, y: 0 }, size: { width: 80, height: 40 } }]);
    element.style.transform = "translate(30px, 0px) scale(1.5, 1.5)";
    drawDrafts([{ handle, end: "restore" }]);
    expect(element.style.transform).toBe("translate(30px, 0px) scale(1.5, 1.5)");
    expect(element.style.width).toBe("50px");
    expect(element.style.translate).toBe("");
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

// fails without the fix: a sealed drag of a GSAP-held layer drew an unrounded CSS translate on top of GSAP's, where an
// open preview gives GSAP the rounded x/y, so the sealed drop point and saved x came out 0.001 px off.
describe("moves through GSAP", () => {
  function gsapHeld() {
    const { element, handle } = card("translate: 4px 2px; width: 50px");
    const position = { x: 40, y: 30 };
    // Like real GSAP, the first read folds the CSS translate into x/y and leaves translate none.
    const gsap = {
      getProperty: (target: HTMLElement, axis: "x" | "y") => {
        if (target.style.translate !== "none") {
          const [x = 0, y = 0] = shown(target);
          Object.assign(position, { x: position.x + x, y: position.y + y });
          target.style.setProperty("translate", "none");
        }
        return position[axis];
      },
      set: (_: Element, props: Partial<typeof position>) => Object.assign(position, props),
    };
    (window as { gsap?: unknown }).gsap = gsap;
    gsap.getProperty(element, "x"); // the press reads GSAP's x/y before any draft draws
    const move = (x: number, y: number) =>
      drawDrafts([{ handle, translate: { x, y, route: "gsap" }, size: null }]);
    return { element, handle, position, move };
  }

  it("draws GSAP's x/y where Studio's drag puts them, with no translate on top", () => {
    const { element, position, move } = gsapHeld();
    move(35, 33);
    move(30, 36);
    expect([position, element.style.translate]).toEqual([{ x: 30, y: 36 }, "none"]);
  });

  it("puts GSAP's x/y and the translate back when the draft is restored", () => {
    const { element, handle, position, move } = gsapHeld();
    move(30, 36);
    drawDrafts([{ handle, end: "restore" }]);
    expect([position, element.style.translate]).toEqual([{ x: 44, y: 32 }, "none"]);
  });

  it("leaves GSAP where the drag drew it when the draft ends keeping its size", () => {
    const { element, handle, position, move } = gsapHeld();
    move(30, 36);
    drawDrafts([{ handle, end: "keep-size" }]);
    expect([position, element.style.translate]).toEqual([{ x: 30, y: 36 }, "none"]);
  });

  // fails without the fix: a sealed resize saved as GSAP x/y over a stylesheet translate drew 50 px off after the
  // drop, because the end put back the press's empty inline translate over the none GSAP's soft reload had set.
  it("keeps the translate GSAP folded off when a soft reload set it before the end", () => {
    document.head.innerHTML = "<style>#card { translate: 40px 30px }</style>";
    const { element, handle } = card("width: 50px");
    (window as { gsap?: unknown }).gsap = { getProperty: () => 0, set: () => {} };
    drawDrafts([{ handle, translate: { x: -50, y: -33 }, size: { width: 80, height: 40 } }]);
    element.style.setProperty("translate", "none");

    drawDrafts([{ handle, end: "keep-size" }]);

    expect([getComputedStyle(element).translate, element.style.width]).toEqual(["none", "80px"]);
  });

  it("puts back a CSS-placed layer's translate when GSAP is loaded but never moved it", () => {
    document.head.innerHTML = "<style>#card { translate: 40px 30px }</style>";
    const { element, handle } = card("width: 50px");
    (window as { gsap?: unknown }).gsap = { getProperty: () => 0, set: () => {} };
    drawDrafts([{ handle, translate: { x: -50, y: -33 }, size: { width: 80, height: 40 } }]);

    drawDrafts([{ handle, end: "keep-size" }]);

    expect([getComputedStyle(element).translate, element.style.width]).toEqual([
      "40px 30px",
      "80px",
    ]);
  });

  it("keeps translate none after a GSAP-route draft when GSAP folded a stylesheet translate", () => {
    document.head.innerHTML = "<style>#card { translate: 40px 30px }</style>";
    const { element, handle } = card("width: 50px");
    const fold = (target: HTMLElement) => target.style.setProperty("translate", "none");
    (window as { gsap?: unknown }).gsap = {
      getProperty: (t: HTMLElement) => (fold(t), 0),
      set: () => {},
    };
    drawDrafts([
      { handle, translate: { x: 10, y: 0, route: "gsap" }, size: { width: 80, height: 40 } },
    ]);

    drawDrafts([{ handle, end: "keep-size" }]);

    expect(getComputedStyle(element).translate).toBe("none");
  });

  // fails without the fix: restore compared GSAP's x/y with the drawn one, so a later set to that same value, or one
  // within 0.001 px, read as the draft's own and was thrown back to where the drag began.
  it.each([
    ["the drawn value", 30],
    ["a value within 0.001 px of it", 30.0005],
  ])(
    "leaves a position set over the port to %s after the draw when the draft is restored",
    (_name, x) => {
      const { handle, position, move } = gsapHeld();
      move(30, 36);
      gsapSet({ handle, props: { x, y: 36 } });
      drawDrafts([{ handle, end: "restore" }]);
      expect(position).toEqual({ x, y: 36 });
    },
  );

  // fails without the fix: a write of x alone also dropped the draft's y, so a restore kept the cancelled drag's y.
  it("puts back only the axis no later write took when the draft is restored", () => {
    const { handle, position, move } = gsapHeld();
    move(30, 36);
    gsapSet({ handle, props: { x: 25 } });
    drawDrafts([{ handle, end: "restore" }]);
    expect(position).toEqual({ x: 25, y: 32 });
  });

  // fails without the fix: the hold dropped only when the whole batch landed, so a restore after a batch with a missed
  // patch threw back the position an earlier patch had already written.
  it("keeps a patch's position written before a later patch in the batch misses", () => {
    const { handle, position, move } = gsapHeld();
    move(30, 36);
    const patches = [
      { selector: "#card", change: { kind: "global-set" as const, props: { x: 50, y: 60 } } },
      { selector: "#missing", change: { kind: "global-set" as const, props: { x: 1 } } },
    ];
    expect(patchTweens({ patches, seek: false }).patched).toBe(false);
    drawDrafts([{ handle, end: "restore" }]);
    expect(position).toEqual({ x: 50, y: 60 });
  });

  it("leaves the position a save's patch sets after the draw when the draft is restored", () => {
    const { handle, position, move } = gsapHeld();
    move(30, 36);
    const change = { kind: "global-set" as const, props: { x: 30, y: 36 } };
    expect(patchTweens({ patches: [{ selector: "#card", change }], seek: false }).patched).toBe(
      true,
    );
    drawDrafts([{ handle, end: "restore" }]);
    expect(position).toEqual({ x: 30, y: 36 });
  });

  it("leaves a position set over the port after the draw when the draft is restored", () => {
    const { handle, position, move } = gsapHeld();
    move(30, 36);
    gsapSet({ handle, props: { x: 12, y: 7 } });
    drawDrafts([{ handle, end: "restore" }]);
    expect(position).toEqual({ x: 12, y: 7 });
  });
});

// fails without the fix: a sealed recording drew only a translate, so opacity, scale and rotation stood still while
// it ran, and a tweened layer showed its tween under the recorded move.
describe("a recording's GSAP values", () => {
  function recordable() {
    const { element, handle } = card("translate: 4px 2px");
    const calls: string[] = [];
    (window as { gsap?: unknown }).gsap = {
      getProperty: () => 0,
      set: (_: Element, props: Record<string, unknown>) =>
        calls.push(`gsap ${JSON.stringify(props)}`),
    };
    (window as { __timelines?: unknown }).__timelines = {
      __proxied: true,
      main: { seek: (t: number) => calls.push(`seek ${t}`), time: () => 1.5 },
    };
    const sample = (seconds: number, values: Record<string, number>) =>
      drawDrafts([{ handle, translate: null, size: null, props: { seconds, values } }]);
    return { element, handle, calls, sample };
  }

  afterEach(() => {
    delete (window as { __timelines?: unknown }).__timelines;
  });

  it("seeks the film's timeline, then sets every recorded value, in one draw", () => {
    const { element, calls, sample } = recordable();
    sample(1.5, { x: 20, opacity: 0.4, scale: 1.2, rotation: 15 });
    expect(calls).toEqual(["seek 1.5", 'gsap {"x":20,"opacity":0.4,"scale":1.2,"rotation":15}']);
    expect(element.style.translate).toBe("none");
  });

  it("clears exactly what it set and gives the layer back its translate when the recording ends", () => {
    const { element, handle, calls, sample } = recordable();
    sample(1.5, { x: 20, opacity: 0.4 });
    sample(1.6, { x: 30, rotation: 5 });
    calls.length = 0;
    drawDrafts([{ handle, end: "clear" }]);
    expect(calls).toContain('gsap {"clearProps":"x,opacity,rotation"}');
    expect(element.style.translate).toBe("4px 2px");
  });
});
