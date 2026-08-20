/**
 * Selection-set arithmetic for the player store.
 *
 * Its own module so `playerStore.ts` stays under the studio's 600-line cap.
 */

/**
 * The id set a selection change leaves behind.
 *
 * `preserveSet` means "keep the multi-selection if this id is already in it" —
 * a DOM→store echo re-announcing a member must not collapse the set — and
 * anything else is a genuine single selection.
 */
export function nextSelectionSet(
  current: ReadonlySet<string>,
  id: string | null,
  preserveSet: boolean | undefined,
): Set<string> {
  if (preserveSet) return id && current.has(id) ? new Set(current) : new Set<string>();
  return id ? new Set([id]) : new Set<string>();
}
