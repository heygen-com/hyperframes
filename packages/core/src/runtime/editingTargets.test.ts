import { afterEach, describe, expect, it } from "vitest";
import { MAX_POINT_STACK } from "./editingElement";
import { elementForHandle } from "./editingHandles";
import { pointerTargetsAt } from "./editingTargets";

function sized(element: Element, [x, y, width, height]: number[]) {
  element.getBoundingClientRect = () =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }) as DOMRect;
  return element;
}

const asked: Array<[number, number]> = [];
function stackAt(elements: Element[]) {
  Object.assign(document, {
    elementsFromPoint: (x: number, y: number) => {
      asked.push([x, y]);
      return elements;
    },
    elementFromPoint: () => elements[0] ?? null,
  });
}

afterEach(() => {
  asked.length = 0;
  document.body.innerHTML = "";
  delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
});

describe("pointer-targets", () => {
  it("reads a fraction of the composition root's box, and answers the pick and its stack", () => {
    document.body.innerHTML = `<main data-composition-id="m"><p id="a" style="color: red">A</p></main>`;
    sized(document.querySelector("main")!, [0, 0, 1920, 1080]);
    const a = sized(document.getElementById("a")!, [10, 20, 300, 40]);
    stackAt([a]);
    const answer = pointerTargetsAt(0.25, 0.5);
    expect(asked[0]).toEqual([480, 540]);
    expect(answer.target).toMatchObject({ tag: "p", rect: { x: 10, y: 20, width: 300 } });
    expect(answer.stack.map((hit) => hit.handle)).toEqual([answer.target!.handle]);
    expect(asked).toHaveLength(1);
  });

  it("reads the stack once, and falls back to a group's gap only when it is empty", () => {
    document.body.innerHTML = `<main data-composition-id="m"><div id="g" data-hf-group="g"><i id="a"></i><i id="b"></i></div></main>`;
    sized(document.querySelector("main")!, [0, 0, 1920, 1080]);
    sized(document.getElementById("a")!, [0, 0, 100, 100]);
    sized(document.getElementById("b")!, [400, 400, 100, 100]);
    stackAt([]);
    const answer = pointerTargetsAt(0.1, 0.2);
    expect(asked).toHaveLength(1);
    expect(answer.stack).toEqual([]);
    expect(elementForHandle(answer.target!.handle)).toBe(document.getElementById("g"));
  });

  it("caps the stack, and answers nothing when the composition has no size", () => {
    const tiles = Array.from({ length: MAX_POINT_STACK + 5 }, (_, i) => `<p id="t${i}">t</p>`);
    document.body.innerHTML = `<main data-composition-id="m">${tiles.join("")}</main>`;
    sized(document.querySelector("main")!, [0, 0, 1920, 1080]);
    const elements = [...document.querySelectorAll("p")].map((p) => sized(p, [0, 0, 50, 50]));
    stackAt(elements);
    expect(pointerTargetsAt(0.1, 0.1).stack).toHaveLength(MAX_POINT_STACK);

    sized(document.querySelector("main")!, [0, 0, 0, 0]);
    Object.defineProperty(window, "innerWidth", { value: 0, configurable: true });
    try {
      expect(pointerTargetsAt(0.1, 0.1)).toEqual({ target: null, stack: [] });
    } finally {
      Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
    }
  });
});
