import type { ArcPathSegment } from "@hyperframes/parsers/gsap-parser";

/**
 * Edit callbacks shared by GsapAnimationSection and each AnimationCard it
 * renders. Extracted so the two prop interfaces don't duplicate the (large)
 * signatures the section forwards straight through to the card.
 */
export interface GsapAnimationEditCallbacks {
  onUpdateProperty: (animationId: string, property: string, value: number | string) => void;
  onUpdateMeta: (
    animationId: string,
    updates: { duration?: number; ease?: string; position?: number },
  ) => void;
  onDeleteAnimation: (animationId: string) => void;
  onAddProperty: (animationId: string, property: string) => void;
  onRemoveProperty: (animationId: string, property: string) => void;
  onUpdateFromProperty?: (animationId: string, property: string, value: number | string) => void;
  onAddFromProperty?: (animationId: string, property: string) => void;
  onRemoveFromProperty?: (animationId: string, property: string) => void;
  onLivePreview?: (property: string, value: number | string) => void;
  onLivePreviewEnd?: () => void;
  onSetArcPath?: (
    animationId: string,
    config: { enabled: boolean; autoRotate?: boolean | number; segments?: ArcPathSegment[] },
  ) => void;
  onUpdateArcSegment?: (
    animationId: string,
    segmentIndex: number,
    update: Partial<ArcPathSegment>,
  ) => void;
  onUpdateKeyframeEase?: (animationId: string, percentage: number, ease: string) => void;
  /** Apply one ease to every keyframe segment at once (clears per-segment overrides). */
  onSetAllKeyframeEases?: (animationId: string, ease: string) => void;
  /** Unroll a computed (helper/loop) tween into literal tweens so it edits directly. */
  onUnroll?: (animationId: string) => void;
}

// User-facing control label for each animation-meta field. The ease control is
// labelled "Speed" in the card UI, so ease/easeEach map there.
const ANIMATION_META_LABELS: Record<string, { control: string; name: string }> = {
  duration: { control: "metric", name: "Length" },
  position: { control: "metric", name: "Starts at" },
  ease: { control: "select", name: "Speed" },
  easeEach: { control: "select", name: "Speed" },
};

/**
 * Emit design-input telemetry for an `onUpdateMeta` payload, attributing each
 * changed field to the control the user actually touched. Iterates the real keys
 * present rather than falling through to a single placeholder — so a meta field
 * added later is attributed honestly by its own key instead of poisoning another
 * control's usage count.
 */
export function trackAnimationMetaUpdate(
  track: (control: string, name: string) => void,
  updates: Record<string, unknown>,
): void {
  for (const key of Object.keys(updates)) {
    const mapped = ANIMATION_META_LABELS[key];
    if (mapped) track(mapped.control, mapped.name);
    else track("select", key);
  }
}
