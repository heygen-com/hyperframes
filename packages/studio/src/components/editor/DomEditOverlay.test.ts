import { describe, expect, it } from "vitest";
import {
  focusDomEditOverlayElement,
  resolveDomEditCoordinateScale,
  resolveDomEditPathOffsetGesture,
  resolveDomEditResizeGesture,
  resolveDomEditRotationGesture,
} from "./DomEditOverlay";

describe("focusDomEditOverlayElement", () => {
  it("focuses the canvas overlay without scrolling", () => {
    const calls: Array<FocusOptions | undefined> = [];
    focusDomEditOverlayElement({
      focus: (options?: FocusOptions) => calls.push(options),
    });

    expect(calls).toEqual([{ preventScroll: true }]);
  });
});

describe("resolveDomEditCoordinateScale", () => {
  it("uses the top-level preview scale when no source boundary dimensions are available", () => {
    expect(
      resolveDomEditCoordinateScale({
        rootScaleX: 0.5,
        rootScaleY: 0.5,
      }),
    ).toEqual({
      scaleX: 0.5,
      scaleY: 0.5,
    });
  });

  it("converts source-local pixels through a scaled nested composition host", () => {
    expect(
      resolveDomEditCoordinateScale({
        rootScaleX: 0.5,
        rootScaleY: 0.5,
        sourceRectWidth: 960,
        sourceRectHeight: 540,
        sourceWidth: 1920,
        sourceHeight: 1080,
      }),
    ).toEqual({
      scaleX: 0.25,
      scaleY: 0.25,
    });
  });
});

describe("resolveDomEditPathOffsetGesture", () => {
  it("writes source-local offsets when the edited source is scaled down in master view", () => {
    expect(
      resolveDomEditPathOffsetGesture({
        actualOffsetX: 10,
        actualOffsetY: -4,
        scaleX: 0.25,
        scaleY: 0.25,
        dx: 25,
        dy: 10,
      }),
    ).toEqual({
      x: 110,
      y: 36,
    });
  });
});

describe("resolveDomEditResizeGesture", () => {
  it("resizes width and height independently by default", () => {
    expect(
      resolveDomEditResizeGesture({
        originWidth: 240,
        originHeight: 120,
        actualWidth: 240,
        actualHeight: 120,
        scaleX: 1,
        scaleY: 1,
        dx: 30,
        dy: 12,
        uniform: false,
      }),
    ).toEqual({
      overlayWidth: 270,
      overlayHeight: 132,
      width: 270,
      height: 132,
    });
  });

  it("snaps width and height to the same value when Shift is held", () => {
    expect(
      resolveDomEditResizeGesture({
        originWidth: 240,
        originHeight: 120,
        actualWidth: 240,
        actualHeight: 120,
        scaleX: 1,
        scaleY: 1,
        dx: 30,
        dy: 12,
        uniform: true,
      }),
    ).toEqual({
      overlayWidth: 270,
      overlayHeight: 270,
      width: 270,
      height: 270,
    });
  });

  it("uses the dominant pointer delta for uniform shrink", () => {
    expect(
      resolveDomEditResizeGesture({
        originWidth: 300,
        originHeight: 180,
        actualWidth: 300,
        actualHeight: 180,
        scaleX: 1,
        scaleY: 1,
        dx: 8,
        dy: -40,
        uniform: true,
      }),
    ).toMatchObject({
      width: 260,
      height: 260,
    });
  });

  it("writes source-local dimensions when the edited source is scaled down in master view", () => {
    expect(
      resolveDomEditResizeGesture({
        originWidth: 100,
        originHeight: 50,
        actualWidth: 400,
        actualHeight: 200,
        scaleX: 0.25,
        scaleY: 0.25,
        dx: 25,
        dy: 10,
        uniform: false,
      }),
    ).toEqual({
      overlayWidth: 125,
      overlayHeight: 60,
      width: 500,
      height: 240,
    });
  });
});

describe("resolveDomEditRotationGesture", () => {
  it("rotates by the pointer angle around the element center", () => {
    expect(
      resolveDomEditRotationGesture({
        centerX: 0,
        centerY: 0,
        startX: 0,
        startY: -10,
        currentX: 10,
        currentY: 0,
        actualAngle: 5,
        snap: false,
      }),
    ).toEqual({ angle: 95 });
  });

  it("uses the shortest delta across the 180 degree boundary", () => {
    expect(
      resolveDomEditRotationGesture({
        centerX: 0,
        centerY: 0,
        startX: -10,
        startY: 1.76,
        currentX: -10,
        currentY: -1.76,
        actualAngle: 0,
        snap: false,
      }).angle,
    ).toBeCloseTo(20, 1);
  });

  it("snaps to 15 degree increments when requested", () => {
    expect(
      resolveDomEditRotationGesture({
        centerX: 0,
        centerY: 0,
        startX: 10,
        startY: 0,
        currentX: 10,
        currentY: 3.25,
        actualAngle: 0,
        snap: true,
      }),
    ).toEqual({ angle: 15 });
  });
});
