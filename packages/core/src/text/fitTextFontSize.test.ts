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
});
