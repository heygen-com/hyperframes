import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { TimelineElement } from "../store/playerStore";
import type { ResizingClipState } from "./timelineClipDragTypes";
import { animationContributesLane } from "./TimelinePropertyLanes";

export function hasKeyframedTimelineClips(
  animationsByElement: ReadonlyMap<string, readonly GsapAnimation[]>,
): boolean {
  return Array.from(animationsByElement.values()).some((animations) =>
    animations.some(animationContributesLane),
  );
}

export function getEffectiveTimelineDuration(
  duration: number,
  elements: readonly TimelineElement[],
): number {
  const safeDuration = Number.isFinite(duration) ? duration : 0;
  if (elements.length === 0) return safeDuration;
  const result = Math.max(
    safeDuration,
    ...elements.map((element) => element.start + element.duration),
  );
  return Number.isFinite(result) ? result : safeDuration;
}

export function getTimelinePreviewElement(
  element: TimelineElement,
  resizingClip: ResizingClipState | null,
): TimelineElement {
  const elementKey = element.key ?? element.id;
  const groupPreview = resizingClip?.groupPreview?.find((change) => change.key === elementKey);
  if (groupPreview) return { ...element, ...groupPreview };
  if (resizingClip && (resizingClip.element.key ?? resizingClip.element.id) === elementKey) {
    return {
      ...element,
      start: resizingClip.previewStart,
      duration: resizingClip.previewDuration,
      playbackStart: resizingClip.previewPlaybackStart,
    };
  }
  return element;
}
