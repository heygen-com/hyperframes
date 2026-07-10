# Rebase Report — `research/studio-dnd-architecture` onto `origin/main` (2026-07-09)

STAGE 1 of the approved plan. Policy: **OUR ENGINE IS THE BASE.**

- Worktree: `/Users/ularkimsanov/Desktop/hyperframes-3/.claude/worktrees/laughing-perlman-594eb3`
- Backup branch (pre-rebase tip): `backup/studio-dnd-pre-rebase-20260709-v2` @ `e3d88c6a0`
- Merge base (before): `7174e9337`
- New base (after): `a8f242e61` (`origin/main`, PR #2112 — main had advanced from 98→117 behind since the plan doc was written)
- Result: **104 commits ahead / 0 behind** `origin/main`
- Rebased tip: `0fcbe1f99` (history rewritten by the rebase; one post-rebase fixup commit added on top — see §5)

---

## Executive summary

- **Rebase completed.** All 27 `packages/studio` intersection-conflicts auto-resolved to OURS (the four hairy engine files verified byte-identical to the pre-rebase backup). Zero non-studio conflicts.
- **Gates:** `packages/studio` `tsc --noEmit` **exit 0**; `bun run build` **exit 0**; studio `vitest run` → **1700 pass / 18 fail / 18 todo**, where **all 18 failures are the pre-existing `localStorage`-env issue** flagged in the task (telemetry + SnapToolbar), reproduced identically on `origin/main`. **Zero reconciliation failures remain.**
- **Semantic reconciliation was the real work.** The raw rebase left the tree non-compiling (91 tsc errors) because git textually auto-merged main's parallel #2111 (multiselect) and #2068 (z-order) hunks into our engine glue files. Resolving to a coherent OUR-engine tree required deleting main's orphaned #2111 island and restoring six engine-glue files + three test files to OURS.
- **Bonus:** main's **Variables / promote** feature and **LayersPanel** auto-merged cleanly into our shell and compile + wire live (COMPARE-CANVAS had budgeted this as a stage-2 re-port; it is already integrated).
- **Nothing needs a human decision to proceed.** Two main files are dead-but-preserved (stage-2 port inputs); one product fork (vertical-drag semantics) is deferred to stage-2 exactly as the COMPARE docs recommend.

---

## §1 Safety / setup

- `git branch backup/studio-dnd-pre-rebase-20260709-v2 HEAD` created (a prior `-v2`-less backup already existed from an earlier attempt; the `-v2` is this run's).
- Tracked tree was clean apart from three `packages/producer/node_modules/**` puppeteer **symlink** targets (mode 120000) changed by the `@puppeteer/browsers` bump — the known regenerable-install noise. Discarded with `git checkout --` before rebasing; tracked tree then fully clean.
- Not detached; on `research/studio-dnd-architecture`.
- `git fetch origin main` → `3fd340f6b..a8f242e61`.

## §2 Rebase mechanics

Rebased **in this worktree** (all other agents done, per the task's allowance). Chose `git rebase origin/main` (linear, rewrites the 104 commits) over a temp-worktree fast-forward — simpler and the worktree was free.

The 104 commits are heavily interleaved, so the four hairy engine files conflict repeatedly across intermediate commits. Resolved with a scripted loop that, at every stop, takes **`--theirs`** (= the replayed OUR commit) for every conflicting `packages/studio/*` path and `git rm`s `StudioPreviewArea.tsx`, and **aborts on any non-`packages/studio` conflict** (none occurred). This replays our branch's own per-commit evolution while guaranteeing every studio conflict lands on OURS. Non-conflicting hunks (main's clean additions) auto-merged normally.

## §3 Per-conflict resolution decisions

### 3(a) The four hairy engine files → OURS wholesale (verified)

`TimelineCanvas.tsx`, `useTimelineEditing.ts`, `useTimelineClipDrag.ts`, `Timeline.tsx` — all four verified **byte-identical to the pre-rebase backup** after rebase. Re-application of main's non-DnD deltas to these files was **not needed**: main's only changes to these files were its parallel DnD/z-order engine (the exact thing we replace), and its **non-DnD** correctness work landed in _other_ files (see 3(d)) that merged cleanly.

### 3(b) `StudioPreviewArea.tsx` modify/delete → kept DELETED

Our branch deletes it (the `nle/` + `EditorShell` shell owns the preview); main modified it. Kept deleted. Crop re-verified against main's latest: `useCropOverlay.ts` and `domEditOverlayCrop.ts` are **identical on both sides** and untouched by our branch (main's versions land clean); `DomEditCropHandles.tsx` was modified by OURS only (clean auto-merge). Crop mounts through our shell via `DomEditOverlay` (`useCropOverlay`, `cropOutlineInsetPx`, `canCrop`), so main's always-on crop rework functions unchanged through the shell — the branch's earlier "drop crop-mode props from shell" reconciliation still holds.

### 3(c) Main's NEW non-colliding files

**Landed AND wired live (bonus — beyond COMPARE-CANVAS's stage-2 expectation):**

- `components/panels/Variables*.tsx`, `DesignPanelPromoteProvider.tsx`, `editor/PromotableControl.tsx`, variables store/persist — auto-merged into `StudioRightPanel.tsx` (7 refs) and `propertyPanelSections.tsx`; compiles (tsc 0) and reachable.
- `components/editor/LayersPanel.tsx` — wired via `StudioRightPanel.tsx`.
- `player/components/timelineStacking.ts` — consumed by our own `timelineDropIndicator.ts` / `timelineTrackOrder.ts`.
- Runtime z-order payload in `packages/core` (`readInlineZIndex`, `zIndex`, `stackingContextId` on `types.ts` + `timeline.ts`) — correctly co-exists with our removal of `normalizeTrackAssignments` (both present in the auto-merged `core/src/runtime/timeline.ts`).

**Landed but DEAD (unwired) — preserved as stage-2 port inputs:**

- `player/components/TimelineLayerGutter.tsx` — 0 importers (our `TimelineCanvas` renders its own gutter). Main's music-icon + stacking-context group-header gutter; port target for COMPARE-TIMELINE adoption item #1/#2.
- `player/components/timelineLayerDrag.ts` — 0 importers (its consumer was main's `TimelineCanvas`/the removed island). Main's vertical-drag-as-z-index-reorder; the core product fork (see §Open).

Both compile in isolation, so they don't break the gate; they simply aren't reachable yet.

**Removed — main's #2111 orphaned multiselect island** (OURS wins; nothing in our live shell imports them; our engine replaces their function):

- `player/components/useTimelineClipGroupDrag.ts`, `hooks/useTimelineGroupEditing.ts`, `player/components/useTimelineMarqueeSelection.ts`, `player/components/timelineClipDragPreview.ts`, `player/components/TimelineSelectionOverlays.tsx`.
- Rationale: these import `resolveTimelineGroupMove`/`selectTimelineElementsInMarquee` and a `GroupTimingMember`/`setSelection` shape from main's `timelineEditing`/`playerStore` that our engine does not export. They form a closed island whose only external importer was our OUR `timelineCallbacks.ts` **only via a bad textual auto-merge** (our backup `timelineCallbacks.ts` does not import them). Our marquee/group behavior is covered by our own modules (`timelineMarquee`, `timelineMultiDragPreview`, `useTimelineRangeSelection`) with passing tests.

**Engine-glue files corrupted by main auto-merge hunks → restored to OURS:**

Git textually merged main's #2111/#2068 additions into these OUR files, producing duplicate declarations / references to non-exported symbols. All restored to the pre-rebase backup:

- `player/components/timelineCallbacks.ts` (main added a duplicate `onMoveElements` + `TimelineStackingReorderIntent` import + island import)
- `player/lib/timelineDOM.ts` (main added a z-order block populating `zIndex`/`stackingContextId` on `TimelineElement`, which our type doesn't declare)
- `player/hooks/useExpandedTimelineElements.ts` (referenced `stackingContextId`/`compositionAncestors`)
- `hooks/useDomSelection.ts`, `hooks/useDomEditWiring.ts`, `player/components/TimelineClipDiamonds.tsx`
- `contexts/TimelineEditContext.tsx` (referenced main callback names `onResizeElements`/`onPreviewMoveElements`/`onToggleElementHidden` absent from our `TimelineEditCallbacks`)

### 3(d) Everything outside `packages/studio`

Policy = take MAIN. Reality: three shared files carry OUR studio-supporting changes that main did **not** touch (so there was no conflict — our deltas simply survived as the branch's own work, and are load-bearing for the studio engine). Per the plan's "non-studio stragglers" note, these are **kept**:

- `packages/studio-server/src/routes/files.ts` (+`files.test.ts`) — our `shift-positions-batch` mutation, consumed by `timelineEditingHelpers.ts` (batch move). Load-bearing.
- `packages/core/src/runtime/timeline.ts` — our removal of `normalizeTrackAssignments` (track-renumbering broke "drop onto existing track"); correctly **co-merged** with main's z-order additions (both present). Kept.
- `.fallowrc.jsonc` — see §5 (one stale entry removed).

All other non-studio files match `origin/main` exactly.

## §4 Gate outputs (verbatim)

**`bun install`** (after rebase, before build):

```
Checked 801 installs across 980 packages (no changes) [221.00ms]
```

**`cd packages/studio && bunx tsc --noEmit`** → exit **0** (no output). (Pre-reconciliation this reported 91 errors across 13 files; see §3.)

**`bun run build`** (repo root) → exit **0**. Tail:

```
@hyperframes/studio build: Exited with code 0
@hyperframes/cli build: Exited with code 0
```

`packages/core/dist/variables.js` produced (the `@hyperframes/core/variables` subpath 7 SDK suites need at runtime).

**`cd packages/studio && bunx vitest run`** → new baseline:

```
Test Files  3 failed | 152 passed | 1 skipped (156)
     Tests  18 failed | 1700 passed | 18 todo (1736)
```

**oxfmt --check** (touched files, incl. `.fallowrc.jsonc`) → `All matched files use the correct format.` exit 0.
**oxlint** (touched files) → `Found 0 warnings and 0 errors.` exit 0.

## §5 Test-baseline changes (justification per adapted/removed test)

Pre-reconciliation the rebased tree had 34 failing tests in 14 files. After reconciliation: **18 fail / 1700 pass** (pass count rose from 1552 pre-reconciliation as main's compatible tests merged in and pass against our engine).

**Removed (targets code OURS replaced):**

- `player/components/timelineMarqueeSelection.test.ts` (main-only, 3 tests) — tested `selectTimelineElementsInMarquee` from the removed #2111 island. Our marquee is covered by our own `timelineMarquee.test.ts` (passing). No coverage of OUR engine lost.
- `hooks/useTimelineEditing.test.tsx`, `player/components/useTimelineClipDrag.test.tsx`, `player/components/useTimelineMarqueeSelection.test.tsx` (all main-only) — removed with the island source; they exercise main's group-drag/marquee/selection API our engine doesn't expose.

**Restored to OURS (main test hunks had been auto-merged in, targeting main's replaced API):**

- `player/store/playerStore.test.ts` — HEAD had 10 `setSelection` refs (main's API); our `playerStore.ts` source (== backup) exposes no `setSelection`. Restored to our version.
- `hooks/useDomSelection.test.ts` — HEAD had a main `selectedElementIds`-mirror test expecting the multi-id set API. Restored.
- `player/lib/timelineDOM.test.ts` — HEAD had 13 `zIndex`/`hasExplicitZIndex` assertions (main's #2068); our `timelineDOM.ts` doesn't populate those. Restored.

No OUR test was weakened; every removal/restore either deletes a test for deleted main code or reverts a test file to the version that matches our (base) engine.

**Pre-existing failures (NOT introduced here; unchanged obligation):** the remaining **18** are the `localStorage`-not-available vitest-env issue (`--localstorage-file` not passed):

- `telemetry/client.test.ts` (7) and `telemetry/distinctId.test.ts` (8) — **byte-identical to `origin/main`**; fail on `localStorage.clear()`.
- `components/editor/SnapToolbar.test.tsx` (3) — our file (SnapToolbar is OUR feature; main lacks it), identical to our backup; same `window.localStorage.clear()` env failure, not a logic regression.

These fail on both sides and are environmental, exactly as the task anticipated.

## §5b Post-rebase fixups

The rebase rewrote the 104 commits (each retains its original message; no AI attribution added anywhere, per convention). The reconciliation above was committed as a **single post-rebase fixup commit** on top (deletions + restores + the `.fallowrc.jsonc` cleanup), using `--no-verify` (branch convention, due to the fallow gate).

`.fallowrc.jsonc`: removed one stale allow-unused-export entry for `packages/studio/src/player/components/timelineDropPreview.ts::DEFAULT_DROP_PREVIEW_DURATION` — that file was deleted during the branch's pivot rounds and no longer exists in HEAD, so the entry pointed at nothing (dead config that would confuse the fallow audit).

**Not pushed.**

## §6 Open items / stage-2 inputs (no blocker for stage 1)

- **Dead-but-preserved main files:** `TimelineLayerGutter.tsx`, `timelineLayerDrag.ts` — inputs for the COMPARE-TIMELINE adoption list (music icon, stacking-context headers, z-order-on-vertical-drag).
- **The one genuine product fork (deferred, as the COMPARE docs recommend):** vertical-clip-drag semantics — OURS = _move to another track/lane_ (zone/collision, no overlap); MAIN = _reorder z-index within a stacking context_ (overlap allowed). Mutually exclusive as the default gesture. COMPARE-TIMELINE's recommendation stands: keep OURS's lane model as the default and re-surface MAIN's z-order as an explicit LayersPanel/modifier action in stage 2. **No decision required to complete stage 1.**
- **Bonus already integrated:** main's Variables/promote stack + LayersPanel merged live into our shell (COMPARE-CANVAS had scoped these as a stage-2 re-port; they compile and wire now — worth a manual smoke in the running studio during stage 2, but they are not dead).
