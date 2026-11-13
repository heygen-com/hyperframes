// @vitest-environment jsdom
// happy-dom drops the vendor-prefixed fill property these tests assert on.

import { afterEach, describe, expect, it, vi } from "vitest";
import { applyInlineStyle } from "./inlineTextStyleRange";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<h1>${html}</h1>`;
  return document.body.firstElementChild as HTMLElement;
}

/** Every text node and line break in order, with the offset each one starts at. */
function charSpans(host: HTMLElement): Array<{ node: Node; from: number; length: number }> {
  const spans: Array<{ node: Node; from: number; length: number }> = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let seen = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const isBreak = node.nodeType === 1 && (node as Element).tagName === "BR";
    if (node.nodeType === 1 && !isBreak) continue;
    const length = isBreak ? 1 : (node.textContent?.length ?? 0);
    spans.push({ node, from: seen, length });
    seen += length;
  }
  return spans;
}

/**
 * A range over the host's text, by character offsets across the whole element.
 *
 * A line break counts as one character, the same way the module does, but is
 * never landed on: a boundary there belongs to the text beside it, which is
 * where a real selection would put it too.
 */
function rangeOver(host: HTMLElement, start: number, end: number): Range {
  const range = document.createRange();
  const text = charSpans(host).filter((span) => span.node.nodeType === 3);
  const at = (offset: number) => text.find((span) => span.from + span.length >= offset);
  const from = at(start);
  const to = at(end);
  if (from) range.setStart(from.node, start - from.from);
  if (from && to) range.setEnd(to.node, end - to.from);
  return range;
}

/**
 * A colour that does not paint is the same to the user as one that did not save.
 *
 * `-webkit-text-fill-color` inherits and paints the glyph fill, so a composition
 * that sets it on a text element wins over any `color` the editor puts on a run
 * inside it. The run saved correctly and rendered in someone else's colour,
 * which reads as the colour picker being broken.
 */
describe("applyInlineStyle when something else is painting the glyphs", () => {
  function stubFill(fill: string | null | ((element: HTMLElement) => string | null)) {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation(((element: Element) => {
      const computed = real(element as HTMLElement);
      const resolvedFill = typeof fill === "function" ? fill(element as HTMLElement) : fill;
      return new Proxy(computed, {
        get: (target, key) => {
          if (key === "webkitTextFillColor") return resolvedFill ?? undefined;
          if (key === "color") return (element as HTMLElement).style.color || "rgb(0, 0, 0)";
          return Reflect.get(target, key);
        },
      });
    }) as typeof window.getComputedStyle);
  }

  it("mirrors the colour into the fill when an ancestor is overpainting", () => {
    const host = mount("Hello world");
    stubFill("rgb(255, 255, 255)");
    applyInlineStyle(rangeOver(host, 6, 11), { color: "rgb(255, 0, 149)" });

    expect(host.innerHTML).toContain("-webkit-text-fill-color: rgb(255, 0, 149)");
    expect(host.innerHTML).toContain("color: rgb(255, 0, 149)");
  });

  it("leaves the markup alone when nothing is overpainting", () => {
    const host = mount("Hello world");
    stubFill("rgb(255, 0, 149)");
    applyInlineStyle(rangeOver(host, 6, 11), { color: "rgb(255, 0, 149)" });

    expect(host.innerHTML).not.toContain("-webkit-text-fill-color");
    expect(host.innerHTML).toContain("color: rgb(255, 0, 149)");
  });

  it("says nothing about a run that carries no colour", () => {
    const host = mount("Hello world");
    stubFill("rgb(255, 255, 255)");
    applyInlineStyle(rangeOver(host, 6, 11), { "font-weight": "700" });

    expect(host.innerHTML).not.toContain("-webkit-text-fill-color");
  });

  it("mirrors only the run whose own ancestor path is overpainting", () => {
    const host = mount(
      '<span data-hf-text-key="child:0" style="color: blue">left</span>' +
        '<span data-hf-text-key="child:1" style="color: green">right</span>',
    );
    stubFill((element) =>
      element.textContent === "left" ? "rgb(255, 255, 255)" : element.style.color,
    );

    applyInlineStyle(rangeOver(host, 4, 9), { color: "red" });

    const [left, right] = Array.from(host.querySelectorAll<HTMLElement>("span"));
    expect(left?.style.getPropertyValue("-webkit-text-fill-color")).toBe("blue");
    expect(right?.style.getPropertyValue("-webkit-text-fill-color")).toBe("");
  });

  it("drops a generated mirror when the ancestor stops overpainting", () => {
    const host = mount("Hello world");
    let overpainted = true;
    stubFill((element) => (overpainted ? "rgb(255, 255, 255)" : element.style.color));
    applyInlineStyle(rangeOver(host, 6, 11), { color: "red" });
    expect(host.innerHTML).toContain("-webkit-text-fill-color");

    overpainted = false;
    const live = document.getSelection()?.getRangeAt(0);
    if (live) applyInlineStyle(live, { "font-weight": "700" });

    expect(host.innerHTML).not.toContain("-webkit-text-fill-color");
  });
});
