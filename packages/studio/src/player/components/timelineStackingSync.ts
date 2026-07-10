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
  /**
   * Discovery / DOM document position (optional). Two clips with EQUAL z paint by
   * DOM order — the one LATER in the DOM paints ON TOP. When supplied, "is A above
   * B" uses (zIndex, domIndex); without it equal-z is ambiguous and the sync can
   * under-patch (the reported bug: a clip dragged to the bottom lane over an
   * equal-z neighbour changed nothing on canvas). Callers pass the index of the
   * element in the discovery order array.
   */
  domIndex?: number;
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
 * Does `a` currently paint ON TOP of `b`? Higher z wins; equal z breaks by DOM
 * order (later in DOM paints on top). When either domIndex is absent, equal z is
 * treated as "not strictly above" (ambiguous) — callers should supply domIndex to
 * disambiguate (see StackingElement.domIndex).
 */
function paintsAbove(a: StackingElement, b: StackingElement): boolean {
  if (a.zIndex !== b.zIndex) return a.zIndex > b.zIndex;
  if (a.domIndex != null && b.domIndex != null) return a.domIndex > b.domIndex;
  return false;
}

/**
 * Working record for the cascade resolver: a live-mutable z the resolver can bump,
 * plus the immutable identity/lane/time/dom fields.
 */
interface MutZ extends StackingElement {
  zIndex: number;
}

/**
 * Resolve `edited` so that, among the clips it OVERLAPS IN TIME, its paint order
 * matches its lane order (lower lane ⇒ paints on top). Records every z change
 * (edited clip AND any neighbours that must be bumped) into `patchZ`.
 *
 * Fast path (unchanged behaviour): when a single non-negative z for the edited
 * clip alone realises the order — strictly between the neighbours if there is
 * integer room, else just above the lower neighbour, else just below the upper —
 * emit only that. This keeps every existing single-patch test passing.
 *
 * Cascade path: when ties/clamping make the single-clip patch impossible or
 * ineffective (must sit below an overlapping z=0 neighbour, or between adjacent /
 * equal-z neighbours where DOM order alone can't express it), bump the minimum set
 * of overlapping neighbours that must stay ABOVE by +1 (cascading only as far as
 * needed) so the edited clip's intended lane order is realised with all z ≥ 0.
 * "Authored z sacred" stays the default — neighbours are touched only when the
 * user's explicit lane move is otherwise inexpressible (same precedent as the
 * canvas context-menu tie-aware fix).
 *
 * Returns true when any z changed (recorded in `patchZ`), false for a no-op.
 */
function resolveEditedZ(
  edited: MutZ,
  overlapping: MutZ[],
  patchZ: (clip: MutZ, z: number) => void,
): boolean {
  const visualOverlap = overlapping.filter((o) => !o.isAudio);
  if (visualOverlap.length === 0) return false;

  // Neighbours that must end up BELOW edited (lower lane) vs ABOVE (higher lane).
  const below = visualOverlap.filter((o) => laneIsAbove(edited, o));
  const above = visualOverlap.filter((o) => laneIsAbove(o, edited));

  // Already correct against every overlapping neighbour → no-op (authored z kept).
  const correct =
    below.every((o) => paintsAbove(edited, o)) && above.every((o) => paintsAbove(o, edited));
  if (correct) return false;

  const maxBelow = below.length > 0 ? Math.max(...below.map((o) => o.zIndex)) : null;
  const minAbove = above.length > 0 ? Math.min(...above.map((o) => o.zIndex)) : null;

  // ── Fast path: try to realise the order by moving only `edited`. ──────────────
  const single = trySingleZ(edited, maxBelow, minAbove);
  if (single != null) {
    if (single !== edited.zIndex) patchZ(edited, single);
    // Even at an unchanged z the DOM-order ties may already be satisfied; if not,
    // `trySingleZ` returned null and we fall through to the cascade.
    return single !== edited.zIndex;
  }

  // ── Cascade path: can't fit `edited` between the neighbours with one z ≥ 0. ───
  // Sit edited at maxBelow+1 (or 0 when it only has above-neighbours) and lift the
  // above-neighbours that are now not strictly above, minimally, one step past it.
  const target = maxBelow != null ? maxBelow + 1 : 0;
  const clamped = Math.max(0, target);
  if (clamped !== edited.zIndex) patchZ(edited, clamped);
  liftAbove(edited, above, patchZ);
  return true;
}

/**
 * Pick a single non-negative z for `edited` that lands it strictly between its
 * neighbours' z (paint order), or null when no such integer exists (ties /
 * adjacency / a z=0 floor block it — the caller then cascades).
 */
function trySingleZ(edited: MutZ, maxBelow: number | null, minAbove: number | null): number | null {
  if (maxBelow != null && minAbove != null) {
    if (minAbove - maxBelow >= 2) {
      const mid = Math.floor((maxBelow + minAbove) / 2);
      return mid > maxBelow && mid < minAbove ? mid : null;
    }
    return null; // adjacent / inverted → need a cascade
  }
  if (maxBelow != null) return maxBelow + 1; // only below-neighbours → grow upward
  if (minAbove != null) {
    const candidate = minAbove - 1; // only above-neighbours → sit just below
    return candidate >= 0 ? candidate : null; // z=0 floor blocked → cascade
  }
  return null;
}

/**
 * Bump each above-neighbour that no longer paints strictly above `edited` to
 * `edited.zIndex + 1`, cascading upward through the overlapping set so the bump
 * never re-collides. Only clips whose z actually changes are patched.
 */
function liftAbove(edited: MutZ, above: MutZ[], patchZ: (clip: MutZ, z: number) => void): void {
  // Lowest-first so a chain of adjacent neighbours ratchets up minimally.
  const ordered = [...above].sort((a, b) => a.zIndex - b.zIndex || (a.key < b.key ? -1 : 1));
  let floor = edited.zIndex;
  for (const o of ordered) {
    if (o.zIndex > floor) {
      floor = o.zIndex;
      continue;
    }
    const next = floor + 1;
    if (next !== o.zIndex) patchZ(o, next);
    floor = next;
  }
}

/**
 * Compute z-index patches so each edited clip's stacking matches its lane order.
 *
 * @param elements  The FULL post-edit element set (edited clips already carry
 *                  their new lane/time). Untouched clips keep their current z.
 * @param editedKeys  Keys of the clip(s) the user just edited.
 * @returns  Minimal z patches. When a single-clip patch realises the order it is
 *           the only patch (authored z of neighbours untouched); when ties or a
 *           z=0 floor make that impossible, the minimum set of overlapping
 *           neighbours is bumped too so the lane move is always realisable with
 *           all z ≥ 0. Non-overlapping / already-correct edits yield nothing.
 *
 * Multi-clip edits: each edited clip is resolved against the CURRENT (already-
 * patched) z of all OTHER clips, lower lane first, so a group dragged onto a busy
 * region stacks consistently.
 */
export function computeStackingPatches(
  elements: StackingElement[],
  editedKeys: Iterable<string>,
): StackingPatch[] {
  const editedSet = new Set(editedKeys);
  if (editedSet.size === 0) return [];

  // Mutable z snapshot so edits + cascaded bumps see each other's applied z.
  const byKey = new Map<string, MutZ>(elements.map((e) => [e.key, { ...e }]));
  const edited = elements
    .filter((e) => editedSet.has(e.key) && !e.isAudio)
    .map((e) => byKey.get(e.key)!)
    // Resolve lower-lane (renders below) clips first so their new z is visible
    // to higher-lane siblings resolved after them.
    .sort((a, b) => b.track - a.track);

  const changed = new Map<string, number>();
  const patchZ = (clip: MutZ, z: number): void => {
    clip.zIndex = z;
    changed.set(clip.key, z);
  };

  for (const clip of edited) {
    const overlapping = [...byKey.values()].filter(
      (o) => o.key !== clip.key && overlapsInTime(clip, o),
    );
    resolveEditedZ(clip, overlapping, patchZ);
  }

  // Emit in a stable order (edited clips first in their resolve order, then any
  // cascaded neighbours) — deterministic for tests and undo grouping.
  const emitted = new Set<string>();
  const patches: StackingPatch[] = [];
  for (const clip of edited) {
    if (changed.has(clip.key) && !emitted.has(clip.key)) {
      patches.push({ key: clip.key, zIndex: changed.get(clip.key)! });
      emitted.add(clip.key);
    }
  }
  for (const [key, zIndex] of changed) {
    if (!emitted.has(key)) {
      patches.push({ key, zIndex });
      emitted.add(key);
    }
  }
  return patches;
}
