import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("touches nothing until the host reports a scale", () => {
    const words = layer(POSITIONED);
    expect(document.querySelectorAll(`style, [${PREVIEW_RASTER_ATTR}]`)).toHaveLength(0);
    expect(getComputedStyle(words).willChange).toBe("transform");
  });

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

  it("leaves marked layers alone when only something around them changes", async () => {
    const scene = layer("");
    const words = [layer(POSITIONED, scene), layer(POSITIONED, scene)];
    setPreviewRasterScale(0.5);
    const markChanges: MutationRecord[] = [];
    const watch = new MutationObserver((records) => markChanges.push(...records));
    watch.observe(document.body, { subtree: true, attributeFilter: [PREVIEW_RASTER_ATTR] });
    scene.dataset.upcoming = "";
    await Promise.resolve();
    await Promise.resolve();
    watch.disconnect();
    expect(words.map(marked)).toEqual([true, true]);
    expect(markChanges).toEqual([]);
  });

  it("does not react to its own marks", async () => {
    const words = layer(POSITIONED);
    setPreviewRasterScale(0.5);
    words.dataset.scene = "intro";
    await Promise.resolve();
    await Promise.resolve();
    const reads = vi.spyOn(window, "getComputedStyle");
    await Promise.resolve();
    await Promise.resolve();
    expect(reads).not.toHaveBeenCalled();
    reads.mockRestore();
    expect(marked(words)).toBe(true);
  });

  it("re-checks the page when a linked stylesheet loads", async () => {
    const sheet = document.createElement("style");
    document.head.append(sheet);
    const words = layer(POSITIONED);
    layer("", words).className = "loaded-pinned";
    setPreviewRasterScale(0.5);
    const link = document.createElement("link");
    document.head.append(link);
    await Promise.resolve();
    expect(marked(words)).toBe(true);
    // Stands in for the linked rules arriving: stylesheet object edits are not observed.
    sheet.sheet!.insertRule(".loaded-pinned { position: fixed }");
    link.dispatchEvent(new Event("load"));
    expect(marked(words)).toBe(false);
    sheet.remove();
    link.remove();
  });
});
