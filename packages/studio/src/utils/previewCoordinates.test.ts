// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { previewPointFromClient, resolvePreviewCoordinateSpace } from "./previewCoordinates";

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

describe("resolvePreviewCoordinateSpace", () => {
  it("uses declared composition dimensions ahead of transformed root rect dimensions", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Expected iframe document");

    doc.body.innerHTML = `<main id="scene" data-composition-id="scene" data-width="1600" data-height="900"></main>`;
    const scene = doc.getElementById("scene");
    if (!scene) throw new Error("Expected preview root");

    stubRect(iframe, domRect(10, 20, 800, 450));
    stubRect(scene, domRect(0, 0, 1000, 500));

    const space = resolvePreviewCoordinateSpace(iframe);
    expect(space?.viewport).toEqual({ width: 1600, height: 900 });
    expect(space?.scaleX).toBe(0.5);
    expect(space?.scaleY).toBe(0.5);

    iframe.remove();
  });

  it("falls back to a positive root rect when no declared dimensions exist", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Expected iframe document");

    doc.body.innerHTML = `<main id="scene" data-composition-id="scene"></main>`;
    const scene = doc.getElementById("scene");
    if (!scene) throw new Error("Expected preview root");

    stubRect(iframe, domRect(0, 0, 600, 300));
    stubRect(scene, domRect(0, 0, 1200, 600));

    const space = resolvePreviewCoordinateSpace(iframe);
    expect(space?.viewport).toEqual({ width: 1200, height: 600 });
    expect(space?.scaleX).toBe(0.5);
    expect(space?.scaleY).toBe(0.5);

    iframe.remove();
  });

  it("returns null when neither declared nor measured root dimensions are positive", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Expected iframe document");

    doc.body.innerHTML = `<main id="scene" data-composition-id="scene"></main>`;
    const scene = doc.getElementById("scene");
    if (!scene) throw new Error("Expected preview root");

    stubRect(iframe, domRect(0, 0, 600, 300));
    stubRect(scene, domRect(0, 0, 0, 0));
    Object.defineProperty(iframe.contentWindow, "innerWidth", { configurable: true, value: 0 });
    Object.defineProperty(iframe.contentWindow, "innerHeight", { configurable: true, value: 0 });

    expect(resolvePreviewCoordinateSpace(iframe)).toBeNull();

    iframe.remove();
  });

  it("maps host client points into composition coordinates", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Expected iframe document");

    doc.body.innerHTML = `<main id="scene" data-composition-id="scene" data-width="1600" data-height="900"></main>`;
    const scene = doc.getElementById("scene");
    if (!scene) throw new Error("Expected preview root");

    stubRect(iframe, domRect(10, 20, 800, 450));
    stubRect(scene, domRect(0, 0, 1600, 900));

    const space = resolvePreviewCoordinateSpace(iframe);
    if (!space) throw new Error("Expected coordinate space");
    expect(previewPointFromClient(space, 210, 120)).toEqual({
      x: 400,
      y: 200,
      viewport: { width: 1600, height: 900 },
    });

    iframe.remove();
  });
});
