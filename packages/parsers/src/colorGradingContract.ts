export const COLOR_GRADING_CONTRACT_VERSION = 2;
export const COLOR_GRADING_COLOR_SPACE = "rec709";
export const COLOR_GRADING_MAX_CURVE_POINTS = 16;
export const COLOR_GRADING_MAX_SECONDARIES = 4;
export const COLOR_GRADING_ADVANCED_LIMITS = {
  hueDegrees: { min: 0, max: 360, inclusiveMax: false },
  unit: { min: 0, max: 1 },
  signedUnit: { min: -1, max: 1 },
  secondaryHueRange: { min: 0, max: 180 },
  secondaryHueSoftness: { min: 0, max: 180 },
  secondaryHueCombinedMax: 180,
  secondarySoftRangeSoftness: { min: 0, max: 0.5 },
  secondaryHueShift: { min: -180, max: 180 },
  effects: {
    asciiStyle: { min: 0, max: 7 },
    bloom: { min: 0, max: 3 },
    bloomRadius: { min: 1, max: 100 },
    monoScreenShape: { min: 0, max: 4 },
  },
} as const;

export const COLOR_GRADING_TOP_LEVEL_KEYS = [
  "enabled",
  "preset",
  "intensity",
  "adjust",
  "wheels",
  "curves",
  "hueCurves",
  "secondaries",
  "details",
  "effects",
  "palette",
  "lut",
  "colorSpace",
] as const;

export const COLOR_GRADING_ADJUST_KEYS = [
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
] as const;

export const COLOR_GRADING_WHEEL_KEYS = ["shadows", "midtones", "highlights"] as const;
export const COLOR_GRADING_CURVE_KEYS = ["master", "red", "green", "blue"] as const;
export const COLOR_GRADING_HUE_CURVE_KEYS = ["hueVsHue", "hueVsSaturation", "hueVsLuma"] as const;

const COLOR_GRADING_WHEEL_CONTROL_KEYS = ["hue", "amount", "level"] as const;
const COLOR_GRADING_SECONDARY_KEYS = ["enabled", "key", "correction"] as const;
const COLOR_GRADING_SECONDARY_KEY_KEYS = ["hue", "saturation", "luma"] as const;
const COLOR_GRADING_HUE_RANGE_KEYS = ["center", "range", "softness"] as const;
const COLOR_GRADING_SOFT_RANGE_KEYS = ["min", "max", "softness"] as const;
const COLOR_GRADING_SECONDARY_CORRECTION_KEYS = [
  "hueShift",
  "saturation",
  "luma",
  "temperature",
  "tint",
] as const;

export const COLOR_GRADING_DETAIL_KEYS = [
  "vignette",
  "vignetteMidpoint",
  "vignetteRoundness",
  "vignetteFeather",
  "grain",
  "grainSize",
  "grainRoughness",
] as const;

export const COLOR_GRADING_EFFECT_KEYS = [
  "blur",
  "pixelate",
  "chromaBleed",
  "tapeDamage",
  "tapeTracking",
  "tapeNoise",
  "tapeSpeed",
  "filmArtifacts",
  "halftone",
  "halftoneSize",
  "twoInkPrint",
  "twoInkPrintSize",
  "ascii",
  "asciiSize",
  "asciiInvert",
  "asciiStyle",
  "asciiColor",
  "asciiRotation",
  "dither",
  "ditherSize",
  "bloom",
  "bloomRadius",
  "monoScreen",
  "monoScreenSize",
  "monoScreenAngle",
  "monoScreenSpread",
  "monoScreenShape",
  "monoScreenInvert",
  "scanlines",
  "scanlineCount",
  "scanlineSoftness",
  "chromaticAberration",
  "chromaticAngle",
  "crtCurvature",
  "digitalGlitch",
  "digitalGlitchColorSplit",
  "digitalGlitchLineTear",
  "digitalGlitchPixelate",
  "digitalGlitchBlockAmount",
  "digitalGlitchBlockDisplacement",
  "digitalGlitchBlockOpacity",
  "digitalGlitchSpeed",
  "engraving",
  "engravingSpacing",
  "engravingMinThickness",
  "engravingMaxThickness",
  "engravingAngle",
  "engravingContrast",
  "engravingSharpness",
  "engravingWave",
  "engravingWaveFrequency",
  "crosshatch",
  "crosshatchSpacing",
  "crosshatchThickness",
  "crosshatchAngle",
  "crosshatchContrast",
  "crosshatchEdges",
  "crosshatchLineWeight",
  "crosshatchWave",
  "crosshatchWaveFrequency",
  "kuwahara",
  "kuwaharaRadius",
  "kuwaharaSharpness",
  "kuwaharaSaturation",
] as const;

export const COLOR_GRADING_LUT_KEYS = ["src", "intensity"] as const;

type NumericLimit = Readonly<{ min: number; max: number }>;

const UNIT_LIMIT: NumericLimit = COLOR_GRADING_ADVANCED_LIMITS.unit;
const SIGNED_UNIT_LIMIT: NumericLimit = COLOR_GRADING_ADVANCED_LIMITS.signedUnit;
const EFFECT_LIMIT_OVERRIDES: Readonly<Record<string, NumericLimit>> =
  COLOR_GRADING_ADVANCED_LIMITS.effects;
const VARIABLE_REF = /^\$(?:\{[A-Za-z0-9_.:-]+\}|[A-Za-z0-9_.:-]+)$/;
const PALETTE_COLOR = /^#[0-9a-f]{6}$/i;

const OBJECT_SECTIONS = [
  ["adjust", COLOR_GRADING_ADJUST_KEYS],
  ["details", COLOR_GRADING_DETAIL_KEYS],
  ["effects", COLOR_GRADING_EFFECT_KEYS],
  ["lut", COLOR_GRADING_LUT_KEYS],
] as const;

export interface ColorGradingContractIssue {
  path: string;
  message: string;
  hint?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isColorGradingVariableRef(value: unknown): value is string {
  return typeof value === "string" && VARIABLE_REF.test(value.trim());
}

function unknownKeysHint(path: string, unknown: readonly string[]): string {
  if (path !== "grading") return `Correct or remove the unsupported "${path}" keys.`;
  const sections = new Set(
    unknown.flatMap((key) =>
      OBJECT_SECTIONS.filter(([, keys]) => (keys as readonly string[]).includes(key)).map(
        ([section]) => section,
      ),
    ),
  );
  return sections.size === 1
    ? `Move those controls under "${[...sections][0]}".`
    : "Use only the documented media-treatment keys at the top level.";
}

function validateObject(
  value: unknown,
  path: string,
  keys: readonly string[],
  issues: ColorGradingContractIssue[],
): Record<string, unknown> | null {
  if (isColorGradingVariableRef(value)) return null;
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object or variable reference" });
    return null;
  }
  const allowed = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    issues.push({
      path,
      message: `has unsupported key(s): ${unknown.join(", ")}`,
      hint: unknownKeysHint(path, unknown),
    });
  }
  return value;
}

function isNumberInRange(value: unknown, limit: NumericLimit, inclusiveMax: boolean): boolean {
  if (typeof value !== "number" || !Number.isFinite(value) || value < limit.min) return false;
  return inclusiveMax ? value <= limit.max : value < limit.max;
}

function validateNumericField(
  value: Record<string, unknown>,
  key: string,
  path: string,
  limit: NumericLimit,
  issues: ColorGradingContractIssue[],
  inclusiveMax = true,
): void {
  const candidate = value[key];
  if (candidate === undefined || isColorGradingVariableRef(candidate)) return;
  if (isNumberInRange(candidate, limit, inclusiveMax)) return;
  issues.push({
    path: path ? `${path}.${key}` : key,
    message: `must be a finite number from ${limit.min} ${inclusiveMax ? "through" : "up to"} ${limit.max}`,
  });
}

function isFiniteTuple(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
  );
}

function validateCurve(value: unknown, path: string, issues: ColorGradingContractIssue[]): void {
  if (isColorGradingVariableRef(value)) return;
  if (!Array.isArray(value) || value.length < 2 || value.length > COLOR_GRADING_MAX_CURVE_POINTS) {
    issues.push({
      path,
      message: `must contain 2 to ${COLOR_GRADING_MAX_CURVE_POINTS} [input, output] points`,
    });
    return;
  }

  const inputs = new Set<number>();
  value.forEach((point, index) => {
    if (!isFiniteTuple(point)) {
      issues.push({ path: `${path}[${index}]`, message: "must be a finite [input, output] tuple" });
      return;
    }
    const [input, output] = point;
    if (input < 0 || input > 1 || output < 0 || output > 1) {
      issues.push({ path: `${path}[${index}]`, message: "coordinates must be between 0 and 1" });
    }
    if (inputs.has(input)) issues.push({ path, message: `contains duplicate input ${input}` });
    inputs.add(input);
  });

  const inferredPointCount = value.length + (inputs.has(0) ? 0 : 1) + (inputs.has(1) ? 0 : 1);
  if (inferredPointCount > COLOR_GRADING_MAX_CURVE_POINTS) {
    issues.push({
      path,
      message: `must contain at most ${COLOR_GRADING_MAX_CURVE_POINTS} points including inferred 0 and 1 endpoints`,
    });
  }
}

function validateHueCurve(
  value: unknown,
  path: string,
  outputMin: number,
  outputMax: number,
  issues: ColorGradingContractIssue[],
): void {
  if (isColorGradingVariableRef(value)) return;
  if (!Array.isArray(value) || value.length < 3 || value.length > COLOR_GRADING_MAX_CURVE_POINTS) {
    issues.push({
      path,
      message: `must contain 3 to ${COLOR_GRADING_MAX_CURVE_POINTS} [hueDegrees, delta] points`,
    });
    return;
  }

  const hues = new Set<number>();
  value.forEach((point, index) => {
    if (!isFiniteTuple(point)) {
      issues.push({ path: `${path}[${index}]`, message: "must be a finite [hue, delta] tuple" });
      return;
    }
    const [hue, delta] = point;
    if (hue < 0 || hue >= 360) {
      issues.push({ path: `${path}[${index}][0]`, message: "must be from 0 up to 360 degrees" });
    }
    if (delta < outputMin || delta > outputMax) {
      issues.push({
        path: `${path}[${index}][1]`,
        message: `must be between ${outputMin} and ${outputMax}`,
      });
    }
    if (hues.has(hue)) issues.push({ path, message: `contains duplicate hue ${hue}` });
    hues.add(hue);
  });
}

function validateNumericSection(
  value: Record<string, unknown>,
  path: string,
  keys: readonly string[],
  limitFor: (key: string) => NumericLimit,
  issues: ColorGradingContractIssue[],
): void {
  for (const key of keys) validateNumericField(value, key, path, limitFor(key), issues);
}

function validatePalette(value: unknown, issues: ColorGradingContractIssue[]): void {
  if (value === undefined || value === null || isColorGradingVariableRef(value)) return;
  const hint =
    'Use 2 to 6 colors in the intended mapping order, each written as exact "#RRGGBB", or use a project variable reference.';
  if (!Array.isArray(value) || value.length < 2 || value.length > 6) {
    issues.push({ path: "palette", message: "must contain 2 to 6 hex colors", hint });
    return;
  }
  value.forEach((color, index) => {
    if (typeof color !== "string" || !PALETTE_COLOR.test(color)) {
      issues.push({
        path: `palette[${index}]`,
        message: "must be a six-digit hex color",
        hint,
      });
    }
  });
}

function validateLut(
  value: unknown,
  object: Record<string, unknown> | null,
  issues: ColorGradingContractIssue[],
): void {
  if (typeof value === "string") {
    if (!value.trim()) issues.push({ path: "lut", message: "must not be empty" });
    return;
  }
  if (!object) return;
  if (
    !isColorGradingVariableRef(object.src) &&
    (typeof object.src !== "string" || !object.src.trim())
  ) {
    issues.push({
      path: "lut.src",
      message: "must be a non-empty string or variable reference",
    });
  }
  validateNumericField(object, "intensity", "lut", UNIT_LIMIT, issues);
}

function validateEnabled(
  grading: Record<string, unknown>,
  issues: ColorGradingContractIssue[],
): void {
  if (
    grading.enabled !== undefined &&
    !isColorGradingVariableRef(grading.enabled) &&
    typeof grading.enabled !== "boolean"
  ) {
    issues.push({ path: "enabled", message: "must be a boolean or variable reference" });
  }
}

function validatePreset(
  grading: Record<string, unknown>,
  issues: ColorGradingContractIssue[],
): void {
  if (
    grading.preset !== undefined &&
    grading.preset !== null &&
    !isColorGradingVariableRef(grading.preset) &&
    (typeof grading.preset !== "string" || !grading.preset.trim())
  ) {
    issues.push({
      path: "preset",
      message: "must be a non-empty string, null, or variable reference",
    });
  }
}

function validateColorSpace(
  grading: Record<string, unknown>,
  issues: ColorGradingContractIssue[],
): void {
  if (
    grading.colorSpace !== undefined &&
    !isColorGradingVariableRef(grading.colorSpace) &&
    grading.colorSpace !== COLOR_GRADING_COLOR_SPACE
  ) {
    issues.push({
      path: "colorSpace",
      message: `must be "${COLOR_GRADING_COLOR_SPACE}" or a variable reference`,
    });
  }
}

function validateTopLevel(
  grading: Record<string, unknown>,
  issues: ColorGradingContractIssue[],
): void {
  validateEnabled(grading, issues);
  validateNumericField(grading, "intensity", "", UNIT_LIMIT, issues);
  validatePreset(grading, issues);
  validateColorSpace(grading, issues);
}

function validateSection(
  grading: Record<string, unknown>,
  key: (typeof OBJECT_SECTIONS)[number][0],
  keys: readonly string[],
  issues: ColorGradingContractIssue[],
): void {
  const section = grading[key];
  if (section === undefined || (key === "lut" && section === null)) return;
  if (key === "lut" && typeof section === "string") {
    validateLut(section, null, issues);
    return;
  }
  const object = validateObject(section, key, keys, issues);
  if (!object) return;
  if (key === "lut") return validateLut(section, object, issues);

  const limitFor = (control: string): NumericLimit => {
    if (key === "adjust" && control === "exposure") return { min: -2, max: 2 };
    if (key === "adjust" || (key === "details" && control === "vignetteRoundness")) {
      return SIGNED_UNIT_LIMIT;
    }
    return key === "effects" ? (EFFECT_LIMIT_OVERRIDES[control] ?? UNIT_LIMIT) : UNIT_LIMIT;
  };
  validateNumericSection(object, key, keys, limitFor, issues);
}

function validateSections(
  grading: Record<string, unknown>,
  issues: ColorGradingContractIssue[],
): void {
  for (const [key, keys] of OBJECT_SECTIONS) validateSection(grading, key, keys, issues);
}

function validateWheels(value: unknown, issues: ColorGradingContractIssue[]): void {
  if (value === undefined || isColorGradingVariableRef(value)) return;
  const wheels = validateObject(value, "wheels", COLOR_GRADING_WHEEL_KEYS, issues);
  if (!wheels) return;

  for (const wheel of COLOR_GRADING_WHEEL_KEYS) {
    if (wheels[wheel] === undefined) continue;
    const path = `wheels.${wheel}`;
    const controls = validateObject(wheels[wheel], path, COLOR_GRADING_WHEEL_CONTROL_KEYS, issues);
    if (!controls) continue;
    validateNumericField(
      controls,
      "hue",
      path,
      COLOR_GRADING_ADVANCED_LIMITS.hueDegrees,
      issues,
      COLOR_GRADING_ADVANCED_LIMITS.hueDegrees.inclusiveMax,
    );
    validateNumericField(controls, "amount", path, UNIT_LIMIT, issues);
    validateNumericField(controls, "level", path, SIGNED_UNIT_LIMIT, issues);
  }
}

function validateCurves(value: unknown, issues: ColorGradingContractIssue[]): void {
  if (value === undefined || isColorGradingVariableRef(value)) return;
  const curves = validateObject(value, "curves", COLOR_GRADING_CURVE_KEYS, issues);
  if (!curves) return;
  for (const key of COLOR_GRADING_CURVE_KEYS) {
    if (curves[key] !== undefined) validateCurve(curves[key], `curves.${key}`, issues);
  }
}

function validateHueCurves(value: unknown, issues: ColorGradingContractIssue[]): void {
  if (value === undefined || isColorGradingVariableRef(value)) return;
  const curves = validateObject(value, "hueCurves", COLOR_GRADING_HUE_CURVE_KEYS, issues);
  if (!curves) return;
  const limits = {
    hueVsHue: [-180, 180],
    hueVsSaturation: [-1, 1],
    hueVsLuma: [-1, 1],
  } as const;
  for (const key of COLOR_GRADING_HUE_CURVE_KEYS) {
    if (curves[key] !== undefined) {
      validateHueCurve(curves[key], `hueCurves.${key}`, limits[key][0], limits[key][1], issues);
    }
  }
}

function validateSoftRange(
  value: unknown,
  path: string,
  issues: ColorGradingContractIssue[],
): void {
  const range = validateObject(value, path, COLOR_GRADING_SOFT_RANGE_KEYS, issues);
  if (!range) return;
  validateNumericField(range, "min", path, UNIT_LIMIT, issues);
  validateNumericField(range, "max", path, UNIT_LIMIT, issues);
  validateNumericField(
    range,
    "softness",
    path,
    COLOR_GRADING_ADVANCED_LIMITS.secondarySoftRangeSoftness,
    issues,
  );
  if (typeof range.min === "number" && typeof range.max === "number" && range.min >= range.max) {
    issues.push({ path, message: "min must be smaller than max" });
  }
}

function validateSecondaryHue(
  value: unknown,
  path: string,
  issues: ColorGradingContractIssue[],
): void {
  const hue = validateObject(value, path, COLOR_GRADING_HUE_RANGE_KEYS, issues);
  if (!hue) return;
  validateNumericField(
    hue,
    "center",
    path,
    COLOR_GRADING_ADVANCED_LIMITS.hueDegrees,
    issues,
    COLOR_GRADING_ADVANCED_LIMITS.hueDegrees.inclusiveMax,
  );
  validateNumericField(hue, "range", path, COLOR_GRADING_ADVANCED_LIMITS.secondaryHueRange, issues);
  validateNumericField(
    hue,
    "softness",
    path,
    COLOR_GRADING_ADVANCED_LIMITS.secondaryHueSoftness,
    issues,
  );
  if (
    typeof hue.range === "number" &&
    typeof hue.softness === "number" &&
    hue.range + hue.softness > COLOR_GRADING_ADVANCED_LIMITS.secondaryHueCombinedMax
  ) {
    issues.push({
      path,
      message: `range plus softness must not exceed ${COLOR_GRADING_ADVANCED_LIMITS.secondaryHueCombinedMax} degrees`,
    });
  }
}

function validateSecondaryKey(
  value: unknown,
  path: string,
  issues: ColorGradingContractIssue[],
): void {
  const key = validateObject(value, path, COLOR_GRADING_SECONDARY_KEY_KEYS, issues);
  if (!key) return;
  if (key.hue !== undefined) validateSecondaryHue(key.hue, `${path}.hue`, issues);
  if (key.saturation !== undefined) validateSoftRange(key.saturation, `${path}.saturation`, issues);
  if (key.luma !== undefined) validateSoftRange(key.luma, `${path}.luma`, issues);
}

function validateSecondaryCorrection(
  value: unknown,
  path: string,
  issues: ColorGradingContractIssue[],
): void {
  const correction = validateObject(value, path, COLOR_GRADING_SECONDARY_CORRECTION_KEYS, issues);
  if (!correction) return;
  validateNumericField(
    correction,
    "hueShift",
    path,
    COLOR_GRADING_ADVANCED_LIMITS.secondaryHueShift,
    issues,
  );
  for (const key of ["saturation", "luma", "temperature", "tint"] as const) {
    validateNumericField(correction, key, path, SIGNED_UNIT_LIMIT, issues);
  }
}

function validateSecondary(
  value: unknown,
  index: number,
  issues: ColorGradingContractIssue[],
): void {
  const path = `secondaries[${index}]`;
  const secondary = validateObject(value, path, COLOR_GRADING_SECONDARY_KEYS, issues);
  if (!secondary) return;
  if (
    secondary.enabled !== undefined &&
    typeof secondary.enabled !== "boolean" &&
    !isColorGradingVariableRef(secondary.enabled)
  ) {
    issues.push({ path: `${path}.enabled`, message: "must be a boolean" });
  }
  validateSecondaryKey(secondary.key, `${path}.key`, issues);
  validateSecondaryCorrection(secondary.correction, `${path}.correction`, issues);
}

function validateSecondaries(value: unknown, issues: ColorGradingContractIssue[]): void {
  if (value === undefined || isColorGradingVariableRef(value)) return;
  if (!Array.isArray(value) || value.length > COLOR_GRADING_MAX_SECONDARIES) {
    issues.push({
      path: "secondaries",
      message: `must be an array of at most ${COLOR_GRADING_MAX_SECONDARIES} selections`,
    });
    return;
  }

  value.forEach((secondary, index) => validateSecondary(secondary, index, issues));
}

/** Browser-safe structural validation shared by Lint, CLI, and Core consumers. */
export function validateColorGradingContract(value: unknown): ColorGradingContractIssue[] {
  if (typeof value === "string") {
    return value.trim() ? [] : [{ path: "grading", message: "is empty" }];
  }

  const issues: ColorGradingContractIssue[] = [];
  const grading = validateObject(value, "grading", COLOR_GRADING_TOP_LEVEL_KEYS, issues);
  if (!grading) return issues;

  validateTopLevel(grading, issues);
  validateSections(grading, issues);
  validateWheels(grading.wheels, issues);
  validateCurves(grading.curves, issues);
  validateHueCurves(grading.hueCurves, issues);
  validateSecondaries(grading.secondaries, issues);
  validatePalette(grading.palette, issues);
  return issues;
}
