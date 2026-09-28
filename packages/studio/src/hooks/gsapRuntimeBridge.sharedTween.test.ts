// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { tryGsapDragIntercept } from "./gsapRuntimeBridge";

const WORDS = ["How", "we", "build", "videos", "at", "scale", "every", "day"];

function mountPhrase(): HTMLElement[] {
  document.body.innerHTML = `<h1>${WORDS.map(
    (word, i) => `<span class="w" data-hf-id="hf-w${i}">${word}</span>`,
  ).join("")}</h1>`;
  return [...document.querySelectorAll<HTMLElement>(".w")];
}

function wordSelection(element: HTMLElement, index: number): DomEditSelection {
  return {
    selector: ".w",
    selectorIndex: index,
    hfId: element.getAttribute("data-hf-id") ?? undefined,
    element,
  } as unknown as DomEditSelection;
}

// One staggered entrance on the shared class, the way generated titles are written.
const staggerIn = {
  id: ".w-from-200",
  targetSelector: ".w",
  method: "from",
  properties: { y: 60, opacity: 0 },
  position: 0.2,
  resolvedStart: 0.2,
  duration: 0.6,
  stagger: 0.08,
} as unknown as GsapAnimation;

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("tryGsapDragIntercept: one word of a staggered phrase", () => {
  it("leaves the shared tween alone and hands the move to that word's own offset", async () => {
    const words = mountPhrase();
    const commitMutation = vi.fn();
    const outcome = await tryGsapDragIntercept(
      wordSelection(words[0]!, 0),
      { x: -40, y: 0 },
      [staggerIn],
      null,
      commitMutation,
      async () => [staggerIn],
    );
    expect(outcome).toEqual({ status: "element-offset" });
    expect(commitMutation).not.toHaveBeenCalled();
  });

  it("still edits a tween that targets only the dragged word", async () => {
    const words = mountPhrase();
    const own = { ...staggerIn, id: "own", targetSelector: '[data-hf-id="hf-w0"]' };
    const commitMutation = vi.fn();
    const outcome = await tryGsapDragIntercept(
      wordSelection(words[0]!, 0),
      { x: -40, y: 0 },
      [own as GsapAnimation],
      null,
      commitMutation,
      async () => [own as GsapAnimation],
    );
    expect(outcome.status).toBe("persisted");
    expect(commitMutation).toHaveBeenCalled();
  });
});

describe("tryGsapDragIntercept: one drag is one undo step", () => {
  it("records the split and the move under one gesture key", async () => {
    document.body.innerHTML = `<div id="hero"></div>`;
    const hero = document.getElementById("hero")!;
    const mixed = {
      id: "#hero-fromTo-0",
      targetSelector: "#hero",
      method: "fromTo",
      fromProperties: { x: 0, opacity: 0 },
      properties: { x: 100, opacity: 1 },
      position: 0,
      resolvedStart: 0,
      duration: 1,
    } as unknown as GsapAnimation;
    const split = [
      { ...mixed, id: "#hero-fromTo-0-position", propertyGroup: "position" },
      { ...mixed, id: "#hero-fromTo-0-opacity", propertyGroup: "opacity" },
    ] as GsapAnimation[];
    let fetches = 0;
    const commitMutation = vi.fn();
    await tryGsapDragIntercept(
      { id: "hero", selector: "#hero", element: hero } as unknown as DomEditSelection,
      { x: 20, y: 0 },
      [mixed],
      null,
      commitMutation,
      async () => (fetches++ === 0 ? [mixed] : split),
    );
    const options = commitMutation.mock.calls.map((call) => call[2]);
    expect(options.length).toBeGreaterThan(1);
    expect(new Set(options.map((o) => o.coalesceKey)).size).toBe(1);
    expect(options[0].coalesceKey).toMatch(/^gsap:drag:/);
    expect(options.every((o) => o.coalesceMs === Number.POSITIVE_INFINITY)).toBe(true);
  });
});
