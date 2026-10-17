// @vitest-environment jsdom
import { gsap } from "gsap";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hideTimedClipsUntilFirstPass,
  revealTimedClipsAfterFirstPass,
  setTimedClipVisibility,
  showHiddenClipFilters,
} from "@hyperframes/core/runtime/timed-clip-hide";
import { findParsedTween, parsedImplicitEndValue } from "./gsapParsedTween";
import { tween } from "./gsapParsedTween.test-helpers";

afterEach(() => {
  vi.restoreAllMocks();
  gsap.globalTimeline.clear();
  revealTimedClipsAfterFirstPass();
  document.head.replaceChildren();
  document.body.replaceChildren();
});

function fixture() {
  hideTimedClipsUntilFirstPass();
  revealTimedClipsAfterFirstPass();
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument!;
  doc.head.innerHTML = document.head.innerHTML + "<style>#B { filter: opacity(1) }</style>";
  doc.body.innerHTML = '<div id="A"></div><div id="B"></div>';
  const a = doc.getElementById("A")!;
  const b = doc.getElementById("B")!;
  const timeline = gsap
    .timeline({ paused: true })
    .to(a, { x: 300, duration: 1, lazy: false, ease: "none" }, 2)
    .from(
      b,
      { filter: "opacity(0)", duration: 1, immediateRender: false, lazy: false, ease: "none" },
      2,
    );
  timeline.seek(0.5);
  gsap.set(a, { x: 40 });
  setTimedClipVisibility(b, "hidden");
  const outside = document.createElement("div");
  document.body.append(outside);
  setTimedClipVisibility(outside, "hidden");
  Reflect.set(iframe.contentWindow!, "gsap", gsap);
  Reflect.set(iframe.contentWindow!, "__timelines", { main: timeline });
  const anim = tween({ method: "to", properties: { x: 300 }, resolvedStart: 2, duration: 1 });
  return { iframe, doc, a, b, outside, timeline, anim };
}

const attributes = (element: Element) =>
  [...element.attributes].map(({ name, value }) => [name, value]);
const cache = (element: Element) => {
  const live = Reflect.get(element, "_gsap");
  return live && { ...live };
};

describe("parsed tween filter sampling", () => {
  it.each([false, true])("protects an unrelated stylesheet tween (outer borrow=%s)", (outer) => {
    const { iframe, doc, a, b, outside, timeline, anim } = fixture();
    const releaseOuter = outer ? showHiddenClipFilters(doc) : () => {};
    const before = [a, b].map(attributes);
    const caches = [a, b].map(cache);
    const reads: boolean[] = [];
    const seek = timeline.seek.bind(timeline);
    vi.spyOn(timeline, "seek").mockImplementation((time, suppress) => {
      reads.push(b.hasAttribute("data-hf-filter-sampling"));
      return seek(time, suppress);
    });
    const parsed = findParsedTween(iframe, a, anim);
    expect(parsedImplicitEndValue(parsed)("x", "start")).toBe(0);
    expect([a, b].map(attributes)).toEqual(before);
    expect([a, b].map(cache)).toEqual(caches);
    expect(timeline.time()).toBe(0.5);
    expect(outside.hasAttribute("data-hf-filter-sampling")).toBe(false);
    expect(b.hasAttribute("data-hf-filter-sampling")).toBe(outer);
    releaseOuter();
    expect(doc.querySelectorAll("[data-hf-filter-sampling]")).toHaveLength(0);
    setTimedClipVisibility(b, "visible");
    timeline.seek(3);
    expect(doc.defaultView!.getComputedStyle(b).filter).toBe("opacity(1)");
    expect(reads.slice(0, 3)).toEqual([true, true, true]);
  });

  it.each(
    ["clear", "read", "start", "end", "restore"].flatMap((failure) =>
      [false, true].map((outer) => ({ failure, outer })),
    ),
  )(
    "restores DOM and cache after a $failure failure (outer borrow=$outer)",
    ({ failure, outer }) => {
      const { iframe, doc, a, b, timeline, anim } = fixture();
      const releaseOuter = outer ? showHiddenClipFilters(doc) : () => {};
      const before = [a, b].map(attributes);
      const caches = [a, b].map(cache);
      const error = new Error(`failed ${failure}`);
      const set = gsap.set.bind(gsap);
      const get = gsap.getProperty.bind(gsap);
      const seek = timeline.seek.bind(timeline);
      vi.spyOn(gsap, "set").mockImplementation((target, vars) => {
        const result = set(target, vars);
        if (failure === "clear") throw error;
        return result;
      });
      vi.spyOn(gsap, "getProperty").mockImplementation((target, prop, unit, uncache) => {
        const result = get(target, prop, unit, uncache);
        if (failure === "read") throw error;
        return result;
      });
      vi.spyOn(timeline, "seek").mockImplementation((time, suppress) => {
        const result = seek(time, suppress);
        if (
          (failure === "start" && time === 2) ||
          (failure === "end" && time === 3) ||
          (failure === "restore" && time === 0.5)
        )
          throw error;
        return result;
      });
      expect(() => findParsedTween(iframe, a, anim)).toThrow(error);
      expect([a, b].map(attributes)).toEqual(before);
      expect([a, b].map(cache)).toEqual(caches);
      expect(timeline.time()).toBe(0.5);
      expect(b.hasAttribute("data-hf-filter-sampling")).toBe(outer);
      releaseOuter();
      expect(doc.querySelectorAll("[data-hf-filter-sampling]")).toHaveLength(0);
    },
  );
});
