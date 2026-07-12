import { describe, expect, it } from "vitest";
import {
  HF_COLOR_GRADING_COLOR_SPACE,
  HF_COLOR_GRADING_PRESETS,
  isHfColorGradingActive,
  normalizeHfColorGrading,
  normalizeHfColorGradingWithVariables,
  serializeHfColorGrading,
} from "./colorGrading";

describe("color grading", () => {
  it("parses preset shorthand", () => {
    const grading = normalizeHfColorGrading("warm-clean");
    expect(grading?.preset).toBe("warm-clean");
    expect(grading?.colorSpace).toBe(HF_COLOR_GRADING_COLOR_SPACE);
    expect(grading?.adjust.temperature).toBeGreaterThan(0);
    expect(isHfColorGradingActive(grading)).toBe(true);
  });

  it("includes consumer-friendly filter presets", () => {
    expect(HF_COLOR_GRADING_PRESETS.some((preset) => preset.id === "fresh-pop")).toBe(true);
    expect(normalizeHfColorGrading("mono-clean")?.adjust.saturation).toBe(-1);
    expect(normalizeHfColorGrading("vintage-wash")?.details.vignette).toBeGreaterThan(0);
    expect(normalizeHfColorGrading("food-pop")?.adjust.saturation).toBeGreaterThan(0);
    expect(normalizeHfColorGrading("food-pop")?.adjust.vibrance).toBeGreaterThan(0);
  });

  it("merges manual adjustments over preset values", () => {
    const grading = normalizeHfColorGrading({
      preset: "warm-clean",
      intensity: 0.5,
      adjust: { temperature: -0.25, contrast: 0.2 },
    });
    expect(grading?.intensity).toBe(0.5);
    expect(grading?.adjust.temperature).toBe(-0.25);
    expect(grading?.adjust.contrast).toBe(0.2);
    expect(grading?.adjust.saturation).toBeGreaterThan(0);
  });

  it("clamps values to supported shader ranges", () => {
    const grading = normalizeHfColorGrading({
      intensity: 2,
      adjust: { exposure: 10, contrast: -5, vibrance: 3, saturation: 3 },
      details: {
        vignette: 2,
        vignetteMidpoint: -1,
        vignetteRoundness: 2,
        vignetteFeather: 2,
        grain: -1,
        grainSize: 2,
        grainRoughness: -1,
      },
      effects: { blur: 2, pixelate: 3 },
      lut: { src: "looks/test.cube", intensity: 3 },
    });
    expect(grading?.intensity).toBe(1);
    expect(grading?.adjust.exposure).toBe(2);
    expect(grading?.adjust.contrast).toBe(-1);
    expect(grading?.adjust.vibrance).toBe(1);
    expect(grading?.adjust.saturation).toBe(1);
    expect(grading?.details.vignette).toBe(1);
    expect(grading?.details.vignetteMidpoint).toBe(0);
    expect(grading?.details.vignetteRoundness).toBe(1);
    expect(grading?.details.vignetteFeather).toBe(1);
    expect(grading?.details.grain).toBe(0);
    expect(grading?.details.grainSize).toBe(1);
    expect(grading?.details.grainRoughness).toBe(0);
    expect(grading?.effects.blur).toBe(1);
    expect(grading?.effects.pixelate).toBe(1);
    expect(grading?.lut?.intensity).toBe(1);
  });

  it("returns null for disabled or invalid grading", () => {
    expect(normalizeHfColorGrading({ enabled: false, preset: "warm-clean" })).toBeNull();
    expect(normalizeHfColorGrading("{nope")).toBeNull();
    expect(normalizeHfColorGrading("")).toBeNull();
  });

  it("serializes normalized grading for data-color-grading", () => {
    const grading = normalizeHfColorGrading({
      adjust: { exposure: 0.25 },
      details: { vignette: 0.3, grain: 0.1 },
      effects: { blur: 0.2, pixelate: 0.4 },
      lut: { src: "assets/luts/test.cube", intensity: 0.6 },
    });
    const serialized = serializeHfColorGrading(grading);
    expect(serialized).toContain('"exposure":0.25');
    expect(serialized).toContain('"vignette":0.3');
    expect(serialized).toContain('"grain":0.1');
    expect(serialized).toContain('"blur":0.2');
    expect(serialized).toContain('"pixelate":0.4');
    expect(serialized).toContain('"src":"assets/luts/test.cube"');
    expect(normalizeHfColorGrading(serialized)?.adjust.exposure).toBe(0.25);
    expect(normalizeHfColorGrading(serialized)?.details.vignette).toBe(0.3);
    expect(normalizeHfColorGrading(serialized)?.effects.blur).toBe(0.2);
    expect(normalizeHfColorGrading(serialized)?.lut?.intensity).toBe(0.6);
  });

  it("treats zero global intensity as inactive even with LUT data", () => {
    const grading = normalizeHfColorGrading({
      intensity: 0,
      adjust: { exposure: 0.5 },
      lut: { src: "assets/luts/test.cube", intensity: 1 },
    });
    expect(isHfColorGradingActive(grading)).toBe(false);
  });

  it("treats finishing details as active grading", () => {
    const grading = normalizeHfColorGrading({ details: { vignette: 0.2 } });
    expect(isHfColorGradingActive(grading)).toBe(true);
  });

  it("does not activate grading for advanced finishing defaults alone", () => {
    const grading = normalizeHfColorGrading({
      details: { vignetteMidpoint: 0.2, grainSize: 0.8 },
    });
    expect(isHfColorGradingActive(grading)).toBe(false);
  });

  it("treats media effects as active grading", () => {
    const grading = normalizeHfColorGrading({ effects: { blur: 0.2 } });
    expect(isHfColorGradingActive(grading)).toBe(true);
  });

  it("resolves exact variable references inside color grading JSON", () => {
    const grading = normalizeHfColorGradingWithVariables(
      JSON.stringify({
        preset: "$preset",
        intensity: "$gradingIntensity",
        adjust: {
          exposure: "${exposure}",
          vibrance: "$vibrance",
          saturation: "$saturation",
        },
        details: {
          vignette: "$vignette",
          grainSize: "$grainSize",
        },
        effects: { pixelate: "$pixelate" },
        lut: {
          src: "$lutSrc",
          intensity: "$lutIntensity",
        },
      }),
      {
        preset: "warm-clean",
        gradingIntensity: 0.6,
        exposure: 0.25,
        vibrance: 0.3,
        saturation: -0.2,
        vignette: 0.15,
        grainSize: 0.4,
        pixelate: 0.1,
        lutSrc: "assets/luts/warm.cube",
        lutIntensity: 0.4,
      },
    );

    expect(grading?.preset).toBe("warm-clean");
    expect(grading?.intensity).toBe(0.6);
    expect(grading?.adjust.exposure).toBe(0.25);
    expect(grading?.adjust.vibrance).toBe(0.3);
    expect(grading?.adjust.saturation).toBe(-0.2);
    expect(grading?.details.vignette).toBe(0.15);
    expect(grading?.details.grainSize).toBe(0.4);
    expect(grading?.effects.pixelate).toBe(0.1);
    expect(grading?.lut).toEqual({ src: "assets/luts/warm.cube", intensity: 0.4 });
  });

  it("supports a whole grading supplied by one variable", () => {
    const grading = normalizeHfColorGradingWithVariables("$colorGrade", {
      colorGrade: {
        adjust: { contrast: 0.2 },
        lut: { src: "assets/luts/natural-boost.cube", intensity: 0.75 },
      },
    });

    expect(grading?.adjust.contrast).toBe(0.2);
    expect(grading?.lut).toEqual({ src: "assets/luts/natural-boost.cube", intensity: 0.75 });
  });
});
