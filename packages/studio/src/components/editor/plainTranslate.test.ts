// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  readTranslatePx,
  readTranslatePxLeavingPercent,
  rememberFrameTranslate,
} from "./plainTranslate";

function box(style: string): HTMLElement {
  const element = document.createElement("div");
  element.style.cssText = `position: absolute; width: 240px; height: 160px; ${style}`;
  document.body.append(element);
  return element;
}

describe("readTranslatePx", () => {
  it.each([
    ["40px 30px", { x: 40, y: 30 }],
    ["-50% -50%", { x: -120, y: -80 }],
    ["25% 25%", { x: 60, y: 40 }],
    ["calc(-50% + 12px) calc(10% - 6px)", { x: -108, y: 10 }],
    ["30px", { x: 30, y: 0 }],
  ])("reads %s against the border box, in px", (translate, want) => {
    expect(readTranslatePx(box(`translate: ${translate}`))).toEqual(want);
  });

  it.each([
    ["calc(50% - 20px) 0px", { x: 100, y: 0 }],
    ["calc(50% + 20px) calc(50% - 20px)", { x: 140, y: 60 }],
  ])("adds and subtracts the terms of %s", (translate, want) => {
    expect(readTranslatePx(box(`translate: ${translate}`))).toEqual(want);
  });

  it.each([
    ["min(10px, 5%) max(-20%, -40px)", { x: 10, y: -32 }],
    ["clamp(0px, 10%, 30px) 5px", { x: 24, y: 5 }],
    ["calc(min(50%, 100px) * 2 - (10px + 5%)) calc(-1 * clamp(10%, 1px, 20%))", { x: 178, y: -16 }],
    ["calc(2 * 10px) calc(80px / 4)", { x: 20, y: 20 }],
  ])("works out %s by arithmetic", (translate, want) => {
    expect(readTranslatePx(box(`translate: ${translate}`))).toEqual(want);
  });

  it.each(["calc(10px +) 0px", "abs(10% - 50px) 0px", "round(10%, 7px) 0px", "min(10px 5%) 0px"])(
    "reads %s as NaN, never as a guess",
    (translate) => {
      expect(readTranslatePx(box(`translate: ${translate}`)).x).toBeNaN();
    },
  );

  it.each(["content-box", "fill-box"])(
    "resolves a percent against the content box under transform-box: %s",
    (transformBox) => {
      const element = box(
        `translate: 50% 50%; padding: 10px; border: 5px solid; box-sizing: content-box; transform-box: ${transformBox}`,
      );
      expect(readTranslatePx(element)).toEqual({ x: 120, y: 80 });
    },
  );

  it("counts padding and border in the box a percent resolves against", () => {
    const element = box(
      "translate: 50% 50%; padding: 10px; border: 5px solid; box-sizing: content-box",
    );
    expect(readTranslatePx(element)).toEqual({ x: 135, y: 95 });
  });

  it.each(["-50% -50%", "min(10px, 5%) clamp(0px, 10%, 30px)"])(
    "writes nothing to the element while it reads %s",
    (translate) => {
      const element = box(`translate: ${translate}; transform: rotate(5deg)`);
      const before = element.getAttribute("style");
      const writes: MutationRecord[] = [];
      const observer = new MutationObserver((records) => writes.push(...records));
      observer.observe(element, { attributes: true });
      readTranslatePx(element);
      writes.push(...observer.takeRecords());
      observer.disconnect();
      expect(writes).toEqual([]);
      expect(element.getAttribute("style")).toBe(before);
    },
  );
});

describe("readTranslatePxLeavingPercent", () => {
  it("seeds a first tween from the px a plain move left in CSS translate, leaving % to xPercent", () => {
    const el = document.body.appendChild(document.createElement("div"));
    // happy-dom computes no `translate`; Chromium resolves it to these strings.
    const computed = (translate: string) =>
      vi.spyOn(window, "getComputedStyle").mockReturnValue({ translate } as CSSStyleDeclaration);
    computed("299.893px 203.262px");
    expect(readTranslatePxLeavingPercent(el)).toEqual({ x: 299.893, y: 203.262 });
    computed("calc(-50% + 120px) -50%");
    expect(readTranslatePxLeavingPercent(el)).toEqual({ x: 120, y: 0 });
    computed("calc(-50% - 120px) calc(min(10px, 20px) + 5px)");
    expect(readTranslatePxLeavingPercent(el)).toEqual({ x: -120, y: 15 });
    computed("none");
    expect(readTranslatePxLeavingPercent(el)).toEqual({ x: 0, y: 0 });
    vi.restoreAllMocks();
    el.remove();
  });

  // fails without the fix: a sealed preview's stand-in has no window, so Add keyframe seeded 0,0 and the layer jumped.
  it("seeds from the inline translate of a layer with no window, like a sealed preview's stand-in", () => {
    const standIn = document.implementation.createHTMLDocument("").createElement("div");
    standIn.style.setProperty("translate", "319.893px -75.508px");

    expect(readTranslatePxLeavingPercent(standIn)).toEqual({ x: 319.893, y: -75.508 });
  });

  it("seeds a stand-in from the translate its frame renders, a stylesheet's included, until a move rewrites it", () => {
    const standIn = document.implementation.createHTMLDocument("").createElement("div");
    rememberFrameTranslate(standIn, { x: 40, y: 30 }, "40px 30px");

    expect(readTranslatePxLeavingPercent(standIn)).toEqual({ x: 40, y: 30 });
    standIn.style.setProperty("translate", "70px 10px");
    expect(readTranslatePxLeavingPercent(standIn)).toEqual({ x: 70, y: 10 });
  });
});
