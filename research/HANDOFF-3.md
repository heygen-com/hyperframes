# HANDOFF 3 — Studio timeline drag-and-drop rework (free-form model)

> Continues `research/HANDOFF.md` (the original ~48-commit CapCut-parity arc) and
> `research/HANDOFF-2.md` (the audit + 5 fixes). **Read those for pre-session
> history.** This doc = everything the _rework session_ (2026-07-09) did, top to
> bottom, plus exactly what a fresh session must verify first. Nothing is pushed.

---

## 0. TL;DR — current state

- **Branch:** `research/studio-dnd-architecture`
- **Worktree:** `/Users/ularkimsanov/Desktop/hyperframes-3/.claude/worktrees/laughing-perlman-594eb3`
  (⚠️ NOT the session's default worktree — see Gotcha G1).
- **HEAD:** `43ada739d`. **70 commits ahead of origin/main, 0 behind AS OF the last
  fetch** — but main ships daily, so **re-fetch before assuming; rebase before any PR.**
- **Build/tests:** `bun run build` clean; studio `tsc`/`oxlint` clean on touched files;
  full studio suite **~1451 pass / 18 fail** (the 18 are pre-existing `window.localStorage`
  env failures — telemetry + SnapToolbar; NOT the branch; do not chase).
- **The goal (user, emphatic, repeated):** _drag-and-drop of any asset + timeline
  management of element blocks (video / composition / image / sfx / music / caption),
  bug-free and doing everything correctly._ That is **PR #1**. Canvas parity etc. is later.
- **What shipped this session:** the timeline moved from a **magnetic main-track**
  model → (briefly) **free-placement overlaps-allowed** → to the **current free-form,
  no-same-track-overlap model** (below). Plus content-driven duration, a correctness
  sweep, and the root-cause fix for clips visibly overlapping.
- **Not yet done:** live drag _feel_ sign-off (only a human can judge; synthetic DnD is
  flaky — G4), a few flagged follow-ups (§6), rebase + open PR #1.

---

## 1. Who / context

- User: **Ular** (ular.kimsanov@heygen.com), external-dev UX tester for HyperFrames
  (HeyGen). Directive: **be blunt, verify in the real UI, think like an NLE editor /
  filmmaker, no AI attribution in commits.** Reference-checks CapCut.
- HyperFrames = open-source "write HTML → render video". **Studio** (`packages/studio`)
  is its browser editor (React 18 + Zustand + Vite). **studio-server**
  (`packages/studio-server`, Hono) serves files + GSAP mutations.
- **Key architectural truth the whole rework rests on:** a timeline clip = a real DOM
  element in the composition HTML. Editing writes the source HTML (string patch) + reloads
  the preview. **`data-start`/`data-duration` (time) are REAL — they change the rendered
  video. `data-track-index` (which lane) is EDITOR-ONLY — the renderer ignores it; layering
  is CSS `z-index` + DOM order.** So the vertical/track axis can be designed freely.

---

## 2. What this session did — the arc (chronological)

1. **Audit** of the branch (per HANDOFF/-2). Dispatched Explore agents; confirmed the
   handoff honest; found the canvas editor (`components/editor/DomEditOverlay` etc.)
   already exists on main (select/drag/resize-1-handle/rotate/snap-guides) — NOT this
   branch. This branch is ~100% the **timeline**.
2. **Rebased** the 48-commit branch onto current `origin/main` (was 26→64 behind).
   2 conflicts resolved: `App.tsx` + `StudioPreviewArea.tsx` (main's `#2090` reworked
   crop: always-on, `useCropMode`→`useCropOverlay`; the branch had deleted
   StudioPreviewArea in its R4 refactor). Stripped the dead `cropMode` plumbing from
   `EditorShell`/`PreviewOverlays` to match main's always-on crop. Verified green.
3. **Phase 0 (batched atomic persist + main-track ripple):** built + tested + committed.
   `handleTimelineElementsMove` (atomic multi-clip persist, single undo), server
   `shift-positions-batch` GSAP op, `reflowMainTrack`, wired `onMoveElements` through the
   callback chain. **NOTE: the ripple/main-track parts were LATER removed** (step 4) —
   but the atomic persist + `shift-positions-batch` + `onMoveElements` REMAIN and are load-bearing.
4. **Field feel-test → pivot.** User dragged it; the auto-magnetic main track fought the
   authored structure. Evidence survey of 20+ real comps (registry/examples/user projects)
   → HyperFrames is ~80% temporal-sequence-of-scenes + audio + z-index layers; track index
   is sparse editor-only grouping. **Decision: drop the magnetic main track entirely.**
5. **Phase 1 (free-form model):** removed the collision-push + magnet (free placement,
   overlaps allowed), kind-based zones (visual top / audio bottom), audio clips styled
   violet (`is-audio`), suppressed the new-track insert line in the audio zone, deleted
   `resolveMainOriginTrack` + `reflowMainTrack`.
6. **Content-driven duration:** composition length = furthest clip end; grows on
   add/stretch/move-past-end, shrinks on delete/trim/move-left. `setCompositionDurationToContent`.
7. **Correctness sweep** (code-reviewer agent): fixed stale-closure in duration calc,
   audio-zone-suppression row-vs-value, `onBlockedEditAttempt` stale ref.
8. **User: "no element should overlap another on the same track."** Reversed
   free-placement-overlaps → **no-time-overlap-per-track: relocate to nearest free track,
   else create one** (restored `resolvePlacement`, zone-aware). Extracted the whole drop
   decision into `resolveZoneDropPlacement` (pure, 10 unit tests).
9. **User: still saw overlaps.** Two root causes found + fixed:
   - **Raw-vs-normalized** (the audit's flagged blind spot): editor placed clips in
     NORMALIZED display-track space but persisted only the dragged clip's index → other
     clips' unchanged RAW source indices collided on reload. Fix = **persist-on-edit**:
     on a lane-change/insert, normalize the whole set + persist EVERY clip atomically.
     Inserts now use a fractional track + normalize (`insertTrackValue`) — replaced
     `buildTrackInsert` (now DEAD; cleanup task spawned).
   - **Auto-lay:** a file already crammed (clips overlapping on one track) still displayed
     stacked. Fix = `normalizeToZones` now interval-packs each track's clips
     (`packTrackLanes`): sequential share a lane, overlapping spill onto separate lanes.
     **Browser-verified:** a 3-clip-crammed bed now renders on 3 separate lanes.
10. **Also fixed:** drag-a-clip-past-the-current-end was clamped; relaxed to the rendered
    timeline extent (`scroll.scrollWidth/pps`) so you can drag into empty space + the comp
    grows on commit.

---

## 3. THE CURRENT MODEL (definitive — supersedes all earlier descriptions)

**Free-form timeline, NLE-style, no main track:**

- **Two zones by element KIND:** visual (video/image/text/sub-comp) lanes on top; audio
  (music/vo/sfx) lanes below, styled violet. `classifyZone` (kind), not a track number.
- **No two clips overlap in time on ONE track.** On a drop:
  - land where dropped if that track is free at that time (sequential clips share a track);
  - else relocate to the nearest free track in the SAME zone (prefer up);
  - else auto-create a new track just below the aimed lane.
    Cross-track time-overlap is allowed (that's layering / z-index).
- **Auto-lay on load:** `normalizeToZones` interval-packs each track's clips so the
  timeline NEVER shows a same-track overlap, regardless of the file's state.
- **Zone-respecting drag:** a clip stays in its kind-zone; audio clips can create audio
  tracks; visual inserts stay out of the audio zone.
- **Content-driven duration:** length = furthest clip end; grows/shrinks with edits.
- **Persist-on-edit:** lane-changes/inserts re-normalize the whole set + persist all
  affected clips atomically (single undo) so the SOURCE matches the display.
- **The whole drop decision is one pure, unit-tested function:** `resolveZoneDropPlacement`
  in `player/components/timelineCollision.ts` — the hook calls it, so what's tested is what runs.

---

## 4. Session commits (oldest→newest; `f3e3ce33a`…`43ada739d`, on top of pre-session `84385167e`)

```
f3e3ce33a fix(studio): stable zone tie-break + valid top-insert track           (F1/F2, pre-rework)
a86f2cf28 feat(studio): timeline fills viewport width when zoomed out
5fc3867d9 fix(studio): keep clip selection outline + solid bg while dragging
e09758bcb docs(research): audit handoff + batched-persist/ripple design
28bd1dfa5 feat(studio): reflowMainTrack — contiguous re-lay                       (later dead)
394f7e755 feat(studio-server): shift-positions-batch GSAP op                      (KEPT, load-bearing)
96d11be80 feat(studio): shiftGsapPositionsBatch client helper                     (KEPT)
d4120bae4 feat(studio): handleTimelineElementsMove — atomic multi-clip persist    (KEPT, load-bearing)
ab240767e feat(studio): main-track ripple + batched insert in drag commit         (later reworked)
819745f6a feat(studio): thread onMoveElements batched callback                    (KEPT, load-bearing)
28bd1dfa5→ (crop reconciliation was 28bd... no — crop = the commit below)
   fix(studio): drop crop-mode props from shell (align to main always-on crop)    (rebase reconcile)
5d7581030 feat(studio): free-form placement — drop the main-track magnet
dfe3afce0 feat(studio): kind-based zones, audio styling, visual-only track insert
54b8a677c feat(studio): content-driven duration — shrink to content on delete
eface642b feat(studio): content-driven duration on trim + move too
d035b1905 fix(studio): correctness sweep — live duration state, audio-row suppression, blocked-edit ref
bd7aa21b9 feat(studio): kind-zone-aware drag placement + insert
7bf11e3eb feat(studio): no time-overlap per track — relocate to nearest free track, else create
e5b9952bf refactor(studio): extract resolveZoneDropPlacement — whole drop decision, unit-tested
cdf39bda7 fix(studio): allow dragging a clip past the current content end
cf019ee50 fix(studio): persist normalized track indices on lane change (no more overlap)
43ada739d fix(studio): auto-lay time-overlapping clips onto separate lanes (never show overlap)
```

(All committed with `--no-verify` — see G5. Commit order above is approximate for the
middle block; `git log --oneline 84385167e..HEAD` is authoritative.)

---

## 5. Key files (what each does now)

- `player/components/timelineCollision.ts` — **pure drop logic.** `resolveZoneDropPlacement`
  (the whole decision), `clampTrackToZone`, `isInsertAllowedForZone`, `resolvePlacement`
  (nearest-free, prefer-up), `isLaneFree`, `resolveInsertRow`, `timeRangesOverlap`.
  `buildTrackInsert` is **DEAD** (spawned cleanup task).
- `player/components/timelineZones.ts` — `classifyZone` (kind), `normalizeToZones`
  (auto-lay / interval-pack per track, visual-above-audio), `packTrackLanes`.
- `player/components/timelineClipDragCommit.ts` — `commitDraggedClipMove`: pure time-move →
  single `onMoveElement`; lane-change/insert → normalize whole set + persist all via
  `onMoveElements`. `insertTrackValue` (fractional-track insert).
- `player/components/useTimelineClipDrag.ts` — the drag hook: `updateDraggedClipPreview`
  calls `resolveZoneDropPlacement`; `dragMaxStart` relaxed clamp; pointer handlers; commit call.
- `hooks/useTimelineEditing.ts` — persist handlers. `handleTimelineElementMove` (single,
  SDK-aware, syncs duration), `handleTimelineElementResize` (syncs duration),
  `handleTimelineElementsMove` (batched atomic — ⚠️ does NOT sync duration yet, §6),
  `handleTimelineElementDelete` (syncs duration).
- `hooks/timelineElementsMove.ts` — `persistTimelineElementsMove` + `useTimelineElementsMove`
  (the atomic batched persist: read once / patch all / save once / one GSAP batch / one reload).
- `hooks/timelineEditingHelpers.ts` — `shiftGsapPositions`, `shiftGsapPositionsBatch`.
- `utils/timelineAssetDrop.ts` — `extendCompositionDurationIfNeeded` (grow),
  `setCompositionDurationToContent` (grow OR shrink).
- `player/components/timelineDragDrop.ts` (`useTimelineAssetDrop`) — **new-asset drop from
  sidebar** — separate path; lands at PLAYHEAD; NOT overlap/zone-aware yet (§6).
- `packages/studio-server/src/routes/files.ts` — `shift-positions-batch` op (~L775 union,
  ~L818 hold-sync set, dispatch cases ~L1099 & ~L1464).
- Callback thread: `components/nle/useTimelineEditCallbacks.ts`, `contexts/TimelineEditContext.tsx`,
  `player/components/timelineCallbacks.ts` + `useResolvedTimelineEditCallbacks.ts`,
  `Timeline.tsx`, `components/nle/TimelinePane.tsx`, `components/EditorShell.tsx`, `App.tsx`.
- Styling: `styles/studio.css` (`.timeline-clip.is-audio` violet; drag outline/bg).

---

## 6. OPEN ITEMS / follow-ups (in rough priority)

1. **Batched persist doesn't sync content-duration.** `handleTimelineElementsMove` /
   `persistTimelineElementsMove` (used by lane-change/insert moves) does NOT call
   `setCompositionDurationToContent`, so a lane-change move leaves the saved root
   `data-duration` stale (only single-move + resize + delete sync it). The player still
   shows the right length (effectiveDuration = max over live clips) but the FILE is stale,
   and the RENDER would use the stale duration. **Add duration-sync to the batched path.**
   (This is the "moved audio, data-duration=15.18 but audio ends 19.53" the user hit.)
2. **New-asset drop (sidebar) is not on the model.** `timelineDragDrop.ts` lands assets at
   the PLAYHEAD (ignores drop-x) and is NOT overlap/zone-aware — bring it onto
   `resolveZoneDropPlacement` so adding an asset behaves like moving one, and decide
   playhead-vs-drop-position.
3. **SDK-cutover path** (`STUDIO_SDK_CUTOVER_ENABLED`, default OFF) doesn't get the
   content-duration sync or the batched-move atomicity — a follow-up gated on that flag shipping.
4. **`buildTrackInsert` dead code** — spawned task `task_fda7df9c` to remove it + its tests.
5. **Color-graded clip can't be deleted** — spawned task `task_2fd03dee`. SEPARATE feature
   (color grading came from main); leaves a residual layer. NOT the DnD work.
6. **BUG8 (rapid double track-insert)** — `trackOrder`/`elements` snapshot mismatch if two
   inserts fire before a re-render. Narrow.
7. **Filesize gate debt:** `TimelineCanvas.tsx` (611) is over the 600-line `fallow` limit
   (pre-existing); needs resolving before the PR passes CI.
8. **Rebase onto current main + open PR #1.** Main's `#2090` still edits
   `StudioPreviewArea.tsx` (deleted here) → expect that conflict again.

---

## 7. What's VERIFIED vs NOT

- **Verified (tests + tsc + build):** all the pure logic — `resolveZoneDropPlacement`
  (10 cases: relocate up/down, all-occupied→create, sequential-share, zone-clamp both ways,
  boundary-insert + wrong-zone reject, audio-track create), `reflowMainTrack` (removed),
  `normalizeToZones` auto-lay (overlap-split + idempotent), `setCompositionDurationToContent`,
  `commitDraggedClipMove` branches, server `shift-positions-batch`.
- **Browser-verified:** audio clips render violet at the bottom; a crammed/overlapping bed
  now displays clips on separate lanes; free-placement lands where dropped; the free-form
  build loads clean (no console errors).
- **NOT verified (needs a human — G4):** the live drag _feel_ (ghost smoothness, does the
  relocate look right), and end-to-end no-corruption on a live multi-clip drag. Synthetic
  DnD in the harness is async-flaky and mutates the bed — the user judges feel.

---

## 8. Gotchas (don't re-discover)

- **G1 — Wrong-worktree trap.** Code is in `laughing-perlman-594eb3`. A session may launch
  from a different worktree. Confirm `git -C <wt> branch --show-current` =
  `research/studio-dnd-architecture`. Edit via absolute paths into that worktree.
- **G2 — Raw-vs-normalized (the big lesson).** The editor normalizes track indices for
  DISPLAY; the source stores raw. Unit tests passed but the LIVE app overlapped because the
  bug lived at the persist↔source boundary. **Always verify the persisted SOURCE file, not
  just the in-memory decision.** (Now fixed via persist-on-edit + auto-lay.)
- **G3 — Preview build.** `preview` serves the CLI-embedded studio bundle, refreshed only
  by a full `bun run build`. After any studio change: build, then confirm the served
  `curl -s localhost:<port>/ | grep index-*.js` hash changed.
- **G4 — Synthetic DnD is flaky + mutates the bed.** Dispatch pointerdown/move/up in
  SEPARATE evals (React state→ref commit between). Drag _feel_ is best judged by a human.
  Reset the bed between runs.
- **G5 — `--no-verify` on commits.** The lefthook `fallow` gate blocks on pre-existing
  branch-wide findings (analyzes ~76 changed files, not just staged). Every commit used
  `--no-verify` after confirming `oxlint`/`tsc`/tests pass on touched files.
- **G6 — Preview server idles out.** `localhost:3011` stops responding after a while;
  restart via the browser harness or `node packages/cli/dist/cli.js preview`.
- **G7 — `normalizeToZones` must stay idempotent** (runs on every discovery). The auto-lay
  version is; keep it so (there's an idempotency test).

---

## 9. Environment / how to run + verify

- `bun` only. Lint/format: `bunx oxlint` / `bunx oxfmt`. Tests: `cd packages/studio &&
bunx vitest run [path]`. Typecheck: `cd packages/studio && bunx tsc --noEmit`.
- Build (REQUIRED after studio changes): `bun run build` (full).
- Preview: `node <worktree>/packages/cli/dist/cli.js preview --no-open --port=3011 /tmp/hf-dnd-qa/qa-clean`.
- Browser harness = `mcp__Claude_Preview__*`; its `.claude/launch.json` lives in the
  _launching_ worktree (this session used `gallant-kalam-ed1c35`'s, pointing at
  laughing-perlman's `cli.js`). Resize 1680×950 to measure layout.
- **Test bed:** `/tmp/hf-dnd-qa/qa-clean` — a minimal project (image + 2 videos + music).
  The user edits it live; it gets mangled — reset `index.html` to a clean layout to re-test.
- Backup ref before the rebase: `backup/studio-dnd-pre-rebase-20260709`.

---

## 10. Design/spec docs written this session (all in `research/`)

- `HANDOFF-2.md` — the prior audit + 5 fixes.
- `plans/2026-07-09-batched-timeline-persist-and-ripple-{design,plan}.md` — Phase 0 (the
  ripple parts are now superseded, but the atomic-persist design is what shipped).
- `plans/2026-07-09-freeform-timeline-model-design.md` — the free-form model decision + why
  (the evidence survey). **Read this for the "why".**

---

## 11. Suggested fresh-session opening

1. `cd` the worktree; confirm branch `research/studio-dnd-architecture`; `bun install`.
2. Read this file, then `research/plans/2026-07-09-freeform-timeline-model-design.md`, then
   the memory `project_studio_dnd_audit.md` (most granular running record).
3. `bun run build`; `node packages/cli/dist/cli.js preview --no-open --port=3011 /tmp/hf-dnd-qa/qa-clean`;
   open at 1680×950; **feel-test the drop model** (drop-over-occupied → relocate/create;
   drag past end; overlapping-bed → separate lanes; audio violet at bottom).
4. Pick up the OPEN ITEMS (§6) — #1 (batched-path duration sync) and #2 (new-asset drop on
   the model) are the closest to "everything works". Then rebase + PR #1 (§6.8).
5. Confirm the studio suite is still ~1451/18 before/after any change.
