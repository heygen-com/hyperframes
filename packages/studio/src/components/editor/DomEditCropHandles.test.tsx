// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function render(
  el: HTMLElement,
  onStyleCommit: (property: string, value: string) => Promise<unknown> | void = () => undefined,
  rect: OverlayRect = overlayRect,
): { root: Root; rerender: (next: HTMLElement) => void } {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const draw = (target: HTMLElement) =>
    act(() => {
      root.render(
        <DomEditCropHandles
          selection={selectionFor(target)}
          overlayRect={rect}
          onStyleCommit={onStyleCommit}
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

  it("re-lifts synchronously after the commit path re-applies the cropped value", async () => {
    const a = makeEl("a", "inset(10px)");
    let resolveCommit: (() => void) | undefined;
    const pendingCommit = new Promise<void>((resolve) => {
      resolveCommit = resolve;
    });
    const onStyleCommit = vi.fn((property: string, value: string) => {
      a.style.setProperty(property, value);
      return pendingCommit;
    });
    const { root } = render(a, onStyleCommit);
    const handle = document.querySelector<HTMLButtonElement>('[aria-label="Crop right"]');
    expect(handle).toBeTruthy();

    act(() =>
      handle!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 100 }),
      ),
    );
    act(() =>
      handle!.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 80 }),
      ),
    );
    act(() =>
      handle!.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 80 }),
      ),
    );

    expect(onStyleCommit).toHaveBeenCalledWith("clip-path", "inset(10px 30px 10px 10px)");
    expect(a.style.getPropertyValue("clip-path")).toBe("none");
    resolveCommit?.();
    await act(async () => pendingCommit);
    act(() => root.unmount());
    expect(a.style.getPropertyValue("clip-path")).toBe("inset(10px 30px 10px 10px)");
  });

  it.each([
    { name: "a crop edge", clip: "inset(10px)", handle: "Crop right", dx: -20, dy: 0 },
    {
      name: "the reposition handle on fractional insets",
      clip: "inset(20px 0.42px 40px 0.03px)",
      handle: "Reposition crop",
      dx: 0,
      dy: 10,
    },
  ])("commits nothing when $name is dragged back to where it started", (c) => {
    const onStyleCommit = vi.fn();
    render(makeEl("a", c.clip), onStyleCommit);
    const handle = document.querySelector<HTMLButtonElement>(`[aria-label="${c.handle}"]`)!;
    for (const [type, d] of [
      ["pointerdown", 0],
      ["pointermove", 1],
      ["pointermove", 0],
      ["pointerup", 0],
    ] as const) {
      const at = { clientX: 100 + d * c.dx, clientY: 50 + d * c.dy };
      act(() =>
        handle.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 3, ...at })),
      );
    }
    expect(onStyleCommit).not.toHaveBeenCalled();
  });

  it("commits where the pointer was released, even before its last move renders", () => {
    const onStyleCommit = vi.fn();
    render(makeEl("a", "inset(10px)"), onStyleCommit);
    const handle = document.querySelector<HTMLButtonElement>('[aria-label="Crop right"]')!;
    act(() => {
      for (const [type, clientX] of [
        ["pointerdown", 100],
        ["pointermove", 90],
        ["pointermove", 80],
        ["pointerup", 80],
      ] as const) {
        handle.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 4, clientX }));
      }
    });
    expect(onStyleCommit).toHaveBeenCalledWith("clip-path", "inset(10px 30px 10px 10px)");
  });

  it("re-lifts when the crop commit rejects", async () => {
    const a = makeEl("a", "inset(10px)");
    const onStyleCommit = vi.fn((property: string, value: string) => {
      a.style.setProperty(property, value);
      return Promise.reject(new Error("persist failed"));
    });
    const { root } = render(a, onStyleCommit);
    const handle = document.querySelector<HTMLButtonElement>('[aria-label="Crop right"]');

    act(() =>
      handle!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 2, clientX: 100 }),
      ),
    );
    act(() =>
      handle!.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, pointerId: 2, clientX: 80 }),
      ),
    );
    await act(async () => {
      handle!.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerId: 2, clientX: 80 }),
      );
      await Promise.resolve();
    });

    expect(a.style.getPropertyValue("clip-path")).toBe("none");
    act(() => root.unmount());
  });
});

describe("DomEditCropHandles leaves the corner resize dots free", () => {
  type Box = { left: number; top: number; width: number; height: number };
  const HIT = 16;
  const cornerSquares = (r: Box): Box[] =>
    [
      [r.left, r.top],
      [r.left + r.width, r.top],
      [r.left, r.top + r.height],
      [r.left + r.width, r.top + r.height],
    ].map(([x, y]) => ({ left: x - HIT / 2, top: y - HIT / 2, width: HIT, height: HIT }));
  const overlaps = (a: Box, b: Box) =>
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height;
  const handles = () =>
    [...document.querySelectorAll<HTMLElement>("[data-dom-edit-crop-handle]")].map((el) => ({
      label: el.getAttribute("aria-label"),
      box: {
        left: parseFloat(el.style.left),
        top: parseFloat(el.style.top),
        width: parseFloat(el.style.width),
        height: parseFloat(el.style.height),
      },
    }));
  const rectOf = (width: number, height: number): OverlayRect => ({
    left: 0,
    top: 0,
    width,
    height,
    editScaleX: 1,
    editScaleY: 1,
  });

  it.each([
    {
      name: "29x14",
      size: [29, 14],
      clip: "",
      cropped: { left: 0, top: 0, width: 29, height: 14 },
    },
    {
      name: "40x40",
      size: [40, 40],
      clip: "",
      cropped: { left: 0, top: 0, width: 40, height: 40 },
    },
    {
      name: "29x14",
      size: [29, 14],
      clip: "inset(2px)",
      cropped: { left: 2, top: 2, width: 25, height: 10 },
    },
    {
      name: "200x100",
      size: [200, 100],
      clip: "inset(10px)",
      cropped: { left: 10, top: 10, width: 180, height: 80 },
    },
  ])("no crop handle covers a corner of a $name box clipped '$clip'", (c) => {
    render(makeEl("a", c.clip), undefined, rectOf(c.size[0], c.size[1]));
    const found = handles();
    expect(found.length).toBeGreaterThan(0);
    for (const handle of found) {
      for (const corner of cornerSquares(c.cropped)) {
        expect(overlaps(handle.box, corner), `${handle.label} covers a corner`).toBe(false);
      }
    }
  });

  it("keeps every handle where the edges have room, and drops only those with none", () => {
    render(makeEl("a", "inset(10px)"), undefined, rectOf(200, 100));
    expect(handles().map((h) => h.label)).toEqual([
      "Reposition crop",
      "Crop top",
      "Crop right",
      "Crop bottom",
      "Crop left",
    ]);
    document.body.innerHTML = "";
    render(makeEl("b", ""), undefined, rectOf(29, 14));
    expect(handles().map((h) => h.label)).toEqual(["Crop top", "Crop bottom"]);
  });
});
