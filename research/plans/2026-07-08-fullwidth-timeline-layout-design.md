# Design — Full-Width Timeline Layout (R4)

> Design doc for the editor-shell restructure that moves the Studio timeline to a
> full-width row at the bottom, with `[left sidebar | preview | right panel]` above it
> (classic CapCut / Premiere layout).
>
> Brainstormed 2026-07-08. Approach approved by the user; this is the validated design,
> handed to `writing-plans` next. Gap ref: this is item **R4** in `research/HANDOFF.md` §6.

## 1. Goal

Restructure the Studio editor shell so the timeline spans the **full width at the very
bottom**, and the left sidebar, preview, and right panel sit **above** it as a horizontal
row. Today the timeline is nested inside the center column (`NLELayout`) beside both
sidebars, so the left sidebar spans the full height down past the timeline.

## 2. Non-goals / hard boundaries

- **No change to any timeline interaction behavior.** This is the load-bearing constraint.
  Drop handling (file / asset / block), clip move / resize / split, snapping + magnet
  toggle, the drag ghost, the edit context, drill-down, keyframe diamonds — all keep their
  **exact current code paths**. They are _relocated_, never _altered_. Acceptance bar:
  every interaction behaves byte-identically after the restructure, verified live.
- No feature flag. We **replace the layout outright** (user decision). No dual layout paths.
- Not R1 (ruler restyle), R2 (CapCut drag physics), or R3 (variable track heights). Those
  are separate, follow R4, and are where the real interaction _polish_ happens. R4 only
  gives them the correct container.
- No rebuild of timeline rendering (DOM/CSS approach stays), no virtualization.

## 3. Why this needs a restructure (the crux)

The preview and the timeline currently live stacked inside one `NLELayout`, which owns the
state they **both** depend on:

- `useTimelinePlayer()` — holds **component-local refs**: `iframeRef` (the preview iframe
  binds to it) plus all seek / shuttle / RAF refs; installs `window` keyboard + `message`
  listeners once on mount; returns `seek` / `togglePlay` / `refreshPlayer` / `onIframeLoad`.
  Playback _values_ live in the global `usePlayerStore` (Zustand) and are already shared,
  but these bound outputs are per-instance. **The hook must be called exactly once.**
- `useCompositionStack()` — holds local `compositionStack` / `compIdToSrc` / `masterSeekRef`
  state driving drill-down + breadcrumb.

To make the timeline a full-width sibling in a different row from the preview, that shared
state must be **lifted above both rows** into a provider. Chosen mechanism: React context
(idiomatic here — the shell already uses `StudioShellProvider`, `DomEditProvider`,
`PanelLayoutProvider`, `TimelineEditProvider`).

Approaches considered: (A) lift to an NLE context provider — **chosen**; (B) `createPortal`
the timeline into a bottom container — rejected: portaling a large stateful interactive
region invites fullscreen / focus / window-listener event-bubbling bugs; (C) prop-drill the
hook return — rejected: verbose vs. the context the codebase already models.

## 4. Architecture

New component tree (replaces the current horizontal `<div flex flex-1>` block in `App.tsx`):

```
App.tsx
  <EditorShell left={<StudioLeftSidebar/>} right={<StudioRightPanel/>} …props>
    <NLEProvider>                       // calls useTimelinePlayer() + useCompositionStack()
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex flex-row flex-1 min-h-0">   // TOP ROW
          {left}                        // StudioLeftSidebar (slot)
          <PreviewPane/>                // flex-1 min-w-0
          {right}                       // StudioRightPanel (slot, when not collapsed)
        </div>
        <TimelineResizeDivider/>        // resizes timeline vs. the whole top row
        <TimelinePane/>                 // flex-shrink-0, height = timelineH, FULL WIDTH
      </div>
    </NLEProvider>
  </EditorShell>
  <StudioOverlays/>                     // stays a sibling of EditorShell, unchanged
```

### Components (each: responsibility / interface / dependencies)

- **`NLEProvider` (new)** — _responsibility:_ own the shared player + composition-stack
  state and expose it. Calls `useTimelinePlayer()` and `useCompositionStack()` once; owns
  `timelineH` (+ persistence), `compositionLoading`, `previewCompositionSize`, fullscreen
  state, and the expanded-clip-rebasing edit wrappers (`handleMoveElement` / `Resize` /
  `Delete` / `Split` — moved verbatim from `NLELayout`). _Interface:_ `NLEContext` value
  (`iframeRef`, `seek`, `togglePlay`, `refreshPlayer`, `onIframeLoad`, composition stack +
  drill-down, `timelineH` setters, loading, wrapped edit handlers). _Depends on:_
  `usePlayerStore`, the two hooks, `studioUiPreferences`.
- **`PreviewPane` (new)** — _responsibility:_ render the preview and everything visually
  over/under it. The preview iframe (`NLEPreview`), `CompositionBreadcrumb`,
  `PlayerControls`, and the `previewOverlay` content (DomEditOverlay / CaptionOverlay /
  SnapToolbar / MotionPathOverlay — relocated from `StudioPreviewArea`). Owns
  `usePreviewBlockDrop` + the preview drag-over affordance. _Fullscreen:_ the button targets
  **this pane's container** → browser fullscreen shows the preview only (user decision).
  _Interface:_ consumes `NLEContext`; keeps the same overlay props it has today.
- **`TimelinePane` (new)** — _responsibility:_ the full-width timeline. Timeline toolbar
  slot + `<Timeline>` + caption footer + the composition-loading disabled overlay, wrapped
  in `TimelineEditProvider`. The big keyframe-callbacks `useMemo` (`timelineEditCallbacks`)
  **moves here** from `StudioPreviewArea` (it consumes `DomEditActionsContext`, a provider
  above — unaffected). _Interface:_ consumes `NLEContext`; keeps the same `on*` drop / edit
  props wired to the same handlers.
- **`EditorShell` (new, thin)** — _responsibility:_ own the CapCut layout skeleton and the
  storyboard-hidden toggle. Renders `NLEProvider` → `flex-col` → top row (sidebar slots +
  `PreviewPane`) + `TimelineResizeDivider` + `TimelinePane`. _Interface:_ `left` / `right`
  slots + the props `StudioPreviewArea` takes today, threaded to the panes.
- **`App.tsx`** — swap the horizontal `<div flex flex-1>` (left / `StudioPreviewArea` /
  right) for `<EditorShell left=… right=… …/>`. `StudioOverlays` stays a sibling. The
  `viewMode === "storyboard"` hidden toggle moves onto `EditorShell`'s outer wrapper.
- **`NLELayout.tsx` / `StudioPreviewArea.tsx`** — dissolved; their logic relocates into the
  four components above. No duplicate layout path (replace outright).
- **`StudioFeedbackBar`** — currently the last child of `StudioPreviewArea`'s column. Moves
  to the bottom of `EditorShell` (below the timeline), so it stays a single full-width bar.

### Resize / divider

`TimelineResizeDivider` logic is unchanged; it now sits between the top row and the
timeline, and clamps the timeline height against the **`EditorShell` container** height
instead of the old `NLELayout` container. `MIN_PREVIEW_H` semantically becomes the min
height of the whole top row (same constant, same clamp math). `timelineHeight` persistence
in `studioUiPreferences` is untouched.

### Fullscreen (preview-only, user decision)

`requestFullscreen()` targets the `PreviewPane` container element. The browser then shows
only that subtree, so sidebars + timeline are naturally excluded — simpler than today's
whole-`NLELayout` fullscreen with conditional hiding. Escape / `fullscreenchange`
subscription moves to `PreviewPane`.

## 5. Regression surface — live verification checklist

R4 changes structure, so the risk is behavioral regressions. After implementation, verify
each in the real UI (browser) on a QA project — this is the acceptance gate:

1. Play / pause / scrub sync (playhead + preview + timecode).
2. Seek by clicking the timeline ruler / dragging playhead.
3. Drill-down: double-click a sub-comp clip → enters; Escape pops; breadcrumb navigates.
4. Preview-only fullscreen: enter shows preview only, exit restores layout.
5. Timeline drops: OS file, asset card, block card → land at playhead, correct track.
6. Preview block drop (drag block onto canvas).
7. Clip move / resize / split + snapping + magnet toggle (`N`) — unchanged feel.
8. Divider resize + height persists across reload; clamps (no 0px preview / timeline).
9. Caption edit mode: footer `CaptionTimeline` appears under the timeline.
10. DomEdit overlay selection + keyframe diamonds still work.
11. Right panel present / collapsed both lay out correctly; timeline stays full-width.
12. Console clean of new studio-shell errors (composition-content errors are pre-existing).

## 6. Testing

- Repoint / split `NLELayout.test.ts` to cover `EditorShell` + the panes; keep pure helpers
  (`shouldDisableTimelineWhileCompositionLoading`) covered.
- Full studio + core suites green (the 18 pre-existing telemetry/SnapToolbar failures on
  `main` stay out of scope — do not chase).
- `bun run build` (full — refreshes the CLI-embedded studio), lint (oxlint) + format
  (oxfmt) + tsc clean on changed files before commit.

## 7. Risks

- **Shared-state lift errors** (double-instantiating `useTimelinePlayer`, stale `iframeRef`)
  → mitigate: single provider call, verify checklist #1–#4 first.
- **File-size gate (≤600 lines)** — extracting into four components keeps each small; watch
  `EditorShell` / `TimelinePane` don't absorb too much.
- **fallow complexity gate** flags pre-existing complexity as branch diff grows; run
  lint/format/tsc/tests manually, `--no-verify` only for findings not from this change.

## 8. Sequenced follow-on (not R4)

After R4 lands and verifies: **R1** (ruler restyle + frame sync, quick), then **R3 + R2
together** (variable track heights + CapCut drag physics — the real interaction polish),
built on the container R4 provides.
