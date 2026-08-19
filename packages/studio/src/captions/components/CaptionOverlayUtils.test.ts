// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { readGsapTransform } from "./CaptionOverlayUtils";

describe("readGsapTransform", () => {
  it("preserves a zero GSAP scale", () => {
    const element = document.createElement("span");
    const values: Record<string, number> = { x: 0, y: 0, scale: 0, rotation: 0 };
    const iframeWindow = {
      gsap: {
        getProperty: (_element: HTMLElement, property: string) => values[property],
      },
    } as unknown as Window;

    expect(readGsapTransform(element, iframeWindow)).toEqual({
      x: 0,
      y: 0,
      scale: 0,
      rotation: 0,
    });
  });

  it("falls back for non-finite GSAP values", () => {
    const element = document.createElement("span");
    const iframeWindow = {
      gsap: {
        getProperty: () => Number.NaN,
      },
    } as unknown as Window;

    expect(readGsapTransform(element, iframeWindow)).toEqual({
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    });
  });
});
