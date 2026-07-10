/**
 * Pure geometry for a multi-selection drag.
 *
 * Visual model (matches main): while a selected clip is dragged, the GRABBED
 * clip follows the cursor freely as a ghost — its ghost may even exceed the
 * formation clamp — while the OTHER selected members ("passengers") stay
 * VISUALLY STILL on their lanes. They only carry the selected-highlight, so the
 * group still reads as selected; there is no live passenger preview. On DROP the
 * commit shifts every selected clip by the same group-clamped delta (see
 * timelineClipDragCommit / useTimelineClipDrag) so the formation moves rigidly
 * and never deforms.
 *
 * The only geometry left in this module is the drop-time clamp below; the
 * per-passenger live-ghost helpers were removed with the passenger preview.
 */

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
