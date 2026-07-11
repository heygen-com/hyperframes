# Review evidence pack — 2026-07-10 (verbatim subagent + reviewer material)

> Companion to HANDOFF-5. This preserves the VERBATIM outputs that back HANDOFF-5 §3/§4,
> so a fresh session can re-derive any decision without this session's context.
> Raw GitHub review bodies (all 50): `research/REVIEWS-GITHUB-RAW-2026-07-10.txt`.
> Slack originals: thread `heygen.slack.com/archives/C0ACCNHLG3U/p1783733341403229`
> (Abhai's consolidated readout + verdict table, Rames's HF-specialist rollup — re-read
> them there; summaries below are faithful but the thread is the source).

## A. /code-review max — verifier verdicts (the fix backlog's evidence)

### V1 (CONFIRMED, all sub-claims) — lane-drag dual persist
(a) No shared serialization: move path = client read-modify-write of the FULL file
(`readFileContent → applyGroupTimingPatches → filesToSave → writeProjectFile` via
`saveProjectFilesWithHistory`, timelineElementsMove.ts:104-124, 234-242); z path =
server `patch-element` POST (useDomEditCommits.ts:156-220). Only queue on z path is
`queueDomEditSave`; move path bypasses `enqueueEdit`/`editQueueRef` AND `queueDomEditSave`.
Move's full-content write computed from a pre-z snapshot → if it lands after the server
z-patch it drops the z change.
(b) Rollback asymmetry: `persistMoveEdits` catch restores only `{start, track}`
(timelineClipDragCommit.ts:68); the z patch (line 160) is never reverted.
(c) Two undo entries: move = `"Move timeline clips"`, no coalesceKey
(timelineElementsMove.ts:234-242); z = `"Reorder layers"`, coalesceKey `z-reorder:…`
(useElementLifecycleOps.ts:179,211). Historical: main's `04ddd411e` "harden group
timeline edits" ordering was lost in the DnD-engine reconciliation.

### V2 (CONFIRMED) — stale store zIndex after z-edits
`handleDomZIndexReorderCommit` mutates `entry.element.style.zIndex`, persists with
`skipRefresh: true` (useElementLifecycleOps.ts:182,213), never calls `updateElement`
to sync store z. skipRefresh skips `reloadPreview()` (useDomEditCommits.ts:278-280) →
no rediscovery → store z stale. Next lane-drag: `normalizeToZones(candidate)` packs
from stale store z (`zOf`, timelineZones.ts:20,103) while `syncStackingForEdit` reads
fresh DOM z (timelineClipDragCommit.ts:188). Nothing else refreshes store z
(mergeTimelineElementsPreservingDowngrades only preserves identities; no MutationObserver).

### V3 (CONFIRMED per sub-path) — stale selectedElementIds
(a) Non-clearing single-select sites: useDomEditWiring.ts:178, AssetCard.tsx:143,
AudioRow.tsx:61, Timeline.tsx:539 (keyframe diamond). Store's setSelectedElementId
clears only activeKeyframePct/motionPathArmed (playerStore.ts:454-463).
TimelineLanes.tsx:418 is the correct pattern (clears set first).
(b) Consequences: Delete expands to stale set (useAppHotkeys.ts:295-297 →
useTimelineEditing.ts:501-509); drag engages group via multiKeys
(useTimelineClipDrag.ts:378 → timelineClipDragCommit.ts:104-105); canvas delete
(useElementLifecycleOps.ts:90,132) nulls primary but never clears the set.
(c) Escape (useTimelineRangeSelection.ts:413-414) clears the set but not the primary.
Sweep found a 5th trigger site: sidebar click (AssetCard/AudioRow) → Delete = silent
multi-clip data loss.

### V4 (CONFIRMED) — group move bypasses capabilities
`toMarqueeClips` carries only {id,start,duration,track} (useTimelineRangeSelection.ts:55-62);
zero `getTimelineEditCapabilities`/`canMove` checks across useTimelineClipDrag /
timelineClipDragCommit / timelineElementsMove (grep-verified). `buildPatchTarget` keys
off domId/hfId/selector only (timelineEditingHelpers.ts:17-38) while
`getTimelineEditCapabilities` returns canMove:false for timelineLocked/implicit
(timelineEditing.ts:290-296) → a locked clip in a marquee gets written start/track.
Old gate = main `04ddd411e`, dropped in reconciliation.

### V5 (CONFIRMED) — razor split un-rebased for expanded sub-comp children
Expanded child: `start` is master-timeline, `sourceFile` is the sub-comp file,
`expandedParentStart` = host's master start (useExpandedTimelineElements.ts:161-233).
TimelinePane rebases onMove/onMoveElements/onResize/onDelete/onSplit
(TimelinePane.tsx:80-146; handleSplitElement uses toLocalElement +
`Math.max(0, splitTime - basis)`), but razor bypasses TimelinePane: TimelineCanvas.tsx:41
pulls onRazorSplit straight from context; TimelineLanes.tsx:410 fires master-coord
clampedTime; useRazorSplit.ts:121-133 writes master coords into the sub-comp file.

### V6 (PLAUSIBLE) — readClipZIndex null→0
useTimelineStackingSync.ts:51 `return node ? readEffectiveZIndex(node) : 0`; candidate
set = ALL expanded elements, no same-file filter (timelineClipDragCommit.ts:183-191;
overlap filter is time-only). False z=0 requires an actual findElementForSelection miss
(nested/unmounted sub-comp node); resolution usually succeeds; synchronous read at
pointer-up weakens the reload-transient trigger.

### V7 (CONFIRMED) — trySingleZ over-patch
timelineStackingSync.ts:171-177 returns null when `minAbove - maxBelow < 2` without the
DOM tie-break; for b(z=3)/o(z=4, later in DOM): edited z=4 already paints correctly
(`paintsAbove` 86-89 confirms), but the cascade sets edited=4 AND liftAbove (191-203)
bumps o to 5 — an unnecessary authored-z mutation; domIndex IS available at the call site.

### V8 (PLAUSIBLE, harm-limited) — multi-file drop stale closure
useTimelineEditingDrops.ts:101 identical newElementZIndex for the batch; placement
ignores prior batch files. Neutralized in the normal path by
buildTimelineFileDropPlacements (timelineAssetDrop.ts:62-71) staggering starts
sequentially on one track — latent z-numbering inconsistency, no visible mis-paint.

### V9 (CONFIRMED) — cross-project asset preview bleed
assetPreviewStore doc-comment (lines 10-11) claims project-scoped clearing; nothing
clears on project change (NLEContext.tsx:99-101 resets player store ONLY; EditorShell
not keyed by projectId; overlay always mounted at PreviewPane.tsx:143; only
AssetCard.tsx:148/AudioRow.tsx:66 set it).

### V10 (CONFIRMED) — raw preview URLs
AssetCard.tsx:114, AudioRow.tsx:40 (`/api/projects/${projectId}/preview/${asset}` raw);
useCompositionStack.ts:87,103 (`/preview/comp/${resolvedPath}` raw) vs
useRenderClipContent.ts:113 which encodes the same comp src. Filenames provably contain
spaces/parens (AssetsTab fixtures; thumbnailUtils tests cover café / Screenshot / (v2)).
AssetPreviewOverlay.tsx:98 inline encoder copy = maintainability nit (functionally OK).

### V11 (PLAUSIBLE, defense-in-depth) — updateElement guard
playerStore.ts:464-469 spreads updates with no finiteness guard while siblings guard
(449/450/425/437). No live NaN producer: drag paths clamp+round upstream
(timelineEditing.ts:186; pps divide guarded). Also confirmed: single-clip commit persists
raw drag.previewStart while multi-clip rounds+clamps (timelineClipDragCommit.ts:121 vs
108/116) — same gesture, different normalization by selection size.

### V12 (CONFIRMED) — selection race
useDomSelection.ts:360 awaits buildDomSelectionForTimelineElement (genuinely async —
network probeSourceElement fetch, domEditingLayers.ts:294) then applies unconditionally;
NO seq/abort/cancelled guard anywhere in the file. Git: `1265702ed` ADDED
timelineSelectSeqRef with the exact race comment; `780b89aac` REMOVED it, no replacement.
Wired live via EditorShell.tsx:134.

### V13 (CONFIRMED) — multi-select resize regression
resolveTimelineGroupResize/Move (timelineGroupEditing.ts:98,132) have ZERO callers at tip.
Legacy hook useTimelineClipGroupDrag.ts (417 lines) deleted in 26f858b84; feature proven
by main commit 36413da7f "resize selected timeline clips together". New resize path
(computeResizePreview :181, commitResizePointerUp useTimelineClipDrag.ts:319-349)
is single-clip only. USER DECISION: RESTORE.

### V14 (downgraded/refuted parts) — duplication family
(a) 3 z-readers exist but the claimed semantic divergence input (`style.zIndex="abc"`)
is unreachable (CSSOM rejects invalid z-index → "") — maintenance, not correctness.
(b) overlaps/overlapsInTime byte-identical dup CONFIRMED; but timeRangesOverlap is NOT
dead (called internally at timelineCollision.ts:145 inside isLaneFree) and its exact-<
is documented-deliberate.

### V15 (CONFIRMED a/b/c) — chrome hot path
(a) RAF (useDomEditOverlayRects.ts:118/166) runs orientedOverlayRect every frame for any
single selection; rafPaused only mid-gesture; comment at :163 concedes rotation-0 ===
AABB; no rotation gate. (b) orientedOverlayRect computes computeOverlayRootScale TWICE
(:193 via toOverlayRect + :258 via elementCornerOverlayPoints) and reads
getComputedStyle/DOMMatrix twice (:121/:125 + :269/:277). (c) resize pointermove
WRITE(292)→READ(300)→READ(311)→WRITE(338)→READ(342) = 2-3 forced synchronous reflows.

### V16 (CONFIRMED a/b/c, caveats) — drag-frozen recomputation
(a) buildSnapTargets full rebuild per pointermove (collectTimelineSnapTargets: new Map,
scan all beats+elements, sort) — caveat: skipped when magnet toggle off. (b) audioTracks
Set allocated per move (timelineClipDragPreview.ts:81). (c) auto-scroll RAF reruns full
computeDragPreview per frame (useTimelineClipDrag.ts:210-229). No element/beat bound.

## B. Sweep (phase-3) — new finds
1. AssetCard.tsx:143 / AudioRow.tsx:61 → 5th stale-selection trigger (sidebar click then
   Delete = silent multi-clip loss).
2. timelineElementsMove.ts:139 syncTimelineMovePreviews: per-group soft-reload against
   the shared ROOT iframe → sub-comp scriptText applied to root, or null scriptText fires
   a clobbering second reloadPreview.
3. timelineElementsMove.ts:118: optimistic setDuration+patchIframeRootDuration never
   rolled back on write failure (caller reverts only start/track).
4. timelineClipDragCommit.test.ts:207: "no z-sync deps → no stacking side-effects" test
   has ZERO expect() calls.
5. canvasContextMenuZOrder.test.ts:258: `patches.every(p => p.zIndex >= 0)` is vacuous
   (always true by construction); the claimed "no no-op patches" invariant is untested.

## C. Slack-only reviewer findings (full text in the thread — permalink in header)

**Abhai must-fix (2 with executed repros):**
1. #2212 alone = NaN corruption: swapped Timeline resolves legacy-context onMoveElements
   (NLELayout passes no override); new engine sends {element,updates}, legacy
   handleTimelineGroupMove reads change.start → undefined → data-start="NaN" written AND
   persisted (buildTimelineMoveTimingPatch has no finiteness guard). Healed at #2213.
2. #2211 alone = phantom z-menu: StudioPreviewArea passes neither onApplyZIndex nor
   onDeleteSelection; menu opens ungated → optimistic z writes never persist; Delete
   silently no-ops. Healed at #2213. → REMEDY (endorsed by Rames + adopted): land
   #2211+#2212+#2213 as ONE UNIT.
3. #2198 cascade (EXECUTED): M z1 / N z0 / E; drag E → module returns [{key:"N",zIndex:1}]
   → N ties M and (later in DOM) paints above → unedited pair inverts; next normalize
   visibly reshuffles. liftAbove must cascade transitively.
4. #2195 empty-zone hole (EXECUTED): audio clip dropped on visual-only timeline over an
   occupied span → {track:0, insertRow:null} → stacked on occupied lane, violating the
   module's own no-overlap invariant. Fix the idx===-1 branch to signal insert.
5. #2202 renumber: overlap-scoped renumber (0..n-1) can drop a scoped sibling below a
   non-scoped one → untouched pair reorders. Zero coverage on the scoped path (jsdom
   rects 0×0 — mock getBoundingClientRect to test).
Abhai extras: CI trigger reality (ci.yml pull_request branches:[main] — heavy jobs
haven't run on #2193–#2216; local suites are the evidence: 1,759 keystone / 1,801 tip);
#2215 preview-regression PASSES at head (earlier red was a superseded run); #2205 regex
assumes attribute order (data-composition-id…data-duration — 26/26 authored comps
conform; hand-authored order-swap silently never extends); OBB corner math wrong-sized
under transformed non-root ancestor (safe fallback, edge case); #2209 deep-dive: shell's
callback bag drops onResizeElements/preview-patch callbacks whose consumers are deleted →
multi-select resize gone (flagged as possibly-unintentional feature regression — user
confirmed RESTORE); timeline eye-toggle lost per-element path (right-panel hide works);
#2209 688 lines zero tests; #2216 double-encode edge for pre-encoded hand-authored srcs;
#2192 beat-fallback misses TAG-only non-music; #2193 duration=NaN → seek(NaN) unguarded
on every-reload path; #2194 batch≠singles (FIXED in review round 1); #2196 end-edge snap
dead for non-ms durations; #2200 normalizeSrc vs deriveUsedPaths drift → badge/click
mismatch; #2204 NLEContext projectId lifecycle (mount-once fetch) + vacuous test.

**Rames deltas:** #2211 useDomSelection deletions (seq race guard — see V12; and
rightPanelTab==="variables" preservation removed → Variables-tab yank on canvas-select);
#2208 PreviewOverlays.tsx:960-969 silently drops sibling selections without stable
selector mid-persist (optimistic write already landed → siblings revert on reload);
#2208 useDomEditNudge:754 cleanup keyed on selection identity → spurious mid-burst
cleanups if parent doesn't stabilize the object; #2210 useProbedDuration orphaned network
fetch after unmount; #2205 setTimelineScale direct mutation bypasses set() (store-contract
nit; subscribe/DevTools blind); #2206 persistMoveEdits silent no-op if both handlers
absent + silent per-clip-race regression if only onMoveElement wired → add runtime warn;
#2209 handleMoveElements missing trackStudioExpandedClipEdit (telemetry gap). Asset-flicker
lens on #2214/15/16: CLEAN.

## D. What the review-round-1 wave already fixed (in the PRs as of last submit)
#2201 blocker (tests → #2211 via computeNextResizeAnchor); #2194 batch no-op parity +
Array.isArray guard + tests; #2192 tie-break docstring; #2198 epsilon comment; #2196
clip-edge>beat test; #2199 zone-identity test; #2200 nudge-gate reset; #2207 useEffect
for setTimelineScale + no-virtualization TODO; persistMoveEdits fire-and-forget doc note.
Replies posted on #2201/#2204/#2193/#2205/#2207/#2209 (GitHub).

## E. The 10 finder outputs
Preserved in this session's task transcripts only in summary form; the DEDUPED, VERIFIED
form above (A+B) is authoritative and strictly supersedes them. Angles run: line-by-line,
removed-behavior, cross-file tracer, TS/React pitfalls, wrapper correctness, reuse,
simplification, efficiency, altitude, conventions (3 minor as-cast notes, entrenched
house style — dropped). ~57 raw candidates → 16 verified clusters + 5 sweep finds →
15 reported findings (12 CONFIRMED / 3 PLAUSIBLE).
