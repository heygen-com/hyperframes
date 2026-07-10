/**
 * timelineStackingSync — lane ↔ stacking unification (pure).
 *
 * The approved design: **lane order implies stacking**. A clip on a higher lane
 * (rendered ABOVE another in the timeline) should render ON TOP of any clip it
 * OVERLAPS IN TIME. But authored z-indexes are sacred: z only changes on a user
 * edit, and ONLY for the clip(s) the user actually edited.
 *
 * Lane → screen mapping (see Timeline.tsx trackOrder / TimelineCanvas rows):
 * tracks are sorted ASCENDING and rendered top → bottom, so a LOWER `track`
 * value renders HIGHER on screen. Standard NLE convention = the top row wins,
 * therefore **lower track ⇒ higher z-index**. We express this with a single
 * comparator so callers never have to remember the polarity.
 *
 * This module is DOM-free and store-free. Callers project their world onto
 * `StackingElement` (supplying the live z-index they read from the DOM/inline
 * style) and apply the returned `StackingPatch[]` however they persist styles.
 */

/** Minimal element view this module reasons over. */
export interface StackingElement {
  /** Stable identity (TimelineElement.key ?? id). */
  key: string;
  /** Absolute start time (seconds). */
  start: number;
  /** Duration (seconds). */
  duration: number;
  /**
   * Display lane (the normalized timeline `track`). Lower = higher on screen =
   * should stack on top. This is the post-edit lane for edited clips.
   */
  track: number;
  /** Current z-index (parsed from inline style / computed; "auto" ⇒ 0). */
  zIndex: number;
  /** Audio clips have no visual stacking and are excluded from the computation. */
  isAudio: boolean;
}

/** A minimal z-index change for one clip. */
export interface StackingPatch {
  key: string;
  zIndex: number;
}

const EPS = 1e-6;

/** Two clips overlap in time when their half-open [start, end) intervals intersect. */
function overlapsInTime(a: StackingElement, b: StackingElement): boolean {
  return a.start < b.start + b.duration - EPS && b.start < a.start + a.duration - EPS;
}

/**
 * Is `a` visually ABOVE `b` (should stack on top)? Lower track renders higher on
 * screen, so a lower track number means "above". Exposed for tests / callers.
 */
export function laneIsAbove(
  a: Pick<StackingElement, "track">,
  b: Pick<StackingElement, "track">,
): boolean {
  return a.track < b.track;
}

/**
 * Resolve the minimal z-index for `edited` so that, among the clips it OVERLAPS
 * IN TIME, its z is:
 *   - strictly ABOVE every overlapping clip on a HIGHER-on-screen-but... no —
 *     above every overlapping clip that is on a LOWER lane (renders below it),
 *   - strictly BELOW every overlapping clip on a HIGHER lane (renders above it).
 *
 * Returns null when there is no overlap (⇒ no z patch) OR when the edited clip's
 * current z already satisfies the ordering (⇒ no-op, don't churn the DOM).
 *
 * "Minimal" = pick a value that fits between the neighbours without disturbing
 * anyone else: the between-neighbours midpoint floored to an int when there is
 * room, else maxBelow + 1 (grow upward — the common "I dragged it to the top
 * lane" case), clamped ≥ 0.
 */
function resolveEditedZ(edited: StackingElement, others: StackingElement[]): number | null {
  const overlapping = others.filter((o) => !o.isAudio && overlapsInTime(edited, o));
  if (overlapping.length === 0) return null;

  // Clips that should end up BELOW edited (they render on a LOWER lane).
  const below = overlapping.filter((o) => laneIsAbove(edited, o));
  // Clips that should end up ABOVE edited (they render on a HIGHER lane).
  const above = overlapping.filter((o) => laneIsAbove(o, edited));

  const maxBelow = below.length > 0 ? Math.max(...below.map((o) => o.zIndex)) : null;
  const minAbove = above.length > 0 ? Math.min(...above.map((o) => o.zIndex)) : null;

  // Already correctly ordered relative to every overlapping neighbour → no-op.
  const satisfiesBelow = maxBelow == null || edited.zIndex > maxBelow;
  const satisfiesAbove = minAbove == null || edited.zIndex < minAbove;
  if (satisfiesBelow && satisfiesAbove) return null;

  let next: number;
  if (maxBelow != null && minAbove != null) {
    if (minAbove - maxBelow > 1) {
      // Room to sit strictly between the neighbours.
      next = Math.floor((maxBelow + minAbove) / 2);
      if (next <= maxBelow) next = maxBelow + 1;
    } else {
      // Neighbours are adjacent (or inverted); we cannot fit an integer strictly
      // between without touching them, so land just above the lower neighbour.
      // (Authored z of untouched clips is sacred — we never renumber them.)
      next = maxBelow + 1;
    }
  } else if (maxBelow != null) {
    next = maxBelow + 1;
  } else {
    // Only higher-lane neighbours exist → sit just below the lowest of them.
    next = Math.max(0, (minAbove as number) - 1);
  }

  next = Math.max(0, next);
  return next === edited.zIndex ? null : next;
}

/**
 * Compute z-index patches for the edited clip(s) only.
 *
 * @param elements  The FULL post-edit element set (edited clips already carry
 *                  their new lane/time). Untouched clips keep their current z.
 * @param editedKeys  Keys of the clip(s) the user just edited.
 * @returns  One patch per edited clip whose z must change; empty when nothing
 *           overlaps or everyone is already correctly ordered. Untouched clips
 *           NEVER appear in the result.
 *
 * Multi-clip edits: each edited clip is resolved against the CURRENT z of all
 * OTHER clips (including other edited clips), left → right by the resolved-then-
 * applied order (lower lane first) so a group dragged onto a busy region stacks
 * consistently instead of every member fighting for the same slot.
 */
export function computeStackingPatches(
  elements: StackingElement[],
  editedKeys: Iterable<string>,
): StackingPatch[] {
  const editedSet = new Set(editedKeys);
  if (editedSet.size === 0) return [];

  // Work on a mutable z snapshot so multi-clip edits see each other's applied z.
  const byKey = new Map(elements.map((e) => [e.key, { ...e }]));
  const edited = elements
    .filter((e) => editedSet.has(e.key) && !e.isAudio)
    .map((e) => byKey.get(e.key)!)
    // Resolve lower-lane (renders below) clips first so their new z is visible
    // to higher-lane siblings resolved after them.
    .sort((a, b) => b.track - a.track);

  const patches: StackingPatch[] = [];
  for (const clip of edited) {
    const others = [...byKey.values()].filter((o) => o.key !== clip.key);
    const next = resolveEditedZ(clip, others);
    if (next == null) continue;
    clip.zIndex = next; // reflect for subsequent siblings in this batch
    patches.push({ key: clip.key, zIndex: next });
  }
  return patches;
}
