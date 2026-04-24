import { describe, expect, it } from "vitest";
import { mergeColorWithExistingAlpha, parseCssColor, toColorPickerValue } from "./colorValue";

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
});

describe("toColorPickerValue", () => {
  it("converts css color to hex", () => {
    expect(toColorPickerValue("rgba(15, 23, 42, 0.64)")).toBe("#0f172a");
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
