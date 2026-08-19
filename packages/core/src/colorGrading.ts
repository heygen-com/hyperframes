import { DEFAULT_MAX_CUBE_LUT_SIZE } from "./colorLuts";
import type { HfColorCurvePoint, HfHueCurvePoint } from "./colorGradingCurves";
import {
  COLOR_GRADING_ADJUST_KEYS,
  COLOR_GRADING_ADVANCED_LIMITS,
  COLOR_GRADING_COLOR_SPACE,
  COLOR_GRADING_CONTRACT_VERSION,
  COLOR_GRADING_CURVE_KEYS,
  COLOR_GRADING_DETAIL_KEYS,
  COLOR_GRADING_EFFECT_KEYS,
  COLOR_GRADING_HUE_CURVE_KEYS,
  COLOR_GRADING_LUT_KEYS,
  COLOR_GRADING_MAX_CURVE_POINTS,
  COLOR_GRADING_MAX_SECONDARIES,
  COLOR_GRADING_TOP_LEVEL_KEYS,
  COLOR_GRADING_WHEEL_KEYS,
} from "@hyperframes/parsers/color-grading-contract";

export type { HfColorCurvePoint, HfHueCurvePoint } from "./colorGradingCurves";
export {
  compileHfColorCurve,
  compileHfHueCurve,
  HF_COLOR_CURVE_MAX_POINTS,
} from "./colorGradingCurves";

export const HF_COLOR_GRADING_ATTR = "data-color-grading";

// Runtime <-> studio contract attributes. The runtime grading engine writes
// them; studio editing/soft-reload code reads them. Single owner — never
// re-declare these literals elsewhere.
/** Set on a graded source while its pixels render on the grading canvas. */
export const COLOR_GRADING_SOURCE_HIDDEN_ATTR = "data-hf-color-grading-source-hidden";
/**
 * The element's AUTHORED inline opacity, stamped at document parse time before
 * any animation engine mutates it ("" = authored none; attribute absent =
 * never captured). See installAuthoredOpacityCapture in the runtime.
 */
export const COLOR_GRADING_AUTHORED_OPACITY_ATTR = "data-hf-authored-opacity";

export const HF_COLOR_GRADING_CANVAS_ID_PREFIX = "__hf_color_grading_";

export const HF_COLOR_GRADING_COLOR_SPACE = COLOR_GRADING_COLOR_SPACE;

export type HfColorGradingPresetId =
  | "neutral"
  | "warm-daylight"
  | "clean-studio"
  | "skin-soft"
  | "food-pop"
  | "night-lift"
  | "muted-editorial"
  | "vintage-wash"
  | "mono-clean"
  | "mono-fade"
  | "soft-boost"
  | "bright-pop"
  | "deep-contrast"
  | "creator-camcorder"
  | "vhs-playback"
  | "home-movie-8mm"
  | "editorial-halftone"
  | "two-ink-print";

export type HfColorGradingAdjustKey = (typeof COLOR_GRADING_ADJUST_KEYS)[number];

const ADJUST_ZERO = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
} satisfies Record<HfColorGradingAdjustKey, number>;

export type HfColorGradingAdjust = Partial<Record<HfColorGradingAdjustKey, number>>;

export type HfColorGradingWheelKey = (typeof COLOR_GRADING_WHEEL_KEYS)[number];

export interface HfColorGradingTonalWheel {
  hue?: number;
  amount?: number;
  level?: number;
}

export type HfColorGradingWheels = Partial<
  Record<HfColorGradingWheelKey, HfColorGradingTonalWheel>
>;

export type NormalizedHfColorGradingWheels = Record<
  HfColorGradingWheelKey,
  Required<HfColorGradingTonalWheel>
>;

export type HfColorGradingCurveKey = (typeof COLOR_GRADING_CURVE_KEYS)[number];
export type HfColorGradingHueCurveKey = (typeof COLOR_GRADING_HUE_CURVE_KEYS)[number];
export type HfColorGradingCurves = Partial<
  Record<HfColorGradingCurveKey, readonly HfColorCurvePoint[]>
>;
export type HfColorGradingHueCurves = Partial<
  Record<HfColorGradingHueCurveKey, readonly HfHueCurvePoint[]>
>;
export type NormalizedHfColorGradingCurves = Record<
  HfColorGradingCurveKey,
  readonly HfColorCurvePoint[]
>;
export type NormalizedHfColorGradingHueCurves = Record<
  HfColorGradingHueCurveKey,
  readonly HfHueCurvePoint[]
>;

export interface HfColorGradingHueRange {
  center?: number;
  range?: number;
  softness?: number;
}

export interface HfColorGradingSoftRange {
  min?: number;
  max?: number;
  softness?: number;
}

export interface HfColorGradingSecondaryCorrection {
  hueShift?: number;
  saturation?: number;
  luma?: number;
  temperature?: number;
  tint?: number;
}

export interface HfColorGradingSecondary {
  enabled?: boolean;
  key: {
    hue?: HfColorGradingHueRange;
    saturation?: HfColorGradingSoftRange;
    luma?: HfColorGradingSoftRange;
  };
  correction: HfColorGradingSecondaryCorrection;
}

export interface NormalizedHfColorGradingSecondary {
  enabled: boolean;
  key: {
    hue: Required<HfColorGradingHueRange>;
    saturation: Required<HfColorGradingSoftRange>;
    luma: Required<HfColorGradingSoftRange>;
  };
  correction: Required<HfColorGradingSecondaryCorrection>;
}

// Sub-controls use useful identity defaults rather than raw mathematical zeroes.
export type HfColorGradingDetailKey = (typeof COLOR_GRADING_DETAIL_KEYS)[number];

const DETAIL_DEFAULTS = {
  vignette: 0,
  vignetteMidpoint: 0.5,
  vignetteRoundness: 0,
  vignetteFeather: 0.65,
  grain: 0,
  grainSize: 0.25,
  grainRoughness: 0.5,
} satisfies Record<HfColorGradingDetailKey, number>;

export type HfColorGradingDetails = Partial<Record<HfColorGradingDetailKey, number>>;

export type HfColorGradingEffectKey = (typeof COLOR_GRADING_EFFECT_KEYS)[number];

const EFFECT_DEFAULTS = {
  blur: 0,
  pixelate: 0,
  chromaBleed: 0,
  tapeDamage: 0,
  tapeTracking: 0,
  tapeNoise: 1,
  tapeSpeed: 0.5,
  filmArtifacts: 0,
  halftone: 0,
  halftoneSize: 0,
  twoInkPrint: 0,
  twoInkPrintSize: 0,
  ascii: 0,
  asciiSize: 5 / 76,
  asciiInvert: 0,
  asciiStyle: 0,
  asciiColor: 1,
  asciiRotation: 0,
  dither: 0,
  ditherSize: 0,
  bloom: 0,
  bloomRadius: 8,
  monoScreen: 0,
  monoScreenSize: 0,
  monoScreenAngle: 0,
  monoScreenSpread: 0,
  monoScreenShape: 0,
  monoScreenInvert: 0,
  scanlines: 0,
  scanlineCount: 0,
  scanlineSoftness: 0,
  chromaticAberration: 0,
  chromaticAngle: 0,
  crtCurvature: 0,
  digitalGlitch: 0,
  digitalGlitchColorSplit: 0,
  digitalGlitchLineTear: 0,
  digitalGlitchPixelate: 0,
  digitalGlitchBlockAmount: 0,
  digitalGlitchBlockDisplacement: 0,
  digitalGlitchBlockOpacity: 0,
  digitalGlitchSpeed: 0,
  engraving: 0,
  engravingSpacing: 7 / 17,
  engravingMinThickness: 0.2,
  engravingMaxThickness: 3.2 / 7,
  engravingAngle: 0.25,
  engravingContrast: 7 / 15,
  engravingSharpness: 0.59,
  engravingWave: 0.2,
  engravingWaveFrequency: 2 / 9,
  crosshatch: 0,
  crosshatchSpacing: 7 / 25,
  crosshatchThickness: 0.25,
  crosshatchAngle: 0.25,
  crosshatchContrast: 1 / 3,
  crosshatchEdges: 0.5,
  crosshatchLineWeight: 0,
  crosshatchWave: 0.33,
  crosshatchWaveFrequency: 2 / 9,
  kuwahara: 0,
  kuwaharaRadius: 1 / 7,
  kuwaharaSharpness: 5 / 16,
  kuwaharaSaturation: 0.5,
} satisfies Record<HfColorGradingEffectKey, number>;

export type HfColorGradingEffects = Partial<Record<HfColorGradingEffectKey, number>>;

export interface HfColorGradingLutRef {
  src: string;
  intensity?: number;
}

export interface HfColorGrading {
  enabled?: boolean;
  preset?: HfColorGradingPresetId | string | null;
  intensity?: number;
  adjust?: HfColorGradingAdjust;
  wheels?: HfColorGradingWheels;
  curves?: HfColorGradingCurves;
  hueCurves?: HfColorGradingHueCurves;
  secondaries?: readonly HfColorGradingSecondary[];
  details?: HfColorGradingDetails;
  effects?: HfColorGradingEffects;
  palette?: readonly string[] | null;
  lut?: HfColorGradingLutRef | string | null;
  colorSpace?: typeof HF_COLOR_GRADING_COLOR_SPACE | string;
}

export const HF_COLOR_GRADING_TOP_LEVEL_KEYS =
  COLOR_GRADING_TOP_LEVEL_KEYS satisfies readonly (keyof HfColorGrading)[];

export const HF_COLOR_GRADING_LUT_KEYS =
  COLOR_GRADING_LUT_KEYS satisfies readonly (keyof HfColorGradingLutRef)[];

export interface NormalizedHfColorGrading {
  enabled: boolean;
  preset: HfColorGradingPresetId | string | null;
  intensity: number;
  adjust: Record<HfColorGradingAdjustKey, number>;
  wheels?: NormalizedHfColorGradingWheels;
  curves?: NormalizedHfColorGradingCurves;
  hueCurves?: NormalizedHfColorGradingHueCurves;
  secondaries?: readonly NormalizedHfColorGradingSecondary[];
  details: Record<HfColorGradingDetailKey, number>;
  effects: Record<HfColorGradingEffectKey, number>;
  palette: readonly string[] | null;
  lut: HfColorGradingLutRef | null;
  colorSpace: typeof HF_COLOR_GRADING_COLOR_SPACE | string;
}

export interface ResolvedHfColorGrading extends NormalizedHfColorGrading {
  wheels: NormalizedHfColorGradingWheels;
  curves: NormalizedHfColorGradingCurves;
  hueCurves: NormalizedHfColorGradingHueCurves;
  secondaries: readonly NormalizedHfColorGradingSecondary[];
}

export interface HfColorGradingTarget {
  id?: string | null;
  hfId?: string | null;
  selector?: string | null;
  selectorIndex?: number | null;
}

export interface HfColorGradingPreset {
  id: HfColorGradingPresetId;
  label: string;
  intensity: number;
  adjust: Record<HfColorGradingAdjustKey, number>;
  details: Record<HfColorGradingDetailKey, number>;
  effects: Record<HfColorGradingEffectKey, number>;
}

export const HF_COLOR_GRADING_PALETTES = [
  { id: "noir", label: "Noir", group: "Classic", colors: ["#000000", "#ffffff"] },
  {
    id: "ink-paper",
    label: "Ink & Paper",
    group: "Classic",
    colors: ["#1a1a2e", "#f5f5dc"],
  },
  {
    id: "terminal",
    label: "Terminal",
    group: "Classic",
    colors: ["#001100", "#00ff00"],
  },
  {
    id: "amber-glow",
    label: "Amber Glow",
    group: "Classic",
    colors: ["#1a0f00", "#ffcc00"],
  },
  {
    id: "handheld-green",
    label: "Handheld Green",
    group: "Classic",
    colors: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
  },
  {
    id: "golden-hour",
    label: "Golden Hour",
    group: "Mood",
    colors: ["#1a1205", "#4a3510", "#8b6914", "#d4a017", "#fff8dc"],
  },
  {
    id: "deep-sea",
    label: "Deep Sea",
    group: "Mood",
    colors: ["#0a1628", "#1a3a5c", "#2d6187", "#5ba4c9", "#a8dce8"],
  },
  {
    id: "arctic-night",
    label: "Arctic Night",
    group: "Mood",
    colors: ["#0a0a14", "#1a2a4a", "#3a5a8a", "#6a9aca", "#cae8ff"],
  },
  {
    id: "synthwave",
    label: "Synthwave",
    group: "Mood",
    colors: ["#120458", "#7b2cbf", "#e040fb", "#ff6ec7", "#fff59d"],
  },
  {
    id: "vaporwave",
    label: "Vaporwave",
    group: "Mood",
    colors: ["#1a0a2e", "#3d1a5c", "#ff71ce", "#01cdfe", "#fffb96"],
  },
  {
    id: "forest",
    label: "Forest",
    group: "Mood",
    colors: ["#1a2e1a", "#2d4a2d", "#4a7c4a", "#7ab37a", "#c8e6c8"],
  },
  {
    id: "sepia",
    label: "Sepia",
    group: "Mono",
    colors: ["#1a1610", "#3d3020", "#6b5a40", "#a89070", "#e8dcc8"],
  },
  {
    id: "blueprint",
    label: "Blueprint",
    group: "Mono",
    colors: ["#001830", "#003060", "#0050a0", "#0080e0", "#e0f0ff"],
  },
  {
    id: "warm-print",
    label: "Warm Print",
    group: "HyperFrames",
    colors: ["#17121a", "#824c50", "#e09873", "#f7ddb1"],
  },
  {
    id: "electric-ink",
    label: "Electric Ink",
    group: "HyperFrames",
    colors: ["#080717", "#3c185f", "#7e2278", "#d9339f", "#ff6b66", "#aafae0"],
  },
] as const;

export type HfColorGradingVariableMap = Record<string, unknown>;

export const HF_COLOR_GRADING_ADJUST_KEYS =
  COLOR_GRADING_ADJUST_KEYS satisfies readonly HfColorGradingAdjustKey[];

export const HF_COLOR_GRADING_WHEEL_KEYS =
  COLOR_GRADING_WHEEL_KEYS satisfies readonly HfColorGradingWheelKey[];

export const HF_COLOR_GRADING_CURVE_KEYS =
  COLOR_GRADING_CURVE_KEYS satisfies readonly HfColorGradingCurveKey[];

export const HF_COLOR_GRADING_HUE_CURVE_KEYS =
  COLOR_GRADING_HUE_CURVE_KEYS satisfies readonly HfColorGradingHueCurveKey[];

export const HF_COLOR_GRADING_DETAIL_KEYS =
  COLOR_GRADING_DETAIL_KEYS satisfies readonly HfColorGradingDetailKey[];

export const HF_COLOR_GRADING_EFFECT_KEYS =
  COLOR_GRADING_EFFECT_KEYS satisfies readonly HfColorGradingEffectKey[];

const VINTAGE_WASH_ADJUST: HfColorGradingAdjust = {
  exposure: 0.03,
  contrast: -0.12,
  highlights: -0.1,
  shadows: 0.16,
  whites: -0.04,
  blacks: 0.08,
  temperature: 0.13,
  vibrance: -0.08,
  saturation: -0.08,
};

const VINTAGE_WASH_DETAILS: HfColorGradingDetails = { vignette: 0.18 };

function preset(
  id: HfColorGradingPresetId,
  label: string,
  adjust: HfColorGradingAdjust = {},
  details: HfColorGradingDetails = {},
  effects: HfColorGradingEffects = {},
  intensity = 1,
): HfColorGradingPreset {
  return {
    id,
    label,
    intensity,
    adjust: { ...ADJUST_ZERO, ...adjust },
    details: { ...DETAIL_DEFAULTS, ...details },
    effects: { ...EFFECT_DEFAULTS, ...effects },
  };
}

export const HF_COLOR_GRADING_PRESETS: readonly HfColorGradingPreset[] = [
  preset("neutral", "Neutral"),
  preset("warm-daylight", "Warm Daylight", {
    exposure: 0.06,
    contrast: 0.07,
    highlights: -0.06,
    shadows: 0.08,
    temperature: 0.18,
    saturation: 0.08,
  }),
  preset("clean-studio", "Clean Studio", {
    contrast: 0.08,
    highlights: -0.08,
    shadows: 0.06,
    temperature: -0.08,
    tint: 0.03,
    saturation: 0.04,
  }),
  preset("skin-soft", "Skin Soft", {
    exposure: 0.04,
    contrast: -0.03,
    highlights: -0.12,
    shadows: 0.12,
    temperature: 0.08,
    tint: 0.02,
    saturation: 0.04,
  }),
  preset("food-pop", "Food Pop", {
    exposure: 0.06,
    contrast: 0.1,
    shadows: 0.06,
    temperature: 0.14,
    vibrance: 0.1,
    saturation: 0.18,
  }),
  preset(
    "night-lift",
    "Night Lift",
    {
      exposure: 0.08,
      contrast: 0.08,
      highlights: -0.18,
      shadows: 0.2,
      blacks: -0.08,
      saturation: 0.04,
    },
    {
      vignette: 0.12,
    },
  ),
  preset(
    "muted-editorial",
    "Muted Editorial",
    {
      exposure: -0.02,
      contrast: 0.08,
      highlights: -0.08,
      shadows: 0.06,
      blacks: -0.05,
      temperature: -0.03,
      saturation: -0.12,
    },
    {
      vignette: 0.1,
    },
  ),
  preset("vintage-wash", "Vintage Wash", VINTAGE_WASH_ADJUST, VINTAGE_WASH_DETAILS),
  preset("mono-clean", "Mono Clean", {
    contrast: 0.12,
    highlights: -0.04,
    shadows: 0.04,
    blacks: -0.08,
    saturation: -1,
  }),
  preset(
    "mono-fade",
    "Mono Fade",
    {
      contrast: -0.04,
      highlights: -0.06,
      shadows: 0.1,
      blacks: 0.12,
      saturation: -1,
    },
    {
      vignette: 0.08,
    },
  ),
  preset("soft-boost", "Soft Boost", {
    exposure: 0.06,
    contrast: -0.04,
    highlights: -0.14,
    shadows: 0.16,
    vibrance: 0.08,
    saturation: 0.1,
  }),
  preset("bright-pop", "Bright Pop", {
    exposure: 0.12,
    contrast: 0.12,
    whites: 0.08,
    blacks: -0.04,
    vibrance: 0.08,
    saturation: 0.14,
  }),
  preset("deep-contrast", "Deep Contrast", {
    exposure: -0.03,
    contrast: 0.2,
    highlights: -0.08,
    shadows: -0.08,
    blacks: -0.12,
    saturation: 0.06,
  }),
  preset(
    "creator-camcorder",
    "Creator Camcorder",
    {
      contrast: 0.08,
      highlights: -0.05,
      shadows: 0.02,
      whites: 0.03,
      blacks: -0.04,
      temperature: -0.03,
      tint: -0.015,
      vibrance: -0.03,
      saturation: -0.06,
    },
    { vignette: 0.06, grain: 0.08, grainSize: 0.18, grainRoughness: 0.58 },
    { chromaBleed: 0.55 },
    0.72,
  ),
  preset(
    "vhs-playback",
    "VHS Playback",
    { contrast: -0.04, saturation: -0.08 },
    { grain: 0.16, grainSize: 0.12, grainRoughness: 0.72 },
    {
      tapeDamage: 0.82,
      tapeTracking: 0.85,
      tapeNoise: 0.3,
      tapeSpeed: 0.5,
      chromaBleed: 0.5,
      chromaticAberration: 0.18,
      scanlines: 0.35,
      scanlineCount: 0.17,
      scanlineSoftness: 1,
      digitalGlitch: 0.32,
      digitalGlitchLineTear: 0.08,
      digitalGlitchSpeed: 0.5,
    },
  ),
  preset(
    "home-movie-8mm",
    "8mm Home Movie",
    VINTAGE_WASH_ADJUST,
    {
      ...VINTAGE_WASH_DETAILS,
      vignette: 0.28,
      vignetteMidpoint: 0.54,
      vignetteFeather: 0.72,
      grain: 0.34,
      grainSize: 0.18,
      grainRoughness: 0.72,
    },
    { filmArtifacts: 0.62 },
    0.72,
  ),
  preset(
    "editorial-halftone",
    "Editorial Halftone",
    { contrast: 0.04, saturation: 0.04 },
    {},
    { halftone: 0.94, halftoneSize: 0.36 },
  ),
  preset(
    "two-ink-print",
    "Two-Ink Print",
    { contrast: 0.08, highlights: -0.06, shadows: 0.04 },
    {},
    { twoInkPrint: 1, twoInkPrintSize: 0.42 },
  ),
];

const PRESETS_BY_ID = new Map<string, HfColorGradingPreset>(
  HF_COLOR_GRADING_PRESETS.map((preset) => [preset.id, preset]),
);

const VARIABLE_REF_RE = /^\$(?:\{([A-Za-z0-9_.:-]+)\}|([A-Za-z0-9_.:-]+))$/;

const ADJUST_LIMITS: Record<HfColorGradingAdjustKey, { min: number; max: number }> = {
  exposure: { min: -2, max: 2 },
  contrast: { min: -1, max: 1 },
  highlights: { min: -1, max: 1 },
  shadows: { min: -1, max: 1 },
  whites: { min: -1, max: 1 },
  blacks: { min: -1, max: 1 },
  temperature: { min: -1, max: 1 },
  tint: { min: -1, max: 1 },
  vibrance: { min: -1, max: 1 },
  saturation: { min: -1, max: 1 },
};

const TONAL_WHEEL_DEFAULT: Required<HfColorGradingTonalWheel> = {
  hue: 0,
  amount: 0,
  level: 0,
};
const WHEEL_LIMITS = {
  amount: COLOR_GRADING_ADVANCED_LIMITS.unit,
  level: COLOR_GRADING_ADVANCED_LIMITS.signedUnit,
};
const RGB_CURVE_IDENTITY: readonly HfColorCurvePoint[] = [
  [0, 0],
  [1, 1],
];
const HUE_CURVE_IDENTITY: readonly HfHueCurvePoint[] = [];
const HUE_CURVE_LIMITS: Record<HfColorGradingHueCurveKey, { min: number; max: number }> = {
  hueVsHue: COLOR_GRADING_ADVANCED_LIMITS.secondaryHueShift,
  hueVsSaturation: COLOR_GRADING_ADVANCED_LIMITS.signedUnit,
  hueVsLuma: COLOR_GRADING_ADVANCED_LIMITS.signedUnit,
};
const SECONDARY_HUE_DEFAULT: Required<HfColorGradingHueRange> = {
  center: 0,
  range: 180,
  softness: 0,
};
const SECONDARY_SOFT_RANGE_DEFAULT: Required<HfColorGradingSoftRange> = {
  min: 0,
  max: 1,
  softness: 0.05,
};
const DETAIL_LIMITS: Record<HfColorGradingDetailKey, { min: number; max: number }> = {
  vignette: COLOR_GRADING_ADVANCED_LIMITS.unit,
  vignetteMidpoint: COLOR_GRADING_ADVANCED_LIMITS.unit,
  vignetteRoundness: COLOR_GRADING_ADVANCED_LIMITS.signedUnit,
  vignetteFeather: COLOR_GRADING_ADVANCED_LIMITS.unit,
  grain: COLOR_GRADING_ADVANCED_LIMITS.unit,
  grainSize: COLOR_GRADING_ADVANCED_LIMITS.unit,
  grainRoughness: COLOR_GRADING_ADVANCED_LIMITS.unit,
};

const UNIT_LIMIT = COLOR_GRADING_ADVANCED_LIMITS.unit;
const EFFECT_LIMIT_OVERRIDES: Partial<
  Record<HfColorGradingEffectKey, { min: number; max: number }>
> = COLOR_GRADING_ADVANCED_LIMITS.effects;

export const HF_COLOR_GRADING_ACTIVE_EFFECT_KEYS = [
  "blur",
  "pixelate",
  "chromaBleed",
  "tapeDamage",
  "filmArtifacts",
  "halftone",
  "twoInkPrint",
  "ascii",
  "dither",
  "bloom",
  "monoScreen",
  "scanlines",
  "chromaticAberration",
  "crtCurvature",
  "digitalGlitch",
  "engraving",
  "crosshatch",
  "kuwahara",
] as const satisfies readonly HfColorGradingEffectKey[];

export type HfColorGradingActiveEffectKey = (typeof HF_COLOR_GRADING_ACTIVE_EFFECT_KEYS)[number];

const EFFECT_FAMILIES = [
  {
    id: "essentials",
    label: "Essentials",
    description: "Common optical, focus, and privacy-oriented primitives.",
  },
  {
    id: "retro-glitch",
    label: "Retro & Glitch",
    description: "Tape, film, CRT, channel separation, and digital disruption.",
  },
  {
    id: "print",
    label: "Print",
    description: "Halftone, limited-ink, dither, and screen-print rendering.",
  },
  {
    id: "art",
    label: "Art",
    description: "ASCII, engraved, crosshatched, and painterly rendering.",
  },
] as const;

type EffectFamilyId = (typeof EFFECT_FAMILIES)[number]["id"];

const EFFECT_METADATA = {
  blur: {
    family: "essentials",
    label: "Blur",
    description: "Defocus or soften a full media layer.",
  },
  pixelate: {
    family: "essentials",
    label: "Pixelate",
    description: "Turn a media layer into a block mosaic.",
  },
  bloom: {
    family: "essentials",
    label: "Bloom",
    description: "Add thresholded glow around bright image regions.",
  },
  chromaBleed: {
    family: "retro-glitch",
    label: "Chroma Softening",
    description: "Smear color like low-bandwidth video.",
  },
  tapeDamage: {
    family: "retro-glitch",
    label: "Tape Damage",
    description: "Add moving tracking errors and tape noise.",
  },
  filmArtifacts: {
    family: "retro-glitch",
    label: "Film Artifacts",
    description: "Add deterministic dust and film wear.",
  },
  scanlines: {
    family: "retro-glitch",
    label: "Scanlines",
    description: "Overlay configurable horizontal display lines.",
  },
  crtCurvature: {
    family: "retro-glitch",
    label: "CRT Curvature",
    description: "Warp media toward curved CRT geometry.",
  },
  chromaticAberration: {
    family: "retro-glitch",
    label: "Channel Separation",
    description: "Offset color channels by angle.",
  },
  digitalGlitch: {
    family: "retro-glitch",
    label: "Digital Glitch",
    description: "Compose tears, blocks, and color splits.",
  },
  halftone: {
    family: "print",
    label: "Halftone",
    description: "Render source color through a print-dot raster.",
  },
  twoInkPrint: {
    family: "print",
    label: "Two-Ink Print",
    description: "Reduce media to a two-ink print treatment.",
  },
  dither: {
    family: "print",
    label: "Ordered Dither",
    description: "Quantize media into an ordered limited palette.",
  },
  monoScreen: {
    family: "print",
    label: "Mono Screen",
    description: "Build monochrome dot, shape, or line artwork.",
  },
  ascii: {
    family: "art",
    label: "ASCII",
    description: "Render media as configurable procedural glyph cells.",
  },
  engraving: {
    family: "art",
    label: "Engraving",
    description: "Translate luminance into directional engraved lines.",
  },
  crosshatch: {
    family: "art",
    label: "Crosshatch",
    description: "Translate media into layered hand-hatched lines.",
  },
  kuwahara: {
    family: "art",
    label: "Kuwahara Paint",
    description: "Apply edge-preserving painterly smoothing.",
  },
} as const satisfies Record<
  HfColorGradingActiveEffectKey,
  { family: EffectFamilyId; label: string; description: string }
>;

export const HF_COLOR_GRADING_EFFECT_PRESETS = HF_COLOR_GRADING_PRESETS.filter((preset) =>
  HF_COLOR_GRADING_ACTIVE_EFFECT_KEYS.some((key) => preset.effects[key] > 0.0001),
);

export const HF_COLOR_GRADING_GRADE_PRESETS = HF_COLOR_GRADING_PRESETS.filter(
  (preset) => !HF_COLOR_GRADING_EFFECT_PRESETS.includes(preset),
);

/** Useful one-click values. Sub-controls not listed here keep their normalized defaults. */
export const HF_COLOR_GRADING_EFFECT_APPLY_DEFAULTS: Readonly<
  Record<HfColorGradingActiveEffectKey, HfColorGradingEffects>
> = {
  blur: { blur: 0.45 },
  pixelate: { pixelate: 0.55 },
  bloom: { bloom: 0.55, bloomRadius: 8 },
  chromaBleed: { chromaBleed: 0.55 },
  tapeDamage: {
    tapeDamage: 0.65,
    tapeTracking: 0.55,
    tapeNoise: 0.25,
    tapeSpeed: 0.5,
  },
  filmArtifacts: { filmArtifacts: 0.55 },
  scanlines: { scanlines: 0.35, scanlineCount: 0.17, scanlineSoftness: 1 },
  chromaticAberration: { chromaticAberration: 0.15, chromaticAngle: 0 },
  crtCurvature: { crtCurvature: 0.2 },
  digitalGlitch: {
    digitalGlitch: 0.55,
    digitalGlitchColorSplit: 0.25,
    digitalGlitchLineTear: 0.25,
    digitalGlitchPixelate: 0.15,
    digitalGlitchBlockAmount: 0.5,
    digitalGlitchBlockDisplacement: 0.25,
    digitalGlitchBlockOpacity: 0,
    digitalGlitchSpeed: 0.5,
  },
  halftone: { halftone: 0.94, halftoneSize: 0.36 },
  twoInkPrint: { twoInkPrint: 1, twoInkPrintSize: 0.42 },
  ascii: {
    ascii: 1,
    asciiSize: 5 / 76,
    asciiInvert: 0,
    asciiStyle: 0,
    asciiColor: 1,
    asciiRotation: 0,
  },
  dither: { dither: 1, ditherSize: 0.5 },
  monoScreen: {
    monoScreen: 1,
    monoScreenSize: 0.35,
    monoScreenAngle: 0.25,
    monoScreenSpread: 0.3,
    monoScreenShape: 0,
    monoScreenInvert: 0,
  },
  engraving: {
    engraving: 1,
    engravingSpacing: 7 / 17,
    engravingMinThickness: 0.2,
    engravingMaxThickness: 3.2 / 7,
    engravingAngle: 0.25,
    engravingContrast: 7 / 15,
    engravingSharpness: 0.59,
    engravingWave: 0.2,
    engravingWaveFrequency: 2 / 9,
  },
  crosshatch: {
    crosshatch: 1,
    crosshatchSpacing: 7 / 25,
    crosshatchThickness: 0.25,
    crosshatchAngle: 0.25,
    crosshatchContrast: 1 / 3,
    crosshatchEdges: 0.5,
    crosshatchLineWeight: 0,
    crosshatchWave: 0.33,
    crosshatchWaveFrequency: 2 / 9,
  },
  kuwahara: {
    kuwahara: 1,
    kuwaharaRadius: 1 / 7,
    kuwaharaSharpness: 5 / 16,
    kuwaharaSaturation: 0.5,
  },
};

export const HF_COLOR_GRADING_ANIMATABLE_PROPERTIES = [
  { path: "intensity", name: "--hf-color-grading-intensity", min: 0, max: 1 },
  { path: "lut.intensity", name: "--hf-color-grading-lut-intensity", min: 0, max: 1 },
  { path: "adjust.exposure", name: "--hf-color-grading-exposure", min: -2, max: 2 },
  { path: "effects.blur", name: "--hf-color-grading-blur", min: 0, max: 1 },
  { path: "effects.bloom", name: "--hf-color-grading-bloom", min: 0, max: 3 },
  { path: "effects.kuwahara", name: "--hf-color-grading-kuwahara", min: 0, max: 1 },
  { path: "effects.pixelate", name: "--hf-color-grading-pixelate", min: 0, max: 1 },
  { path: "effects.ascii", name: "--hf-color-grading-ascii", min: 0, max: 1 },
  { path: "effects.dither", name: "--hf-color-grading-dither", min: 0, max: 1 },
] as const;

export type HfColorGradingAnimatablePath =
  (typeof HF_COLOR_GRADING_ANIMATABLE_PROPERTIES)[number]["path"];

function effectLimit(key: HfColorGradingEffectKey): { min: number; max: number } {
  return EFFECT_LIMIT_OVERRIDES[key] ?? UNIT_LIMIT;
}

const PALETTE_EFFECT_KEYS = new Set<HfColorGradingActiveEffectKey>([
  "ascii",
  "dither",
  "monoScreen",
  "engraving",
  "crosshatch",
]);

const MULTIPASS_EFFECT_KEYS = new Set<HfColorGradingActiveEffectKey>(["blur", "bloom", "kuwahara"]);

/** Agent-readable view of the canonical grading and effect contracts. */
export function getHfColorGradingCapabilities() {
  return {
    version: COLOR_GRADING_CONTRACT_VERSION,
    targetTags: ["img", "video"],
    colorSpace: HF_COLOR_GRADING_COLOR_SPACE,
    intensity: { identity: 1, min: 0, max: 1 },
    palette: { minColors: 2, maxColors: 6, colorFormat: "#rrggbb" },
    lut: {
      format: "3d-cube",
      maxCubeSize: DEFAULT_MAX_CUBE_LUT_SIZE,
      intensity: { ...UNIT_LIMIT },
    },
    presets: [...HF_COLOR_GRADING_GRADE_PRESETS, ...HF_COLOR_GRADING_EFFECT_PRESETS].map(
      (preset) => ({
        id: preset.id,
        label: preset.label,
        intensity: preset.intensity,
      }),
    ),
    adjustments: HF_COLOR_GRADING_ADJUST_KEYS.map((key) => ({
      key,
      identity: ADJUST_ZERO[key],
      ...ADJUST_LIMITS[key],
    })),
    wheels: {
      zones: HF_COLOR_GRADING_WHEEL_KEYS,
      controls: {
        hue: {
          identity: 0,
          unit: "degrees",
          wrap: true,
          min: COLOR_GRADING_ADVANCED_LIMITS.hueDegrees.min,
          maxExclusive: COLOR_GRADING_ADVANCED_LIMITS.hueDegrees.max,
        },
        amount: { identity: 0, ...WHEEL_LIMITS.amount },
        level: { identity: 0, ...WHEEL_LIMITS.level },
      },
    },
    curves: {
      channels: HF_COLOR_GRADING_CURVE_KEYS,
      input: { min: 0, max: 1 },
      output: { min: 0, max: 1 },
      minPoints: 2,
      maxPoints: COLOR_GRADING_MAX_CURVE_POINTS,
      implicitEndpoints: true,
      endpointsCountTowardMax: true,
    },
    hueCurves: {
      channels: HF_COLOR_GRADING_HUE_CURVE_KEYS.map((key) => ({
        key,
        input: { min: 0, maxExclusive: 360, unit: "degrees", wrap: true },
        output: HUE_CURVE_LIMITS[key],
      })),
      minPoints: 3,
      maxPoints: COLOR_GRADING_MAX_CURVE_POINTS,
    },
    secondaries: {
      max: COLOR_GRADING_MAX_SECONDARIES,
      hue: {
        center: {
          min: COLOR_GRADING_ADVANCED_LIMITS.hueDegrees.min,
          maxExclusive: COLOR_GRADING_ADVANCED_LIMITS.hueDegrees.max,
          unit: "degrees",
          wrap: true,
        },
        range: { ...COLOR_GRADING_ADVANCED_LIMITS.secondaryHueRange, unit: "degrees" },
        softness: { ...COLOR_GRADING_ADVANCED_LIMITS.secondaryHueSoftness, unit: "degrees" },
        rangePlusSoftnessMax: COLOR_GRADING_ADVANCED_LIMITS.secondaryHueCombinedMax,
      },
      saturation: {
        min: { ...UNIT_LIMIT },
        max: { ...UNIT_LIMIT },
        relation: "min < max",
        softness: { ...COLOR_GRADING_ADVANCED_LIMITS.secondarySoftRangeSoftness },
      },
      luma: {
        min: { ...UNIT_LIMIT },
        max: { ...UNIT_LIMIT },
        relation: "min < max",
        softness: { ...COLOR_GRADING_ADVANCED_LIMITS.secondarySoftRangeSoftness },
      },
      correction: {
        hueShift: { ...COLOR_GRADING_ADVANCED_LIMITS.secondaryHueShift, unit: "degrees" },
        saturation: { ...COLOR_GRADING_ADVANCED_LIMITS.signedUnit },
        luma: { ...COLOR_GRADING_ADVANCED_LIMITS.signedUnit },
        temperature: { ...COLOR_GRADING_ADVANCED_LIMITS.signedUnit },
        tint: { ...COLOR_GRADING_ADVANCED_LIMITS.signedUnit },
      },
    },
    effectFamilies: EFFECT_FAMILIES,
    finishing: HF_COLOR_GRADING_DETAIL_KEYS.map((key) => ({
      key,
      identity: DETAIL_DEFAULTS[key],
      ...DETAIL_LIMITS[key],
    })),
    effects: HF_COLOR_GRADING_ACTIVE_EFFECT_KEYS.map((key) => {
      const apply = HF_COLOR_GRADING_EFFECT_APPLY_DEFAULTS[key];
      return {
        key,
        ...EFFECT_METADATA[key],
        apply: { ...apply },
        supportsPalette: PALETTE_EFFECT_KEYS.has(key),
        renderLane: MULTIPASS_EFFECT_KEYS.has(key) ? "multipass" : "single-pass",
        controls: HF_COLOR_GRADING_EFFECT_KEYS.filter((control) =>
          Object.hasOwn(apply, control),
        ).map((control) => ({
          key: control,
          identity: EFFECT_DEFAULTS[control],
          recommended: apply[control] ?? EFFECT_DEFAULTS[control],
          ...effectLimit(control),
        })),
      };
    }),
    palettes: HF_COLOR_GRADING_PALETTES.map(({ id, label, group, colors }) => ({
      id,
      label,
      group,
      colors,
    })),
    animatable: HF_COLOR_GRADING_ANIMATABLE_PROPERTIES,
  };
}

export type HfColorGradingCapabilities = ReturnType<typeof getHfColorGradingCapabilities>;

const EFFECT_PALETTE_COLOR = /^#[0-9a-f]{6}$/i;

function normalizePalette(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 6) return null;
  if (!value.every((color) => typeof color === "string" && EFFECT_PALETTE_COLOR.test(color))) {
    return null;
  }
  return value.map((color) => color.toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(min, value));
}

function clampUnit(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function readLimitedValue(value: unknown, limit: { min: number; max: number }): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return clamp(parsed, limit.min, limit.max);
}

function wrapDegrees(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return ((parsed % 360) + 360) % 360;
}

function smoothstep(min: number, max: number, value: number): number {
  const normalized = clamp((value - min) / (max - min), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function softRangeMask(value: number, min: number, max: number, softness: number): number {
  if (value < min) {
    return softness <= 0 ? 0 : smoothstep(min - softness, min, value);
  }
  if (value > max) {
    return softness <= 0 ? 0 : 1 - smoothstep(max, max + softness, value);
  }
  return 1;
}

/**
 * Mirrors the runtime shader's HSL-secondary qualifier for Studio mattes and
 * other non-WebGL verification surfaces.
 */
export function calculateHfColorGradingSecondaryMask(
  hue: number,
  saturation: number,
  luma: number,
  key: NormalizedHfColorGradingSecondary["key"],
): number {
  const hueDistance = Math.abs(((((hue - key.hue.center + 540) % 360) + 360) % 360) - 180);
  const hueMask =
    key.hue.range < 179.999 && saturation < 0.001
      ? 0
      : hueDistance <= key.hue.range
        ? 1
        : key.hue.softness <= 0
          ? 0
          : 1 - smoothstep(key.hue.range, key.hue.range + key.hue.softness, hueDistance);
  return (
    hueMask *
    softRangeMask(saturation, key.saturation.min, key.saturation.max, key.saturation.softness) *
    softRangeMask(luma, key.luma.min, key.luma.max, key.luma.softness)
  );
}

function normalizeWheels(value: unknown): NormalizedHfColorGradingWheels {
  const wheels = isRecord(value) ? value : {};
  return HF_COLOR_GRADING_WHEEL_KEYS.reduce<NormalizedHfColorGradingWheels>(
    (result, key) => {
      const wheel = isRecord(wheels[key]) ? wheels[key] : {};
      result[key] = {
        hue: wrapDegrees(wheel.hue, TONAL_WHEEL_DEFAULT.hue),
        amount: readLimitedValue(wheel.amount ?? TONAL_WHEEL_DEFAULT.amount, WHEEL_LIMITS.amount),
        level: readLimitedValue(wheel.level ?? TONAL_WHEEL_DEFAULT.level, WHEEL_LIMITS.level),
      };
      return result;
    },
    {
      shadows: { ...TONAL_WHEEL_DEFAULT },
      midtones: { ...TONAL_WHEEL_DEFAULT },
      highlights: { ...TONAL_WHEEL_DEFAULT },
    },
  );
}

function normalizeCurvePoint(value: unknown): HfColorCurvePoint | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const input = Number(value[0]);
  const output = Number(value[1]);
  return Number.isFinite(input) && Number.isFinite(output)
    ? [clamp(input, 0, 1), clamp(output, 0, 1)]
    : null;
}

function hasDuplicateCurveInputs(points: readonly HfColorCurvePoint[]): boolean {
  return points.some((point, index) => index > 0 && point[0] === points[index - 1]?.[0]);
}

function completeCurveEndpoints(points: HfColorCurvePoint[]): void {
  if ((points[0]?.[0] ?? 0) > 0) points.unshift([0, 0]);
  if ((points.at(-1)?.[0] ?? 1) < 1) points.push([1, 1]);
}

function normalizeCurve(value: unknown): readonly HfColorCurvePoint[] {
  if (!Array.isArray(value) || value.length < 2) return RGB_CURVE_IDENTITY;
  const points: HfColorCurvePoint[] = [];
  for (const valuePoint of value) {
    const point = normalizeCurvePoint(valuePoint);
    if (!point) return RGB_CURVE_IDENTITY;
    points.push(point);
  }
  points.sort((a, b) => a[0] - b[0]);
  if (hasDuplicateCurveInputs(points)) return RGB_CURVE_IDENTITY;
  completeCurveEndpoints(points);
  if (points.length > COLOR_GRADING_MAX_CURVE_POINTS) return RGB_CURVE_IDENTITY;
  return points;
}

function normalizeCurves(value: unknown): NormalizedHfColorGradingCurves {
  const curves = isRecord(value) ? value : {};
  return HF_COLOR_GRADING_CURVE_KEYS.reduce<NormalizedHfColorGradingCurves>(
    (result, key) => {
      result[key] = normalizeCurve(curves[key]);
      return result;
    },
    {
      master: RGB_CURVE_IDENTITY,
      red: RGB_CURVE_IDENTITY,
      green: RGB_CURVE_IDENTITY,
      blue: RGB_CURVE_IDENTITY,
    },
  );
}

function normalizeHueCurvePoint(
  value: unknown,
  limit: { min: number; max: number },
): HfHueCurvePoint | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const hue = Number(value[0]);
  const delta = Number(value[1]);
  return Number.isFinite(hue) && Number.isFinite(delta)
    ? [wrapDegrees(hue), clamp(delta, limit.min, limit.max)]
    : null;
}

function normalizeHueCurve(
  value: unknown,
  limit: { min: number; max: number },
): readonly HfHueCurvePoint[] {
  if (!Array.isArray(value) || value.length < 3 || value.length > COLOR_GRADING_MAX_CURVE_POINTS) {
    return HUE_CURVE_IDENTITY;
  }
  const points: HfHueCurvePoint[] = [];
  for (const candidate of value) {
    const point = normalizeHueCurvePoint(candidate, limit);
    if (!point) return HUE_CURVE_IDENTITY;
    points.push(point);
  }
  points.sort((a, b) => a[0] - b[0]);
  return hasDuplicateCurveInputs(points) ? HUE_CURVE_IDENTITY : points;
}

function normalizeHueCurves(value: unknown): NormalizedHfColorGradingHueCurves {
  const curves = isRecord(value) ? value : {};
  return HF_COLOR_GRADING_HUE_CURVE_KEYS.reduce<NormalizedHfColorGradingHueCurves>(
    (result, key) => {
      result[key] = normalizeHueCurve(curves[key], HUE_CURVE_LIMITS[key]);
      return result;
    },
    {
      hueVsHue: HUE_CURVE_IDENTITY,
      hueVsSaturation: HUE_CURVE_IDENTITY,
      hueVsLuma: HUE_CURVE_IDENTITY,
    },
  );
}

function normalizeSoftRange(value: unknown): Required<HfColorGradingSoftRange> {
  const range = isRecord(value) ? value : {};
  const first = readLimitedValue(range.min ?? SECONDARY_SOFT_RANGE_DEFAULT.min, UNIT_LIMIT);
  const second = readLimitedValue(range.max ?? SECONDARY_SOFT_RANGE_DEFAULT.max, UNIT_LIMIT);
  return {
    min: Math.min(first, second),
    max: Math.max(first, second),
    softness: readLimitedValue(
      range.softness ?? SECONDARY_SOFT_RANGE_DEFAULT.softness,
      COLOR_GRADING_ADVANCED_LIMITS.secondarySoftRangeSoftness,
    ),
  };
}

function normalizeSecondaryHue(value: unknown): Required<HfColorGradingHueRange> {
  const hue = isRecord(value) ? value : {};
  const range = readLimitedValue(
    hue.range ?? SECONDARY_HUE_DEFAULT.range,
    COLOR_GRADING_ADVANCED_LIMITS.secondaryHueRange,
  );
  return {
    center: wrapDegrees(hue.center, SECONDARY_HUE_DEFAULT.center),
    range,
    softness: readLimitedValue(hue.softness ?? SECONDARY_HUE_DEFAULT.softness, {
      min: COLOR_GRADING_ADVANCED_LIMITS.secondaryHueSoftness.min,
      max: COLOR_GRADING_ADVANCED_LIMITS.secondaryHueCombinedMax - range,
    }),
  };
}

function normalizeSecondaryCorrection(
  value: Record<string, unknown>,
): Required<HfColorGradingSecondaryCorrection> {
  return {
    hueShift: readLimitedValue(
      value.hueShift ?? 0,
      COLOR_GRADING_ADVANCED_LIMITS.secondaryHueShift,
    ),
    saturation: readLimitedValue(value.saturation ?? 0, COLOR_GRADING_ADVANCED_LIMITS.signedUnit),
    luma: readLimitedValue(value.luma ?? 0, COLOR_GRADING_ADVANCED_LIMITS.signedUnit),
    temperature: readLimitedValue(value.temperature ?? 0, COLOR_GRADING_ADVANCED_LIMITS.signedUnit),
    tint: readLimitedValue(value.tint ?? 0, COLOR_GRADING_ADVANCED_LIMITS.signedUnit),
  };
}

function normalizeSecondary(value: unknown): NormalizedHfColorGradingSecondary | null {
  if (!isRecord(value) || !isRecord(value.key) || !isRecord(value.correction)) return null;
  return {
    enabled: value.enabled !== false,
    key: {
      hue: normalizeSecondaryHue(value.key.hue),
      saturation: normalizeSoftRange(value.key.saturation),
      luma: normalizeSoftRange(value.key.luma),
    },
    correction: normalizeSecondaryCorrection(value.correction),
  };
}

function normalizeSecondaries(value: unknown): readonly NormalizedHfColorGradingSecondary[] {
  if (!Array.isArray(value)) return [];
  const result: NormalizedHfColorGradingSecondary[] = [];
  for (const candidate of value.slice(0, COLOR_GRADING_MAX_SECONDARIES)) {
    const secondary = normalizeSecondary(candidate);
    if (secondary) result.push(secondary);
  }
  return result;
}

function normalizePresetId(value: unknown): HfColorGradingPresetId | string | null {
  if (value == null) return null;
  const preset = String(value).trim();
  return preset ? preset : null;
}

function normalizeLut(value: unknown): HfColorGradingLutRef | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const src = value.trim();
    return src ? { src, intensity: 1 } : null;
  }
  if (!isRecord(value)) return null;
  const rawSrc = value.src;
  if (typeof rawSrc !== "string" || rawSrc.trim() === "") return null;
  return {
    src: rawSrc.trim(),
    intensity: clampUnit(value.intensity, 1),
  };
}

function readColorGradingObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        return isRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return { preset: trimmed };
  }
  return isRecord(raw) ? raw : null;
}

function resolveStringVariableRef(value: string, variables: HfColorGradingVariableMap): unknown {
  const match = value.trim().match(VARIABLE_REF_RE);
  if (!match) return value;
  const key = match[1] ?? match[2] ?? "";
  return key && Object.hasOwn(variables, key) ? variables[key] : value;
}

export function resolveHfColorGradingVariables(
  raw: unknown,
  variables: HfColorGradingVariableMap,
): unknown {
  if (typeof raw === "string") {
    const direct = resolveStringVariableRef(raw, variables);
    if (direct !== raw) return direct;
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{")) return raw;
    try {
      return resolveHfColorGradingVariables(JSON.parse(trimmed) as unknown, variables);
    } catch {
      return raw;
    }
  }
  if (Array.isArray(raw)) {
    return raw.map((value) => resolveHfColorGradingVariables(value, variables));
  }
  if (!isRecord(raw)) return raw;

  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    resolved[key] = resolveHfColorGradingVariables(value, variables);
  }
  return resolved;
}

function getHfColorGradingPreset(id: string | null | undefined): HfColorGradingPreset | null {
  if (!id) return null;
  return PRESETS_BY_ID.get(id) ?? null;
}

export function normalizeHfColorGrading(raw: unknown): ResolvedHfColorGrading | null {
  const grading = readColorGradingObject(raw);
  if (!grading) return null;
  if (grading.enabled === false) return null;

  const presetId = normalizePresetId(grading.preset);
  const preset = getHfColorGradingPreset(presetId);
  const presetAdjust = preset?.adjust ?? ADJUST_ZERO;
  const presetDetails = preset?.details ?? DETAIL_DEFAULTS;
  const presetEffects = preset?.effects ?? EFFECT_DEFAULTS;
  const rawAdjust = isRecord(grading.adjust) ? grading.adjust : {};
  const rawDetails = isRecord(grading.details) ? grading.details : {};
  const rawEffects = isRecord(grading.effects) ? grading.effects : {};
  const adjust = HF_COLOR_GRADING_ADJUST_KEYS.reduce<Record<HfColorGradingAdjustKey, number>>(
    (result, key) => {
      result[key] = readLimitedValue(rawAdjust[key] ?? presetAdjust[key], ADJUST_LIMITS[key]);
      return result;
    },
    { ...ADJUST_ZERO },
  );
  const details = HF_COLOR_GRADING_DETAIL_KEYS.reduce<Record<HfColorGradingDetailKey, number>>(
    (result, key) => {
      result[key] = readLimitedValue(rawDetails[key] ?? presetDetails[key], DETAIL_LIMITS[key]);
      return result;
    },
    { ...DETAIL_DEFAULTS },
  );
  const effects = HF_COLOR_GRADING_EFFECT_KEYS.reduce<Record<HfColorGradingEffectKey, number>>(
    (result, key) => {
      result[key] = readLimitedValue(
        rawEffects[key] ?? presetEffects[key],
        EFFECT_LIMIT_OVERRIDES[key] ?? UNIT_LIMIT,
      );
      return result;
    },
    { ...EFFECT_DEFAULTS },
  );

  return {
    enabled: true,
    preset: presetId,
    intensity: clampUnit(grading.intensity, preset?.intensity ?? 1),
    adjust,
    wheels: normalizeWheels(grading.wheels),
    curves: normalizeCurves(grading.curves),
    hueCurves: normalizeHueCurves(grading.hueCurves),
    secondaries: normalizeSecondaries(grading.secondaries),
    details,
    effects,
    palette: normalizePalette(grading.palette),
    lut: normalizeLut(grading.lut),
    colorSpace:
      typeof grading.colorSpace === "string" && grading.colorSpace.trim()
        ? grading.colorSpace.trim()
        : HF_COLOR_GRADING_COLOR_SPACE,
  };
}

export function normalizeHfColorGradingWithVariables(
  raw: unknown,
  variables: HfColorGradingVariableMap,
): ResolvedHfColorGrading | null {
  return normalizeHfColorGrading(resolveHfColorGradingVariables(raw, variables));
}

function hasWheelGrade(wheels: NormalizedHfColorGradingWheels): boolean {
  return HF_COLOR_GRADING_WHEEL_KEYS.some(
    (key) => Math.abs(wheels[key].amount) > 0.0001 || Math.abs(wheels[key].level) > 0.0001,
  );
}

export function hasHfColorGradingRgbCurveValues(curves: NormalizedHfColorGradingCurves): boolean {
  return HF_COLOR_GRADING_CURVE_KEYS.some((key) =>
    curves[key].some(([input, output]) => Math.abs(input - output) > 0.0001),
  );
}

export function hasHfColorGradingHueCurveValues(
  curves: NormalizedHfColorGradingHueCurves,
): boolean {
  return HF_COLOR_GRADING_HUE_CURVE_KEYS.some((key) =>
    curves[key].some(([, delta]) => Math.abs(delta) > 0.0001),
  );
}

export function hasHfColorGradingSecondaryValues(
  secondaries: readonly NormalizedHfColorGradingSecondary[],
): boolean {
  return secondaries.some(
    (secondary) =>
      secondary.enabled &&
      Object.values(secondary.correction).some((value) => Math.abs(value) > 0.0001),
  );
}

export function serializeHfColorGrading(
  grading: NormalizedHfColorGrading | HfColorGrading | null,
): string {
  const normalized = normalizeHfColorGrading(grading);
  if (!normalized) return "";
  const {
    enabled: _enabled,
    wheels,
    curves,
    hueCurves,
    secondaries,
    palette,
    ...serializable
  } = normalized;
  return JSON.stringify({
    ...serializable,
    ...(hasWheelGrade(wheels) ? { wheels } : {}),
    ...(hasHfColorGradingRgbCurveValues(curves) ? { curves } : {}),
    ...(hasHfColorGradingHueCurveValues(hueCurves) ? { hueCurves } : {}),
    // Preserve a keyed secondary even before it changes pixels so Studio and
    // CLI can author its qualifier and correction in separate transactions.
    ...(secondaries.length > 0 ? { secondaries } : {}),
    ...(palette ? { palette } : {}),
  });
}

export function isHfColorGradingActive(
  grading: NormalizedHfColorGrading | null,
): grading is NormalizedHfColorGrading {
  if (!grading?.enabled) return false;
  const hasIndependentTreatment =
    Math.abs(grading.details.vignette) > 0.0001 ||
    Math.abs(grading.details.grain) > 0.0001 ||
    HF_COLOR_GRADING_ACTIVE_EFFECT_KEYS.some((key) => Math.abs(grading.effects[key]) > 0.0001);
  if (hasIndependentTreatment) return true;
  if (grading.intensity === 0) return false;
  if (grading.lut && grading.lut.intensity !== 0) return true;
  return (
    HF_COLOR_GRADING_ADJUST_KEYS.some((key) => Math.abs(grading.adjust[key]) > 0.0001) ||
    (grading.wheels ? hasWheelGrade(grading.wheels) : false) ||
    (grading.curves ? hasHfColorGradingRgbCurveValues(grading.curves) : false) ||
    (grading.hueCurves ? hasHfColorGradingHueCurveValues(grading.hueCurves) : false) ||
    (grading.secondaries ? hasHfColorGradingSecondaryValues(grading.secondaries) : false)
  );
}

export function hasHfColorGradingAuthoredValues(
  grading: NormalizedHfColorGrading | null,
): grading is NormalizedHfColorGrading {
  if (!grading) return false;
  if (grading.secondaries?.length) return true;
  return isHfColorGradingActive(grading);
}
