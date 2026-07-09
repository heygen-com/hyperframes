// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { selectionCacheKey, toOverlayRect } from "./domEditOverlayGeometry";

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}

function stubRect(el: Element, rect: DOMRect): void {
  el.getBoundingClientRect = () => rect;
}

describe("selectionCacheKey — hfId collision (R7)", () => {
  it("produces distinct keys for two elements that differ only by hfId", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = selectionCacheKey({ sourceFile: "index.html", hfId: "hf-111" } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = selectionCacheKey({ sourceFile: "index.html", hfId: "hf-222" } as any);
    expect(a).not.toBe(b);
  });
});

describe("toOverlayRect", () => {
  it("uses the declared composition size when the root rect is transformed", () => {
    const overlay = document.createElement("div");
    const iframe = document.createElement("iframe");
    document.body.append(overlay, iframe);
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Expected iframe document");

    doc.body.innerHTML = `
      <main id="scene" data-composition-id="scene" data-width="1600" data-height="900">
        <div id="card">Card</div>
      </main>
    `;

    const scene = doc.getElementById("scene");
    const card = doc.getElementById("card");
    if (!scene || !card) throw new Error("Expected preview fixture elements");

    stubRect(overlay, domRect(10, 20, 1000, 600));
    stubRect(iframe, domRect(110, 70, 800, 450));
    // Live root rect is smaller because an animation transformed it; overlay
    // math must remain anchored to the authored 1600x900 coordinate space.
    stubRect(scene, domRect(0, 0, 800, 450));
    stubRect(card, domRect(200, 100, 100, 50));

    expect(toOverlayRect(overlay, iframe, card)).toEqual({
      left: 200,
      top: 100,
      width: 50,
      height: 25,
      editScaleX: 0.5,
      editScaleY: 0.5,
    });

    overlay.remove();
    iframe.remove();
  });
});
