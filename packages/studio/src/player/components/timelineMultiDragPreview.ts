/**
 * Pure geometry for the LIVE multi-selection drag preview.
 *
 * When the dragged clip is part of a multi-selection, the commit shifts every
 * selected clip by the dragged clip's time delta (see timelineClipDragCommit).
 * To make the DRAG itself accurate — not just the drop — the other selected
 * clips ("passengers") must preview that same shift while the pointer moves.
 *
 * The dragged clip is rendered as a free-floating ghost that follows the cursor;
 * the passengers stay on their lanes but slide by `delta * pps` via a cheap
 * compositor `translateX` (no re-layout). Track changes apply to the dragged
 * clip only, mirroring the commit — passengers keep their lanes, so only x moves.
 */

export interface MultiDragPreviewInput {
  /** The drag is live (past the movement threshold). */
  dragStarted: boolean;
  /** Key of the clip under the pointer. */
  draggedKey: string;
  /** The dragged clip's committed start (pre-drag). */
  draggedOriginStart: number;
  /** The dragged clip's live preview start (follows the pointer + snapping). */
  draggedPreviewStart: number;
  /** The current multi-selection (store.selectedElementIds). */
  selectedKeys: ReadonlySet<string>;
}

/**
 * Whether a live multi-selection drag is in effect: the drag started, and the
 * dragged clip is itself part of a 2+ multi-selection. Below this, single-drag
 * behavior is unchanged and there are no passengers.
 */
export function isMultiDragActive(input: MultiDragPreviewInput): boolean {
  return (
    input.dragStarted && input.selectedKeys.size > 1 && input.selectedKeys.has(input.draggedKey)
  );
}

/**
 * The time delta every passenger shifts by — the dragged clip's preview start
 * minus its origin start. Zero when the clip hasn't moved (or no multi-drag).
 */
export function multiDragDeltaSeconds(input: MultiDragPreviewInput): number {
  if (!isMultiDragActive(input)) return 0;
  return input.draggedPreviewStart - input.draggedOriginStart;
}

/**
 * Whether a specific rendered clip is a passenger — a selected clip that is NOT
 * the dragged clip and NOT the same clip key. Passengers get the translateX
 * treatment; the dragged clip is drawn as the free-floating ghost instead.
 */
export function isMultiDragPassenger(clipKey: string, input: MultiDragPreviewInput): boolean {
  return (
    isMultiDragActive(input) && clipKey !== input.draggedKey && input.selectedKeys.has(clipKey)
  );
}

/**
 * The passenger's rendered x offset in PIXELS (delta seconds × pixels/second),
 * to apply as `transform: translateX(...px)`. Returns 0 for non-passengers so
 * callers can compute unconditionally and only branch on the elevated styling.
 */
export function multiDragPassengerOffsetPx(
  clipKey: string,
  pixelsPerSecond: number,
  input: MultiDragPreviewInput,
): number {
  if (!isMultiDragPassenger(clipKey, input)) return 0;
  const pps = Number.isFinite(pixelsPerSecond) ? pixelsPerSecond : 0;
  return multiDragDeltaSeconds(input) * pps;
}

/**
 * Clamp a group move so the WHOLE selection moves as ONE rigid formation.
 *
 * The grabbed clip proposes a raw delta (its desired preview start minus its
 * origin start, after its own snapping). Applied naively, a passenger could be
 * pushed below 0 (or past any other member bound), and the commit's per-clip
 * `Math.max(0, …)` would then deform the formation — the grabbed clip out-runs
 * the group while a passenger sticks at the wall. This ports main's model
 * (useTimelineClipGroupDrag / clampTimelineGroupMoveDelta): the applied delta is
 * bounded by the MOST-CONSTRAINED member, so the grabbed clip STOPS the instant
 * any member hits 0 and the formation never deforms.
 *
 * `memberStarts` are the pre-drag starts of every selected clip (the grabbed clip
 * included). Only the lower bound (start ≥ 0) constrains a move; the timeline has
 * no fixed right wall (the composition grows on commit).
 */
export function clampGroupMoveDelta(rawDelta: number, memberStarts: readonly number[]): number {
  if (memberStarts.length === 0) return rawDelta;
  // Leftmost member sets the floor: delta ≥ -min(start) keeps every start ≥ 0.
  const minStart = Math.min(...memberStarts);
  const minDelta = minStart === 0 ? 0 : -minStart; // avoid -0
  return rawDelta < minDelta ? minDelta : rawDelta;
}
