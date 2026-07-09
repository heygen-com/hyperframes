# Design — Batched atomic timeline persist + main-track ripple

> Branch `research/studio-dnd-architecture`. Fixes the per-clip persist race
> (HANDOFF §7.1 / HANDOFF-2 bugs #1 & #2) and ships the reverted main-track
> ripple (Piece 4b gap-close + 4c insert-ripple) on top of the new atomic primitive.
> Date: 2026-07-09.

## 1. Problem

Multi-clip timeline moves corrupt the composition HTML.

`commitDraggedClipMove` (`player/components/timelineClipDragCommit.ts`) fires **one
fire-and-forget `onMoveElement` per affected clip**. Each `onMoveElement`
(= `handleTimelineElementMove`, `hooks/useTimelineEditing.ts`) does its own
source-write + GSAP-tween shift + preview reload. The source-write is serialized
by the `enqueueEdit` promise queue, **but the GSAP shift escapes that queue**:

```
enqueueEdit(...).then(() => shiftGsapPositions(...).then(reloadPreview))
```

`shiftGsapPositions` (`hooks/timelineEditingHelpers.ts:165`) is a server round-trip
that read-modify-writes the same file via `POST /projects/:id/gsap-mutations/*`.
Fire N of these concurrently on N clips whose `data-start` changed and they clobber
each other → verified corruption ("two videos both ended at start 0").

This is why the main-track ripple (`reflowMainTrack`) was built, live-tested, and
reverted. It is the single blocker for the ripple, and for future multi-clip ops
(lane-packing, insert-ripple, align/distribute).

Two related facts, verified 2026-07-09:

- `STUDIO_SDK_CUTOVER_ENABLED` defaults **false** (`components/editor/manualEditingAvailability.ts:84`).
  So the clean in-memory-doc path (`sdkSession.batch()`) is dark-launched/off; the
  **legacy server fallback is the live path** and is where the race occurs.
- Track-index-only shifts (the F2 top-insert) short-circuit `shiftGsapPositions`
  (`delta === 0`), so they race far less — but they still fire N reloads + N undo
  entries. Start-time ripple is the dangerous case.
- **Correction to HANDOFF §7.1:** the reverted `reflowMainTrack` + tests are **NOT**
  in git history (only the _defer_ commit `0f1910ad` exists) and are not in
  `stash@{0}`. The reflow logic is written fresh here (~15 lines).

## 2. Goal / non-goals

**Goal:** a single atomic multi-clip timing persist (one read, all patches, one
write, one GSAP batch, one reload, one undo), and the main-track ripple wired on
top of it. Correct for every asset kind (video / composition / image / audio /
sfx / music / caption) since it operates on generic `TimelineElement` timing.

**Non-goals (explicit, to stay scoped):**

- Main-track _identity_ rework ("longest video" heuristic is wrong for sub-comp
  compositions). Keep the current stable `resolveMainOriginTrack`; flag as follow-up.
- Lane-packing, R3 track heights, canvas-editor work, multi-select drag — separate pieces.
- Turning on `STUDIO_SDK_CUTOVER_ENABLED`. We keep the same fallback/SDK split.

## 3. Architecture

### 3.1 Core primitive — `handleTimelineElementsMove(edits)`

New export from `useTimelineEditing.ts`:

```ts
type TimelineBatchMove = { element: TimelineElement; updates: Pick<TimelineElement,"start"|"track"> };
handleTimelineElementsMove(edits: TimelineBatchMove[]): Promise<void>
```

Single atomic sequence — **everything awaited, exactly one of each server op** (this
serialization _is_ the race fix):

1. Optimistic live DOM patch of each clip's `data-start` / `data-track-index`
   (`patchIframeDomTiming`) — instant, cosmetic.
2. Read the target file **once** (`readFileContent`). (All edits target the active
   composition file; edits are grouped by `sourceFile` and each group is one atomic
   sequence — in practice one file.)
3. Apply **all** attribute patches to the string in a loop (`applyPatchByTarget`:
   `start` + `track-index` per edit).
4. Persist **once** via `saveProjectFilesWithHistory` → **single undo entry**
   (the exact atomic pattern `handleTimelineElementDelete` / `handleTimelineAssetDrop`
   already use). Label e.g. "Move timeline clips" / "Ripple main track".
5. **One** batched GSAP call: collect `{ targetSelector: '#'+domId, delta }` for every
   edit with `delta !== 0`; if non-empty, `POST .../gsap-mutations/*` with the new
   `shift-positions-batch` op (§3.2). Skip entirely when no start-times changed.
6. **One** `reloadPreview()` + `forceReloadSdkSession()`.

**SDK-cutover branch** (kept, still off by default): when a session exists and
cutover is on, `sdkSession.batch(() => edits.forEach(e => setTiming(e.hfId, ...)))`
→ one serialize → one `persistSdkSerialize`. Naturally atomic. Same structure as the
existing single-clip path, looped.

**Ponytail — one code path:** the existing `handleTimelineElementMove(element, updates)`
becomes a thin wrapper: `handleTimelineElementsMove([{ element, updates }])`. No
duplicated SDK/fallback logic. `handleTimelineElementResize` is unchanged (single-clip,
different attrs).

### 3.2 Server — `shift-positions-batch` op

`packages/studio-server/src/routes/files.ts`. Add `"shift-positions-batch"` to the op
allowlist (~L817) and a dispatch case in both switches (~L1099 and ~L1460) that folds
the existing pure `shiftPositionsInScript(scriptText, selector, delta)` over a
`shifts: { targetSelector: string; delta: number }[]` payload, threading the result
scriptText through each shift. Reuses the AST parser — no duplicated GSAP logic.

### 3.3 Ripple — `reflowMainTrack` (new pure fn)

In `player/components/timelineCollision.ts` (co-located with the other pure lane logic):

```ts
// Sort main-track clips by intended start (dragged clip uses its previewStart),
// then lay them end-to-end from 0. One op = gap-close (4b) + insert-ripple (4c).
reflowMainTrack(
  mainClips: TimelineElement[],
  draggedKey: string,
  draggedPreviewStart: number,
): Array<{ key: string; start: number }>
```

Returns only the clips whose start actually changed. Deterministic, no I/O.

### 3.4 Wiring `commitDraggedClipMove`

- `DragCommitDeps` gains `onMoveElements(edits: TimelineBatchMove[]): Promise<void>`.
- **New main-track branch:** when the drop lands on the main track
  (`mainTrack !== null && placement.track === mainTrack`), compute
  `reflowMainTrack(mainClips, draggedKey, previewStart)`, build one `edits[]` (each
  changed main clip + the dragged clip's track), call `onMoveElements(edits)` once.
- **Insert branch switches to `onMoveElements`** — retires F2's N fire-and-forget
  persists (bug #2) and its latent race in one edit array.
- **Plain-move** stays single (delegates through the batch-of-one wrapper).

### 3.5 Callback thread

Add `onMoveElements` alongside `onMoveElement` through:
`components/nle/useTimelineEditCallbacks.ts` → `contexts/TimelineEditContext.tsx` →
`player/components/timelineCallbacks.ts` → `Timeline.tsx` → `TimelineCanvas.tsx` →
`useTimelineClipDrag.ts` → `commitDraggedClipMove`. `useTimelineClipDrag` passes the
batched handler into the commit deps.

## 4. Error handling

Batch is all-or-nothing. On a failed source-write or GSAP-batch call: revert the
optimistic DOM patch and the in-store `updateElement` calls to prior `start`/`track`,
`console.error`, and toast. A single undo entry restores every clip in one step.
Recording-mode guard reuses the existing early-return + toast.

## 5. Testing

- **Pure units** — `reflowMainTrack`: gap-close (leading/interior gaps removed),
  insert-ripple (dragged clip lands, followers shift right), single clip, empty list,
  order stability (equal starts keep stable id order), returns only changed clips.
- **Server** — `shift-positions-batch` folds multiple shifts correctly; empty list is a no-op.
- **Integration** — `commitDraggedClipMove` main-track branch and insert branch each
  build the correct `edits[]` and call `onMoveElements` exactly once.
- **Manual (browser)** — drag a main clip over another → ripple, no overlap, no
  corruption; single Undo restores all; reload persists; repeat for audio/caption/
  sub-comp on overlay lanes (should NOT ripple — only main is magnetic). Drag feel is
  not auto-verifiable (HANDOFF G4/G7).

## 6. Determinism

No `Date.now` / `Math.random` in the reflow or edit-building path. Existing
`domEditSaveTimestampRef = Date.now()` is a save-echo guard (not rendered output) — unchanged.

## 7. Risks / dependencies

- **Main-track identity** ("longest video") can crown the wrong lane for sub-comp
  compositions → ripple would reflow the wrong lane. Pre-existing; flagged as follow-up.
- **Branch rebase** (48 ahead / 64 behind main): main's `#2090` edits
  `StudioPreviewArea.tsx`, which this branch deleted → delete/modify conflict on rebase.
  Out of scope for this fix; sequence the rebase as its own task before any PR.
- `saveProjectFilesWithHistory` writes attrs, then the GSAP batch endpoint does a second
  write on the same file. Two writes, but **awaited sequentially** (one then the other),
  so no race. One reload after both.

## 8. Files touched (estimate)

- `hooks/useTimelineEditing.ts` — new batch handler; single-move wrapper.
- `player/components/timelineClipDragCommit.ts` — main-track branch; batched insert.
- `player/components/timelineCollision.ts` (+`.test.ts`) — `reflowMainTrack`.
- `player/components/useTimelineClipDrag.ts` — pass `onMoveElements` into commit deps.
- callback thread: `useTimelineEditCallbacks.ts`, `TimelineEditContext.tsx`,
  `timelineCallbacks.ts`, `Timeline.tsx`, `TimelineCanvas.tsx`.
- `packages/studio-server/src/routes/files.ts` (+ parser test) — `shift-positions-batch`.
- `hooks/timelineEditingHelpers.ts` — `shiftGsapPositionsBatch` client helper.
