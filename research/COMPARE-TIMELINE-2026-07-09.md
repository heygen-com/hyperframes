# Timeline Comparison — OURS vs MAIN (2026-07-09)

**OURS** = `research/studio-dnd-architecture` (worktree `laughing-perlman-594eb3`), served at `localhost:3011`.
**MAIN** = `v0.7.46-70` (`/tmp/hf-main-preview`), served fresh at `localhost:3016` (the pre-existing `3013` instance was left untouched).
Both studios serve the **same** project `/tmp/hf-dnd-qa/qa-clean` (20 clips, 8 tracks: SVGs w/ spaces, PNGs, 3 videos, 1 audio).

**Method.** Two parallel code-reading agents produced file:line inventories of each `packages/studio/src` tree; I then live-verified the highest-value + user-suspected claims in both running studios (toolbar/track-header affordance enumeration via DOM, clip DOM, stacking-group headers, music icon, snap-toggle presence). Synthetic pointer drags are ~50% flaky and `setPointerCapture` rejects synthetic pointers, so **drag-mechanics rows (collision, group-move deltas, snap thresholds) are adjudicated from code** and flagged as such; affordance/structure rows are live-verified.

---

## Verdict table

| #   | Feature                                                        | Verdict                           | One-line reason                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Clip drag (feel, snap, collision, cross-track)                 | **HYBRID**                        | OURS: free 2-axis ghost + no-overlap relocate/new-lane + **snap toggle**. MAIN: ghost + **overlap allowed → z-index reorder**. Take OURS's collision safety + snap toggle; take MAIN's z-order-on-vertical-drag concept.                                                          |
| 2   | Multi-select (marquee, group move, batch delete, additive)     | **HYBRID (lean OURS)**            | Both have live marquee + live group ghosts. **OURS has batch delete + cmd/shift additive**; **MAIN's group MOVE is arguably cleaner (rollback-on-fail, single commit) but MAIN has NO batch delete and NO cmd-click additive.**                                                   |
| 3   | Trim/resize (handles, limits, auto-scroll)                     | **TIE**                           | Nearly identical: 14px handles, clamp to source-media duration, auto-scroll 40px/12px.                                                                                                                                                                                            |
| 4   | Drag/trim past right edge → extend                             | **OURS**                          | OURS grow-**and-shrink** to content off raw source `data-duration` (avoids truncation loop); MAIN grow-only in-memory, and any edit needing extension **drops out of the SDK soft path → reload flash**.                                                                          |
| 5   | Drop of new media (asset panel + OS file)                      | **HYBRID**                        | OURS lands at **playhead** (CapCut model, deliberate); MAIN lands at **drop-x**. Both route by zone + don't move playhead. Pick per product taste — playhead is more predictable, drop-x more spatial.                                                                            |
| 6   | Playhead (scrub surface, visibility, edit-moves, seek)         | **OURS**                          | OURS head is **sticky** (visible when scrolled); MAIN scrolls with content (can scroll out of view). Both: ruler scrubs, no edit moves playhead, live seek.                                                                                                                       |
| 7   | Edit blink (move/trim/delete/drop)                             | **TIE (both partial)**            | Both: move/trim = **soft** (DOM patch + SDK/script swap, no flash); delete + drop = **full reload flash**. Same wins, same gaps.                                                                                                                                                  |
| 8   | Duration model (readout, fit-zoom, min extent)                 | **HYBRID**                        | Both live readout + frozen-basis-during-drag so zoom doesn't jump. OURS adds a **60s minimum extent** (real drop runway); MAIN has **no trailing runway** (tighter, but nowhere to drop past content).                                                                            |
| 9   | Track/lane visuals (headers, waveform, thumbs, ruler, toolbar) | **HYBRID (lean MAIN on headers)** | **MAIN has the music icon on audio tracks (user likes it) + stacking-context group headers.** OURS has cleaner uniform lanes + a **snap toggle + add-beat** in the toolbar + **SVG-with-spaces thumbnails work**; MAIN's SVG-with-spaces thumbnail URL is **unencoded → broken**. |
| 10  | Undo granularity                                               | **TIE**                           | Both: one drag = one undo step (OURS atomic read-patch-write; MAIN 300ms coalesceKey). Both group-op = one entry.                                                                                                                                                                 |
| 11  | Unique capabilities                                            | **HYBRID**                        | MAIN-only: **z-order surface (#2068)** + LayersPanel sharing the z-index commit path + music icon. OURS-only: **snap toggle (N)** + **beat-grid add** + **batch delete** + **cmd/shift additive select** + sticky playhead + SVG-space-safe thumbnails.                           |

---

## Per-row evidence

### 1. Clip drag

- **OURS** (verified code): free 2-axis floating ghost = a real `TimelineClip` at `zIndex:40`, follows pointer on both axes (`player/components/TimelineCanvas.tsx:200-213,627-658`). Snap targets = playhead + every clip start/end edge + music beats; **8px** threshold zoom-scaled (`timelineSnapping.ts:11,19-44`). **Snap toggle exists** (`timelineSnapEnabled`, Magnet button + **N**) — live-confirmed: OURS toolbar has a "Toggle timeline snapping" button. Collision = **no overlap on a track**; a colliding drop **relocates the dragged clip to nearest free lane (up→down) or creates a new track** (`timelineCollision.ts:134-203`), and near a lane edge (top/bottom 22%) forces a new-track insert. On commit all clips re-pack via `normalizeToZones`. Clips clamped to zone (visual above audio).
- **MAIN** (verified code): dedicated ghost `div` (`TimelineDragGhost.tsx:28-36`), **real clip culled from DOM while dragging** (`TimelineCanvas.tsx:373-376`). Snap targets = t0/comp-end + playhead + all clip edges + beats; **8px** (`timelineSnapTargets.ts:15,44-97`). **No snap toggle** (live-confirmed: MAIN toolbar has no snap button; snapping always on). Collision = **overlap allowed**; vertical drag resolves as a **z-index stacking reorder** (`timelineEditing.ts:125-147`, `timelineLayerDrag.ts`), new track only when dragged past first/last beyond **0.55** (`timelineEditing.ts:159-171`).
- **Live feel note:** OURS clip at rest shows `cursor: default`; MAIN shows `cursor: grab` (MAIN advertises draggability better at rest).

### 2. Multi-select

- **OURS**: marquee recomputes selection **live every move** (`useTimelineRangeSelection.ts:169-192`), dashed teal box (`TimelineCanvas.tsx:660-677`). Group move: dragged clip is the ghost, all passengers preview the same delta via `translateX` opacity .85 (`timelineMultiDragPreview.ts:33-72`). **Batch delete: deleting any selected clip deletes the whole selection atomically** (`useTimelineEditing.ts:506-524`). **Additive: shift/cmd-click arms range/additive union** (`useTimelineRangeSelection.ts:110-122,142-150`).
- **MAIN** (PR **#2111** `feat/timeline-multiselect`): marquee 4px threshold, live rect, **committed on pointer-up** (`useTimelineMarqueeSelection.ts:19-26,139-146,251-262`). **Group move is genuinely robust** — group `MoveSession` only if grabbed clip already selected & size>1, every member live-ghosted via `updateElement`, same clamped delta preserving spacing, **rollback-all-on-failure**, single-op commit (`useTimelineClipGroupDrag.ts:308-387`, `timelineGroupEditing.ts:98-110`). **BUT: no batch delete** (Delete reads singular `selectedElementId`, `useAppHotkeys.ts:280-309`) and **no cmd/ctrl-click additive** (plain click replaces; shift only arms range — `TimelineCanvas.tsx:479-507`).
- **On the user's suspicion that MAIN's group selection+move is better:** MAIN's group-_move_ internals are indeed cleaner (explicit session, rollback, single commit). But the overall multi-select _feature set_ favors OURS because MAIN cannot batch-delete a selection and cannot cmd-click to accumulate. Recommendation: port MAIN's rollback+single-commit group-move discipline into OURS's selection model, which already has the missing delete/additive pieces.

### 3. Trim/resize — TIE

- OURS: 14px handles gated by `canTrimStart/End`, max = `start + sourceRemaining` (source, not comp), auto-scroll 40px/12px (`TimelineClip.tsx:103-162`, `useTimelineClipDrag.ts:287-304,473-485`).
- MAIN: identical shape — 14px handles, `maxEnd = start + sourceRemaining`, auto-scroll 40px/12px (`TimelineClip.tsx:100-159`, `useTimelineClipDrag.ts:363-374,284-307`).

### 4. Drag/trim past right edge

- OURS: grow-**or-shrink** to content via `setCompositionDurationToContent`, reading raw source `data-duration` (`timelineElementsMove.ts:112-127`, `timelineElementHelpers.ts:74-77`) — avoids the runtime-truncation feedback loop.
- MAIN: `extendRootDurationIfNeeded` grows in-memory (`timelineEditingHelpers.ts:113-118`); crucially, an edit that **needs extension skips the SDK soft path** (guards `!needsExtension`) and falls to reload → a flash on edge-extends.

### 5. Drop of new media

- OURS: lands at **playhead time always** (drop-x discarded; explicit CapCut comment dated 2026-07-09), track from drop-y, zone-routed, **playhead does not move**, full `reloadPreview()` renders immediately (`timelineDragDrop.ts:14-67`, `useTimelineEditing.ts:572-624`).
- MAIN: lands at **drop cursor X → time** (`timelineAssetDrop.ts:51-79`), bumps track on overlap, playhead unchanged, full `reloadPreview()` (`useTimelineEditing.ts:494`).

### 6. Playhead

- OURS: ruler press scrubs (`seekFromX`), empty-body press starts marquee (never scrubs), head is **`position:sticky` → stays visible while tracks scroll** (`PlayheadIndicator.tsx:66-80`, `useTimelineRangeSelection.ts:129-150`). No edit moves it.
- MAIN: ruler + empty body scrub, clicking a `[data-clip]` won't scrub, **playhead absolutely positioned at `left:GUTTER` and scrolls WITH content** (can scroll out of view) (`TimelineCanvas.tsx:577-587`). Live seek via `liveTime.notify`. No edit moves it.

### 7. Edit blink

- OURS: move/trim = **soft** (`syncTimingEditPreview` swaps the GSAP `<script>` in place, restores currentTime; `timelineEditingHelpers.ts:294-306`); delete = full reload (`useTimelineEditing.ts:485`); drop = full reload (`:623`). DOM attrs patched instantly pre-reload.
- MAIN: move/trim = **soft** (`patchIframeDomTiming` + `sdkTimingPersist`, `useTimelineEditing.ts:142-190`); delete = full reload (`:408`); drop = full reload (`:494`).
- **Same story both sides**: timing edits are flicker-free, delete+drop flash. Neither has solved the delete/drop blink.

### 8. Duration model

- OURS: `effectiveDuration = max(furthest clip end, MIN_TIMELINE_EXTENT_S=60)` (`Timeline.tsx:194-227`, `timelineLayout.ts:50-57`); zoom pinned before delete so no re-fit jump (`useTimelineEditing.ts:407-418`). Gives a 60s drop runway even for short comps.
- MAIN: `basisDuration = max(root, clip ends)`, **frozen during drag**, `effectiveDuration` grows live so track extends but zoom holds (`Timeline.tsx:234-296`); **no trailing runway** — width is exactly content (`timelineLayout.ts:19-27`).

### 9. Track/lane visuals — **live-verified**

- **MAIN track-header affordances** (`TimelineLayerGutter.tsx:30-58`): (1) **Music icon on audio layers** — live-confirmed `hasMusicIcon:true`; (2) Eye/EyeSlash hide toggle ("Hide track N"). **No mute, no lock, no solo.** Plus **stacking-context group headers** "Inside: qa-clean" rendered between clip groups — live-confirmed present.
- **OURS track-header affordances** (`TimelineCanvas.tsx:276-306`): **Eye only** ("Hide track N"). No music icon (live-confirmed `hasMusicIcon:false`), no mute/lock, no stacking header (live-confirmed empty).
- **Toolbars (live-verified button lists):** OURS = Selection, Razor, **Toggle timeline snapping**, Add keyframe, Auto-record, **Split at playhead**, **Add beat at playhead**, Fit, Zoom out/in. MAIN = Selection, Razor, Auto-record, Split at playhead, Fit, −, +. **OURS uniquely exposes snap-toggle + add-beat; MAIN uniquely exposes a numeric % zoom readout.**
- **Waveform**: both render div-bar waveforms windowed to trim (OURS `AudioWaveform.tsx:72-211`; MAIN `:86-158`) — TIE.
- **Thumbnails**: both do 6-frame video extraction + image fill. **SVG-with-spaces divergence**: OURS special-cases SVG and is space-safe (URL-encode at fetch) (`VideoThumbnail`/`ImageThumbnail`); **MAIN interpolates `el.src` unencoded → SVG filenames with spaces produce a broken thumbnail URL** (`useRenderClipContent.ts:140-143`). This project has `heygen-symbol-blue-logo (2).svg` etc., so MAIN's thumbnails for those are broken.

### 10. Undo granularity — TIE

- OURS: one drag/trim = one atomic read→patch→write→history entry; multi-delete = one entry (`timelineElementsMove.ts:61-166`, `useTimelineEditing.ts:402-478`).
- MAIN: 300ms `coalesceKey` merge (`editHistory.ts:111-154`); group op key concatenates member ids = one entry (`useTimelineGroupEditing.ts:69-75`).

### 11. Unique capabilities

- **MAIN-only**: **Z-order surface (PR #2068)** — vertical clip drag becomes a z-index stacking reorder within a stacking context, visible "Inside:" group headers + gutter, and a **LayersPanel** sharing the same z-index commit path (`timelineLayerDrag.ts`, `timelineStacking.ts`, `editor/LayersPanel.tsx`). Cross-realm HTMLElement guard so iframe z-index commits don't drop. **Music icon** on audio tracks.
- **OURS-only**: **Snap toggle (Magnet, N)** with beat-aware targets; **Add beat at playhead** (beat-grid editing); **Batch delete** of a selection; **cmd/shift additive** selection; **sticky playhead head** (visible when scrolled); **SVG-with-spaces-safe thumbnails**; **60s minimum drop runway**; grow-and-shrink duration off raw source data.
- **Both**: split/razor (razor tool + split-at-playhead, shift-click splits all tracks), zoom Fit/±, per-track hide, auto-scroll, new-track-past-edge, live marquee, live group ghosts, one-step-per-drag undo, soft timing reloads.

---

## Recommended adoption plan

### Take from MAIN → port into OURS

1. **Music icon on audio tracks** (user explicitly likes it). Trivial: MAIN's `TimelineLayerGutter.tsx:30-37` gates a `<Music>` icon on `isAudio`. OURS's `TimelineCanvas.tsx:276-306` gutter is tag-agnostic — add the same audio-kind check. Low risk, high user-satisfaction.
2. **Z-order surface concept (#2068)** — OURS treats z-order as a _canvas_ right-click feature only; MAIN makes vertical timeline drag = z-index reorder with visible stacking-context group headers + a LayersPanel. This is a genuinely richer layering UX. Porting it is larger, but at minimum adopt the **visible stacking-context grouping** so users see z-order in the timeline. **Caveat:** it conflicts with OURS's "vertical drag = move to another track/lane" model — this is the core architectural fork and needs a product decision (see hybrid note).
3. **Group-move discipline**: MAIN's `MoveSession` with **rollback-all-on-failure + single-op commit** (`useTimelineClipGroupDrag.ts`) is cleaner than OURS's passenger-preview approach. Fold that robustness into OURS's group move (which already has the batch-delete/additive pieces MAIN lacks).
4. **Numeric % zoom readout** in the toolbar — minor nicety MAIN has, OURS shows only a slider.
5. **`cursor: grab` at rest** on draggable clips — MAIN advertises draggability; OURS shows `default`.

### Keep / promote from OURS (do NOT regress to MAIN)

1. **Snap toggle (N) + beat-aware snapping + Add-beat** — MAIN has neither; these are real editorial wins.
2. **Batch delete + cmd/shift additive selection** — MAIN is missing both; OURS's multi-select is functionally more complete.
3. **Collision safety (no-overlap relocate/new-lane + `normalizeToZones` re-pack)** — prevents post-reload overlap; MAIN allows overlaps and leans entirely on z-order to disambiguate.
4. **Sticky playhead head** — MAIN's scrolls out of view.
5. **SVG-with-spaces-safe thumbnails** — MAIN's are broken for this exact project's assets; **flag as a MAIN bug**.
6. **Grow-and-shrink duration off raw source `data-duration`** and the **60s min drop runway**.
7. **Edge-extend stays on the soft path** — MAIN drops to a reload flash when an edit needs extension; OURS doesn't.

### Hybrid notes / open decisions

- **The core fork = what does vertical drag mean?** OURS: _move to another track/lane_ (zone-clamped, no overlap). MAIN: _reorder z-index within a stacking context_ (overlap allowed). These are mutually exclusive as the default gesture. Recommended resolution: keep OURS's zone/lane model as the primary spatial gesture, and add MAIN-style **z-order as an explicit surface** (the LayersPanel + visible "Inside:" headers + a modifier-drag or context action), rather than overloading the raw vertical drag. This preserves OURS's collision safety while recovering MAIN's layering visibility.
- **Drop landing (playhead vs drop-x)**: product call. Playhead (OURS) is more predictable and matches CapCut; drop-x (MAIN) is more spatial. Consider drop-x with playhead-snap when near the head.
- **Delete/drop blink is unsolved on both** — a shared follow-up: extend the soft-reload path to cover delete and drop, not just move/trim.

### MAIN bugs worth filing regardless of adoption

- SVG thumbnails with spaces in the filename break (unencoded `el.src`, `useRenderClipContent.ts:140-143`) — reproduces on this qa-clean project.
- Multi-select can group-move but cannot batch-delete (Delete only removes the primary clip, `useAppHotkeys.ts:294-299`) — surprising given #2111 shipped full group move.
