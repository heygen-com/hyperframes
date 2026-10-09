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
    const mixed = layer("position: relative; will-change: transform, opacity");
    setPreviewRasterScale(0.275);
    expect(marked(words)).toBe(true);
    expect(marked(word)).toBe(false);
    expect(marked(mixed)).toBe(false);
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

  it("gives the hint back when an inline style makes a child depend on it", async () => {
    const words = layer(POSITIONED);
    const word = layer("position: absolute", words);
    setPreviewRasterScale(0.5);
    expect(marked(words)).toBe(true);
    word.style.zIndex = "5";
    await Promise.resolve();
    expect(marked(words)).toBe(false);
  });

  it("re-reads a marked layer's own hints and position when they change", async () => {
    const sheet = document.createElement("style");
    sheet.textContent =
      ".hinted { will-change: transform } .hinted.fading { will-change: transform, opacity }";
    document.head.append(sheet);
    const classed = layer("position: absolute");
    classed.className = "hinted";
    const inline = layer(POSITIONED);
    const inlineHint = layer(POSITIONED);
    setPreviewRasterScale(0.5);
    expect([classed, inline, inlineHint].map(marked)).toEqual([true, true, true]);
    classed.className = "hinted fading";
    inline.style.position = "static";
    inlineHint.style.willChange = "transform, opacity";
    await Promise.resolve();
    expect([classed, inline, inlineHint].map(marked)).toEqual([false, false, false]);
    sheet.remove();
  });

  it("follows stylesheets and attribute selectors added while the preview is small", async () => {
    const byStylesheet = layer(POSITIONED);
    layer("", byStylesheet).className = "late-pinned";
    const byAttribute = layer(POSITIONED);
    const scene = layer("", byAttribute);
    setPreviewRasterScale(0.5);
    expect([byStylesheet, byAttribute].map(marked)).toEqual([true, true]);
    const sheet = document.createElement("style");
    sheet.textContent = '.late-pinned, [data-scene="pinned"] { position: fixed }';
    document.head.append(sheet);
    await Promise.resolve();
    expect(marked(byStylesheet)).toBe(false);
    expect(marked(byAttribute)).toBe(true);
    scene.dataset.scene = "pinned";
    await Promise.resolve();
    expect(marked(byAttribute)).toBe(false);
    sheet.remove();
  });
});
