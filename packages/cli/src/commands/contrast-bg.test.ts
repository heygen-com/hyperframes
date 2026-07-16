import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  parseColorRGBA,
  pickOpaqueBackground,
  relativeLuminance,
  requiredContrastRatio,
  suggestCompliantForegroundColor,
} from "./contrast-bg.js";

const opaque = (bg: string) => ({ backgroundColor: bg, backgroundImage: "none" });

describe("parseColorRGBA", () => {
  it("parses rgb() with default opaque alpha", () => {
    expect(parseColorRGBA("rgb(12, 34, 56)")).toEqual([12, 34, 56, 1]);
  });
  it("parses rgba() alpha", () => {
    expect(parseColorRGBA("rgba(0, 0, 0, 0)")).toEqual([0, 0, 0, 0]);
  });
  it("returns null for non-rgb strings", () => {
    expect(parseColorRGBA("transparent")).toBeNull();
    expect(parseColorRGBA("")).toBeNull();
    expect(parseColorRGBA(null)).toBeNull();
  });
});

describe("pickOpaqueBackground", () => {
  it("returns the element's own opaque background-color", () => {
    // The core bug: a caption/CTA with its own solid pill background. Its text
    // is readable against that pill; the ring outside the box is irrelevant.
    expect(pickOpaqueBackground([opaque("rgb(255, 255, 255)")])).toEqual([255, 255, 255]);
  });

  it("walks up to an opaque ancestor when the element itself is transparent", () => {
    const chain = [
      opaque("rgba(0, 0, 0, 0)"), // element: transparent
      opaque("rgb(20, 20, 20)"), // container: solid dark card behind the text
    ];
    expect(pickOpaqueBackground(chain)).toEqual([20, 20, 20]);
  });

  it("defers to the ring (null) when a background-image is hit first", () => {
    // Text over a real photo — the pixel ring is the right proxy, not a color.
    const chain = [
      opaque("rgba(0, 0, 0, 0)"),
      { backgroundColor: "rgb(20, 20, 20)", backgroundImage: 'url("photo.jpg")' },
    ];
    expect(pickOpaqueBackground(chain)).toBeNull();
  });

  it("skips a semi-transparent background-color and keeps walking", () => {
    const chain = [
      opaque("rgba(255, 255, 255, 0.4)"), // blends with below — not a reliable bg
      opaque("rgb(10, 10, 10)"),
    ];
    expect(pickOpaqueBackground(chain)).toEqual([10, 10, 10]);
  });

  it("returns null when nothing opaque exists (text truly over the scene)", () => {
    expect(pickOpaqueBackground([opaque("rgba(0, 0, 0, 0)")])).toBeNull();
  });
});

describe("relativeLuminance", () => {
  it("uses the WCAG sRGB transfer function", () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 255, 255])).toBe(1);
    expect(relativeLuminance([255, 0, 0])).toBeCloseTo(0.2126, 4);
  });
});

describe("contrastRatio", () => {
  it("is symmetric and reaches 21:1 for black and white", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBe(21);
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBe(21);
  });
});

describe("requiredContrastRatio", () => {
  it("requires 3:1 for large text and 4.5:1 otherwise", () => {
    expect(requiredContrastRatio(true)).toBe(3);
    expect(requiredContrastRatio(false)).toBe(4.5);
  });
});

describe("suggestCompliantForegroundColor", () => {
  it("brightens a failing foreground on a dark background until it passes", () => {
    const background: [number, number, number] = [20, 20, 20];
    const foreground: [number, number, number] = [80, 80, 80];
    const suggested = suggestCompliantForegroundColor(foreground, background, 4.5);

    expect(suggested[0]).toBeGreaterThan(foreground[0]);
    expect(contrastRatio(suggested, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("darkens a failing foreground on a light background until it passes", () => {
    const background: [number, number, number] = [245, 245, 245];
    const foreground: [number, number, number] = [180, 180, 180];
    const suggested = suggestCompliantForegroundColor(foreground, background, 4.5);

    expect(suggested[0]).toBeLessThan(foreground[0]);
    expect(contrastRatio(suggested, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("preserves a foreground that already passes", () => {
    expect(suggestCompliantForegroundColor([255, 255, 255], [0, 0, 0], 4.5)).toEqual([
      255, 255, 255,
    ]);
  });
});
