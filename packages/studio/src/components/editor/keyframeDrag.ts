/**
 * Pure math for the timeline keyframe-diamond drag-to-retime gesture. Kept free
 * of React/store so the gesture handler stays a thin orchestrator and the
 * click-vs-drag + clip%→tween% conversion is unit-testable in isolation.
 *
 * The diamond is positioned by clip-relative % but the retime mutation keys on
 * tween-relative %. We compute the drop position as clip% from the pointer pixel
 * delta (same basis the diamond is drawn with), then convert clip%→tween% via the
 * keyframes' own linear (percentage ↔ tweenPercentage) map.
 */
import { clipToTweenPercentage } from "./KeyframeNavigation";

/** Screen-px the pointer must travel before a press counts as a drag (else click). */
export const KEYFRAME_DRAG_THRESHOLD_PX = 4;
/** Tween-% movement below this is treated as no change (drop == original). */
const NOOP_EPSILON_PCT = 0.1;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export interface KeyframeDragResult {
  /** `click`: under the drag threshold → seek. `noop`: moved but resolved onto
   *  the original keyframe → skip the commit. `move`: commit the retime. */
  kind: "click" | "noop" | "move";
  /** Tween-relative drop position (only on `move`). */
  toTweenPct?: number;
}

/**
 * Decide whether a diamond press was a click or a drag, and for a drag compute
 * the tween-relative drop percentage.
 *
 * - `draggedClipPct` / `draggedTweenPct`: the dragged diamond's own clip- and
 *   tween-relative percentages (its identity — never a sibling's).
 * - `keyframes`: the clip's keyframes, used only to recover the clip→tween map.
 */
export function resolveKeyframeDrag(opts: {
  pointerDownX: number;
  pointerUpX: number;
  clipWidthPx: number;
  draggedClipPct: number;
  draggedTweenPct: number;
  keyframes: ReadonlyArray<{ percentage: number; tweenPercentage?: number }>;
}): KeyframeDragResult {
  const dx = opts.pointerUpX - opts.pointerDownX;
  if (Math.abs(dx) < KEYFRAME_DRAG_THRESHOLD_PX || opts.clipWidthPx <= 0) {
    return { kind: "click" };
  }
  const dropClipPct = clamp(opts.draggedClipPct + (dx / opts.clipWidthPx) * 100, 0, 100);
  const toTweenPct = clamp(clipToTweenPercentage(opts.keyframes, dropClipPct), 0, 100);
  if (Math.abs(toTweenPct - opts.draggedTweenPct) < NOOP_EPSILON_PCT) return { kind: "noop" };
  return { kind: "move", toTweenPct };
}

/**
 * Live drag preview: the dragged diamond's clip-% as it follows the pointer,
 * clamped to the clip. Visual only — no runtime/GSAP hold (the #1763 flake).
 */
export function previewClipPct(opts: {
  pointerDownX: number;
  pointerMoveX: number;
  clipWidthPx: number;
  draggedClipPct: number;
}): number {
  if (opts.clipWidthPx <= 0) return opts.draggedClipPct;
  const dx = opts.pointerMoveX - opts.pointerDownX;
  return clamp(opts.draggedClipPct + (dx / opts.clipWidthPx) * 100, 0, 100);
}
