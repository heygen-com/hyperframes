import { describe, expect, it } from "vitest";
import {
  formatCssColor,
  hsvToRgb,
  mergeColorWithExistingAlpha,
  parseCssColor,
  rgbToHsv,
  toColorPickerValue,
  toHexColor,
} from "./colorValue";

describe("parseCssColor", () => {
  it("parses rgb values", () => {
    expect(parseCssColor("rgb(12, 34, 56)")).toEqual({
      red: 12,
      green: 34,
      blue: 56,
      alpha: 1,
    });
  });

  it("parses rgba values", () => {
    expect(parseCssColor("rgba(15, 23, 42, 0.64)")).toEqual({
      red: 15,
      green: 23,
      blue: 42,
      alpha: 0.64,
    });
  });

  it("parses transparent", () => {
    expect(parseCssColor("transparent")).toEqual({
      red: 0,
      green: 0,
      blue: 0,
      alpha: 0,
    });
  });

  it.each([
    ["#fff", { red: 255, green: 255, blue: 255, alpha: 1 }],
    ["#0f172acc", { red: 15, green: 23, blue: 42, alpha: 0.8 }],
    ["white", { red: 255, green: 255, blue: 255, alpha: 1 }],
    ["rgb(255 0 0 / 50%)", { red: 255, green: 0, blue: 0, alpha: 0.5 }],
    ["hsl(210 40% 50%)", { red: 77, green: 127, blue: 179, alpha: 1 }],
    ["color(srgb 0.4 0 0.6)", { red: 102, green: 0, blue: 153, alpha: 1 }],
    ["oklch(0.7 0.15 200)", { red: 0, green: 185, blue: 195, alpha: 1 }],
    ["oklab(0.6 0.1 0.1)", { red: 195, green: 96, blue: 46, alpha: 1 }],
  ])("parses %s", (input, expected) => {
    expect(parseCssColor(input)).toEqual(expected);
  });

  it("clips out-of-gamut colors to srgb", () => {
    expect(parseCssColor("oklch(0.9 0.35 140)")).toEqual({
      red: 0,
      green: 255,
      blue: 0,
      alpha: 1,
    });
  });

  it.each(["", "#12", "notacolor", "currentcolor", "none"])("rejects %s", (input) => {
    expect(parseCssColor(input)).toBeNull();
  });
});

describe("toColorPickerValue", () => {
  it("converts css color to hex", () => {
    expect(toColorPickerValue("rgba(15, 23, 42, 0.64)")).toBe("#0f172a");
  });

  it("converts modern css colors to hex", () => {
    expect(toColorPickerValue("oklch(0.7 0.15 200)")).toBe("#00b9c3");
  });

  it("falls back to black for values that are not colors", () => {
    expect(toColorPickerValue("currentcolor")).toBe("#000000");
  });
});

describe("toHexColor", () => {
  it("formats rgb channels as hex", () => {
    expect(toHexColor({ red: 15, green: 23, blue: 42 })).toBe("#0f172a");
  });
});

describe("formatCssColor", () => {
  it("formats opaque colors as rgb", () => {
    expect(formatCssColor({ red: 18, green: 52, blue: 86, alpha: 1 })).toBe("rgb(18, 52, 86)");
  });

  it("formats translucent colors as rgba", () => {
    expect(formatCssColor({ red: 18, green: 52, blue: 86, alpha: 0.64 })).toBe(
      "rgba(18, 52, 86, 0.64)",
    );
  });
});

describe("rgb hsv conversion", () => {
  it("round-trips primary color values", () => {
    const hsv = rgbToHsv({ red: 47, green: 198, blue: 127 });
    expect(hsvToRgb(hsv)).toEqual({ red: 47, green: 198, blue: 127 });
  });
});

describe("mergeColorWithExistingAlpha", () => {
  it("preserves alpha when the previous color was translucent", () => {
    expect(mergeColorWithExistingAlpha("#123456", "rgba(15, 23, 42, 0.64)")).toBe(
      "rgba(18, 52, 86, 0.64)",
    );
  });

  it("returns rgb when the previous color was opaque", () => {
    expect(mergeColorWithExistingAlpha("#123456", "rgb(15, 23, 42)")).toBe("rgb(18, 52, 86)");
  });
});
