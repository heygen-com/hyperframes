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
  it("swaps a transform hint for an identity filter while the preview is shown small", () => {
    const plain = layer("will-change: transform");
    const mixed = layer("will-change: opacity, transform");
    setPreviewRasterScale(0.275);
    expect(plain.style.willChange).toBe("auto");
    expect(plain.style.filter).toBe("opacity(1)");
    expect(mixed.style.willChange).toBe("opacity");
  });

  it("leaves 3D containers, authored filters and unhinted layers as they are", () => {
    const card = layer("will-change: transform; transform-style: preserve-3d");
    const blurred = layer("will-change: transform; filter: blur(2px)");
    const plain = layer("will-change: opacity");
    setPreviewRasterScale(0.5);
    expect(card.style.willChange).toBe("transform");
    expect(blurred.style.willChange).toBe("auto");
    expect(blurred.style.filter).toBe("blur(2px)");
    expect(plain.style.cssText).toBe("will-change: opacity;");
  });

  it("restores the authored styles once shown at full size, keeping values written since", () => {
    const restored = layer("will-change: transform; color: red");
    const animated = layer("will-change: transform");
    const before = restored.style.cssText;
    setPreviewRasterScale(0.5);
    animated.style.filter = "blur(4px)";
    setPreviewRasterScale(1);
    expect(restored.style.cssText).toBe(before);
    expect(animated.style.willChange).toBe("transform");
    expect(animated.style.filter).toBe("blur(4px)");
  });

  it("swaps layers added while the preview is small", async () => {
    setPreviewRasterScale(0.5);
    const late = layer("will-change: transform");
    await Promise.resolve();
    expect(late.style.willChange).toBe("auto");
  });
});
