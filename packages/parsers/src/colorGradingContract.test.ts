import { describe, expect, it } from "vitest";
import {
  COLOR_GRADING_ADJUST_KEYS,
  COLOR_GRADING_ADVANCED_LIMITS,
  COLOR_GRADING_DETAIL_KEYS,
  COLOR_GRADING_EFFECT_KEYS,
  COLOR_GRADING_HUE_CURVE_KEYS,
  COLOR_GRADING_LUT_KEYS,
  COLOR_GRADING_TOP_LEVEL_KEYS,
  COLOR_GRADING_WHEEL_KEYS,
  isColorGradingVariableRef,
  validateColorGradingContract,
} from "./colorGradingContract";

describe("color grading contract", () => {
  it("publishes one complete key registry", () => {
    expect(COLOR_GRADING_TOP_LEVEL_KEYS).toContain("effects");
    expect(COLOR_GRADING_ADJUST_KEYS).toContain("exposure");
    expect(COLOR_GRADING_DETAIL_KEYS).toContain("grain");
    expect(COLOR_GRADING_EFFECT_KEYS).toContain("kuwahara");
    expect(COLOR_GRADING_WHEEL_KEYS).toEqual(["shadows", "midtones", "highlights"]);
    expect(COLOR_GRADING_HUE_CURVE_KEYS).toContain("hueVsSaturation");
    expect(COLOR_GRADING_LUT_KEYS).toEqual(["src", "intensity"]);
    expect(COLOR_GRADING_ADVANCED_LIMITS).toMatchObject({
      hueDegrees: { min: 0, max: 360, inclusiveMax: false },
      secondaryHueRange: { min: 0, max: 180 },
      secondarySoftRangeSoftness: { min: 0, max: 0.5 },
      secondaryHueShift: { min: -180, max: 180 },
      effects: {
        asciiStyle: { min: 0, max: 7 },
        bloom: { min: 0, max: 3 },
        bloomRadius: { min: 1, max: 100 },
        monoScreenShape: { min: 0, max: 4 },
      },
    });
  });

  it("accepts the complete current contract and variable references", () => {
    expect(
      validateColorGradingContract({
        enabled: "$enabled",
        preset: "clean-studio",
        intensity: 0.8,
        adjust: { exposure: 0.1, contrast: "$contrast" },
        details: { grain: 0.1 },
        effects: { bloom: 1.2, bloomRadius: 24, asciiStyle: 4 },
        palette: ["#112233", "#abcdef"],
        lut: { src: "$lutPath", intensity: 0.5 },
        colorSpace: "rec709",
      }),
    ).toEqual([]);
    expect(isColorGradingVariableRef("${grade.amount}")).toBe(true);
  });

  it("rejects unknown fields, invalid ranges, and malformed palettes", () => {
    expect(
      validateColorGradingContract({
        mystery: true,
        adjust: { exposure: 3, mystery: 1 },
        details: { grain: -0.1 },
        effects: { bloom: 4, bloomRadius: 0 },
        palette: ["red"],
        lut: {},
        colorSpace: "display-p3",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "grading" }),
        expect.objectContaining({ path: "adjust" }),
        expect.objectContaining({ path: "adjust.exposure" }),
        expect.objectContaining({ path: "details.grain" }),
        expect.objectContaining({ path: "effects.bloom" }),
        expect.objectContaining({ path: "effects.bloomRadius" }),
        expect.objectContaining({ path: "palette" }),
        expect.objectContaining({ path: "lut.src" }),
        expect.objectContaining({ path: "colorSpace" }),
      ]),
    );
  });

  it("accepts wheels, color curves, hue curves, and HSL secondaries", () => {
    expect(
      validateColorGradingContract({
        wheels: {
          shadows: { hue: 205, amount: 0.08, level: -0.02 },
          highlights: { hue: 35, amount: 0.06 },
        },
        curves: {
          master: [
            [0, 0],
            [0.25, 0.18],
            [0.75, 0.82],
            [1, 1],
          ],
        },
        hueCurves: {
          hueVsSaturation: [
            [180, 0],
            [215, 0.15],
            [250, 0],
          ],
        },
        secondaries: [
          {
            enabled: false,
            key: {
              hue: { center: 215, range: 25, softness: 10 },
              saturation: { min: 0.2, max: 1, softness: 0.08 },
              luma: { min: 0.1, max: 0.9, softness: 0.08 },
            },
            correction: { saturation: 0.15, luma: 0.03 },
          },
        ],
      }),
    ).toEqual([]);
  });

  it("rejects malformed advanced controls instead of normalizing them", () => {
    const points = Array.from({ length: 16 }, (_, index) => [(index + 1) / 17, (index + 1) / 17]);
    const issues = validateColorGradingContract({
      wheels: { shadows: { hue: 360, mystery: 1 } },
      curves: {
        master: points,
        red: [
          [0, 0],
          [0, 1],
        ],
      },
      hueCurves: {
        hueVsHue: [
          [0, 0],
          [120, 20],
        ],
      },
      secondaries: [
        {
          enabled: "yes",
          key: {
            hue: { center: 360, range: 20, softness: 170 },
            saturation: { min: 0.8, max: 0.2, softness: 0.6 },
          },
          correction: { hueShift: 200 },
        },
      ],
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "wheels.shadows" }),
        expect.objectContaining({ path: "wheels.shadows.hue" }),
        expect.objectContaining({
          path: "curves.master",
          message: expect.stringContaining("including inferred 0 and 1 endpoints"),
        }),
        expect.objectContaining({ path: "curves.red", message: "contains duplicate input 0" }),
        expect.objectContaining({ path: "hueCurves.hueVsHue" }),
        expect.objectContaining({ path: "secondaries[0].enabled" }),
        expect.objectContaining({ path: "secondaries[0].key.hue.center" }),
        expect.objectContaining({ path: "secondaries[0].key.saturation" }),
        expect.objectContaining({ path: "secondaries[0].correction.hueShift" }),
      ]),
    );
  });

  it("allows advanced sections to be supplied by variables", () => {
    expect(
      validateColorGradingContract({
        wheels: "$wheels",
        curves: "${curves}",
        hueCurves: "$hueCurves",
        secondaries: "$secondaries",
      }),
    ).toEqual([]);
    expect(
      validateColorGradingContract({
        secondaries: [{ enabled: "$secondaryEnabled", key: {}, correction: {} }],
      }),
    ).toEqual([]);
  });
});
