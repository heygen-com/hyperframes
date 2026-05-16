// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREVIEW_ZOOM,
  MAX_PREVIEW_ZOOM_PERCENT,
  MIN_PREVIEW_ZOOM_PERCENT,
  canStartPreviewPan,
  clampPreviewPan,
  clampPreviewZoomPercent,
  getNextPreviewZoomPercent,
  getPreviewWheelZoomPercent,
  ownsPreviewPanTarget,
  PREVIEW_PAN_OVERSCROLL_PX,
  PREVIEW_PAN_SURFACE_SELECTOR,
  resolvePreviewWheelPan,
  resolvePreviewWheelZoom,
  toDomPrecision,
} from "./previewZoom";

describe("toDomPrecision", () => {
  it("rounds to 4 decimal places", () => {
    expect(toDomPrecision(1.23456789)).toBe(1.2346);
  });

  it("preserves zero", () => {
    expect(toDomPrecision(0)).toBe(0);
  });

  it("handles negative values", () => {
    expect(toDomPrecision(-3.14159)).toBe(-3.1416);
  });
});

describe("clampPreviewZoomPercent", () => {
  it("falls back to fit zoom for invalid input", () => {
    expect(clampPreviewZoomPercent(Number.NaN)).toBe(100);
  });

  it("clamps to supported preview zoom bounds", () => {
    expect(clampPreviewZoomPercent(1)).toBe(MIN_PREVIEW_ZOOM_PERCENT);
    expect(clampPreviewZoomPercent(5000)).toBe(MAX_PREVIEW_ZOOM_PERCENT);
  });
});

describe("getPreviewWheelZoomPercent", () => {
  it("zooms in on negative deltaY (scroll up / pinch out)", () => {
    expect(getPreviewWheelZoomPercent(-5, 100)).toBeGreaterThan(100);
  });

  it("zooms out on positive deltaY (scroll down / pinch in)", () => {
    expect(getPreviewWheelZoomPercent(5, 200)).toBeLessThan(200);
  });

  it("clamps large deltas to prevent overshoot", () => {
    const small = getPreviewWheelZoomPercent(-5, 100);
    const large = getPreviewWheelZoomPercent(-50, 100);
    expect(large).toBeLessThan(small * 2);
  });

  it("preserves the current zoom for invalid input", () => {
    expect(getPreviewWheelZoomPercent(Number.NaN, 180)).toBe(180);
  });
});

describe("getNextPreviewZoomPercent", () => {
  it("steps preview zoom in and out", () => {
    expect(getNextPreviewZoomPercent("in", 100)).toBe(125);
    expect(getNextPreviewZoomPercent("out", 125)).toBe(100);
  });
});

describe("clampPreviewPan", () => {
  it("allows a small overscroll margin at fit zoom", () => {
    const next = clampPreviewPan({
      panX: 900,
      panY: -900,
      zoomPercent: 100,
      viewportWidth: 800,
      viewportHeight: 600,
    });

    expect(next.panX).toBe(PREVIEW_PAN_OVERSCROLL_PX);
    expect(next.panY).toBe(-PREVIEW_PAN_OVERSCROLL_PX);
  });

  it("keeps pan within the zoomed preview bounds", () => {
    expect(
      clampPreviewPan({
        panX: 900,
        panY: -900,
        zoomPercent: 200,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).toEqual({
      panX: 400 + PREVIEW_PAN_OVERSCROLL_PX,
      panY: -(300 + PREVIEW_PAN_OVERSCROLL_PX),
    });
  });

  it("allows overscroll even when only one axis overflows", () => {
    expect(
      clampPreviewPan({
        panX: 120,
        panY: -90,
        zoomPercent: 107.25,
        viewportWidth: 1352,
        viewportHeight: 682,
        contentWidth: 1184,
        contentHeight: 666,
      }),
    ).toEqual({
      panX: PREVIEW_PAN_OVERSCROLL_PX,
      panY: -(16.142499999999984 + PREVIEW_PAN_OVERSCROLL_PX),
    });
  });
});

describe("canStartPreviewPan", () => {
  it("allows middle mouse pan at fit zoom", () => {
    expect(canStartPreviewPan(1)).toBe(true);
  });

  it("allows middle mouse pan when zoomed in", () => {
    expect(canStartPreviewPan(1)).toBe(true);
  });

  it("rejects other mouse buttons", () => {
    expect(canStartPreviewPan(0)).toBe(false);
    expect(canStartPreviewPan(2)).toBe(false);
  });
});

describe("ownsPreviewPanTarget", () => {
  it("accepts targets inside the preview stage", () => {
    const stage = document.createElement("div");
    const child = document.createElement("div");
    stage.appendChild(child);

    expect(ownsPreviewPanTarget(child, stage)).toBe(true);
  });

  it("accepts targets inside the shared preview pan surface", () => {
    const surface = document.createElement("div");
    surface.setAttribute("data-preview-pan-surface", "true");
    const overlay = document.createElement("div");
    surface.appendChild(overlay);

    expect(ownsPreviewPanTarget(overlay, null)).toBe(true);
  });

  it("rejects targets outside the preview stage and preview pan surface", () => {
    const outside = document.createElement("div");

    expect(ownsPreviewPanTarget(outside, null)).toBe(false);
  });

  it("uses the shared preview pan surface selector contract", () => {
    expect(PREVIEW_PAN_SURFACE_SELECTOR).toBe('[data-preview-pan-surface="true"]');
  });
});

describe("resolvePreviewWheelZoom", () => {
  it("zooms in from center without shifting pan", () => {
    const next = resolvePreviewWheelZoom({
      state: DEFAULT_PREVIEW_ZOOM,
      deltaY: -5,
      viewportWidth: 800,
      viewportHeight: 600,
    });

    expect(next.zoomPercent).toBeGreaterThan(100);
    expect(next.panX).toBe(0);
    expect(next.panY).toBe(0);
  });

  it("preserves small pan inside the overscroll margin when zooming out past minimum", () => {
    const next = resolvePreviewWheelZoom({
      state: { zoomPercent: 26, panX: 20, panY: 20 },
      deltaY: 500,
      viewportWidth: 800,
      viewportHeight: 600,
    });

    expect(next.zoomPercent).toBeCloseTo(MIN_PREVIEW_ZOOM_PERCENT, 0);
    expect(next.panX).toBe(20);
    expect(next.panY).toBe(20);
  });
});

describe("resolvePreviewWheelPan", () => {
  it("moves preview pan from wheel deltas", () => {
    const next = resolvePreviewWheelPan({
      state: DEFAULT_PREVIEW_ZOOM,
      deltaX: 18,
      deltaY: -12,
      viewportWidth: 800,
      viewportHeight: 600,
    });

    expect(next.zoomPercent).toBe(100);
    expect(next.panX).toBe(-18);
    expect(next.panY).toBe(12);
  });

  it("keeps wheel pan inside overscroll bounds", () => {
    const next = resolvePreviewWheelPan({
      state: DEFAULT_PREVIEW_ZOOM,
      deltaX: -900,
      deltaY: 900,
      viewportWidth: 800,
      viewportHeight: 600,
    });

    expect(next.panX).toBe(PREVIEW_PAN_OVERSCROLL_PX);
    expect(next.panY).toBe(-PREVIEW_PAN_OVERSCROLL_PX);
  });
});
