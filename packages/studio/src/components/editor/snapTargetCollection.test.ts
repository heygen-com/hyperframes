// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { collectSnapContext } from "./snapTargetCollection";

vi.mock("../../utils/studioUiPreferences", () => ({
  readStudioUiPreferences: () => ({
    snapEnabled: true,
    snapToGrid: true,
    gridSpacing: 100,
  }),
}));

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

describe("collectSnapContext", () => {
  it("builds snap targets from the shared declared composition coordinate space", () => {
    const overlay = document.createElement("div");
    const iframe = document.createElement("iframe");
    document.body.append(overlay, iframe);
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Expected iframe document");

    doc.body.innerHTML = `
      <main id="scene" data-composition-id="scene" data-width="1600" data-height="600">
        <div id="card" style="position:absolute">Card</div>
      </main>
    `;

    const scene = doc.getElementById("scene");
    const card = doc.getElementById("card");
    if (!scene || !card) throw new Error("Expected preview fixture elements");

    stubRect(overlay, domRect(10, 20, 1000, 600));
    stubRect(iframe, domRect(110, 70, 800, 450));
    // Transformed live root rect; declared data-width/height are the canonical
    // coordinate space. Height intentionally creates non-uniform scale so grid
    // rows prove they use scaleY, not scaleX.
    stubRect(scene, domRect(0, 0, 800, 450));
    stubRect(card, domRect(200, 100, 100, 50));

    const context = collectSnapContext({
      overlayEl: overlay,
      iframe,
      excludeElements: new Set(),
    });

    expect(context.compositionTarget).toMatchObject({
      left: 100,
      top: 50,
      right: 900,
      bottom: 500,
      centerX: 500,
      centerY: 275,
    });
    expect(context.targets[0]).toMatchObject({
      left: 200,
      top: 125,
      right: 250,
      bottom: 162.5,
      centerX: 225,
      centerY: 143.75,
    });
    expect(context.gridEdges?.x[0]?.position).toBe(150);
    expect(context.gridEdges?.y[0]?.position).toBe(125);

    overlay.remove();
    iframe.remove();
  });
});
