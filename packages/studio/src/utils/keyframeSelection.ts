/**
 * Resolves which keyframe percentages a bulk operation should act on.
 *
 * `selectedKeyframes` holds `"<elementId>:<percentage>"` keys and can contain
 * keyframes from more than one element — e.g. a shift-selection made before the
 * active element changed (via a keyframe click, a clip click, the layers panel,
 * or the keyframe context menu). A bulk delete only targets the active
 * element's animation, so keys belonging to other elements must be dropped;
 * otherwise their percentages get applied to the active element and remove
 * keyframes the user never selected on it.
 *
 * The element id is everything before the final `:` so element ids that happen
 * to contain `:` are handled correctly.
 */
export function selectedKeyframePercentagesForElement(
  selectedKeyframes: ReadonlySet<string>,
  activeElementId: string | null,
): number[] {
  if (!activeElementId) return [];
  const percentages: number[] = [];
  for (const key of selectedKeyframes) {
    const separator = key.lastIndexOf(":");
    if (separator < 0) continue;
    if (key.slice(0, separator) !== activeElementId) continue;
    const percentage = Number(key.slice(separator + 1));
    if (Number.isFinite(percentage)) percentages.push(percentage);
  }
  return percentages;
}
