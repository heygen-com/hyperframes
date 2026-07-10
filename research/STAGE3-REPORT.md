# STAGE 3 — lane ↔ stacking unification: design decisions

Implements the user-approved amendment: **lane order implies stacking** (a clip on
a higher lane renders on top of clips it overlaps IN TIME), but **authored z-index
is sacred** — z changes ONLY on a user edit, and ONLY for the edited clip(s).

## Key design decisions

1. **Lane→z polarity.** Timeline tracks are sorted ascending and rendered top→bottom
   (`Timeline.tsx` trackOrder, `TimelineCanvas` rows), so a LOWER `track` value
   renders HIGHER on screen. Standard NLE convention = top row wins → **lower track
   ⇒ higher z-index**. Encapsulated in one comparator `laneIsAbove(a,b)=a.track<b.track`
   so no caller has to reason about polarity.

2. **Pure module boundary (`timelineStackingSync.ts`).** DOM-free and store-free. It
   reasons over an abstract `StackingElement { key, start, duration, track, zIndex,
   isAudio }`. This matters because `TimelineElement` carries NO z-index — z lives
   only in the live iframe DOM (inline style / computed). The caller projects its
   world onto `StackingElement`, supplying the live z it reads. This keeps the
   z-source (DOM) decision out of the pure layer and makes it trivially testable.

3. **Overlap gate = time only.** Two clips "overlap" iff their half-open
   `[start, start+duration)` intervals intersect (touching edges do NOT count).
   Non-overlapping clips are never restacked — z is meaningless without a time
   overlap. Mirrors the canvas menu's rect-overlap gate, but in time not pixels.

4. **Minimal-z resolution.** For the edited clip, among time-overlapping neighbours:
   - it must sit ABOVE overlapping clips on LOWER lanes (`maxBelow`),
   - and BELOW overlapping clips on HIGHER lanes (`minAbove`).
   Resolution: if room exists between neighbours → `floor((maxBelow+minAbove)/2)`;
   adjacent/inverted neighbours → `maxBelow+1`; only-below → `maxBelow+1`; only-above
   → `max(0, minAbove-1)`. Clamped ≥ 0. Returns **null (no patch)** when there is no
   overlap OR the edited clip is already correctly ordered — so we never churn the
   DOM or produce a redundant undo entry.

5. **Untouched clips are sacred.** `computeStackingPatches` only ever returns patches
   keyed to `editedKeys`. Even when an untouched neighbour is itself out of order,
   it is left alone (authored z preserved). This is the explicit anti-goal that
   distinguishes this from a full renumber.

6. **Multi-clip edits.** Each edited clip resolves against the CURRENT z of all other
   clips including sibling edits, processed lower-lane-first so a group dropped onto a
   busy region stacks consistently (each member sees the applied z of the members
   below it) instead of colliding on one slot.

7. **Audio exclusion.** Audio clips have no visual stacking: excluded both as the
   subject of a patch (an audio edit yields nothing) and as neighbours (a visual clip
   ignores overlapping audio). Uses the existing `classifyZone` from `timelineZones`.

8. **Backward-compatible wiring.** `commitDraggedClipMove` gained two OPTIONAL deps
   (`readZIndex`, `onStackingPatches`). Absent → total no-op; the existing move/insert
   behavior and all prior tests are unchanged. The z-sync only fires on a lane-change
   (topology) commit, never on a pure same-lane time-move.

## Shipped vs documented-for-wiring

- **Shipped (files I own):**
  - `timelineStackingSync.ts` — pure computation + `laneIsAbove` helper.
  - `timelineClipDragCommit.ts` — computes patches on lane-change commits and invokes
    `onStackingPatches` (via new `syncStackingForEdit`); no-op unless both deps present.
  - Tests: `timelineStackingSync.test.ts` (17), added stacking cases to
    `timelineClipDragCommit.test.ts` (4).
- **Documented for wiring (concurrent agent's locked files):** the ~5-line dep
  provisioning in `useTimelineClipDrag.ts` (resolve iframe element → `readZIndex` +
  forward patches to `handleDomZIndexReorderCommit`), and the optional persist-merge
  to make move+z a single undo step. See `STAGE3-NEEDED-WIRING.md`.
- **Documented, NOT implemented (§future):** reverse mapping — reflecting a
  menu/panel z-edit back into timeline lane order (needs a `zIndex` field on
  `TimelineElement` + z-ordered `normalizeToZones` + an idempotency/fixed-point test).

## Why the z lands like the canvas z-order commit

`handleDomZIndexReorderCommit` (`useElementLifecycleOps.ts`) is the shared sink for
BOTH the canvas right-click z-order AND the LayersPanel row-drag. It writes an
`inline-style` `z-index` patch (promoting `position:static→relative`) through the
soft persist path with `skipRefresh:true` (no reload flash) and coalesces to one undo
entry. Emitting `StackingPatch[]` in exactly that entry shape means the timeline lane
change reuses the same, already-proven z persist — no new persist mechanism.
