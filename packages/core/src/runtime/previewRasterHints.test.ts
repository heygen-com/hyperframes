import { afterEach, describe, expect, it } from "vitest";
import { setPreviewRasterScale } from "./previewRasterHints";

function layer(style: string): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("style", style);
  document.body.append(element);
  return element;
}

afterEach(() => {
  setPreviewRasterScale(1);
  document.body.innerHTML = "";
});

describe("setPreviewRasterScale", () => {
  it("swaps a transform hint for a far perspective while the preview is shown small", () => {
    const plain = layer("will-change: transform");
    const mixed = layer("will-change: opacity, transform");
    setPreviewRasterScale(0.275);
    expect(plain.style.cssText).toBe("will-change: auto; perspective: 1000000000px;");
    expect(mixed.style.willChange).toBe("opacity");
  });

  it("keeps an authored perspective and leaves unhinted layers alone", () => {
    const deep = layer("will-change: transform; perspective: 600px");
    const plain = layer("will-change: opacity");
    setPreviewRasterScale(0.5);
    expect(deep.style.cssText).toBe("will-change: auto; perspective: 600px;");
    expect(plain.style.cssText).toBe("will-change: opacity;");
  });

  it("restores the authored styles once shown at full size, keeping values written since", () => {
    const restored = layer("will-change: transform; color: red");
    const animated = layer("will-change: transform");
    const before = restored.style.cssText;
    setPreviewRasterScale(0.5);
    animated.style.perspective = "800px";
    setPreviewRasterScale(1);
    expect(restored.style.cssText).toBe(before);
    expect(animated.style.willChange).toBe("transform");
    expect(animated.style.perspective).toBe("800px");
  });

  it("swaps layers added while the preview is small", async () => {
    setPreviewRasterScale(0.5);
    const late = layer("will-change: transform");
    await Promise.resolve();
    expect(late.style.willChange).toBe("auto");
  });

  it("follows a class change on a swapped layer", async () => {
    const sheet = document.createElement("style");
    sheet.textContent = ".hinted { will-change: transform }";
    document.head.append(sheet);
    const toggled = layer("");
    toggled.className = "hinted";
    setPreviewRasterScale(0.5);
    expect(toggled.style.willChange).toBe("auto");
    toggled.className = "";
    await Promise.resolve();
    expect(toggled.style.cssText).toBe("");
    sheet.remove();
  });
});
