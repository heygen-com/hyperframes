/**
 * The one owner of "what track number does the user see".
 *
 * `TimelineElement.track` is a z-order SORT key, not a row number: an expanded
 * sub-composition child gets a synthesized fractional key (`host.track + n /
 * (siblings + 2)`, see `useExpandedTimelineElements`), so putting it in a string
 * announces "Hide track 0.16666666666666666". Every user-visible track number,
 * whether it is rendered by a component or baked into an undo-history label,
 * routes through here; the raw key stays in callbacks and lookups only.
 */

/** Ascending distinct track keys, the row order the timeline renders in. */
export function timelineTrackOrder(elements: readonly { track: number }[]): number[] {
  return [...new Set(elements.map((element) => element.track))].sort((a, b) => a - b);
}

/**
 * A track key's 1-based display row, or null when the key is not in
 * `trackOrder` at all.
 *
 * Both callers build `trackOrder` from the same elements the key came from, so
 * null is unreachable by construction today. It is null rather than a number
 * because the only numbers available to return (the end row, the last row) are
 * indistinguishable from a real answer: a label would announce a row the user
 * can see is wrong, and nothing upstream would ever learn it had guessed.
 */
export function trackDisplayNumber(trackOrder: readonly number[], track: number): number | null {
  const row = trackOrder.indexOf(track);
  return row < 0 ? null : row + 1;
}

/**
 * The `" 3"` in `Hide track 3`, empty when there is no display row to name.
 * Announcing "Hide track" is thin; announcing an invented row is wrong.
 */
export function trackDisplaySuffix(displayNumber: number | null): string {
  return displayNumber === null ? "" : ` ${displayNumber}`;
}
