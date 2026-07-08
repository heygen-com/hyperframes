# Full-Width Timeline Layout (R4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Studio timeline to a full-width row at the bottom, with `[left sidebar | preview | right panel]` as a horizontal row above it (CapCut / Premiere / Resolve layout).

**Architecture:** Lift the shared player + composition-stack state out of `NLELayout` into an `NLEProvider` (React context), decompose the preview and timeline halves into `PreviewPane` and `TimelinePane`, and introduce a thin `EditorShell` that owns the new layout with the sidebars as slots. Strangler refactor: the app stays green and behaviorally identical at every commit until the final "flip" task swaps the layout. `NLELayout` + `StudioPreviewArea` are dissolved.

**Tech Stack:** React 18, Zustand (`usePlayerStore`), TypeScript, Tailwind, Vite; vitest for unit tests; `mcp__Claude_Preview__*` for live browser verification.

## Global Constraints

- **No change to any timeline interaction behavior.** Drops (file/asset/block), clip move/resize/split, snapping + magnet (`N`), the drag ghost, edit context, drill-down, keyframe diamonds keep their **exact current code paths** — relocated, never altered. Acceptance: byte-identical behavior, verified live.
- **Replace outright — no feature flag, no dual layout paths.**
- **Fullscreen is preview-only:** `requestFullscreen()` targets the `PreviewPane` container.
- Package manager **bun**. Lint/format **oxlint / oxfmt** (`bunx oxlint <files>`, `bunx oxfmt <files>`). Not eslint/prettier.
- **Full build required** to refresh the CLI-embedded studio: `bun run build`, then kill+restart the preview server, then `curl` the served `index-*.js` hash to confirm it changed (gotcha G1).
- Commits: conventional (`feat:`/`refactor:`), header ≤100 chars, **never add Co-Authored-By / AI attribution**.
- File-size gate ≤600 lines/file. `fallow` complexity gate flags pre-existing complexity in `useTimelineClipDrag.ts`/`blockInstaller.ts` — `--no-verify` acceptable ONLY for findings not from your change; run oxlint/oxfmt/tsc/tests manually first.
- Tests: `cd packages/studio && bunx vitest run [path]`. The 18 pre-existing `telemetry/*` + `SnapToolbar` failures reproduce on `main @ cebce603d` — out of scope, do not chase.
- **Refactor-note on "show the code":** Tasks 2–5 relocate large existing JSX blocks verbatim. Where a step says "move lines X–Y from FILE", move that source range unchanged; the plan shows the _new_ code (signatures, wiring, context shape) in full and cites exact source ranges for moved blocks rather than re-pasting them.

---

### Task 1: NLEContext + NLEProvider (lift the shared state)

The core lift. `useTimelinePlayer()` and `useCompositionStack()` hold component-local refs/state and must be called exactly once; move them (plus the provider-level shared state and effects) out of `NLELayout` into a provider. `NLELayout` becomes a thin consumer, wrapped by `NLEProvider`. Behavior stays identical.

**Files:**

- Create: `packages/studio/src/components/nle/NLEContext.tsx`
- Modify: `packages/studio/src/components/nle/NLELayout.tsx` (currently 1–547)
- Modify: `packages/studio/src/components/nle/NLELayout.test.ts` → rename to `NLEContext.test.ts`
- Modify: `packages/studio/src/index.ts` (re-export `NLEProvider`/`useNLEContext` if the barrel exports `NLELayout`)

**Interfaces:**

- Produces: `NLEContext` value + `useNLEContext()` + `NLEProvider`:

```ts
export interface NLEContextValue {
  projectId: string;
  // player (from useTimelinePlayer — single instance)
  iframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  togglePlay: () => void;
  seek: (time: number, options?: { keepPlaying?: boolean }) => boolean;
  refreshPlayer: () => void;
  onIframeLoad: () => void; // wraps baseOnIframeLoad + ensureMotionPathPluginLoaded + onIframeRef
  // composition stack (from useCompositionStack)
  compositionStack: ReturnType<typeof useCompositionStack>["compositionStack"];
  updateCompositionStack: ReturnType<typeof useCompositionStack>["updateCompositionStack"];
  handleNavigateComposition: ReturnType<typeof useCompositionStack>["handleNavigateComposition"];
  handleDrillDown: (element: TimelineElement) => void; // the DOM-scanning wrapper
  compIdToSrc: Map<string, string>;
  // layout state
  timelineH: number;
  setTimelineH: React.Dispatch<React.SetStateAction<number>>;
  persistTimelineH: (height: number) => void;
  containerRef: React.RefObject<HTMLDivElement>; // clamp basis for timelineH
  // composition loading
  compositionLoading: boolean;
  setCompositionLoading: (loading: boolean) => void;
  timelineDisabled: boolean;
  // preview composition size (for preview block drop)
  previewCompositionSize: { width: number; height: number } | null;
  setPreviewCompositionSize: (s: { width: number; height: number } | null) => void;
}
export function NLEProvider(props: NLEProviderProps): JSX.Element; // renders context + children
export function useNLEContext(): NLEContextValue;
export function shouldDisableTimelineWhileCompositionLoading(loading: boolean): boolean; // moved here
```

`NLEProviderProps` carries the current `NLELayoutProps` fields the provider needs: `projectId`, `refreshKey`, `activeCompositionPath`, `onIframeRef`, `onCompositionChange`, `onCompIdToSrcChange`, `onCompositionLoadingChange`.

- [ ] **Step 1: Repoint the existing test to the new module (write-first, expect fail)**

Rename `NLELayout.test.ts` → `NLEContext.test.ts`; change the import:

```ts
import { shouldDisableTimelineWhileCompositionLoading } from "./NLEContext";
```

(Keep both `it()` cases unchanged.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/studio && bunx vitest run src/components/nle/NLEContext.test.ts`
Expected: FAIL — cannot resolve `./NLEContext` (module not created yet).

- [ ] **Step 3: Create `NLEContext.tsx`**

Create the file with `NLEContextValue`, a `createContext`, `useNLEContext()` (throws if used outside provider), and `NLEProvider`. Into `NLEProvider`, MOVE from `NLELayout.tsx` verbatim: the `useTimelinePlayer()` call (current 111–117), the projectId `reset()` effect (124–126), `previewCompositionSize` state (135–138), the `refreshKey`→`refreshPlayer` effect (157–162), `onIframeLoad` (164–171), the `useCompositionStack()` call (173–185), the `handleDrillDown` DOM-scan wrapper (188–218), the compIdToSrc `index.html` fetch (`useMountEffect`, 291–319) + patch effect (322–352), `timelineH` state+persist+clamp (356–371), `compositionLoading` state+setter (372–383), and `containerRef` (386). Also MOVE `shouldDisableTimelineWhileCompositionLoading` (85–87). Provide all via context; render `<NLEContext.Provider value={…}>{children}</NLEContext.Provider>`.

- [ ] **Step 4: Refactor `NLELayout.tsx` to consume the provider**

Wrap: `export function NLELayout(props) { return <NLEProvider {…providerProps}><NLELayoutInner {…viewProps}/></NLEProvider>; }`. `NLELayoutInner` reads everything it previously computed via `useNLEContext()` instead of calling the hooks. The fullscreen block (76–83, 385–396), the expanded-clip edit wrappers (223–285), and all JSX (421–546) stay in `NLELayoutInner` for now (extracted in later tasks). Remove the now-moved code from `NLELayout`.

- [ ] **Step 5: Run the test + the NLE/player suites**

Run: `cd packages/studio && bunx vitest run src/components/nle/NLEContext.test.ts src/player`
Expected: PASS (all except the known-pre-existing failures listed in Global Constraints).

- [ ] **Step 6: Typecheck + lint + format changed files**

Run: `cd packages/studio && bunx tsc --noEmit && cd ../.. && bunx oxlint packages/studio/src/components/nle && bunx oxfmt packages/studio/src/components/nle`
Expected: clean (tsc no errors; oxlint no new findings).

- [ ] **Step 7: Full build + live smoke**

Run: `bun run build`; kill+restart `node packages/cli/dist/cli.js preview --no-open /tmp/hf-dnd-qa/qa-project-2`; `curl -s http://localhost:<port>/ | grep -oE '/assets/index-[^"]+\.js'` (hash must change). In the browser: play/pause, click-seek, drill into a sub-comp + Escape, drag the divider, drop a file — all must behave exactly as before.
Expected: identical behavior, no new console errors from the studio shell.

- [ ] **Step 8: Commit**

```bash
git add packages/studio/src/components/nle packages/studio/src/index.ts
git commit -m "refactor(studio): lift player + composition-stack state into NLEProvider"
```

---

### Task 2: Extract PreviewPane

Move the preview half (iframe + controls + breadcrumb + fullscreen + preview block-drop) out of `NLELayoutInner` into a `PreviewPane` that consumes `useNLEContext()`.

**Files:**

- Create: `packages/studio/src/components/nle/PreviewPane.tsx`
- Modify: `packages/studio/src/components/nle/NLELayout.tsx`

**Interfaces:**

- Consumes: `useNLEContext()` (Task 1); `useStudioShellContext()` for `handlePreviewIframeRef` (as `StudioPreviewArea` does today).
- Produces:

```ts
export interface PreviewPaneProps {
  portrait?: boolean;
  previewOverlay?: ReactNode;
  onSelectTimelineElement?: (element: TimelineElement | null) => void;
}
export function PreviewPane(props: PreviewPaneProps): JSX.Element;
```

- [ ] **Step 1: Create `PreviewPane.tsx`**

Move from `NLELayout.tsx` into `PreviewPane`: the fullscreen subscription/getters (76–83), `stageRefForDrop`+`handleStageRef` (128–131), `usePreviewBlockDrop` (140–151), fullscreen state + `toggleFullscreen` (385–396) with `containerRef` now OWNED by `PreviewPane` (fullscreen is preview-only per Global Constraints — the container it fullscreens is the preview pane, not the whole shell), the preview+controls JSX (429–483: the pan surface, `NLEPreview`, drag-over affordance, breadcrumb, `PlayerControls`). Wire `seek`/`togglePlay`/`iframeRef`/`onIframeLoad`/`compositionStack`/`previewCompositionSize` setter from context; `onPreviewBlockDrop` stays wired through (see note). Keep the `!isFullscreen && previewOverlay` conditional (preserve current hide-in-fullscreen behavior).

Note: `usePreviewBlockDrop`'s `onBlockDrop` came from the `onPreviewBlockDrop` prop threaded App→StudioPreviewArea→NLELayout. Thread it into `PreviewPane` via a new optional prop `onPreviewBlockDrop` (add to `PreviewPaneProps`).

- [ ] **Step 2: Render `<PreviewPane/>` from `NLELayoutInner`**

Replace the moved preview JSX (429–483) in `NLELayoutInner` with `<PreviewPane portrait={portrait} previewOverlay={previewOverlay} onSelectTimelineElement={onSelectTimelineElement} onPreviewBlockDrop={onPreviewBlockDrop}/>`. The timeline half + divider stay.

- [ ] **Step 3: Typecheck + lint + format**

Run: `cd packages/studio && bunx tsc --noEmit && cd ../.. && bunx oxlint packages/studio/src/components/nle && bunx oxfmt packages/studio/src/components/nle`
Expected: clean.

- [ ] **Step 4: Player suite + live verify**

Run: `cd packages/studio && bunx vitest run src/player`; then `bun run build` + restart preview. Browser: preview renders, play/pause, **fullscreen enter/exit (preview-only)**, breadcrumb after drill-down, preview block-drop onto canvas.
Expected: identical behavior.

- [ ] **Step 5: Commit**

```bash
git add packages/studio/src/components/nle
git commit -m "refactor(studio): extract PreviewPane from NLELayout"
```

---

### Task 3: Extract TimelinePane

Move the timeline half (toolbar slot + `<Timeline>` + footer + loading overlay + the expanded-clip edit wrappers) out of `NLELayoutInner` into a `TimelinePane`.

**Files:**

- Create: `packages/studio/src/components/nle/TimelinePane.tsx`
- Modify: `packages/studio/src/components/nle/NLELayout.tsx`

**Interfaces:**

- Consumes: `useNLEContext()`; `useTimelineEditContext()` (for `onMoveElement`/`onResizeElement`/`onSplitElement`); the moved edit-wrapper helpers.
- Produces:

```ts
export interface TimelinePaneProps {
  timelineToolbar?: ReactNode;
  timelineFooter?: ReactNode;
  renderClipContent?: (el: TimelineElement, style: { clip: string; label: string }) => ReactNode;
  onFileDrop?: (
    files: File[],
    placement?: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  onAssetDrop?: (
    assetPath: string,
    placement: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  onBlockDrop?: (
    blockName: string,
    placement: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  onDeleteElement?: (element: TimelineElement) => Promise<void> | void;
  onBlockedEditAttempt?: (element: TimelineElement, intent: BlockedTimelineEditIntent) => void;
  onSelectTimelineElement?: (element: TimelineElement | null) => void;
}
export function TimelinePane(props: TimelinePaneProps): JSX.Element;
```

- [ ] **Step 1: Create `TimelinePane.tsx`**

Move from `NLELayout.tsx` into `TimelinePane`: `useTimelineEditContext()` + `toLocalElement` + the four expanded-clip wrappers `handleMoveElement`/`handleResizeElement`/`handleDeleteElement`/`handleSplitElement` (223–285), and the timeline-section JSX (485–544: the `TimelineResizeDivider`, the timeline container with the double-click-to-pop handler, `timelineToolbar` slot, `<Timeline …>`, `timelineFooter`, and the `timelineDisabled` overlay). Wire `seek`, `handleDrillDown`, `timelineDisabled`, `timelineH`/`setTimelineH`/`persistTimelineH`/`containerRef`, `compositionStack`/`updateCompositionStack` from context. `<Timeline>` keeps the exact same `on*` props it has today (this is the no-regression boundary).

Note: `TimelineResizeDivider` currently sits between preview and timeline **inside** `NLELayout`. In Task 3 keep it as the first child of `TimelinePane` (unchanged position). Task 5 moves it to sit between the top row and the timeline.

- [ ] **Step 2: Render `<TimelinePane/>` from `NLELayoutInner`**

Replace the moved timeline JSX (485–544) with `<TimelinePane timelineToolbar={timelineToolbar} timelineFooter={timelineFooter} renderClipContent={renderClipContent} onFileDrop={onFileDrop} onAssetDrop={onAssetDrop} onBlockDrop={onBlockDrop} onDeleteElement={onDeleteElement} onBlockedEditAttempt={onBlockedEditAttempt} onSelectTimelineElement={onSelectTimelineElement}/>`. `NLELayoutInner` is now just `<PreviewPane/>` + `<TimelinePane/>` in a `flex-col` container reading `isFullscreen` from `PreviewPane`'s context-independent state — since fullscreen moved into `PreviewPane`, drop the `!isFullscreen &&` wrapper around the timeline here (browser fullscreen of the preview element already hides siblings).

- [ ] **Step 3: Typecheck + lint + format**

Run: `cd packages/studio && bunx tsc --noEmit && cd ../.. && bunx oxlint packages/studio/src/components/nle && bunx oxfmt packages/studio/src/components/nle`
Expected: clean.

- [ ] **Step 4: Player suite + live verify**

Run: `cd packages/studio && bunx vitest run src/player`; `bun run build` + restart. Browser: clip move/resize/split, snapping + `N` toggle, file/asset/block drop lands at playhead on the right track, divider resize + reload persistence, drill-down double-click + Escape/double-click-empty to pop, caption footer in caption mode.
Expected: identical behavior — this is the interaction no-regression gate.

- [ ] **Step 5: Commit**

```bash
git add packages/studio/src/components/nle
git commit -m "refactor(studio): extract TimelinePane from NLELayout"
```

---

### Task 4: Extract PreviewOverlays + useTimelineEditCallbacks from StudioPreviewArea

Prep for the flip: pull `StudioPreviewArea`'s two heavy pieces — the `timelineEditCallbacks` `useMemo` and the `previewOverlay` JSX — into reusable units so `EditorShell` can compose them. `StudioPreviewArea` still renders `NLELayout` (old layout) — behavior identical.

**Files:**

- Create: `packages/studio/src/components/nle/useTimelineEditCallbacks.ts`
- Create: `packages/studio/src/components/nle/PreviewOverlays.tsx`
- Modify: `packages/studio/src/components/StudioPreviewArea.tsx`

**Interfaces:**

- Produces:

```ts
export function useTimelineEditCallbacks(deps: {
  handleTimelineElementMove: StudioPreviewAreaProps["handleTimelineElementMove"];
  handleTimelineElementResize: StudioPreviewAreaProps["handleTimelineElementResize"];
  handleToggleTrackHidden: StudioPreviewAreaProps["handleToggleTrackHidden"];
  handleBlockedTimelineEdit: StudioPreviewAreaProps["handleBlockedTimelineEdit"];
  handleTimelineElementSplit: StudioPreviewAreaProps["handleTimelineElementSplit"];
  handleRazorSplit: StudioPreviewAreaProps["handleRazorSplit"];
  handleRazorSplitAll: StudioPreviewAreaProps["handleRazorSplitAll"];
}): TimelineEditCallbacks; // the exact object currently built at StudioPreviewArea 177–301

export interface PreviewOverlaysProps {
  /* the props the overlay JSX reads today */
}
export function PreviewOverlays(props: PreviewOverlaysProps): JSX.Element | null;
```

- [ ] **Step 1: Create `useTimelineEditCallbacks.ts`**

Move the `resolveKeyframeTarget` `useCallback` (162–174) and the `timelineEditCallbacks` `useMemo` (177–301) verbatim into this hook, reading `domEditSelection`/`selectedGsapAnimations` via `useDomEditSelectionContext()` + the keyframe handlers via `useDomEditActionsContext()` (same contexts `StudioPreviewArea` uses). Return the callbacks object.

- [ ] **Step 2: Create `PreviewOverlays.tsx`**

Move the `previewOverlay={…}` JSX (332–403: blockPreview branch, `CaptionOverlay`, the `STUDIO_INSPECTOR_PANELS_ENABLED` branch with `DomEditOverlay`/`SnapToolbar`/`MotionPathOverlay`/`gestureOverlay`) + the `snapPrefs` state (148–156) into this component. It reads `previewIframeRef`/`captionEditMode`/`compositionLoading`/`isPlaying` from `useStudioShellContext()`/`useStudioPlaybackContext()` and takes the remaining props (`shouldShowSelectedDomBounds`, `cropMode`, `onCropModeChange`, `recordingState`, `onToggleRecording`, `isGestureRecording`, `blockPreview`, `gestureOverlay`, `activeCompPath`).

- [ ] **Step 3: Rewire `StudioPreviewArea` to use them (behavior identical)**

Replace the inline `useMemo` with `const timelineEditCallbacks = useTimelineEditCallbacks({…});` and the inline `previewOverlay={…}` with `previewOverlay={<PreviewOverlays {…}/>}`. No layout change.

- [ ] **Step 4: Typecheck + lint + format + suite**

Run: `cd packages/studio && bunx tsc --noEmit && bunx vitest run src/components src/player && cd ../.. && bunx oxlint packages/studio/src/components && bunx oxfmt packages/studio/src/components`
Expected: clean + PASS (minus known pre-existing failures).

- [ ] **Step 5: Live verify + commit**

`bun run build` + restart. Browser: DomEdit selection + 8-handle box, snap toolbar, keyframe diamonds, caption overlay in caption mode, block preview — all unchanged.

```bash
git add packages/studio/src/components
git commit -m "refactor(studio): extract PreviewOverlays + useTimelineEditCallbacks"
```

---

### Task 5: Create EditorShell, rewire App, delete NLELayout + StudioPreviewArea (the flip)

The only visual change. `EditorShell` composes the new full-width layout; `App` swaps to it; the two dissolved files are deleted.

**Files:**

- Create: `packages/studio/src/components/EditorShell.tsx`
- Modify: `packages/studio/src/App.tsx` (490–560 region)
- Delete: `packages/studio/src/components/nle/NLELayout.tsx`, `packages/studio/src/components/StudioPreviewArea.tsx`
- Modify: `packages/studio/src/index.ts` (drop `NLELayout` export if present; add `EditorShell` if the barrel is the import path)
- Test: `packages/studio/src/components/EditorShell.test.tsx`

**Interfaces:**

- Consumes: `NLEProvider`/`PreviewPane`/`TimelinePane`/`PreviewOverlays`/`useTimelineEditCallbacks` (Tasks 1–4), `TimelineEditProvider`, `StudioFeedbackBar`, `TimelineResizeDivider`.
- Produces:

```ts
export interface EditorShellProps extends StudioPreviewAreaProps {
  left: ReactNode; // <StudioLeftSidebar/>
  right: ReactNode; // <StudioRightPanel/> or null when collapsed
  hidden?: boolean; // storyboard view active → hide the shell
}
export function EditorShell(props: EditorShellProps): JSX.Element;
```

- [ ] **Step 1: Write a structural test (expect fail)**

Create `EditorShell.test.tsx`. jsdom cannot run the real player, so assert layout STRUCTURE only via a light render with the heavy children mocked (`vi.mock` `PreviewPane`/`TimelinePane` to render sentinels):

```tsx
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
vi.mock("./nle/PreviewPane", () => ({ PreviewPane: () => <div data-testid="preview-pane" /> }));
vi.mock("./nle/TimelinePane", () => ({ TimelinePane: () => <div data-testid="timeline-pane" /> }));
// (mock the remaining providers/children as needed)
import { EditorShell } from "./EditorShell";

it("renders the timeline pane after (below) the top row containing the preview pane", () => {
  const { getByTestId, getByText } = render(
    <EditorShell left={<div>LEFT</div>} right={<div>RIGHT</div>} {/* …required props */} />,
  );
  const preview = getByTestId("preview-pane");
  const timeline = getByTestId("timeline-pane");
  // timeline comes after preview in document order (full-width row below the top row)
  expect(preview.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // left + right sidebars share the top row with the preview
  expect(getByText("LEFT")).toBeTruthy();
  expect(getByText("RIGHT")).toBeTruthy();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/studio && bunx vitest run src/components/EditorShell.test.tsx`
Expected: FAIL — `./EditorShell` not found.

- [ ] **Step 3: Create `EditorShell.tsx`**

```tsx
export function EditorShell({ left, right, hidden, timelineToolbar, renderClipContent, /* …StudioPreviewAreaProps */ }: EditorShellProps) {
  const timelineEditCallbacks = useTimelineEditCallbacks({
    handleTimelineElementMove, handleTimelineElementResize, handleToggleTrackHidden,
    handleBlockedTimelineEdit, handleTimelineElementSplit, handleRazorSplit, handleRazorSplitAll,
  });
  const { projectId, activeCompPath, setActiveCompPath } = useStudioShellContext();
  const { refreshKey, refreshPreviewDocumentVersion } = useStudioPlaybackContext();
  return (
    <div className={`flex flex-col flex-1 min-h-0${hidden ? " hidden" : ""}`}>
      <TimelineEditProvider value={timelineEditCallbacks}>
        <NLEProvider
          projectId={projectId}
          refreshKey={refreshKey}
          activeCompositionPath={activeCompPath}
          onIframeRef={handlePreviewIframeRef}
          onCompIdToSrcChange={setCompIdToSrc}
          onCompositionLoadingChange={setCompositionLoading}
          onCompositionChange={(p) => { if (p !== activeCompPath) { setActiveCompPath(p); refreshPreviewDocumentVersion(); } }}
        >
          {/* TOP ROW: [left | preview | right] */}
          <div className="flex flex-row flex-1 min-h-0">
            {left}
            <div className="flex-1 flex flex-col relative min-w-0">
              <PreviewPane
                previewOverlay={<PreviewOverlays {/* …overlay props */} />}
                onSelectTimelineElement={handleTimelineElementSelect}
                onPreviewBlockDrop={handlePreviewBlockDrop}
              />
            </div>
            {right}
          </div>
          {/* DIVIDER between top row and the full-width timeline */}
          <TimelineResizeDivider /* timelineH/setTimelineH/persist/containerRef from context via a small wrapper */ />
          {/* FULL-WIDTH TIMELINE */}
          <TimelinePane
            timelineToolbar={timelineToolbar}
            timelineFooter={/* caption footer, as StudioPreviewArea built it */}
            renderClipContent={renderClipContent}
            onFileDrop={handleTimelineFileDrop}
            onAssetDrop={handleTimelineAssetDrop}
            onBlockDrop={handleTimelineBlockDrop}
            onDeleteElement={handleTimelineElementDelete}
            onBlockedEditAttempt={handleBlockedTimelineEdit}
            onSelectTimelineElement={handleTimelineElementSelect}
          />
          <StudioFeedbackBar />
        </NLEProvider>
      </TimelineEditProvider>
    </div>
  );
}
```

Move `TimelineResizeDivider` out of `TimelinePane` to sit between the top row and `TimelinePane` (as above); it reads `timelineH`/`setTimelineH`/`persistTimelineH`/`containerRef` from `useNLEContext()`. Set `containerRef` on the outer `flex-col` div so the timeline-height clamp measures the whole shell (min height = top row `MIN_PREVIEW_H`). `handleTimelineElementSelect`/`handlePreviewBlockDrop` come from the DomEdit action context / props exactly as `StudioPreviewArea` wired them.

- [ ] **Step 4: Run the structural test to verify it passes**

Run: `cd packages/studio && bunx vitest run src/components/EditorShell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Rewire `App.tsx`**

Replace the `<div className="flex flex-1 min-h-0…">` block (490–560: `StudioLeftSidebar` + `StudioPreviewArea` + `StudioRightPanel`) with:

```tsx
<EditorShell
  hidden={viewModeValue.viewMode === "storyboard"}
  left={<StudioLeftSidebar leftSidebarRef={leftSidebarRef} onSelectComposition={handleSelectComposition} onAddBlock={handleAddBlock} onPreviewBlock={setBlockPreview} onLint={handleLint} linting={linting} lintFindingCount={lintModal?.length ?? findingsByFile.size} lintFindingsByFile={findingsByFile} onAddAssetToTimeline={timelineEditing.handleAddAssetAtPlayhead} />}
  right={panelLayout.rightCollapsed ? null : <StudioRightPanel {/* …existing props */} />}
  timelineToolbar={timelineToolbar}
  renderClipContent={renderClipContent}
  {/* …the rest of the props StudioPreviewArea received, unchanged */}
/>
```

Keep `StudioOverlays` as the following sibling. Remove the `StudioPreviewArea` import; add `EditorShell`.

- [ ] **Step 6: Delete the dissolved files + fix barrel**

```bash
git rm packages/studio/src/components/nle/NLELayout.tsx packages/studio/src/components/StudioPreviewArea.tsx
```

Remove any `NLELayout`/`StudioPreviewArea` re-exports from `packages/studio/src/index.ts` and update the two remaining importers found earlier (`utils/gsapSoftReload.ts`, `components/editor/domEditingDom.ts` referenced `NLELayout` only in comments/types — verify with `grep -rn "NLELayout\|StudioPreviewArea" packages/studio/src` and fix any real imports).

- [ ] **Step 7: Typecheck + lint + format + full suite**

Run: `cd packages/studio && bunx tsc --noEmit && bunx vitest run && cd ../.. && bunx oxlint packages/studio/src && bunx oxfmt packages/studio/src/components`
Expected: tsc clean; suite green except the 18 known-pre-existing failures.

- [ ] **Step 8: Full build + the complete live QA checklist**

`bun run build`; restart preview; confirm served hash changed. Resize the browser to 1680×950. Walk the design doc §5 checklist in the real UI:

1. Play/pause/scrub sync. 2. Click-seek + playhead drag. 3. Drill-down double-click + Escape pop + breadcrumb nav. 4. Preview-only fullscreen enter/exit. 5. OS-file / asset / block drop → playhead + correct track. 6. Preview block-drop on canvas. 7. Clip move/resize/split + snap + `N`. 8. Divider resize + reload persistence + clamps (no 0px pane). 9. Caption-mode footer under the timeline. 10. DomEdit overlay + keyframe diamonds. 11. Right panel present/collapsed both lay out; timeline stays full-width. 12. Console clean of new shell errors. Capture a screenshot of the new layout for the user.
   Expected: full-width timeline at bottom; `[left | preview | right]` above; every interaction identical.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(studio): full-width timeline layout; sidebars + preview above it"
```

(If the `fallow` gate blocks on pre-existing complexity not from this change, `--no-verify` after confirming oxlint/oxfmt/tsc/tests pass — see Global Constraints.)

---

## Self-review

**Spec coverage:** §3 lift → Task 1. §4 `PreviewPane` → Task 2; `TimelinePane` → Task 3; `PreviewOverlays`/`useTimelineEditCallbacks` split of `StudioPreviewArea` → Task 4; `EditorShell` + App swap + deletions + `StudioFeedbackBar` move → Task 5. §4 resize/divider → Task 5 Step 3. §4 fullscreen (preview-only) → Task 2 Step 1. §5 verification checklist → Task 5 Step 8 (with per-task live smokes en route). §6 testing → per-task suite runs + Task 1/Task 5 test steps. All covered.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Moved-block steps cite exact source ranges + show the new wiring/signatures in full (see the Global Constraints refactor-note). The two spots marked `{/* … */}` are "carry the existing props unchanged" hand-offs, not undefined behavior — the props are enumerated in `StudioPreviewAreaProps` and reused verbatim.

**Type consistency:** `NLEContextValue` (Task 1) is the single source for `seek`/`iframeRef`/`timelineH`/`handleDrillDown`/`compositionLoading`; Tasks 2/3/5 consume those exact names via `useNLEContext()`. `TimelineEditCallbacks` (from `player/components/timelineCallbacks`) is the return type of `useTimelineEditCallbacks` (Task 4) and the value of `TimelineEditProvider` (Task 5) — consistent. `TimelinePaneProps.on*` mirror the current `<Timeline>` prop names (no-regression boundary).
