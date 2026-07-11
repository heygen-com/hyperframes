import { describe, expect, it } from "vitest";
import {
  cropRectFromInsets,
  hugRectForElement,
  readElementCropInsets,
  resolveCropInsetFromEdgeDrag,
  resolveCropInsetFromMoveDrag,
} from "./domEditOverlayCrop";

describe("resolveCropInsetFromEdgeDrag", () => {
  const startInsets = { top: 10, right: 20, bottom: 30, left: 40 };

  it("converts overlay-space edge movement into element-space inset changes", () => {
    expect(
      resolveCropInsetFromEdgeDrag({
        edge: "left",
        startInsets,
        deltaX: 20,
        deltaY: 0,
        scaleX: 2,
        scaleY: 1,
        width: 200,
        height: 120,
      }),
    ).toEqual({ top: 10, right: 20, bottom: 30, left: 50 });

    expect(
      resolveCropInsetFromEdgeDrag({
        edge: "right",
        startInsets,
        deltaX: 20,
        deltaY: 0,
        scaleX: 2,
        scaleY: 1,
        width: 200,
        height: 120,
      }),
    ).toEqual({ top: 10, right: 10, bottom: 30, left: 40 });
  });

  it("clamps edited insets so opposing sides never overlap", () => {
    expect(
      resolveCropInsetFromEdgeDrag({
        edge: "left",
        startInsets,
        deltaX: 400,
        deltaY: 0,
        scaleX: 1,
        scaleY: 1,
        width: 100,
        height: 120,
      }),
    ).toEqual({ top: 10, right: 20, bottom: 30, left: 80 });

    expect(
      resolveCropInsetFromEdgeDrag({
        edge: "top",
        startInsets,
        deltaX: 0,
        deltaY: -40,
        scaleX: 1,
        scaleY: 2,
        width: 200,
        height: 120,
      }),
    ).toEqual({ top: 0, right: 20, bottom: 30, left: 40 });
  });
});

describe("resolveCropInsetFromMoveDrag", () => {
  const startInsets = { top: 10, right: 20, bottom: 30, left: 40 };

  it("shifts opposing insets together so the crop size stays constant", () => {
    expect(
      resolveCropInsetFromMoveDrag({ startInsets, deltaX: 20, deltaY: -10, scaleX: 2, scaleY: 1 }),
    ).toEqual({ top: 0, right: 10, bottom: 40, left: 50 });
  });

  it("clamps the window inside the element bounds", () => {
    expect(
      resolveCropInsetFromMoveDrag({ startInsets, deltaX: 999, deltaY: 999, scaleX: 1, scaleY: 1 }),
    ).toEqual({ top: 40, right: 0, bottom: 0, left: 60 });
  });
});

describe("cropRectFromInsets", () => {
  it("shrinks the overlay rect by scaled insets", () => {
    expect(
      cropRectFromInsets(
        { left: 100, top: 50, width: 200, height: 100 },
        { top: 10, right: 40, bottom: 20, left: 30 },
        2,
        1,
      ),
    ).toEqual({ left: 160, top: 60, width: 60, height: 70 });
  });

  it("clamps to zero size when insets exceed the rect", () => {
    const r = cropRectFromInsets(
      { left: 0, top: 0, width: 100, height: 100 },
      { top: 300, right: 300, bottom: 300, left: 300 },
      1,
      1,
    );
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
  });
});

describe("readElementCropInsets tri-state", () => {
  // Regression: a clip-path the crop tool can't represent (circle/polygon/
  // non-px inset) used to parse to ZEROS — indistinguishable from "no crop" —
  // so selecting lifted the clip and deselecting removed/replaced it: the
  // authored circle clip was silently destroyed by a mere select+deselect.
  const fakeEl = (inlineClip: string) =>
    ({
      style: { getPropertyValue: (p: string) => (p === "clip-path" ? inlineClip : "") },
      ownerDocument: { defaultView: { getComputedStyle: () => ({ clipPath: "none" }) } },
    }) as unknown as HTMLElement;

  it("zeros for no clip", () => {
    expect(readElementCropInsets(fakeEl(""))).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      radius: 0,
    });
  });

  it("parses a px inset", () => {
    expect(readElementCropInsets(fakeEl("inset(16px round 12px)"))).toEqual({
      top: 16,
      right: 16,
      bottom: 16,
      left: 16,
      radius: 12,
    });
  });

  it("null for a circle clip (uneditable, must not be lifted)", () => {
    expect(readElementCropInsets(fakeEl("circle(50% at 50% 50%)"))).toBeNull();
  });

  it("null for a non-px inset (uneditable, must not be lifted)", () => {
    expect(readElementCropInsets(fakeEl("inset(10%)"))).toBeNull();
  });

  it("hugRectForElement passes the rect through for uneditable clips", () => {
    const rect = { left: 1, top: 2, width: 30, height: 40, editScaleX: 1, editScaleY: 1 };
    expect(hugRectForElement(rect, fakeEl("circle(50%)"))).toEqual(rect);
  });
});
