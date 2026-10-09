import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @chenglou/pretext since jsdom lacks real canvas measureText accuracy.
vi.mock("@chenglou/pretext", () => ({
  prepare: vi.fn((_text: string, _font: string) => ({ __mock: true, font: _font })),
  layout: vi.fn(),
}));

import { fitTextFontSize } from "./fitTextFontSize.js";
import { prepare, layout } from "@chenglou/pretext";

const mockLayout = vi.mocked(layout);
const mockPrepare = vi.mocked(prepare);

describe("fitTextFontSize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns base font size when text fits at base size", () => {
    mockLayout.mockReturnValue({ height: 90, lineCount: 1 });
    const result = fitTextFontSize("short text");
    expect(result).toEqual({ fontSize: 78, fits: true });
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    expect(mockLayout).toHaveBeenCalledTimes(1);
  });

  it("shrinks font size when text wraps at base size", () => {
    mockLayout
      .mockReturnValueOnce({ height: 180, lineCount: 2 })
      .mockReturnValueOnce({ height: 180, lineCount: 2 })
      .mockReturnValueOnce({ height: 90, lineCount: 1 });
    const result = fitTextFontSize("this is a much wider piece of text");
    expect(result).toEqual({ fontSize: 74, fits: true });
    expect(mockPrepare).toHaveBeenCalledTimes(3);
  });

  it("returns minFontSize with fits: false when text never fits", () => {
    mockLayout.mockReturnValue({ height: 180, lineCount: 2 });
    const result = fitTextFontSize("WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW");
    expect(result).toEqual({ fontSize: 42, fits: false });
    expect(mockPrepare).toHaveBeenCalledTimes(19); // (78 - 42) / 2 + 1
  });

  it("respects custom options", () => {
    mockLayout.mockReturnValue({ height: 60, lineCount: 1 });
    const result = fitTextFontSize("hello", {
      baseFontSize: 60,
      minFontSize: 30,
      fontWeight: 700,
      fontFamily: "Inter",
      maxWidth: 800,
      step: 4,
    });
    expect(result).toEqual({ fontSize: 60, fits: true });
    expect(mockPrepare).toHaveBeenCalledWith("hello", "700 60px Inter");
    expect(mockLayout).toHaveBeenCalledWith(expect.anything(), 800, 72);
  });

  it("passes correct font string to prepare for each size step", () => {
    mockLayout
      .mockReturnValueOnce({ height: 180, lineCount: 2 })
      .mockReturnValueOnce({ height: 90, lineCount: 1 });
    fitTextFontSize("test", {
      baseFontSize: 80,
      step: 10,
      fontWeight: 900,
      fontFamily: "Outfit",
    });
    expect(mockPrepare).toHaveBeenNthCalledWith(1, "test", "900 80px Outfit");
    expect(mockPrepare).toHaveBeenNthCalledWith(2, "test", "900 70px Outfit");
  });

  it.each([
    { baseFontSize: 78, minFontSize: 43, step: 2 },
    { baseFontSize: 60, minFontSize: 31, step: 4 },
    { baseFontSize: 55, minFontSize: 42.5, step: 3.5 },
    { baseFontSize: 48, minFontSize: 42, step: 10 },
    { baseFontSize: 44, minFontSize: 43, step: 2 },
  ])("accepts text that only fits at the minimum with %j", (options) => {
    mockLayout.mockImplementation(() => {
      const font = mockPrepare.mock.lastCall?.[1] ?? "";
      const size = Number(/ ([\d.]+)px /.exec(font)?.[1]);
      return { height: 90, lineCount: size <= options.minFontSize ? 1 : 2 };
    });

    expect(fitTextFontSize("fits at the floor", options)).toEqual({
      fontSize: options.minFontSize,
      fits: true,
    });
    expect(mockPrepare).toHaveBeenLastCalledWith(
      "fits at the floor",
      `900 ${options.minFontSize}px Outfit`,
    );
  });

  it("measures the minimum exactly once when it is already on a size step", () => {
    mockLayout.mockReturnValue({ height: 180, lineCount: 2 });
    expect(fitTextFontSize("too long", { baseFontSize: 48, minFontSize: 42, step: 2 })).toEqual({
      fontSize: 42,
      fits: false,
    });
    expect(mockPrepare.mock.calls.map((call) => call[1])).toEqual([
      "900 48px Outfit",
      "900 46px Outfit",
      "900 44px Outfit",
      "900 42px Outfit",
    ]);
  });
});
