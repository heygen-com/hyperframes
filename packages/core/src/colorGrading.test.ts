import { describe, expect, it } from "vitest";
import { COLOR_GRADING_ADVANCED_LIMITS } from "@hyperframes/parsers/color-grading-contract";
import { unitFloatToByte } from "./colorLuts";
import {
  calculateHfColorGradingSecondaryMask,
  HF_COLOR_GRADING_COLOR_SPACE,
  HF_COLOR_GRADING_ACTIVE_EFFECT_KEYS,
  HF_COLOR_GRADING_EFFECT_APPLY_DEFAULTS,
  HF_COLOR_GRADING_EFFECT_PRESETS,
  HF_COLOR_GRADING_GRADE_PRESETS,
  HF_COLOR_GRADING_PALETTES,
  HF_COLOR_GRADING_PRESETS,
  getHfColorGradingCapabilities,
  hasHfColorGradingAuthoredValues,
  isHfColorGradingActive,
  normalizeHfColorGrading,
  normalizeHfColorGradingWithVariables,
  serializeHfColorGrading,
} from "./colorGrading";
import { lintHyperframeHtml } from "./lint";

describe("color grading", () => {
  it("derives grade and effect preset views from their actual payloads", () => {
    expect(HF_COLOR_GRADING_GRADE_PRESETS.map(({ id }) => id)).toContain("bright-pop");
    expect(HF_COLOR_GRADING_GRADE_PRESETS.map(({ id }) => id)).not.toContain("vhs-playback");
    expect(HF_COLOR_GRADING_EFFECT_PRESETS.map(({ id }) => id)).toEqual([
      "creator-camcorder",
      "vhs-playback",
      "home-movie-8mm",
      "editorial-halftone",
      "two-ink-print",
    ]);
    expect(HF_COLOR_GRADING_PRESETS).toHaveLength(18);
  });

  it("keeps every canonical grading key accepted by lint", async () => {
    const grading = normalizeHfColorGrading("neutral");
    expect(grading).not.toBeNull();
    const html = (attribute: string) => `
      <html><body>
        <div id="root" data-composition-id="c1" data-start="0" data-width="1920" data-height="1080" data-duration="1">
          <img class="clip" data-start="0" data-duration="1" src="media.jpg" data-color-grading='${attribute}'>
        </div>
        <script>window.__timelines = {};</script>
      </body></html>
    `;

    const valid = await lintHyperframeHtml(html(serializeHfColorGrading(grading)));
    expect(valid.findings.filter((finding) => finding.severity === "error")).toEqual([]);

    const invalid = await lintHyperframeHtml(html('{"effects":{"notARealEffect":1}}'));
    expect(invalid.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "color_grading_invalid_structure",
          severity: "error",
        }),
      ]),
    );
  });

  it("parses preset shorthand", () => {
    const grading = normalizeHfColorGrading("warm-daylight");
    expect(grading?.preset).toBe("warm-daylight");
    expect(grading?.colorSpace).toBe(HF_COLOR_GRADING_COLOR_SPACE);
    expect(grading?.adjust.temperature).toBeGreaterThan(0);
    expect(isHfColorGradingActive(grading)).toBe(true);
  });

  it("includes consumer-friendly filter presets", () => {
    expect(HF_COLOR_GRADING_PRESETS.some((preset) => preset.id === "bright-pop")).toBe(true);
    expect(normalizeHfColorGrading("mono-clean")?.adjust.saturation).toBe(-1);
    expect(normalizeHfColorGrading("vintage-wash")?.details.vignette).toBeGreaterThan(0);
    expect(normalizeHfColorGrading("food-pop")?.adjust.saturation).toBeGreaterThan(0);
    expect(normalizeHfColorGrading("food-pop")?.adjust.vibrance).toBeGreaterThan(0);
  });

  it("publishes valid named palettes through the existing palette contract", () => {
    expect(HF_COLOR_GRADING_PALETTES.map(({ id }) => id)).toContain("handheld-green");
    for (const palette of HF_COLOR_GRADING_PALETTES) {
      expect(normalizeHfColorGrading({ palette: palette.colors })?.palette).toEqual(palette.colors);
    }
  });

  it("resolves calibrated complete-filter presets", () => {
    expect(normalizeHfColorGrading("creator-camcorder")).toMatchObject({
      intensity: 0.72,
      effects: { chromaBleed: 0.55 },
    });
    expect(normalizeHfColorGrading("vhs-playback")).toMatchObject({
      intensity: 1,
      effects: {
        tapeDamage: 0.82,
        tapeTracking: 0.85,
        scanlineCount: 0.17,
        digitalGlitchLineTear: 0.08,
      },
    });
    expect(normalizeHfColorGrading("home-movie-8mm")).toMatchObject({
      intensity: 0.72,
      details: { grain: 0.34, vignette: 0.28 },
      effects: { filmArtifacts: 0.62 },
    });
    expect(normalizeHfColorGrading("editorial-halftone")?.effects).toMatchObject({
      halftone: 0.94,
      halftoneSize: 0.36,
    });
    expect(normalizeHfColorGrading("two-ink-print")?.effects).toMatchObject({
      twoInkPrint: 1,
      twoInkPrintSize: 0.42,
    });
  });

  it("defines a useful normalized apply payload for every active effect", () => {
    expect(Object.keys(HF_COLOR_GRADING_EFFECT_APPLY_DEFAULTS).sort()).toEqual(
      [...HF_COLOR_GRADING_ACTIVE_EFFECT_KEYS].sort(),
    );
    for (const key of HF_COLOR_GRADING_ACTIVE_EFFECT_KEYS) {
      const grading = normalizeHfColorGrading({
        effects: HF_COLOR_GRADING_EFFECT_APPLY_DEFAULTS[key],
      });
      expect(grading?.effects[key], key).toBeGreaterThan(0);
      expect(isHfColorGradingActive(grading), key).toBe(true);
    }
  });

  it("publishes a complete capability catalog for agent-built treatments", () => {
    const capabilities = getHfColorGradingCapabilities();

    expect(capabilities.version).toBe(2);
    expect(capabilities.colorSpace).toBe("rec709");
    expect(capabilities.adjustments.map(({ key }) => key)).toEqual([
      "exposure",
      "contrast",
      "highlights",
      "shadows",
      "whites",
      "blacks",
      "temperature",
      "tint",
      "vibrance",
      "saturation",
    ]);
    expect(capabilities.effects.map(({ key }) => key)).toEqual(HF_COLOR_GRADING_ACTIVE_EFFECT_KEYS);
    expect(capabilities.effects.find(({ key }) => key === "digitalGlitch")?.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "digitalGlitch", recommended: 0.55 }),
        expect.objectContaining({ key: "digitalGlitchLineTear", min: 0, max: 1 }),
      ]),
    );
    expect(capabilities.presets.map(({ id }) => id)).toEqual([
      ...HF_COLOR_GRADING_GRADE_PRESETS.map(({ id }) => id),
      ...HF_COLOR_GRADING_EFFECT_PRESETS.map(({ id }) => id),
    ]);
    expect(capabilities.palettes.map(({ id }) => id)).toContain("handheld-green");
    expect(capabilities.animatable.map(({ path }) => path)).toContain("effects.kuwahara");
    expect(capabilities.palette).toEqual({ minColors: 2, maxColors: 6, colorFormat: "#rrggbb" });
    expect(capabilities.lut).toMatchObject({ format: "3d-cube", maxCubeSize: 64 });
    expect(capabilities.effects.find(({ key }) => key === "ascii")).toMatchObject({
      supportsPalette: true,
      renderLane: "single-pass",
    });
    expect(capabilities.effects.find(({ key }) => key === "kuwahara")?.renderLane).toBe(
      "multipass",
    );
    expect(capabilities.wheels.zones).toEqual(["shadows", "midtones", "highlights"]);
    expect(capabilities.curves).toMatchObject({
      channels: ["master", "red", "green", "blue"],
      minPoints: 2,
      maxPoints: 16,
      implicitEndpoints: true,
    });
    expect(capabilities.hueCurves.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "hueVsHue",
          input: expect.objectContaining({ unit: "degrees", wrap: true }),
          output: { min: -180, max: 180 },
        }),
      ]),
    );
    expect(capabilities.secondaries.max).toBe(4);
    expect(capabilities.secondaries).toMatchObject({
      hue: {
        center: {
          min: COLOR_GRADING_ADVANCED_LIMITS.hueDegrees.min,
          maxExclusive: COLOR_GRADING_ADVANCED_LIMITS.hueDegrees.max,
        },
        range: COLOR_GRADING_ADVANCED_LIMITS.secondaryHueRange,
        softness: COLOR_GRADING_ADVANCED_LIMITS.secondaryHueSoftness,
        rangePlusSoftnessMax: COLOR_GRADING_ADVANCED_LIMITS.secondaryHueCombinedMax,
      },
      saturation: {
        softness: COLOR_GRADING_ADVANCED_LIMITS.secondarySoftRangeSoftness,
      },
      correction: {
        hueShift: COLOR_GRADING_ADVANCED_LIMITS.secondaryHueShift,
        saturation: COLOR_GRADING_ADVANCED_LIMITS.signedUnit,
      },
    });
  });

  it("matches the shader's packed secondary-softness convention", () => {
    for (const axis of ["saturation", "luma"] as const) {
      const grading = normalizeHfColorGrading({
        secondaries: [
          {
            key: {
              hue: { center: 0, range: 180, softness: 0 },
              saturation: { min: axis === "saturation" ? 0.5 : 0, max: 1, softness: 0.4 },
              luma: { min: axis === "luma" ? 0.5 : 0, max: 1, softness: 0.4 },
            },
            correction: {},
          },
        ],
      });
      const key = grading?.secondaries[0]?.key;
      if (!key) throw new Error("Expected a normalized secondary key");

      const packedSoftness = unitFloatToByte(key[axis].softness / 0.5);
      const shaderDecodedSoftness = (packedSoftness / 255) * 0.5;
      const decodedKey = {
        ...key,
        [axis]: { ...key[axis], softness: shaderDecodedSoftness },
      };
      const productMask = calculateHfColorGradingSecondaryMask(0, 0.2, 0.2, key);
      const shaderMask = calculateHfColorGradingSecondaryMask(0, 0.2, 0.2, decodedKey);

      expect(productMask, axis).toBeGreaterThan(0);
      expect(productMask, axis).toBeCloseTo(shaderMask, 2);
    }
  });

  it("merges manual adjustments over preset values", () => {
    const grading = normalizeHfColorGrading({
      preset: "warm-daylight",
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
      effects: {
        blur: 2,
        pixelate: 3,
        chromaBleed: 4,
        tapeDamage: 5,
        filmArtifacts: 6,
        halftone: 7,
        halftoneSize: 8,
        twoInkPrint: 9,
        twoInkPrintSize: 10,
        ascii: 11,
        asciiSize: 12,
        asciiInvert: 13,
        dither: 14,
        ditherSize: 15,
      },
      palette: ["#FF6B66", "#080717", "#D9339F", "#3C185F"],
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
    expect(grading?.effects).toMatchObject({
      blur: 1,
      pixelate: 1,
      chromaBleed: 1,
      tapeDamage: 1,
      filmArtifacts: 1,
      halftone: 1,
      halftoneSize: 1,
      twoInkPrint: 1,
      twoInkPrintSize: 1,
      ascii: 1,
      asciiSize: 1,
      asciiInvert: 1,
      dither: 1,
      ditherSize: 1,
    });
    expect(grading?.palette).toEqual(["#ff6b66", "#080717", "#d9339f", "#3c185f"]);
    expect(grading?.lut?.intensity).toBe(1);
  });

  it("returns null for disabled or invalid grading", () => {
    expect(normalizeHfColorGrading({ enabled: false, preset: "warm-daylight" })).toBeNull();
    expect(normalizeHfColorGrading("{nope")).toBeNull();
    expect(normalizeHfColorGrading("")).toBeNull();
  });

  it("normalizes shared creative effect controls without activating subordinate options", () => {
    const grading = normalizeHfColorGrading({
      effects: {
        asciiStyle: 9,
        asciiColor: 2,
        asciiRotation: 2,
        monoScreen: 0.25,
        monoScreenSize: 0.35,
        monoScreenAngle: 0.45,
        monoScreenSpread: 0.55,
        monoScreenShape: 8,
        monoScreenInvert: 2,
        scanlines: 0.3,
        scanlineCount: 0.4,
        scanlineSoftness: 0.5,
        chromaticAberration: 0.6,
        chromaticAngle: 0.7,
        crtCurvature: 0.8,
        digitalGlitch: 0.7,
        digitalGlitchColorSplit: 0.75,
        digitalGlitchLineTear: 0.8,
        digitalGlitchPixelate: 0.85,
        digitalGlitchBlockAmount: 0.9,
        digitalGlitchBlockDisplacement: 1.2,
        digitalGlitchBlockOpacity: 1.3,
        digitalGlitchSpeed: 0.9,
      },
    });

    expect(grading?.effects).toMatchObject({
      asciiStyle: 7,
      asciiColor: 1,
      asciiRotation: 1,
      monoScreen: 0.25,
      monoScreenSize: 0.35,
      monoScreenAngle: 0.45,
      monoScreenSpread: 0.55,
      monoScreenShape: 4,
      monoScreenInvert: 1,
      scanlines: 0.3,
      scanlineCount: 0.4,
      scanlineSoftness: 0.5,
      chromaticAberration: 0.6,
      chromaticAngle: 0.7,
      crtCurvature: 0.8,
      digitalGlitch: 0.7,
      digitalGlitchColorSplit: 0.75,
      digitalGlitchLineTear: 0.8,
      digitalGlitchPixelate: 0.85,
      digitalGlitchBlockAmount: 0.9,
      digitalGlitchBlockDisplacement: 1,
      digitalGlitchBlockOpacity: 1,
      digitalGlitchSpeed: 0.9,
    });

    const optionsOnly = normalizeHfColorGrading({
      effects: {
        asciiStyle: 4,
        asciiColor: 1,
        asciiRotation: 1,
        monoScreenSize: 0.5,
        monoScreenAngle: 0.5,
        monoScreenSpread: 0.5,
        monoScreenShape: 3,
        monoScreenInvert: 1,
        scanlineCount: 0.5,
        scanlineSoftness: 0.5,
        chromaticAngle: 0.5,
        digitalGlitchColorSplit: 0.5,
        digitalGlitchLineTear: 0.5,
        digitalGlitchPixelate: 0.5,
        digitalGlitchBlockAmount: 0.5,
        digitalGlitchBlockDisplacement: 0.5,
        digitalGlitchBlockOpacity: 0.5,
        digitalGlitchSpeed: 0.5,
      },
    });
    expect(isHfColorGradingActive(optionsOnly)).toBe(false);
  });

  it("uses the public ASCII defaults when only the family is enabled", () => {
    const grading = normalizeHfColorGrading({ effects: { ascii: 1 } });

    expect(grading?.effects).toMatchObject({
      ascii: 1,
      asciiSize: 5 / 76,
      asciiInvert: 0,
      asciiStyle: 0,
      asciiColor: 1,
      asciiRotation: 0,
    });
  });

  it("normalizes tape controls without activating them independently", () => {
    const defaults = normalizeHfColorGrading({ effects: { tapeDamage: 1 } });
    expect(defaults?.effects).toMatchObject({
      tapeDamage: 1,
      tapeTracking: 0,
      tapeNoise: 1,
      tapeSpeed: 0.5,
    });
    expect(isHfColorGradingActive(defaults)).toBe(true);

    const controlsOnly = normalizeHfColorGrading({
      effects: { tapeTracking: 2, tapeNoise: -1, tapeSpeed: 2 },
    });
    expect(controlsOnly?.effects).toMatchObject({
      tapeTracking: 1,
      tapeNoise: 0,
      tapeSpeed: 1,
    });
    expect(isHfColorGradingActive(controlsOnly)).toBe(false);
  });

  it("normalizes engraving controls and activates only from its master amount", () => {
    const defaults = normalizeHfColorGrading({ effects: { engraving: 1 } });
    expect(defaults?.effects).toMatchObject({
      engraving: 1,
      engravingSpacing: 7 / 17,
      engravingMinThickness: 0.2,
      engravingMaxThickness: 3.2 / 7,
      engravingAngle: 0.25,
      engravingContrast: 7 / 15,
      engravingSharpness: 0.59,
      engravingWave: 0.2,
      engravingWaveFrequency: 2 / 9,
    });
    expect(isHfColorGradingActive(defaults)).toBe(true);

    const controlsOnly = normalizeHfColorGrading({
      effects: {
        engravingSpacing: 0.8,
        engravingMinThickness: 0,
        engravingMaxThickness: 0,
        engravingAngle: 0,
        engravingContrast: 0,
        engravingSharpness: 0,
        engravingWave: 0,
        engravingWaveFrequency: 0,
      },
    });
    expect(isHfColorGradingActive(controlsOnly)).toBe(false);
    expect(controlsOnly?.effects.engravingSpacing).toBe(0.8);
    expect(controlsOnly?.effects.engravingMinThickness).toBe(0);
  });

  it("normalizes crosshatch controls and activates only from its master amount", () => {
    const defaults = normalizeHfColorGrading({ effects: { crosshatch: 1 } });
    expect(defaults?.effects).toMatchObject({
      crosshatch: 1,
      crosshatchSpacing: 7 / 25,
      crosshatchThickness: 0.25,
      crosshatchAngle: 0.25,
      crosshatchContrast: 1 / 3,
      crosshatchEdges: 0.5,
      crosshatchLineWeight: 0,
      crosshatchWave: 0.33,
      crosshatchWaveFrequency: 2 / 9,
    });
    expect(isHfColorGradingActive(defaults)).toBe(true);

    const controlsOnly = normalizeHfColorGrading({
      effects: {
        crosshatchSpacing: 0.8,
        crosshatchThickness: 0,
        crosshatchAngle: 0,
        crosshatchContrast: 0,
        crosshatchEdges: 0,
        crosshatchLineWeight: 0,
        crosshatchWave: 0,
        crosshatchWaveFrequency: 0,
      },
    });
    expect(isHfColorGradingActive(controlsOnly)).toBe(false);
    expect(controlsOnly?.effects.crosshatchSpacing).toBe(0.8);
    expect(controlsOnly?.effects.crosshatchThickness).toBe(0);
  });

  it("normalizes Kuwahara controls and activates only from its master amount", () => {
    const defaults = normalizeHfColorGrading({ effects: { kuwahara: 1 } });
    expect(defaults?.effects).toMatchObject({
      kuwahara: 1,
      kuwaharaRadius: 1 / 7,
      kuwaharaSharpness: 5 / 16,
      kuwaharaSaturation: 0.5,
    });
    expect(isHfColorGradingActive(defaults)).toBe(true);

    const controlsOnly = normalizeHfColorGrading({
      effects: {
        kuwaharaRadius: 2,
        kuwaharaSharpness: -1,
        kuwaharaSaturation: 0.75,
      },
    });
    expect(controlsOnly?.effects).toMatchObject({
      kuwaharaRadius: 1,
      kuwaharaSharpness: 0,
      kuwaharaSaturation: 0.75,
    });
    expect(isHfColorGradingActive(controlsOnly)).toBe(false);
  });

  it("normalizes article bloom controls and activates only from intensity", () => {
    const grading = normalizeHfColorGrading({ effects: { bloom: 0.5 } });
    expect(grading?.effects).toMatchObject({ bloom: 0.5, bloomRadius: 8 });
    expect(isHfColorGradingActive(grading)).toBe(true);

    const controlsOnly = normalizeHfColorGrading({ effects: { bloomRadius: 101 } });
    expect(controlsOnly?.effects.bloomRadius).toBe(100);
    expect(isHfColorGradingActive(controlsOnly)).toBe(false);
    expect(normalizeHfColorGrading({ effects: { bloom: 4 } })?.effects.bloom).toBe(3);
  });

  it("serializes normalized grading for data-color-grading", () => {
    const grading = normalizeHfColorGrading({
      adjust: { exposure: 0.25 },
      details: { vignette: 0.3, grain: 0.1 },
      effects: {
        blur: 0.2,
        pixelate: 0.4,
        chromaBleed: 0.3,
        tapeDamage: 0.5,
        filmArtifacts: 0.6,
        halftone: 0.7,
        halftoneSize: 0.8,
        twoInkPrint: 0.9,
        twoInkPrintSize: 0.4,
        ascii: 0.65,
        asciiSize: 0.35,
        asciiInvert: 1,
        dither: 0.75,
        ditherSize: 0.25,
      },
      palette: ["#080717", "#3c185f", "#d9339f", "#ff6b66", "#f6d365", "#aafae0"],
      lut: { src: "assets/luts/test.cube", intensity: 0.6 },
    });
    const serialized = serializeHfColorGrading(grading);
    expect(normalizeHfColorGrading(serialized)).toMatchObject({
      adjust: { exposure: 0.25 },
      details: { vignette: 0.3, grain: 0.1 },
      effects: {
        blur: 0.2,
        pixelate: 0.4,
        chromaBleed: 0.3,
        tapeDamage: 0.5,
        filmArtifacts: 0.6,
        halftone: 0.7,
        halftoneSize: 0.8,
        twoInkPrint: 0.9,
        twoInkPrintSize: 0.4,
        ascii: 0.65,
        asciiSize: 0.35,
        asciiInvert: 1,
        dither: 0.75,
        ditherSize: 0.25,
      },
      palette: ["#080717", "#3c185f", "#d9339f", "#ff6b66", "#f6d365", "#aafae0"],
      lut: { src: "assets/luts/test.cube", intensity: 0.6 },
    });
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
    const grading = normalizeHfColorGrading({ intensity: 0, details: { vignette: 0.2 } });
    expect(isHfColorGradingActive(grading)).toBe(true);
  });

  it("does not activate grading for advanced finishing defaults alone", () => {
    const grading = normalizeHfColorGrading({
      details: { vignetteMidpoint: 0.2, grainSize: 0.8 },
    });
    expect(isHfColorGradingActive(grading)).toBe(false);
  });

  it("does not activate grading for halftone size alone", () => {
    const grading = normalizeHfColorGrading({ effects: { halftoneSize: 0.8 } });
    expect(isHfColorGradingActive(grading)).toBe(false);
  });

  it("does not activate grading for two-ink screen size alone", () => {
    const grading = normalizeHfColorGrading({ effects: { twoInkPrintSize: 0.8 } });
    expect(isHfColorGradingActive(grading)).toBe(false);
  });

  it("does not activate grading for ASCII/dither options without an effect amount", () => {
    const grading = normalizeHfColorGrading({
      effects: { asciiSize: 0.8, asciiInvert: 1, ditherSize: 0.7 },
      palette: ["#111111", "#eeeeee"],
    });
    expect(isHfColorGradingActive(grading)).toBe(false);
  });

  it("rejects malformed or out-of-range effect palettes", () => {
    expect(normalizeHfColorGrading({ palette: ["#000000"] })?.palette).toBeNull();
    expect(normalizeHfColorGrading({ palette: ["#000000", "red"] })?.palette).toBeNull();
    expect(
      normalizeHfColorGrading({
        palette: ["#000000", "#111111", "#222222", "#333333", "#444444", "#555555", "#666666"],
      })?.palette,
    ).toBeNull();
  });

  it("treats media effects as active grading", () => {
    const grading = normalizeHfColorGrading({ intensity: 0, effects: { blur: 0.2 } });
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
        palette: "$palette",
        lut: {
          src: "$lutSrc",
          intensity: "$lutIntensity",
        },
      }),
      {
        preset: "warm-daylight",
        gradingIntensity: 0.6,
        exposure: 0.25,
        vibrance: 0.3,
        saturation: -0.2,
        vignette: 0.15,
        grainSize: 0.4,
        pixelate: 0.1,
        palette: ["#080717", "#aafae0"],
        lutSrc: "assets/luts/warm.cube",
        lutIntensity: 0.4,
      },
    );

    expect(grading?.preset).toBe("warm-daylight");
    expect(grading?.intensity).toBe(0.6);
    expect(grading?.adjust.exposure).toBe(0.25);
    expect(grading?.adjust.vibrance).toBe(0.3);
    expect(grading?.adjust.saturation).toBe(-0.2);
    expect(grading?.details.vignette).toBe(0.15);
    expect(grading?.details.grainSize).toBe(0.4);
    expect(grading?.effects.pixelate).toBe(0.1);
    expect(grading?.palette).toEqual(["#080717", "#aafae0"]);
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

  it("resolves scalar variable references inside secondary arrays", () => {
    const grading = normalizeHfColorGradingWithVariables(
      {
        secondaries: [
          {
            key: {
              hue: { center: "$skinHue", range: 18 },
              saturation: { min: 0.1, max: 1 },
            },
            correction: { saturation: "${skinSaturation}" },
          },
        ],
      },
      { skinHue: 24, skinSaturation: -0.12 },
    );

    expect(grading?.secondaries[0]).toMatchObject({
      key: { hue: { center: 24, range: 18 } },
      correction: { saturation: -0.12 },
    });
  });

  it("normalizes advanced controls defensively", () => {
    const grading = normalizeHfColorGrading({
      colorSpace: "display-p3",
      wheels: {
        shadows: { hue: -30, amount: 2, level: -2 },
        highlights: { hue: 750, amount: 0.15, level: 0.05 },
      },
      curves: {
        master: [
          [0.75, 0.82],
          [0.25, 0.18],
        ],
      },
      hueCurves: {
        hueVsHue: [
          [330, -20],
          [-10, 15],
          [120, 0],
        ],
      },
      secondaries: [
        {
          enabled: false,
          key: {
            hue: { center: -10, range: 30, softness: 200 },
            saturation: { min: 0.8, max: 0.2, softness: 1 },
          },
          correction: { hueShift: 250, saturation: 2, luma: -2 },
        },
      ],
    });

    expect(grading?.colorSpace).toBe("display-p3");
    expect(grading?.wheels.shadows).toEqual({ hue: 330, amount: 1, level: -1 });
    expect(grading?.wheels.highlights).toEqual({ hue: 30, amount: 0.15, level: 0.05 });
    expect(grading?.curves.master).toEqual([
      [0, 0],
      [0.25, 0.18],
      [0.75, 0.82],
      [1, 1],
    ]);
    expect(grading?.hueCurves.hueVsHue).toEqual([
      [120, 0],
      [330, -20],
      [350, 15],
    ]);
    expect(grading?.secondaries[0]).toMatchObject({
      enabled: false,
      key: {
        hue: { center: 350, range: 30, softness: 150 },
        saturation: { min: 0.2, max: 0.8, softness: 0.5 },
      },
      correction: { hueShift: 180, saturation: 1, luma: -1 },
    });
  });

  it("keeps disabled secondaries authored but pixel-inactive", () => {
    const grading = normalizeHfColorGrading({
      secondaries: [
        {
          enabled: false,
          key: { hue: { center: 24, range: 18 } },
          correction: { saturation: 0.5 },
        },
      ],
    });

    expect(grading?.secondaries[0]?.enabled).toBe(false);
    expect(isHfColorGradingActive(grading)).toBe(false);
    expect(hasHfColorGradingAuthoredValues(grading)).toBe(true);
    expect(serializeHfColorGrading(grading)).toContain('"enabled":false');
  });

  it("omits identity advanced controls while retaining authored secondary selectors", () => {
    const grading = normalizeHfColorGrading({
      wheels: { shadows: { hue: 200 } },
      curves: {
        master: [
          [0, 0],
          [0.5, 0.5],
          [1, 1],
        ],
      },
      hueCurves: {
        hueVsSaturation: [
          [0, 0],
          [120, 0],
          [240, 0],
        ],
      },
      secondaries: [
        {
          key: { hue: { center: 20, range: 10, softness: 5 } },
          correction: {},
        },
      ],
    });

    expect(isHfColorGradingActive(grading)).toBe(false);
    expect(hasHfColorGradingAuthoredValues(grading)).toBe(true);
    const serialized = serializeHfColorGrading(grading);
    expect(serialized).not.toContain('"wheels"');
    expect(serialized).not.toContain('"curves"');
    expect(serialized).not.toContain('"hueCurves"');
    expect(serialized).toContain('"secondaries"');
  });

  it("round-trips advanced grading byte-identically", () => {
    const grading = normalizeHfColorGrading({
      wheels: { shadows: { hue: 205, amount: 0.08 } },
      curves: {
        red: [
          [0, 0],
          [0.5, 0.55],
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
          key: { hue: { center: 215, range: 25, softness: 10 } },
          correction: { saturation: 0.15 },
        },
      ],
    });
    const first = serializeHfColorGrading(grading);
    expect(serializeHfColorGrading(normalizeHfColorGrading(first))).toBe(first);
  });

  it("gates advanced grading with intensity while keeping effects independent", () => {
    expect(
      isHfColorGradingActive(
        normalizeHfColorGrading({
          intensity: 0,
          wheels: { shadows: { hue: 205, amount: 0.2 } },
        }),
      ),
    ).toBe(false);
    expect(
      isHfColorGradingActive(
        normalizeHfColorGrading({
          intensity: 0,
          wheels: { shadows: { hue: 205, amount: 0.2 } },
          effects: { blur: 0.2 },
        }),
      ),
    ).toBe(true);
  });
});
