import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    ["#f008", { red: 255, green: 0, blue: 0, alpha: 136 / 255 }],
    ["rgb(255 0 0 / 50%)", { red: 255, green: 0, blue: 0, alpha: 0.5 }],
    ["rgb(100% 0% 0% / 0.001)", { red: 255, green: 0, blue: 0, alpha: 0.001 }],
  ])("parses %s without a browser", (input, expected) => {
    expect(parseCssColor(input)).toEqual(expected);
  });

  it.each(["", "#12", "notacolor", "currentcolor", "none", "rgb(1..2, 3, 4)", "rgb(1. 2 3)"])(
    "rejects %s without a browser",
    (input) => {
      expect(parseCssColor(input)).toBeNull();
    },
  );
});

describe("parseCssColor with a canvas", () => {
  function stubCanvas(serializations: Record<string, string>) {
    const known = new Map(Object.entries(serializations));
    let fillStyle = "#000000";
    const context = {
      get fillStyle() {
        return fillStyle;
      },
      set fillStyle(value: string) {
        if (value === "#000000" || value === "#ffffff") fillStyle = value;
        else fillStyle = known.get(value) ?? fillStyle;
      },
    };
    vi.stubGlobal("CSS", { supports: () => true });
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => context }) });
  }

  async function parseInBrowser(value: string) {
    const module = await import("./colorValue");
    return module.parseCssColor(value);
  }

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("converts through relative color syntax", async () => {
    stubCanvas({
      "color(from oklch(0.7 0.15 200) srgb r g b / alpha)":
        "color(srgb -0.316663 0.724435 0.764448)",
    });
    expect(await parseInBrowser("oklch(0.7 0.15 200)")).toEqual({
      red: 0,
      green: 185,
      blue: 195,
      alpha: 1,
    });
  });

  it("reads relative colors that the canvas serializes as rgba()", async () => {
    stubCanvas({
      "color(from oklch(0.7 0.15 200 / 0.5) srgb r g b / alpha)": "rgba(0, 185, 195, 0.5)",
    });
    expect(await parseInBrowser("oklch(0.7 0.15 200 / 0.5)")).toEqual({
      red: 0,
      green: 185,
      blue: 195,
      alpha: 0.5,
    });
  });

  it("falls back to the plain value when the canvas lacks relative colors", async () => {
    stubCanvas({ white: "#ffffff" });
    expect(await parseInBrowser("white")).toEqual({ red: 255, green: 255, blue: 255, alpha: 1 });
  });

  it("accepts a color that serializes the same as a sentinel", async () => {
    stubCanvas({ "color(from black srgb r g b / alpha)": "#000000" });
    expect(await parseInBrowser("black")).toEqual({ red: 0, green: 0, blue: 0, alpha: 1 });
  });

  it("rejects values the canvas ignores instead of reading its previous color", async () => {
    stubCanvas({});
    expect(await parseInBrowser("notacolor")).toBeNull();
  });

  it.each(["currentcolor", "var(--color)"])(
    "rejects %s, which has no value outside an element",
    async (input) => {
      stubCanvas({ [`color(from ${input} srgb r g b / alpha)`]: "color(srgb 1 0 0)" });
      expect(await parseInBrowser(input)).toBeNull();
    },
  );
});

describe("toColorPickerValue", () => {
  it("converts css color to hex", () => {
    expect(toColorPickerValue("rgba(15, 23, 42, 0.64)")).toBe("#0f172a");
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
