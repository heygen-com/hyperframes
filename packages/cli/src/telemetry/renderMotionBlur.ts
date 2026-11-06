import { MOTION_BLUR_FINGERPRINT_FIELDS, type MotionBlurFingerprint } from "@hyperframes/core";
import type { PageMotionBlurSummary } from "@hyperframes/engine";

export interface RenderMotionBlurTelemetryPayload {
  motionBlurTier?: string;
  motionBlurMovers?: number;
  motionBlurFailedFrames?: number;
  motionBlurFingerprint?: MotionBlurFingerprint;
}

export function renderMotionBlurTelemetryPayload(
  motionBlur: PageMotionBlurSummary | undefined,
): RenderMotionBlurTelemetryPayload {
  if (!motionBlur) return {};
  return {
    motionBlurTier: motionBlur.tier ?? undefined,
    motionBlurMovers: motionBlur.movers,
    motionBlurFailedFrames: motionBlur.failedFrames,
    motionBlurFingerprint: motionBlur.fingerprint ?? undefined,
  };
}

const snake = (field: string): string => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export function renderMotionBlurEventProperties(
  props: RenderMotionBlurTelemetryPayload,
): Record<string, string | number | undefined> {
  const counts = MOTION_BLUR_FINGERPRINT_FIELDS.flatMap((field) => {
    const count = props.motionBlurFingerprint?.[field];
    return count ? [[`motion_blur_fp_${snake(field)}`, count] as const] : [];
  });
  return {
    motion_blur_tier: props.motionBlurTier,
    motion_blur_movers: props.motionBlurMovers,
    motion_blur_failed_frames: props.motionBlurFailedFrames,
    ...Object.fromEntries(counts),
  };
}
