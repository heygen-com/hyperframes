import { describe, expect, it } from "vitest";

import { mapPresetForGpuEncoder } from "./gpuEncoder.js";

describe("mapPresetForGpuEncoder", () => {
  describe("nvenc", () => {
    it.each([
      ["ultrafast", "p1"],
      ["superfast", "p1"],
      ["veryfast", "p2"],
      ["faster", "p3"],
      ["fast", "p4"],
      ["medium", "p4"],
      ["slow", "p5"],
      ["slower", "p6"],
      ["veryslow", "p7"],
      ["placebo", "p7"],
    ])("maps libx264 preset %s to NVENC %s", (input, expected) => {
      expect(mapPresetForGpuEncoder("nvenc", input)).toBe(expected);
    });

    it.each(["p1", "p2", "p3", "p4", "p5", "p6", "p7"])(
      "passes NVENC-native preset %s through unchanged",
      (preset) => {
        expect(mapPresetForGpuEncoder("nvenc", preset)).toBe(preset);
      },
    );

    it("falls back to p4 for unknown preset values", () => {
      expect(mapPresetForGpuEncoder("nvenc", "nonsense")).toBe("p4");
    });
  });

  describe("qsv", () => {
    it.each([
      ["ultrafast", "veryfast"],
      ["superfast", "veryfast"],
      ["placebo", "veryslow"],
    ])("rewrites libx264-only preset %s to QSV-supported %s", (input, expected) => {
      expect(mapPresetForGpuEncoder("qsv", input)).toBe(expected);
    });

    it.each(["veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"])(
      "passes supported preset %s through unchanged",
      (preset) => {
        expect(mapPresetForGpuEncoder("qsv", preset)).toBe(preset);
      },
    );
  });

  describe("other encoders", () => {
    it.each(["videotoolbox", "vaapi"] as const)(
      "passes preset through unchanged for %s",
      (encoder) => {
        expect(mapPresetForGpuEncoder(encoder, "medium")).toBe("medium");
        expect(mapPresetForGpuEncoder(encoder, "ultrafast")).toBe("ultrafast");
      },
    );

    it("passes preset through unchanged when encoder is null (CPU)", () => {
      expect(mapPresetForGpuEncoder(null, "ultrafast")).toBe("ultrafast");
    });
  });
});
