import type { ArcPathSegment } from "@hyperframes/core/gsap-parser";

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
  /** Unroll a computed (helper/loop) tween into literal tweens so it edits directly. */
  onUnroll?: (animationId: string) => void;
}
