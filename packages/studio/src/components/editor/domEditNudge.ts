/**
 * Pure helpers for the canvas arrow-key nudge (DomEditOverlay).
 *
 * Mirrors captions/keyboard.ts conventions; the two nudge surfaces can't
 * double-fire because PreviewOverlays mounts CaptionOverlay and DomEditOverlay
 * mutually exclusively (caption edit mode returns before the DOM overlay).
 */

const CANVAS_NUDGE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export const CANVAS_NUDGE_STEP_PX = 1;
export const CANVAS_NUDGE_SHIFT_STEP_PX = 10;
/** One undo entry per key burst: the commit fires after this idle gap. */
export const CANVAS_NUDGE_COMMIT_DEBOUNCE_MS = 400;

type CanvasNudgeKeyEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "key"
>;

/**
 * Arrow key → composition-px delta (Shift = 10). Null when the key is not a
 * plain/Shift arrow, so browser and app shortcut chords pass through.
 */
export function resolveCanvasNudgeDelta(
  event: CanvasNudgeKeyEvent,
): { dx: number; dy: number } | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (!CANVAS_NUDGE_KEYS.has(event.key)) return null;
  const step = event.shiftKey ? CANVAS_NUDGE_SHIFT_STEP_PX : CANVAS_NUDGE_STEP_PX;
  return {
    dx: event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
    dy: event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0,
  };
}

export interface CanvasNudgeTarget {
  capabilities: { canApplyManualOffset: boolean };
}

/** A nudge needs at least one target and every target must accept manual offsets. */
export function canCanvasNudgeTargets(targets: ReadonlyArray<CanvasNudgeTarget>): boolean {
  return targets.length > 0 && targets.every((t) => t.capabilities.canApplyManualOffset);
}
