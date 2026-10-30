/** The attributes that configure motion blur on a composition root: names, ranges, defaults, parsing. */

export const MOTION_BLUR_ATTR = {
  enable: "data-motion-blur",
  shutter: "data-motion-blur-shutter",
  samples: "data-motion-blur-samples",
  events: "data-motion-blur-events",
  tier: "data-motion-blur-tier",
} as const;

export const MOTION_BLUR_LIMITS = {
  shutterDeg: { min: 0, max: 720, default: 240 },
  samples: { min: 2, max: 64 },
} as const;

export type MotionBlurTier = "auto" | "capture" | "filter";

export interface MotionBlurSettings {
  enabled: boolean;
  shutterDeg: number;
  /** A fixed count per frame; null sizes it to each smear, never under 32. */
  samples: number | null;
  events: boolean;
  tier: MotionBlurTier;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

function number(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readMotionBlurSettings(attr: (name: string) => string | null): MotionBlurSettings {
  const shutter = number(attr(MOTION_BLUR_ATTR.shutter));
  const samples = number(attr(MOTION_BLUR_ATTR.samples));
  const tier = attr(MOTION_BLUR_ATTR.tier);
  const { shutterDeg, samples: bounds } = MOTION_BLUR_LIMITS;
  return {
    enabled: attr(MOTION_BLUR_ATTR.enable) === "on",
    shutterDeg: clamp(shutter ?? shutterDeg.default, shutterDeg.min, shutterDeg.max),
    samples: samples === null ? null : Math.round(clamp(samples, bounds.min, bounds.max)),
    events: attr(MOTION_BLUR_ATTR.events) === "on",
    tier: tier === "capture" || tier === "filter" ? tier : "auto",
  };
}

/**
 * The attribute writes that make `settings` true on a root: a value to set, or null to remove.
 * A setting at its default is removed, so a root carries only what the author changed.
 */
export function motionBlurAttributeEdits(
  settings: MotionBlurSettings,
): Record<string, string | null> {
  const { shutterDeg } = MOTION_BLUR_LIMITS;
  return {
    [MOTION_BLUR_ATTR.enable]: settings.enabled ? "on" : null,
    [MOTION_BLUR_ATTR.shutter]:
      settings.shutterDeg === shutterDeg.default ? null : String(settings.shutterDeg),
    [MOTION_BLUR_ATTR.samples]: settings.samples === null ? null : String(settings.samples),
    [MOTION_BLUR_ATTR.events]: settings.events ? "on" : null,
    [MOTION_BLUR_ATTR.tier]: settings.tier === "auto" ? null : settings.tier,
  };
}
