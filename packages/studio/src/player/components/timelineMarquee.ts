import { GUTTER, TRACK_H, RULER_H, CLIP_Y, getTimelineRowTop } from "./timelineLayout";
import { rectsOverlap, type Rect } from "../../utils/marqueeGeometry";

/** Pointer must travel at least this far (either axis) before a pointerdown on
 *  the empty timeline body becomes a marquee drag instead of a plain click. */
export const MARQUEE_DRAG_THRESHOLD_PX = 4;

/** Minimum rendered clip width, mirrors TimelineClip's `Math.max(w, 4)`. */
const MIN_CLIP_W = 4;

export interface MarqueeClipInput {
  id: string;
  start: number;
  duration: number;
  track: number;
}

/**
 * Ruler-vs-body decision for a pointerdown on the timeline scroll container.
 *
 * The ruler is `position: sticky; top: 0` — once the body is scrolled down its
 * VISUAL position stays pinned to the container top while its LAYOUT position
 * scrolls away. The hit test must therefore use VIEWPORT-space y (clientY
 * relative to the scroll container's bounding rect), NOT content-space y
 * (clientY - rect.top + scrollTop), which misclassifies a press on the stuck
 * ruler as a body/marquee press whenever scrollTop > 0.
 */
export function isTimelineRulerPress(
  clientY: number,
  scrollRectTop: number,
  rulerHeight: number = RULER_H,
): boolean {
  return clientY - scrollRectTop < rulerHeight;
}

export function isMarqueeDrag(
  originX: number,
  originY: number,
  currentX: number,
  currentY: number,
  threshold: number = MARQUEE_DRAG_THRESHOLD_PX,
): boolean {
  return Math.abs(currentX - originX) >= threshold || Math.abs(currentY - originY) >= threshold;
}

/** Normalized marquee rect (canvas/content coordinates) from the drag origin and
 *  the current pointer — handles drags in any direction (negative deltas). */
export function getMarqueeRect(
  originX: number,
  originY: number,
  currentX: number,
  currentY: number,
): Rect {
  return {
    left: Math.min(originX, currentX),
    top: Math.min(originY, currentY),
    width: Math.abs(currentX - originX),
    height: Math.abs(currentY - originY),
  };
}

/**
 * A clip's rendered rect in canvas/content coordinates (the same space the
 * marquee rect lives in): x from GUTTER + start * pps, y from the clip's row
 * index within the visible track order (RULER_H + row * TRACK_H + CLIP_Y).
 * Returns null when the clip's track is not currently displayed.
 */
export function getTimelineClipRect(
  clip: Pick<MarqueeClipInput, "start" | "duration" | "track">,
  trackOrder: number[],
  pps: number,
): Rect | null {
  const row = trackOrder.indexOf(clip.track);
  if (row < 0 || !Number.isFinite(pps) || pps <= 0) return null;
  return {
    left: GUTTER + clip.start * pps,
    top: getTimelineRowTop(row) + CLIP_Y,
    width: Math.max(clip.duration * pps, MIN_CLIP_W),
    height: TRACK_H - CLIP_Y * 2,
  };
}

export interface MarqueeSelectionResult {
  /** Every clip id the marquee currently covers (plus the additive base). */
  ids: Set<string>;
  /** The last marquee-hit clip in element order — the primary selection.
   *  Null when the marquee covers nothing new (caller keeps its current primary). */
  primaryId: string | null;
}

/**
 * Live marquee selection: every clip whose rendered rect intersects the marquee.
 * `baseSelection` (shift/cmd-additive) is unioned in but never affects primaryId.
 */
export function computeMarqueeSelection(input: {
  clips: MarqueeClipInput[];
  trackOrder: number[];
  pps: number;
  marquee: Rect;
  baseSelection?: Iterable<string>;
}): MarqueeSelectionResult {
  const ids = new Set<string>(input.baseSelection ?? []);
  let primaryId: string | null = null;
  for (const clip of input.clips) {
    const rect = getTimelineClipRect(clip, input.trackOrder, input.pps);
    if (rect && rectsOverlap(rect, input.marquee)) {
      ids.add(clip.id);
      primaryId = clip.id;
    }
  }
  return { ids, primaryId };
}
