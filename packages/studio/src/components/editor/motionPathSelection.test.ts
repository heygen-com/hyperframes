// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { DomEditSelection } from "./domEditingTypes";
import { buildStableSelector, getSelectorIndex } from "./domEditingDom";
import { selectorFor } from "./motionPathSelection";

afterEach(() => {
  document.body.innerHTML = "";
});

function selectionFor(el: HTMLElement): DomEditSelection {
  const selector = buildStableSelector(el);
  return {
    element: el,
    id: el.id || undefined,
    hfId: el.getAttribute("data-hf-id") || undefined,
    selector,
    selectorIndex: getSelectorIndex(document, el, selector, "index.html", null),
    sourceFile: "index.html",
    dataAttributes: { start: "0", duration: "2" },
  } as unknown as DomEditSelection;
}

function mountGroupSiblings(): HTMLElement[] {
  document.body.innerHTML = `
    <div id="scene" class="clip" data-start="0" data-duration="2">
      <div class="group"></div>
      <div class="group"></div>
      <div class="group"></div>
    </div>
  `;
  return Array.from(document.querySelectorAll<HTMLElement>(".group"));
}

describe("selectorFor", () => {
  it("addresses one element for a class-only sibling", () => {
    const groups = mountGroupSiblings();
    const selector = selectorFor(selectionFor(groups[2]!));

    // The bare ".group" both measured home off the FIRST sibling and wrote the
    // new motion path onto all three.
    expect(selector).not.toBe(".group");
    expect(document.querySelectorAll(selector!)).toHaveLength(1);
    expect(document.querySelector(selector!)).toBe(groups[2]);
  });

  it("keeps a unique id target", () => {
    document.body.innerHTML = `<div id="hero"></div>`;
    const el = document.querySelector<HTMLElement>("#hero")!;

    expect(selectorFor(selectionFor(el))).toBe("#hero");
  });

  it("returns null with no selection", () => {
    expect(selectorFor(null)).toBeNull();
  });

  it("returns null when no rung addresses one element", () => {
    const groups = mountGroupSiblings();
    const selection = selectionFor(groups[1]!);
    groups[1]!.remove();

    expect(selectorFor(selection)).toBeNull();
  });
});
