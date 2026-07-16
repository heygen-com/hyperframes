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

export const HF_COLOR_GRADING_COLOR_SPACE = "rec709";

export type HfColorGradingPresetId =
  | "neutral"
  | "natural-lift"
  | "fresh-pop"
  | "warm-daylight"
  | "clean-studio"
  | "skin-soft"
  | "food-pop"
  | "night-lift"
  | "muted-editorial"
  | "vintage-wash"
  | "mono-clean"
  | "mono-fade"
  | "warm-clean"
  | "cool-clean"
  | "soft-boost"
  | "bright-pop"
  | "deep-contrast";

export type HfColorGradingAdjustKey =
  | "exposure"
  | "contrast"
  | "highlights"
  | "shadows"
  | "whites"
  | "blacks"
  | "temperature"
  | "tint"
  | "vibrance"
  | "saturation";

export type HfColorGradingAdjust = Partial<Record<HfColorGradingAdjustKey, number>>;

export type HfColorGradingDetailKey =
  | "vignette"
  | "vignetteMidpoint"
  | "vignetteRoundness"
  | "vignetteFeather"
  | "grain"
  | "grainSize"
  | "grainRoughness";

export type HfColorGradingDetails = Partial<Record<HfColorGradingDetailKey, number>>;

export type HfColorGradingEffectKey = "blur" | "pixelate";

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
  details?: HfColorGradingDetails;
  effects?: HfColorGradingEffects;
  lut?: HfColorGradingLutRef | string | null;
  colorSpace?: typeof HF_COLOR_GRADING_COLOR_SPACE | string;
}

export interface NormalizedHfColorGrading {
  enabled: boolean;
  preset: HfColorGradingPresetId | string | null;
  intensity: number;
  adjust: Record<HfColorGradingAdjustKey, number>;
  details: Record<HfColorGradingDetailKey, number>;
  effects: Record<HfColorGradingEffectKey, number>;
  lut: HfColorGradingLutRef | null;
  colorSpace: typeof HF_COLOR_GRADING_COLOR_SPACE | string;
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
  adjust: Record<HfColorGradingAdjustKey, number>;
  details: Record<HfColorGradingDetailKey, number>;
  effects: Record<HfColorGradingEffectKey, number>;
}

export type HfColorGradingVariableMap = Record<string, unknown>;

const ADJUST_ZERO: Record<HfColorGradingAdjustKey, number> = {
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
};

// Detail sub-controls keep identity-state defaults so enabling vignette/grain starts from useful
// perceptual settings instead of raw mathematical zeroes.
const DETAIL_ZERO: Record<HfColorGradingDetailKey, number> = {
  vignette: 0,
  vignetteMidpoint: 0.5,
  vignetteRoundness: 0,
  vignetteFeather: 0.65,
  grain: 0,
  grainSize: 0.25,
  grainRoughness: 0.5,
};

const EFFECT_ZERO: Record<HfColorGradingEffectKey, number> = {
  blur: 0,
  pixelate: 0,
};

export const HF_COLOR_GRADING_ADJUST_KEYS = Object.keys(
  ADJUST_ZERO,
) as readonly HfColorGradingAdjustKey[];

export const HF_COLOR_GRADING_DETAIL_KEYS = Object.keys(
  DETAIL_ZERO,
) as readonly HfColorGradingDetailKey[];

export const HF_COLOR_GRADING_EFFECT_KEYS = Object.keys(
  EFFECT_ZERO,
) as readonly HfColorGradingEffectKey[];

function preset(
  id: HfColorGradingPresetId,
  label: string,
  adjust: HfColorGradingAdjust = {},
  details: HfColorGradingDetails = {},
): HfColorGradingPreset {
  return {
    id,
    label,
    adjust: { ...ADJUST_ZERO, ...adjust },
    details: { ...DETAIL_ZERO, ...details },
    effects: { ...EFFECT_ZERO },
  };
}

export const HF_COLOR_GRADING_PRESETS: readonly HfColorGradingPreset[] = [
  preset("neutral", "Neutral"),
  preset("natural-lift", "Natural Lift", {
    exposure: 0.04,
    contrast: 0.06,
    highlights: -0.06,
    shadows: 0.08,
    saturation: 0.05,
  }),
  preset("fresh-pop", "Fresh Pop", {
    exposure: 0.08,
    contrast: 0.12,
    whites: 0.06,
    shadows: 0.04,
    temperature: -0.02,
    vibrance: 0.08,
    saturation: 0.16,
  }),
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
  preset(
    "vintage-wash",
    "Vintage Wash",
    {
      exposure: 0.03,
      contrast: -0.12,
      highlights: -0.1,
      shadows: 0.16,
      whites: -0.04,
      blacks: 0.08,
      temperature: 0.13,
      vibrance: -0.08,
      saturation: -0.08,
    },
    {
      vignette: 0.18,
    },
  ),
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
  preset("warm-clean", "Warm Clean", {
    exposure: 0.05,
    contrast: 0.08,
    highlights: -0.08,
    shadows: 0.08,
    temperature: 0.16,
    vibrance: 0.04,
    saturation: 0.06,
  }),
  preset("cool-clean", "Cool Clean", {
    contrast: 0.06,
    highlights: -0.06,
    shadows: 0.06,
    temperature: -0.12,
    tint: 0.04,
    saturation: 0.04,
  }),
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

const DETAIL_LIMITS: Record<HfColorGradingDetailKey, { min: number; max: number }> = {
  vignette: { min: 0, max: 1 },
  vignetteMidpoint: { min: 0, max: 1 },
  vignetteRoundness: { min: -1, max: 1 },
  vignetteFeather: { min: 0, max: 1 },
  grain: { min: 0, max: 1 },
  grainSize: { min: 0, max: 1 },
  grainRoughness: { min: 0, max: 1 },
};

const EFFECT_LIMITS: Record<HfColorGradingEffectKey, { min: number; max: number }> = {
  blur: { min: 0, max: 1 },
  pixelate: { min: 0, max: 1 },
};

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
    return { preset: trimmed, intensity: 1 };
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

export function normalizeHfColorGrading(raw: unknown): NormalizedHfColorGrading | null {
  const grading = readColorGradingObject(raw);
  if (!grading) return null;
  if (grading.enabled === false) return null;

  const presetId = normalizePresetId(grading.preset);
  const preset = getHfColorGradingPreset(presetId);
  const presetAdjust = preset?.adjust ?? ADJUST_ZERO;
  const presetDetails = preset?.details ?? DETAIL_ZERO;
  const presetEffects = preset?.effects ?? EFFECT_ZERO;
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
    { ...DETAIL_ZERO },
  );
  const effects = HF_COLOR_GRADING_EFFECT_KEYS.reduce<Record<HfColorGradingEffectKey, number>>(
    (result, key) => {
      result[key] = readLimitedValue(rawEffects[key] ?? presetEffects[key], EFFECT_LIMITS[key]);
      return result;
    },
    { ...EFFECT_ZERO },
  );

  return {
    enabled: true,
    preset: presetId,
    intensity: clampUnit(grading.intensity, 1),
    adjust,
    details,
    effects,
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
): NormalizedHfColorGrading | null {
  return normalizeHfColorGrading(resolveHfColorGradingVariables(raw, variables));
}

export function serializeHfColorGrading(
  grading: NormalizedHfColorGrading | HfColorGrading | null,
): string {
  const normalized = normalizeHfColorGrading(grading);
  if (!normalized) return "";
  const { enabled: _enabled, ...serializable } = normalized;
  return JSON.stringify(serializable);
}

export function isHfColorGradingActive(
  grading: NormalizedHfColorGrading | null,
): grading is NormalizedHfColorGrading {
  if (!grading?.enabled) return false;
  if (grading.intensity === 0) return false;
  if (grading.lut && grading.lut.intensity !== 0) return true;
  return (
    HF_COLOR_GRADING_ADJUST_KEYS.some((key) => Math.abs(grading.adjust[key]) > 0.0001) ||
    Math.abs(grading.details.vignette) > 0.0001 ||
    Math.abs(grading.details.grain) > 0.0001 ||
    HF_COLOR_GRADING_EFFECT_KEYS.some((key) => Math.abs(grading.effects[key]) > 0.0001)
  );
}
