import {
  calculateHfColorGradingSecondaryMask,
  hasHfColorGradingHueCurveValues,
  hasHfColorGradingRgbCurveValues,
  hasHfColorGradingSecondaryValues,
  HF_COLOR_GRADING_ACTIVE_EFFECT_KEYS,
  normalizeHfColorGrading,
  type HfColorGrading,
  type NormalizedHfColorGradingSecondary,
  type ResolvedHfColorGrading,
} from "./colorGrading";
import {
  compileHfColorCurve,
  compileHfHueCurve,
  HF_COLOR_CURVE_LUT_SIZE,
  type HfHueCurvePoint,
} from "./colorGradingCurves";
import { packCubeLutToRgba8, unitFloatToByte, type CubeLut3D } from "./colorLuts";

// The runtime grades in a WebGL shader (runtime/colorGrading.ts `applyColorGrade`). Every stage of
// it is a pointwise colour function, so a grade without spatial stages is exactly a 3D LUT. This
// evaluates the same arithmetic on the CPU, reading curves, hue curves, secondary keys and the
// output LUT through the same 8-bit quantisation the shader's textures impose.

export interface BakeHfColorGradingCubeOptions {
  /** Points per axis. ffmpeg's lut3d reads 2 to 256. */
  size?: number;
  /** The parsed output LUT, required when the grading names one. */
  lut?: CubeLut3D | null;
}

type Rgb = [number, number, number];

const LUMA_WEIGHTS: Rgb = [0.2126, 0.7152, 0.0722];
const CURVE_MAX_INDEX = HF_COLOR_CURVE_LUT_SIZE - 1;

const luma = (c: Rgb): number =>
  c[0] * LUMA_WEIGHTS[0] + c[1] * LUMA_WEIGHTS[1] + c[2] * LUMA_WEIGHTS[2];
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const clampRgb = (c: Rgb): Rgb => [clamp(c[0], 0, 1), clamp(c[1], 0, 1), clamp(c[2], 0, 1)];
const fract = (value: number): number => value - Math.floor(value);
const mod = (value: number, divisor: number): number =>
  value - divisor * Math.floor(value / divisor);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const towardLuma = (c: Rgb, base: number, amount: number): Rgb => [
  mix(base, c[0], amount),
  mix(base, c[1], amount),
  mix(base, c[2], amount),
];

/**
 * A value as the shader reads it back from an 8-bit texture channel. The runtime stages texture
 * data in a Float32Array first, which moves rounding ties: 0.9 packs as 229, not 230.
 */
const texel = (value: number): number => unitFloatToByte(Math.fround(value)) / 255;

/** The runtime's encoding of a signed value into an 8-bit channel. */
const signedUnit = (value: number, range: number): number =>
  Math.min(1, Math.max(1 / 255, (value * (127 / range) + 128) / 255));
const decodeSigned = (value: number): number => (value * 255 - 128) / 127;
const signedTexel = (value: number, range: number): number =>
  decodeSigned(texel(signedUnit(value, range)));

function rgbToHsv(c: Rgb): Rgb {
  const maximum = Math.max(c[0], c[1], c[2]);
  const minimum = Math.min(c[0], c[1], c[2]);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0.00001) {
    if (maximum === c[0]) hue = mod((c[1] - c[2]) / delta, 6);
    else if (maximum === c[1]) hue = (c[2] - c[0]) / delta + 2;
    else hue = (c[0] - c[1]) / delta + 4;
    hue = fract(hue / 6);
  }
  return [hue, maximum > 0.00001 ? delta / maximum : 0, maximum];
}

function hsvToRgb([hue, saturation, value]: Rgb): Rgb {
  const channel = (offset: number): number => {
    const band = Math.abs(fract(hue + offset) * 6 - 3);
    return value * mix(1, clamp(band - 1, 0, 1), saturation);
  };
  return [channel(0), channel(0.6666667), channel(0.3333333)];
}

function applyPrimaryGrade(input: Rgb, adjust: ResolvedHfColorGrading["adjust"]): Rgb {
  const gain = 2 ** adjust.exposure;
  let c: Rgb = [input[0] * gain, input[1] * gain, input[2] * gain];
  const y = luma(c);
  const lift =
    adjust.shadows * 0.35 * (1 - smoothstep(0, 0.65, y)) +
    adjust.highlights * 0.35 * smoothstep(0.35, 1, y);
  const blackPoint = clamp(adjust.blacks * 0.18, -0.18, 0.18);
  const whitePoint = clamp(1 - adjust.whites * 0.18, 0.82, 1.18);
  const range = Math.max(whitePoint - blackPoint, 0.2);
  c = c.map((value) => (value + lift - blackPoint) / range) as Rgb;
  c[0] += adjust.temperature * 0.08 + adjust.tint * 0.04;
  c[2] -= adjust.temperature * 0.08 - adjust.tint * 0.04;
  c[1] -= adjust.tint * 0.08;
  const contrast = Math.max(0, 1 + adjust.contrast);
  c = c.map((value) => (value - 0.5) * contrast + 0.5) as Rgb;
  const satLuma = luma(c);
  const currentSat = clamp(Math.max(...c) - Math.min(...c), 0, 1);
  const skinLike =
    smoothstep(0.02, 0.18, c[0] - c[1]) *
    smoothstep(0, 0.16, c[1] - c[2]) *
    smoothstep(0.18, 0.82, satLuma);
  const vibranceWeight = (1 - currentSat * 0.72) * mix(1, 0.55, skinLike);
  c = towardLuma(c, satLuma, Math.max(0, 1 + adjust.vibrance * vibranceWeight));
  return towardLuma(c, satLuma, Math.max(0, 1 + adjust.saturation));
}

function wheelDirection(hue: number): Rgb {
  const direction = hsvToRgb([fract(hue), 1, 1]);
  const y = luma(direction);
  const centred = direction.map((value) => value - y) as Rgb;
  const scale = Math.max(Math.abs(centred[0]), Math.abs(centred[1]), Math.abs(centred[2]), 0.0001);
  return centred.map((value) => value / scale) as Rgb;
}

function applyTonalWheels(color: Rgb, wheels: ResolvedHfColorGrading["wheels"]): Rgb {
  const y = luma(color);
  const shadows = 1 - smoothstep(0, 0.6, y);
  const highlights = smoothstep(0.4, 1, y);
  const midtones = Math.max(0, 1 - shadows - highlights);
  const total = Math.max(shadows + midtones + highlights, 0.0001);
  const c: Rgb = [...color];
  for (const [wheel, weight] of [
    [wheels.shadows, shadows / total],
    [wheels.midtones, midtones / total],
    [wheels.highlights, highlights / total],
  ] as const) {
    const direction = wheelDirection(wheel.hue / 360);
    for (let channel = 0; channel < 3; channel += 1) {
      c[channel] =
        (c[channel] ?? 0) +
        (direction[channel] ?? 0) * wheel.amount * weight * 0.18 +
        wheel.level * weight * 0.25;
    }
  }
  return c;
}

interface CurveTables {
  red: Float64Array;
  green: Float64Array;
  blue: Float64Array;
  master: Float64Array;
}

function quantisedCurve(samples: Float32Array): Float64Array {
  return Float64Array.from(samples, texel);
}

function sampleCurve(samples: Float64Array, coordinate: number): number {
  const position = clamp(coordinate, 0, 1) * CURVE_MAX_INDEX;
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, CURVE_MAX_INDEX);
  return mix(samples[lower] ?? 0, samples[upper] ?? 0, position - lower);
}

function applyRgbCurves(c: Rgb, curves: CurveTables): Rgb {
  return [
    sampleCurve(curves.red, sampleCurve(curves.master, c[0])),
    sampleCurve(curves.green, sampleCurve(curves.master, c[1])),
    sampleCurve(curves.blue, sampleCurve(curves.master, c[2])),
  ];
}

interface HueCurveTables {
  hue: Float64Array;
  saturation: Float64Array;
  luma: Float64Array;
}

function signedHueCurve(
  points: readonly HfHueCurvePoint[],
  outputMin: number,
  outputMax: number,
): Float64Array {
  const samples =
    points.length >= 3
      ? compileHfHueCurve(points, outputMin, outputMax)
      : new Float32Array(HF_COLOR_CURVE_LUT_SIZE);
  return Float64Array.from(samples, (value) => signedTexel(value, outputMax));
}

function sampleHueCurve(samples: Float64Array, hue: number): number {
  const position = fract(hue) * HF_COLOR_CURVE_LUT_SIZE;
  const lower = Math.floor(position);
  const upper = (lower + 1) % HF_COLOR_CURVE_LUT_SIZE;
  return mix(samples[lower] ?? 0, samples[upper] ?? 0, position - lower);
}

function applyHueCurves(c: Rgb, curves: HueCurveTables): Rgb {
  const hsv = rgbToHsv(clampRgb(c));
  const originalLuma = luma(c);
  const hueShift = sampleHueCurve(curves.hue, hsv[0]);
  const saturation = sampleHueCurve(curves.saturation, hsv[0]);
  const lumaShift = sampleHueCurve(curves.luma, hsv[0]);
  const shifted = hsvToRgb([
    fract(hsv[0] + hueShift * 0.5),
    clamp(hsv[1] * Math.max(0, 1 + saturation), 0, 1),
    hsv[2],
  ]);
  const offset = originalLuma - luma(shifted) + lumaShift;
  return shifted.map((value) => value + offset) as Rgb;
}

interface SecondaryTable {
  key: NormalizedHfColorGradingSecondary["key"];
  hueShift: number;
  saturation: number;
  luma: number;
  temperature: number;
  tint: number;
}

function quantisedSecondary({
  key,
  correction,
}: NormalizedHfColorGradingSecondary): SecondaryTable {
  const range = (soft: NormalizedHfColorGradingSecondary["key"]["luma"]) => ({
    min: texel(soft.min),
    max: texel(soft.max),
    softness: texel(soft.softness / 0.5) * 0.5,
  });
  return {
    key: {
      hue: {
        center: texel(key.hue.center / 360) * 360,
        range: texel(key.hue.range / 180) * 180,
        softness: texel(key.hue.softness / 180) * 180,
      },
      saturation: range(key.saturation),
      luma: range(key.luma),
    },
    hueShift: signedTexel(correction.hueShift, 180),
    saturation: signedTexel(correction.saturation, 1),
    luma: signedTexel(correction.luma, 1),
    temperature: signedTexel(correction.temperature, 1),
    tint: signedTexel(correction.tint, 1),
  };
}

function applySecondary(c: Rgb, secondary: SecondaryTable): Rgb {
  const hsv = rgbToHsv(clampRgb(c));
  const mask = calculateHfColorGradingSecondaryMask(hsv[0] * 360, hsv[1], luma(c), secondary.key);
  if (mask <= 0) return c;
  const rotated = hsvToRgb([fract(hsv[0] + secondary.hueShift * 0.5), hsv[1], hsv[2]]);
  const corrected = towardLuma(rotated, luma(rotated), Math.max(0, 1 + secondary.saturation)).map(
    (value) => value + secondary.luma,
  ) as Rgb;
  corrected[0] += secondary.temperature * 0.08 + secondary.tint * 0.04;
  corrected[2] -= secondary.temperature * 0.08 - secondary.tint * 0.04;
  corrected[1] -= secondary.tint * 0.08;
  return mixRgb(c, corrected, mask);
}

interface LutTable {
  size: number;
  width: number;
  data: Uint8Array;
  domainMin: Rgb;
  span: Rgb;
  intensity: number;
}

function sampleLut(lut: LutTable, r: number, g: number, b: number): Rgb {
  const index = (g * lut.width + b * lut.size + r) * 4;
  return [
    (lut.data[index] ?? 0) / 255,
    (lut.data[index + 1] ?? 0) / 255,
    (lut.data[index + 2] ?? 0) / 255,
  ];
}

function applyLut(color: Rgb, lut: LutTable): Rgb {
  const top = lut.size - 1;
  const scaled = color.map(
    (value, channel) =>
      clamp((value - (lut.domainMin[channel] ?? 0)) / (lut.span[channel] ?? 1), 0, 1) * top,
  ) as Rgb;
  const lo = scaled.map(Math.floor) as Rgb;
  const hi = lo.map((value) => Math.min(value + 1, top)) as Rgb;
  const f = scaled.map((value, channel) => value - (lo[channel] ?? 0)) as Rgb;
  const c00 = mixRgb(
    sampleLut(lut, lo[0], lo[1], lo[2]),
    sampleLut(lut, hi[0], lo[1], lo[2]),
    f[0],
  );
  const c10 = mixRgb(
    sampleLut(lut, lo[0], hi[1], lo[2]),
    sampleLut(lut, hi[0], hi[1], lo[2]),
    f[0],
  );
  const c01 = mixRgb(
    sampleLut(lut, lo[0], lo[1], hi[2]),
    sampleLut(lut, hi[0], lo[1], hi[2]),
    f[0],
  );
  const c11 = mixRgb(
    sampleLut(lut, lo[0], hi[1], hi[2]),
    sampleLut(lut, hi[0], hi[1], hi[2]),
    f[0],
  );
  const lutColor = mixRgb(mixRgb(c00, c10, f[1]), mixRgb(c01, c11, f[1]), f[2]);
  return mixRgb(color, lutColor, clamp(lut.intensity, 0, 1));
}

interface CompiledGrade {
  grading: ResolvedHfColorGrading;
  curves: CurveTables | null;
  hueCurves: HueCurveTables | null;
  secondaries: SecondaryTable[];
  lut: LutTable | null;
}

function spatialStages(grading: ResolvedHfColorGrading): string[] {
  const details = (["vignette", "grain"] as const)
    .filter((key) => Math.abs(grading.details[key]) > 0.0001)
    .map((key) => `details.${key}`);
  const effects = HF_COLOR_GRADING_ACTIVE_EFFECT_KEYS.filter(
    (key) => Math.abs(grading.effects[key]) > 0.0001,
  ).map((key) => `effects.${key}`);
  return [...details, ...effects];
}

function compileLut(
  grading: ResolvedHfColorGrading,
  lut: CubeLut3D | null | undefined,
): LutTable | null {
  if (!grading.lut || grading.lut.intensity === 0) return null;
  if (!lut) {
    throw new Error(
      `The grading applies the LUT ${grading.lut.src}; pass its parsed .cube as options.lut to bake it.`,
    );
  }
  const packed = packCubeLutToRgba8(lut);
  return {
    size: Math.max(lut.size, 2),
    width: packed.width,
    data: packed.data,
    domainMin: [...lut.domainMin] as Rgb,
    span: lut.domainMax.map((max, channel) =>
      Math.max(max - (lut.domainMin[channel] ?? 0), 0.00001),
    ) as Rgb,
    intensity: grading.lut.intensity ?? 0,
  };
}

function compileGrade(
  grading: ResolvedHfColorGrading,
  lut: CubeLut3D | null | undefined,
): CompiledGrade {
  const spatial = spatialStages(grading);
  if (spatial.length > 0) {
    throw new Error(
      `A 3D LUT holds only colour; this grading also has spatial stages: ${spatial.join(", ")}.`,
    );
  }
  const { curves, hueCurves, secondaries } = grading;
  return {
    grading,
    curves: hasHfColorGradingRgbCurveValues(curves)
      ? {
          red: quantisedCurve(compileHfColorCurve(curves.red)),
          green: quantisedCurve(compileHfColorCurve(curves.green)),
          blue: quantisedCurve(compileHfColorCurve(curves.blue)),
          master: quantisedCurve(compileHfColorCurve(curves.master)),
        }
      : null,
    hueCurves: hasHfColorGradingHueCurveValues(hueCurves)
      ? {
          hue: signedHueCurve(hueCurves.hueVsHue, -180, 180),
          saturation: signedHueCurve(hueCurves.hueVsSaturation, -1, 1),
          luma: signedHueCurve(hueCurves.hueVsLuma, -1, 1),
        }
      : null,
    secondaries: hasHfColorGradingSecondaryValues(secondaries)
      ? secondaries.filter((secondary) => secondary.enabled).map(quantisedSecondary)
      : [],
    lut: compileLut(grading, lut),
  };
}

function gradeColor(input: Rgb, grade: CompiledGrade): Rgb {
  let c = applyPrimaryGrade(input, grade.grading.adjust);
  c = applyTonalWheels(c, grade.grading.wheels);
  if (grade.curves) c = applyRgbCurves(c, grade.curves);
  if (grade.hueCurves) c = applyHueCurves(c, grade.hueCurves);
  for (const secondary of grade.secondaries) c = applySecondary(c, secondary);
  c = clampRgb(c);
  if (grade.lut) c = clampRgb(applyLut(c, grade.lut));
  return clampRgb(mixRgb(input, c, grade.grading.intensity));
}

/**
 * Bakes a colour grade into a `.cube` 3D LUT (red varying fastest) that matches the runtime's
 * shader, for applying the grade outside a browser, e.g. with ffmpeg's lut3d. Throws for a grade
 * with spatial stages (grain, vignette, blur, halftone and the other effects), which no LUT holds.
 */
export function bakeHfColorGradingCube(
  grading: HfColorGrading | ResolvedHfColorGrading,
  options: BakeHfColorGradingCubeOptions = {},
): string {
  const size = options.size ?? 33;
  if (!Number.isInteger(size) || size < 2 || size > 256) {
    throw new RangeError(`A .cube size must be a whole number from 2 to 256, not ${size}.`);
  }
  const resolved = normalizeHfColorGrading(grading);
  const grade = resolved ? compileGrade(resolved, options.lut) : null;
  const step = size - 1;
  const lines = [`LUT_3D_SIZE ${size}`, "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"];
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        const input: Rgb = [r / step, g / step, b / step];
        const output = grade ? gradeColor(input, grade) : input;
        lines.push(output.map((value) => value.toFixed(6)).join(" "));
      }
    }
  }
  return `${lines.join("\n")}\n`;
}
