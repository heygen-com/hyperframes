import { afterEach, describe, expect, it } from "vitest";
import { PREVIEW_RASTER_ATTR } from "../studioPreviewMark";
import { setPreviewRasterScale } from "./previewRasterHints";

function layer(style: string, parent: Element = document.body): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("style", style);
  parent.append(element);
  return element;
}

const POSITIONED = "position: absolute; will-change: transform";
const marked = (element: Element) => element.hasAttribute(PREVIEW_RASTER_ATTR);

afterEach(() => {
  setPreviewRasterScale(1);
  document.body.innerHTML = "";
});

describe("setPreviewRasterScale", () => {
  it("drops a positioned layer's transform hint while the preview is shown small", () => {
    const words = layer(POSITIONED);
    const word = layer("position: absolute", words);
    const mixed = layer("position: relative; will-change: opacity, transform");
    setPreviewRasterScale(0.275);
    expect(marked(words)).toBe(true);
    expect(marked(word)).toBe(false);
    expect(marked(mixed)).toBe(true);
    expect(getComputedStyle(words).willChange).toBe("auto");
    expect(words.getAttribute("style")).toBe(POSITIONED);
  });

  it("keeps the hint where the stacking context or containing block matters", () => {
    const unpositioned = layer("will-change: transform");
    const holdsFixed = layer(POSITIONED);
    layer("position: fixed", holdsFixed);
    const holdsZIndex = layer(POSITIONED);
    layer("position: relative; z-index: 2", holdsZIndex);
    const holdsBlend = layer(POSITIONED);
    layer("mix-blend-mode: multiply", holdsBlend);
    const stacked = layer(`${POSITIONED}; z-index: 1`);
    layer("position: relative; z-index: 2", stacked);
    setPreviewRasterScale(0.5);
    expect([unpositioned, holdsFixed, holdsZIndex, holdsBlend].map(marked)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(marked(stacked)).toBe(true);
  });

  it("restores the document once shown at full size", () => {
    const words = layer(POSITIONED);
    const before = document.documentElement.outerHTML;
    setPreviewRasterScale(0.5);
    expect(document.documentElement.outerHTML).not.toBe(before);
    setPreviewRasterScale(1);
    expect(document.documentElement.outerHTML).toBe(before);
    expect(getComputedStyle(words).willChange).toBe("transform");
  });

  it("follows layers added and classes changed while the preview is small", async () => {
    const sheet = document.createElement("style");
    sheet.textContent = ".pinned { position: fixed }";
    document.head.append(sheet);
    setPreviewRasterScale(0.5);
    const late = layer(POSITIONED);
    const child = layer("", late);
    await Promise.resolve();
    expect(marked(late)).toBe(true);
    child.className = "pinned";
    await Promise.resolve();
    expect(marked(late)).toBe(false);
    sheet.remove();
  });
});
