import { afterEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_RASTER_ATTR, STUDIO_PREVIEW_UPCOMING_ATTR } from "../studioPreviewMark";
import { setPreviewRasterScale } from "./previewRasterHints";
import { CLIP_HIDDEN_ATTR } from "./timedClipHide";

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

  it("ignores the clip attributes the runtime toggles while playing", async () => {
    const scene = layer(POSITIONED);
    for (let i = 0; i < 20; i += 1) layer("position: absolute", scene);
    setPreviewRasterScale(0.5);
    const reads = vi.spyOn(window, "getComputedStyle");
    scene.toggleAttribute(STUDIO_PREVIEW_UPCOMING_ATTR, true);
    scene.toggleAttribute(CLIP_HIDDEN_ATTR, true);
    await Promise.resolve();
    expect(reads).not.toHaveBeenCalled();
    expect(marked(scene)).toBe(true);
    reads.mockRestore();
  });

  it("reads no computed style for a mounted scene that nothing gives a hint", async () => {
    setPreviewRasterScale(0.5);
    const reads = vi.spyOn(window, "getComputedStyle");
    const pageQueries = vi.spyOn(document, "querySelector");
    const scene = document.createElement("div");
    const sheet = document.createElement("style");
    sheet.textContent = ".mc-layer { position: absolute }";
    scene.append(sheet);
    for (let i = 0; i < 50; i += 1)
      layer("position: absolute; left: 4px", scene).className = "mc-layer";
    document.body.append(scene);
    await Promise.resolve();
    document.body.append(layer("position: absolute", document.createElement("div")));
    await Promise.resolve();
    const counts = [reads.mock.calls.length, pageQueries.mock.calls.length];
    reads.mockRestore();
    pageQueries.mockRestore();
    expect(counts).toEqual([0, 0]);
  });

  it("marks a layer added later that only a grouped stylesheet rule hints", async () => {
    const sheet = document.createElement("style");
    sheet.textContent = "@media all { .late-hinted { will-change: transform } }";
    document.head.append(sheet);
    setPreviewRasterScale(0.5);
    const late = layer("position: absolute");
    late.className = "late-hinted";
    const plain = layer("position: absolute");
    await Promise.resolve();
    expect([late, plain].map(marked)).toEqual([true, false]);
    sheet.remove();
  });

  it("reads the stylesheets once, not for every batch of added layers", async () => {
    setPreviewRasterScale(0.5);
    const sheetReads = vi.spyOn(Document.prototype, "styleSheets", "get");
    for (let frame = 0; frame < 3; frame += 1) {
      layer("position: absolute");
      await Promise.resolve();
    }
    const reads = sheetReads.mock.calls.length;
    sheetReads.mockRestore();
    expect(reads).toBeLessThanOrEqual(1);
  });

  it("sees a hint rule from a style that arrives while the preview is small", async () => {
    setPreviewRasterScale(0.5);
    layer("position: absolute");
    await Promise.resolve();
    const sheet = document.createElement("style");
    sheet.textContent = ".arrived-hint { will-change: transform }";
    document.head.append(sheet);
    await Promise.resolve();
    const late = layer("position: absolute");
    late.className = "arrived-hint";
    await Promise.resolve();
    expect(marked(late)).toBe(true);
    sheet.remove();
  });

  it("walks no holders for a mounted scene with nothing marked in or around it", async () => {
    setPreviewRasterScale(0.5);
    const walks = vi.spyOn(Element.prototype, "closest");
    const scene = document.createElement("div");
    for (let i = 0; i < 50; i += 1) layer("position: absolute", scene);
    document.body.append(scene);
    await Promise.resolve();
    const count = walks.mock.calls.length;
    walks.mockRestore();
    expect(count).toBeLessThanOrEqual(1);
  });

  it("does no work for attribute and style writes on a page that nothing hints", async () => {
    const paths = Array.from({ length: 20 }, () => layer("position: absolute"));
    setPreviewRasterScale(0.5);
    const walks = vi.spyOn(Element.prototype, "querySelectorAll");
    for (const path of paths) {
      path.setAttribute("fill", "#fff");
      path.style.left = "4px";
    }
    await Promise.resolve();
    const count = walks.mock.calls.length;
    walks.mockRestore();
    expect(count).toBe(0);
  });

  it("gives the hint back to a marked layer re-attached after removal once a child needs it", async () => {
    const words = layer(POSITIONED);
    const child = layer("", words);
    setPreviewRasterScale(0.5);
    expect(marked(words)).toBe(true);
    words.remove();
    await Promise.resolve();
    document.body.append(words);
    await Promise.resolve();
    child.style.position = "fixed";
    await Promise.resolve();
    expect(marked(words)).toBe(false);
  });

  it("follows a copy of a marked layer that arrives with the mark", async () => {
    const words = layer(POSITIONED);
    layer("", words);
    setPreviewRasterScale(0.5);
    const copy = words.cloneNode(true) as HTMLElement;
    words.remove();
    document.body.append(copy);
    await Promise.resolve();
    (copy.firstElementChild as HTMLElement).style.position = "fixed";
    await Promise.resolve();
    expect(marked(copy)).toBe(false);
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

  it("decides every mark in a changed subtree before writing any, so the page restyles once", async () => {
    const sheet = document.createElement("style");
    sheet.textContent = "[data-flat] > div { position: static !important }";
    document.head.append(sheet);
    const panel = layer("");
    const rows = Array.from({ length: 10 }, () => layer(POSITIONED, panel));
    setPreviewRasterScale(0.5);
    expect(rows.every(marked)).toBe(true);
    const order: string[] = [];
    const realRead = window.getComputedStyle.bind(window);
    const reads = vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
      order.push("read");
      return realRead(el, pseudo);
    });
    const realToggle = Element.prototype.toggleAttribute;
    const writes = vi.spyOn(Element.prototype, "toggleAttribute").mockImplementation(function (
      this: Element,
      name: string,
      force?: boolean,
    ) {
      if (name === PREVIEW_RASTER_ATTR) order.push("write");
      return realToggle.call(this, name, force);
    });
    panel.setAttribute("data-flat", "");
    await Promise.resolve();
    reads.mockRestore();
    writes.mockRestore();
    expect(rows.some(marked)).toBe(false);
    expect(order.filter((step) => step === "write")).toHaveLength(10);
    expect(order.lastIndexOf("read")).toBeLessThan(order.indexOf("write"));
    sheet.remove();
  });

  it("checks each element once for a batch of attribute changes inside one subtree", async () => {
    const group = layer(POSITIONED);
    const words = Array.from({ length: 20 }, () => layer("position: absolute", group));
    setPreviewRasterScale(0.275);
    const reads = vi.spyOn(window, "getComputedStyle");
    group.setAttribute("data-state", "a");
    for (const word of words) word.setAttribute("data-state", "a");
    group.setAttribute("data-state", "b");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ownReads = reads.mock.calls.filter(([el, pseudo]) => el === words[0] && !pseudo);
    // Its own check, the group's look at its descendants, and its holders: once each, not per record.
    expect(ownReads.length).toBeLessThanOrEqual(3);
    expect(marked(group)).toBe(true);
    reads.mockRestore();
  });
});
