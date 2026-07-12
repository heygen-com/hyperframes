// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { DomEditSelection } from "./domEditing";
import type { OverlayRect } from "./domEditOverlayGeometry";
import { DomEditCropHandles } from "./DomEditCropHandles";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

const overlayRect: OverlayRect = {
  left: 0,
  top: 0,
  width: 200,
  height: 100,
  editScaleX: 1,
  editScaleY: 1,
};

function selectionFor(el: HTMLElement): DomEditSelection {
  return { element: el, id: el.id, selector: `#${el.id}` } as unknown as DomEditSelection;
}

function makeEl(id: string, clip: string): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  if (clip) el.style.setProperty("clip-path", clip);
  document.body.append(el);
  return el;
}

function render(el: HTMLElement): { root: Root; rerender: (next: HTMLElement) => void } {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const draw = (target: HTMLElement) =>
    act(() => {
      root.render(
        <DomEditCropHandles
          selection={selectionFor(target)}
          overlayRect={overlayRect}
          onStyleCommit={() => undefined}
        />,
      );
    });
  draw(el);
  return { root, rerender: draw };
}

// Regression: the deselect restore used a ref recomputed from RENDER state — on
// a direct A→B selection switch, state re-syncs to B before A's effect cleanup
// runs, so A used to get B's crop string (or lose its crop entirely). The
// restore value must be owned by A's own lift effect / crop gesture.
describe("DomEditCropHandles clip lift/restore", () => {
  it("lifts on select and restores the inline clip verbatim on unmount", () => {
    const a = makeEl("a", "inset(16px round 12px)");
    const { root } = render(a);
    expect(a.style.getPropertyValue("clip-path")).toBe("none");
    act(() => root.unmount());
    expect(a.style.getPropertyValue("clip-path")).toBe("inset(16px round 12px)");
  });

  it("restores A's own clip when switching directly to B", () => {
    const a = makeEl("a", "inset(16px)");
    const b = makeEl("b", "inset(40px 8px 4px 2px)");
    const { root, rerender } = render(a);
    rerender(b);
    // A got ITS clip back, not B's (and not removed); B is now lifted.
    expect(a.style.getPropertyValue("clip-path")).toBe("inset(16px)");
    expect(b.style.getPropertyValue("clip-path")).toBe("none");
    act(() => root.unmount());
    expect(b.style.getPropertyValue("clip-path")).toBe("inset(40px 8px 4px 2px)");
  });

  it("never lifts an uneditable clip and leaves it untouched across select/deselect", () => {
    const a = makeEl("a", "circle(50% at 50% 50%)");
    const { root } = render(a);
    expect(a.style.getPropertyValue("clip-path")).toBe("circle(50% at 50% 50%)");
    act(() => root.unmount());
    expect(a.style.getPropertyValue("clip-path")).toBe("circle(50% at 50% 50%)");
  });
});
