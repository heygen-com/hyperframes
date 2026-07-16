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
  /**
   * Current z-index (parsed from inline style / computed; "auto" ⇒ 0), or a
   * NON-FINITE value (NaN) when the caller could NOT resolve the clip's live node
   * (e.g. an unmounted / nested sub-comp element, or one outside the active file).
   * A non-finite-z clip is EXCLUDED from the computation — it is neither a stacking
   * neighbour nor resolvable as an edit — so an unresolved node never fabricates a
   * z=0 neighbour that poisons the boundary math (item 13). The reader signals a
   * miss with NaN rather than null so the value stays assignable to the existing
   * `(el) => number` reader contract the drag hook / commit deps declare.
   */
  zIndex: number;
  /** Audio clips have no visual stacking and are excluded from the computation. */
  isAudio: boolean;
  /** Source document. Leaf z-indexes are comparable only inside this file. */
  sourceFile?: string;
  /**
   * CSS stacking context the clip's node lives in (TimelineElement.stackingContextId).
   * Leaf z-indexes are only comparable WITHIN one context — across contexts the
   * ancestors' z decides paint order — so the sync partitions by this key and
   * never patches across contexts. Null/undefined ⇒ the root context.
   */
  stackingContextId?: string | null;
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

/**
 * Canonical paint-scope key: leaf z-indexes are comparable only within the same
 * source document and CSS stacking context. The ONLY place this normalization
 * lives — partitioning, membership checks, and pairwise equality all use it.
 */
const paintScopeKey = (el: { sourceFile?: string; stackingContextId?: string | null }): string =>
  JSON.stringify([el.sourceFile ?? null, el.stackingContextId ?? null]);

/** Canonical paint-scope equality for stacking sync and its inverse mirror. */
export function samePaintScope(
  a: { sourceFile?: string; stackingContextId?: string | null },
  b: { sourceFile?: string; stackingContextId?: string | null },
): boolean {
  return paintScopeKey(a) === paintScopeKey(b);
}

/**
 * Two clips overlap in time when their half-open [start, end) intervals intersect.
 *
 * NOTE the `- EPS`: this DELIBERATELY diverges from `timeRangesOverlap`'s exact
 * strict-`<` (timelineCollision.ts). A boolean collision decision is idempotent, so
 * exact `<` is fine there; here the result drives a VISIBLE stacking re-lane, so the
 * epsilon guards against float fuzz (e.g. 5.0000001 vs 5) spuriously overlapping two
 * abutting clips and shuffling lanes. The two are intended to differ, not align.
 */
function overlapsInTime(
  a: Pick<StackingElement, "start" | "duration">,
  b: Pick<StackingElement, "start" | "duration">,
): boolean {
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
 * Working record for the cascade resolver: a live-mutable, RESOLVED (non-null) z
 * the resolver can bump, plus the immutable identity/lane/time/dom fields. Clips
 * whose z could not be resolved (null) are dropped before this stage.
 */
interface MutZ extends StackingElement {
  zIndex: number;
}

/**
 * Does `a` currently paint ON TOP of `b`? Higher z wins; equal z breaks by DOM
 * order (later in DOM paints on top). When either domIndex is absent, equal z is
 * treated as "not strictly above" (ambiguous) — callers should supply domIndex to
 * disambiguate (see StackingElement.domIndex). Exported (like laneIsAbove) as the
 * ONE paint-order predicate so every consumer agrees on what "paints above" means.
 */
function paintsAbove(
  a: Pick<StackingElement, "zIndex" | "domIndex">,
  b: Pick<StackingElement, "zIndex" | "domIndex">,
): boolean {
  if (a.zIndex !== b.zIndex) return a.zIndex > b.zIndex;
  if (a.domIndex != null && b.domIndex != null) return a.domIndex > b.domIndex;
  return false;
}

/** Reduce a neighbour set's z-indices to a single bound, or null when empty. */
function boundaryZ(neighbours: MutZ[], reduce: (zs: number[]) => number): number | null {
  return neighbours.length > 0 ? reduce(neighbours.map((o) => o.zIndex)) : null;
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
  overlappersOf: (clip: MutZ) => MutZ[],
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

  const maxBelow = boundaryZ(below, (zs) => Math.max(...zs));

  // ── Fast path: try to realise the order by moving only `edited`. ──────────────
  const single = trySingleZ(edited, below, above);
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
  liftAbove(edited, overlappersOf, patchZ);
  return true;
}

/**
 * Pick a single non-negative z for `edited` that lands it correctly against its
 * neighbours (paints above every below-neighbour, below every above-neighbour), or
 * null when no such z exists and the caller must cascade.
 *
 * The candidate is verified with the SAME `paintsAbove` predicate the resolver uses
 * (z + DOM tie-break), so an authored z that already paints correctly by DOM order
 * is honoured instead of over-patched: with below=z3 and an above-neighbour at z4
 * that is LATER in the DOM, edited=4 ties the neighbour but the neighbour still
 * paints on top by DOM order — a valid single patch, no neighbour bump (item 12).
 * When the tie would INVERT (the above-neighbour is earlier in DOM) the candidate
 * fails verification and the caller cascades.
 */
// edited has neighbours on BOTH sides: prefer the integer midpoint of a real gap;
// with no strict gap a DOM tie-break may still let it sit AT minAbove (item 12),
// else the caller cascades.
function zBetweenNeighbours(
  maxBelow: number,
  minAbove: number,
  correctAt: (z: number) => boolean,
): number | null {
  if (minAbove - maxBelow >= 2) {
    const mid = Math.floor((maxBelow + minAbove) / 2);
    return mid > maxBelow && mid < minAbove ? mid : null;
  }
  return correctAt(minAbove) ? minAbove : null;
}

// edited has only above-neighbours: sit one step below minAbove, or at the z=0
// floor tie minAbove when a DOM tie-break keeps that neighbour on top.
function zBelowOnly(minAbove: number, correctAt: (z: number) => boolean): number | null {
  const candidate = minAbove - 1;
  if (candidate >= 0) return candidate;
  return correctAt(minAbove) ? minAbove : null;
}

function trySingleZ(edited: MutZ, below: MutZ[], above: MutZ[]): number | null {
  const maxBelow = boundaryZ(below, (zs) => Math.max(...zs));
  const minAbove = boundaryZ(above, (zs) => Math.min(...zs));

  const correctAt = (z: number): boolean => {
    const probe: MutZ = { ...edited, zIndex: z };
    return below.every((b) => paintsAbove(probe, b)) && above.every((a) => paintsAbove(a, probe));
  };

  if (maxBelow != null && minAbove != null)
    return zBetweenNeighbours(maxBelow, minAbove, correctAt);
  if (maxBelow != null) return maxBelow + 1; // only below-neighbours → grow upward
  if (minAbove != null) return zBelowOnly(minAbove, correctAt);
  return null;
}

/**
 * Enforce the module invariant — for every OVERLAPPING pair, the clip on the upper
 * lane paints on top — starting from `edited` and cascading TRANSITIVELY.
 *
 * Seeded with `edited`: each of its upper-lane overlappers must paint strictly
 * above it (the deliberate lane move). Raising a clip can then tie or cross ANOTHER
 * clip it overlaps that sits on an even higher lane — that clip must be lifted too,
 * and so on. Without the cascade a lifted neighbour could tie an untouched clip on
 * a higher lane and, being later in the DOM, paint above it — an untouched pair
 * visibly inverting (#2198). The condition is LANE order (not "was originally
 * above"), so a clip that was already violating lane order — e.g. a bottom-lane
 * clip painting on top — is fixed, never preserved. Only clips whose z actually
 * changes are patched; z climbs by +1 each step so the walk terminates.
 */
function liftAbove(
  edited: MutZ,
  overlappersOf: (clip: MutZ) => MutZ[],
  patchZ: (clip: MutZ, z: number) => void,
): void {
  const queue: MutZ[] = [edited];
  const raiseAbove = (clip: MutZ, floor: MutZ): void => {
    if (paintsAbove(clip, floor)) return; // already strictly on top
    patchZ(clip, floor.zIndex + 1); // patchZ mutates clip.zIndex in place
    queue.push(clip);
  };
  while (queue.length > 0) {
    const floor = queue.shift()!;
    for (const other of overlappersOf(floor)) {
      if (laneIsAbove(other, floor) && !paintsAbove(other, floor)) raiseAbove(other, floor);
    }
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

  // Drop clips whose live z couldn't be resolved (non-finite / NaN): a fabricated
  // z=0 would enter the boundary math as a phantom neighbour at the z-floor. An
  // unresolved clip is neither a neighbour nor resolvable as an edit, so it is
  // excluded outright (item 13).
  const allResolved = elements.filter((e) => Number.isFinite(e.zIndex));

  // Leaf z is only meaningful within ONE source document and stacking context:
  // across either boundary the ancestor composition/context decides paint order.
  // Restrict the computation to the edited clips' own paint scope(s).
  const editedScopes = new Set(allResolved.filter((e) => editedSet.has(e.key)).map(paintScopeKey));
  const resolved = allResolved.filter((e) => editedScopes.has(paintScopeKey(e)));

  // Mutable z snapshot so edits + cascaded bumps see each other's applied z.
  const byKey = new Map<string, MutZ>(resolved.map((e) => [e.key, { ...e }]));
  const edited = resolved
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

  // The full live set, so the transitive cascade can reach clips that overlap a
  // LIFTED neighbour without overlapping the edited clip itself (#2198).
  const all = [...byKey.values()];
  const overlappersOf = (clip: MutZ): MutZ[] =>
    all.filter(
      (o) => o.key !== clip.key && !o.isAudio && samePaintScope(clip, o) && overlapsInTime(clip, o),
    );

  for (const clip of edited) {
    resolveEditedZ(clip, overlappersOf(clip), overlappersOf, patchZ);
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
