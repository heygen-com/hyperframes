# Design — Collision-Push + Track Insert (R2, piece 2 of 4)

> Second piece of the CapCut drag-physics work (R2). Builds directly on piece 1
> (ghost follows cursor + clip-sized drop placeholder). User pulled the mid-lane
> insert (normally Piece 3 track-model work) forward into this piece.
> Brainstormed 2026-07-08. Decisions: push prefers **up**; no free lane → **new
> track**; **mid-lane insert included** (shift lanes below + reindex).

## 1. Goal

While dragging a clip vertically:

1. If the target lane is **occupied** at the drop time-range, the drop placeholder
   moves to the **nearest free lane, preferring up** (then down).
2. If **no existing lane is free**, or the pointer is in the **gap between two
   lanes** / past an edge, a **horizontal insertion line** appears and dropping
   **inserts a new track** at that position — clips on lanes below shift down.

The ghost keeps following the cursor (piece 1); only the placeholder / insertion
line changes to show where it lands.

## 2. Research basis (insertion affordance)

NLEs show an insertion indicator when dragging near a track boundary: Final Cut
uses a directional arrow relative to a criteria line between layers; DaVinci
Resolve previews an insert edit (pushes clips to make room) and auto-creates a
track on drop into empty space. CapCut shows a **horizontal line** = "a new track
will be inserted at this boundary." We adopt: hover **over a lane** → target that
lane (with collision-push); hover the **gap / edge** → insertion line → new track.
Sources: FCP criteria-line arrow (creativecow), Resolve insert preview
(blogs.uoregon.edu/uocinetech).

## 3. Current constraints (grounding)

- Tracks are integers (`data-track-index`); `trackOrder` = sorted unique indices
  ascending; **track 0 renders at the top**, higher indices below. Runtime honors
  authored index verbatim (producer/engine ignore `track`).
- Move persist is **per-element**: `handleTimelineElementMove`
  (`hooks/useTimelineEditing.ts`) patches one clip's `data-start` +
  `data-track-index` (live DOM via `patchIframeDomTiming`, source via
  `enqueueEdit`/`sdkTimingPersist`, coalesced under one undo key).
- Piece 1 added `MAGNETIC_TRACK_THRESHOLD` (0.5) in `resolveTimelineMove` and a
  clip-sized placeholder in `TimelineCanvas` at `(previewStart, previewTrack)`.

## 4. Design

### 4.1 Track index representation for inserts — **renumber, not fractional**

Inserting a lane between two existing lanes needs a track index that sorts
between them. Two options:

- **Fractional** (new track = midpoint like 0.5): zero reindex, one write — but
  non-integer `data-track-index` is unusual, risks the lint/validate rules and
  accumulates messy values. **Rejected.**
- **Renumber** (chosen): after an insert, recompute a clean `0..N` integer index
  per clip by final visual row order. The dragged clip takes the insertion row;
  every clip on a row at/below the insertion shifts +1. Correct, matches the real
  track model Piece 3 needs, at the cost of persisting every shifted clip.

### 4.2 Collision detection + resolution (pure, testable)

New module `timelineCollision.ts`:

- `isLaneFree(elements, track, start, end, excludeKey)` — no other clip on `track`
  overlaps `[start, end)`.
- `resolvePlacement(elements, desiredTrack, start, duration, trackOrder, excludeKey)`
  → `{ track, insertBelowRow? }`. If `desiredTrack` is free, return it. Else search
  outward **preferring up**: `up1, down1, up2, down2, …` over `trackOrder`; return
  the first free lane. If none free, signal an **insert** (new track at the edge
  nearest the search — top when preferring up).

Pure functions → unit-tested exhaustively (free lane, occupied→up, occupied→up-full→down, none-free→insert).

### 4.3 Insert-vs-target mode in the drag (`useTimelineClipDrag`)

`updateDraggedClipPreview` gains an **insert-boundary** check. From `trackDeltaRaw`
(pointer offset in track-heights), the fractional position within the hovered lane
decides mode:

- Within the lane's central band → **target** that lane, then run
  `resolvePlacement` (collision-push).
- In the top/bottom **edge band** of a lane (or past the first/last lane) →
  **insert** mode: record the boundary row index (`insertRow`) on the drag state.

New `DraggedClipState` fields: `insertRow: number | null` (row index where a new
track inserts, null = normal target) and the resolved `previewTrack` continues to
carry the pushed target when not inserting.

### 4.4 Insertion-line indicator (`TimelineCanvas`)

When `draggedClip.insertRow != null`, render a **horizontal line** (full track
width, ~2px, accent color) at `RULER_H + insertRow * TRACK_H` instead of the
clip-sized placeholder. Otherwise keep piece 1's clip-sized placeholder at the
(pushed) target lane.

### 4.5 Commit — single move vs insert-with-reindex (`useTimelineEditing`)

- **Normal / pushed move:** unchanged single-element `handleTimelineElementMove`
  with the resolved `previewTrack`.
- **Insert:** new `handleTimelineElementInsert(element, start, insertRow)`:
  1. Compute the new integer track map: all clips (except dragged) keep relative
     order; those at rows `>= insertRow` shift +1; the dragged clip takes
     `insertRow`.
  2. Persist every changed clip's `data-track-index` (+ the dragged clip's
     `data-start`) — batch under **one coalesce/undo key** so the whole insert is
     a single undo. Live-patch each via `patchIframeDomTiming`, source-write each
     via the existing per-element path in a loop, then one `reloadPreview`.
  3. Only clips whose index actually changes are written (skip no-ops).

### 4.6 Staged build order (each a green, verifiable commit)

- **2a — collision-push, existing lanes only.** `timelineCollision.ts` +
  `resolvePlacement` wired into the drag preview; placeholder shows the pushed
  lane. No inserts yet (none-free falls back to the desired lane). Unit + live.
- **2b — insertion-line + new track at edge.** Insert-boundary detection for the
  top/bottom edges only; horizontal line; commit creates an edge track (reuses the
  existing edge-create index math, no mid reindex). Live.
- **2c — mid-lane insert + reindex.** Extend insert detection to interior gaps;
  `handleTimelineElementInsert` bulk reindex + batched persist. Unit-test the
  reindex map; live-verify shift-down + single-undo + survives reload.

## 5. Testing

- Unit: `timelineCollision.test.ts` (isLaneFree, resolvePlacement prefer-up,
  none-free→insert); reindex-map builder (rows shift +1 at/below insertRow, dragged
  takes insertRow, no-op clips untouched).
- Existing `timelineEditing` / `useTimelineClipDrag` / `Timeline` suites stay green.
- **Live (real gate) per stage:** 2a — drag onto an occupied lane, placeholder
  hops to nearest free lane above; 2b — drag past the top edge, insertion line +
  new top track on drop; 2c — drop in a middle gap, lanes below shift down, one
  undo reverts the whole insert, survives reload on the new rows. Tune feel with
  the user.

## 6. Risks

- **Bulk persist correctness** — N clips reindexed per insert; each must persist
  and land on reload. Batch under one undo key; verify the written `index.html`.
- **Undo granularity** — the whole insert must be one undo, not N. Use a single
  `coalesceKey`.
- **Insert-band thresholds** — the edge-band size that triggers insert vs target is
  a feel constant; make it a named value and tune live (risk: hard to hit target
  lanes if the band is too big).
- **Reload cost** — one reload after the batch, not per clip.
- **Interaction with piece 1** — the pushed/insert `previewTrack` still drives the
  placeholder; the ghost still follows the cursor. Keep those decoupled.
- **Pulls Piece 3 forward** — the reindex/bulk-persist IS the track-model core;
  Piece 3 (persisted track meta: name/kind/lock/mute) still remains after this.

## 7. Non-goals

Main-track no-overlap + ripple/gap-close (Piece 4). Per-track lock/mute/kind
metadata (Piece 3). Horizontal snapping (shipped in Plan 1).
