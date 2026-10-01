// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { readTranslatePx } from "./plainTranslate";

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

  it("counts padding and border in the box a percent resolves against", () => {
    const element = box(
      "translate: 50% 50%; padding: 10px; border: 5px solid; box-sizing: content-box",
    );
    expect(readTranslatePx(element)).toEqual({ x: 135, y: 95 });
  });

  it("writes nothing to the element it reads", () => {
    const element = box("translate: -50% -50%");
    const before = element.getAttribute("style");
    const writes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => writes.push(...records));
    observer.observe(element, { attributes: true });
    readTranslatePx(element);
    writes.push(...observer.takeRecords());
    observer.disconnect();
    expect(writes).toEqual([]);
    expect(element.getAttribute("style")).toBe(before);
  });
});
