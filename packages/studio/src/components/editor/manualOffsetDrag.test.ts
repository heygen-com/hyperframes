import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import {
  applyManualOffsetDragCommit,
  applyManualOffsetDragMatrix,
  createManualOffsetDragMember,
  endManualOffsetDragMembers,
  invertManualOffsetDragMatrix,
  measureManualOffsetDragScreenToOffsetMatrix,
  resolveManualOffsetForPointerDelta,
  type ManualOffsetDragMatrix,
} from "./manualOffsetDrag";
import { STUDIO_OFFSET_X_PROP, STUDIO_OFFSET_Y_PROP } from "./manualEdits";

function expectMatrixClose(actual: ManualOffsetDragMatrix, expected: ManualOffsetDragMatrix): void {
  expect(actual.a).toBeCloseTo(expected.a, 6);
  expect(actual.b).toBeCloseTo(expected.b, 6);
  expect(actual.c).toBeCloseTo(expected.c, 6);
  expect(actual.d).toBeCloseTo(expected.d, 6);
}

describe("manual offset drag matrix helpers", () => {
  it("inverts identity movement", () => {
    const inverse = invertManualOffsetDragMatrix({ a: 1, b: 0, c: 0, d: 1 });
    if (!inverse) throw new Error("identity matrix should be invertible");

    expectMatrixClose(inverse, { a: 1, b: 0, c: 0, d: 1 });
  });

  it("maps screen movement through a rotated coordinate system", () => {
    const screenToOffset = invertManualOffsetDragMatrix({ a: 0, b: 1, c: -1, d: 0 });
    if (!screenToOffset) throw new Error("rotation matrix should be invertible");

    const offsetDelta = applyManualOffsetDragMatrix(screenToOffset, { x: 0, y: 10 });

    expect(offsetDelta.x).toBeCloseTo(10, 6);
    expect(offsetDelta.y).toBeCloseTo(0, 6);
  });

  it("rejects singular movement matrices", () => {
    expect(invertManualOffsetDragMatrix({ a: 1, b: 1, c: 2, d: 2 })).toBeNull();
  });

  it("resolves final offsets from the measured inverse matrix", () => {
    const offsetToScreen = { a: 2, b: 3, c: -1, d: 4 };
    const screenToOffset = invertManualOffsetDragMatrix(offsetToScreen);
    if (!screenToOffset) throw new Error("fixture matrix should be invertible");

    const nextOffset = resolveManualOffsetForPointerDelta({
      initialOffset: { x: 5, y: -2 },
      screenToOffset,
      dx: 7,
      dy: 11,
    });
    const screenDelta = applyManualOffsetDragMatrix(offsetToScreen, {
      x: nextOffset.x - 5,
      y: nextOffset.y + 2,
    });

    expect(screenDelta.x).toBeCloseTo(7, 6);
    expect(screenDelta.y).toBeCloseTo(11, 6);
  });
});

describe("measureManualOffsetDragScreenToOffsetMatrix", () => {
  it("measures the element center response and restores probe styles", () => {
    const window = new Window();
    const element = window.document.createElement("div");
    element.setAttribute("data-hf-studio-path-offset", "true");
    window.document.body.append(element);

    element.getBoundingClientRect = () => {
      const offsetX = Number.parseFloat(element.style.getPropertyValue(STUDIO_OFFSET_X_PROP)) || 0;
      const offsetY = Number.parseFloat(element.style.getPropertyValue(STUDIO_OFFSET_Y_PROP)) || 0;
      return new window.DOMRect(10 + 2 * offsetX - offsetY, 20 + 3 * offsetX + 4 * offsetY, 12, 8);
    };

    const measured = measureManualOffsetDragScreenToOffsetMatrix(element, { x: 0, y: 0 });
    if (!measured.ok) throw new Error(measured.reason);

    const expected = invertManualOffsetDragMatrix({ a: 2, b: 3, c: -1, d: 4 });
    if (!expected) throw new Error("fixture matrix should be invertible");

    expectMatrixClose(measured.matrix, expected);
    expect(element.style.getPropertyValue(STUDIO_OFFSET_X_PROP)).toBe("");
    expect(element.style.getPropertyValue(STUDIO_OFFSET_Y_PROP)).toBe("");
    expect(element.style.getPropertyValue("translate")).toBe("");
  });

  it("measures movement in parent viewport pixels when the element is inside a scaled iframe", () => {
    const window = new Window();
    const iframe = window.document.createElement("iframe");
    window.document.body.append(iframe);
    const iframeWindow = iframe.contentWindow;
    const iframeDocument = iframe.contentDocument;
    if (!iframeWindow || !iframeDocument) throw new Error("iframe fixture failed to initialize");

    Object.defineProperty(iframeWindow, "frameElement", {
      configurable: true,
      value: iframe,
    });
    Object.defineProperty(iframeWindow, "innerWidth", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(iframeWindow, "innerHeight", {
      configurable: true,
      value: 100,
    });
    iframe.getBoundingClientRect = () => new window.DOMRect(50, 40, 100, 50);

    const element = iframeDocument.createElement("div");
    element.setAttribute("data-hf-studio-path-offset", "true");
    iframeDocument.body.append(element);
    element.getBoundingClientRect = () => {
      const offsetX = Number.parseFloat(element.style.getPropertyValue(STUDIO_OFFSET_X_PROP)) || 0;
      const offsetY = Number.parseFloat(element.style.getPropertyValue(STUDIO_OFFSET_Y_PROP)) || 0;
      return new iframeWindow.DOMRect(20 + offsetX, 30 + offsetY, 40, 20);
    };

    const measured = measureManualOffsetDragScreenToOffsetMatrix(element, { x: 0, y: 0 });
    if (!measured.ok) throw new Error(measured.reason);

    expectMatrixClose(measured.matrix, { a: 2, b: -0, c: -0, d: 2 });

    const nextOffset = resolveManualOffsetForPointerDelta({
      initialOffset: { x: 0, y: 0 },
      screenToOffset: measured.matrix,
      dx: 50,
      dy: 25,
    });
    expect(nextOffset).toEqual({ x: 100, y: 50 });
  });

  it("returns identity matrix for non-path-offset elements with zero initial offset", () => {
    const window = new Window();
    const element = window.document.createElement("div");
    window.document.body.append(element);
    element.getBoundingClientRect = () => new window.DOMRect(10, 20, 12, 8);

    const measured = measureManualOffsetDragScreenToOffsetMatrix(element, { x: 0, y: 0 });

    expect(measured.ok).toBe(true);
    if (measured.ok) {
      expectMatrixClose(measured.matrix, { a: 1, b: 0, c: 0, d: 1 });
    }
  });

  it("rejects path-offset elements whose movement response cannot be measured", () => {
    const window = new Window();
    const element = window.document.createElement("div");
    element.setAttribute("data-hf-studio-path-offset", "true");
    window.document.body.append(element);
    element.getBoundingClientRect = () => new window.DOMRect(10, 20, 12, 8);

    const measured = measureManualOffsetDragScreenToOffsetMatrix(element, { x: 0, y: 0 });

    expect(measured.ok).toBe(false);
  });
});

describe("createManualOffsetDragMember uses raw CSS var offset", () => {
  it("ignores GSAP transform — initialOffset comes from CSS vars only", () => {
    const window = new Window();
    const element = window.document.createElement("div");
    window.document.body.append(element);

    element.style.setProperty("transform", "translate(0px, -20px)");

    element.getBoundingClientRect = () => {
      const offsetX = Number.parseFloat(element.style.getPropertyValue(STUDIO_OFFSET_X_PROP)) || 0;
      const offsetY = Number.parseFloat(element.style.getPropertyValue(STUDIO_OFFSET_Y_PROP)) || 0;
      return new window.DOMRect(10 + offsetX, 20 + offsetY, 100, 50);
    };

    const result = createManualOffsetDragMember({
      key: "test",
      selection: { element } as never,
      element,
      rect: { left: 10, top: 20, width: 100, height: 50, editScaleX: 1, editScaleY: 1 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.member.initialOffset.x).toBe(0);
    expect(result.member.initialOffset.y).toBe(0);
  });

  it("reads only the CSS var offset, not GSAP transform", () => {
    const window = new Window();
    const element = window.document.createElement("div");
    window.document.body.append(element);

    element.style.setProperty(STUDIO_OFFSET_X_PROP, "30px");
    element.style.setProperty(STUDIO_OFFSET_Y_PROP, "10px");
    element.style.setProperty("transform", "translate(50px, -15px)");

    element.getBoundingClientRect = () => {
      const offsetX = Number.parseFloat(element.style.getPropertyValue(STUDIO_OFFSET_X_PROP)) || 0;
      const offsetY = Number.parseFloat(element.style.getPropertyValue(STUDIO_OFFSET_Y_PROP)) || 0;
      return new window.DOMRect(10 + offsetX, 20 + offsetY, 100, 50);
    };

    const result = createManualOffsetDragMember({
      key: "test",
      selection: { element } as never,
      element,
      rect: { left: 10, top: 20, width: 100, height: 50, editScaleX: 1, editScaleY: 1 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.member.initialOffset.x).toBe(30);
    expect(result.member.initialOffset.y).toBe(10);
  });

  it("does not accumulate drift across multiple drag cycles", () => {
    const window = new Window();
    const element = window.document.createElement("div");
    window.document.body.append(element);

    element.getBoundingClientRect = () => {
      const offsetX = Number.parseFloat(element.style.getPropertyValue(STUDIO_OFFSET_X_PROP)) || 0;
      const offsetY = Number.parseFloat(element.style.getPropertyValue(STUDIO_OFFSET_Y_PROP)) || 0;
      return new window.DOMRect(10 + offsetX, 20 + offsetY, 100, 50);
    };

    // Simulate GSAP baking a translate into transform each cycle
    for (let cycle = 0; cycle < 3; cycle++) {
      element.style.setProperty("transform", `translate(${50 * (cycle + 1)}px, 0px)`);

      const result = createManualOffsetDragMember({
        key: "test",
        selection: { element } as never,
        element,
        rect: { left: 10, top: 20, width: 100, height: 50, editScaleX: 1, editScaleY: 1 },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // initialOffset should always be the CSS var value, never inflated by GSAP transform
      const currentRawX =
        Number.parseFloat(element.style.getPropertyValue(STUDIO_OFFSET_X_PROP)) || 0;
      expect(result.member.initialOffset.x).toBe(currentRawX);

      // Simulate drag commit: apply a small offset
      applyManualOffsetDragCommit(result.member, 10, 0);
      endManualOffsetDragMembers([result.member]);
    }
  });
});
