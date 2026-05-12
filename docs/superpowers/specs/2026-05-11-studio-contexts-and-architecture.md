# Studio Architecture: Domain Contexts, Hook Split, File-Size Lint

## Problem

After the App.tsx decomposition (PR #741), three issues remain:

1. **Prop drilling**: Sub-components receive 13–37 props each. App.tsx spends ~250 of its 588 lines forwarding hook results to children. Every new feature adds props to multiple interfaces.

2. **useDomEditSession is a monolith**: 1672 LOC with ~30 exports. It owns selection state, canvas pointer events, ~15 commit handlers, the ask-agent modal, and blocked-edit handling. Fails the "what does this own?" test.

3. **No file-size guard**: The 4297-line App.tsx grew unchecked. Nothing prevents the next monolith.

## Design

### 1. Domain Contexts (4 contexts)

Replace prop drilling with 4 React contexts, one per logical domain:

| Context | What it provides | Main producer (hook) |
|---------|-----------------|---------------------|
| `PanelLayoutContext` | leftWidth, rightWidth, collapsed states, resize handlers, tab state | `usePanelLayout` |
| `FileManagerContext` | editingFile, fileTree, compositions, assets, fontAssets, CRUD handlers | `useFileManager` |
| `DomEditContext` | selection state, style/text/geometry commits, preview interaction handlers, agent modal state | `useDomEditSession` (after split) |
| `StudioContext` | projectId, activeCompPath, showToast, previewIframeRef, captionEditMode, and cross-cutting values that don't fit the other three | App.tsx orchestration |

**How it works:**

- Each context is a `createContext` + `useXxxContext` consumer hook pair in its own file under `packages/studio/src/contexts/`.
- The provider wraps the value from the corresponding hook — no new state, just the existing hook return piped into context.
- App.tsx creates the providers in a nested tree (order matches the hook dependency chain).
- Sub-components call `useXxxContext()` instead of receiving props.

**What changes in each component:**

- `StudioHeader`: drops 13 props → uses `usePanelLayoutContext()` for collapse/tab state, `useStudioContext()` for projectId/editHistory, `useDomEditContext()` for clearDomSelection.
- `StudioLeftSidebar`: drops 21 props → uses `useFileManagerContext()` for all file operations, `usePanelLayoutContext()` for width/collapse.
- `StudioPreviewArea`: drops 37 props → uses `useDomEditContext()` for all selection/overlay handlers, `useStudioContext()` for projectId/refreshKey.
- `StudioRightPanel`: drops 36 props → uses `useDomEditContext()` for selection + commit handlers, `useFileManagerContext()` for assets/fonts, `usePanelLayoutContext()` for tab/resize.

**Re-render strategy:**

Each context value is the hook's return object (already stable via `useCallback`/`useMemo`). The hook return itself is a new object each render, so we `useMemo` the context value with the individual stable members as deps. Components that only read from one context don't re-render when another domain changes.

### 2. Split useDomEditSession (1672 → 4 files, each <400 LOC)

The hook has four natural seams:

| New hook | LOC est. | What it owns |
|----------|----------|-------------|
| `useDomSelection` | ~250 | `domEditSelection`, `domEditGroupSelections`, `domEditHoverSelection`, `applyDomSelection`, `clearDomSelection`, `buildDomSelectionFromTarget`, `resolveDomSelectionFromPreviewPoint`, `updateDomEditHoverSelection`, `buildDomSelectionForTimelineElement`, `handleTimelineElementSelect`, hover-cleanup effects |
| `useDomEditCommits` | ~350 | `persistDomEditOperations`, `refreshDomEditSelectionFromPreview`, all `handleDom*Commit` callbacks (style, text, textField, path offset, box size, rotation, manual reset, motion commit/clear), `handleDomEditElementDelete`, `commitDomTextFields`, `handleDomAddTextField`, `handleDomRemoveTextField` |
| `useAskAgentModal` | ~120 | `agentModalOpen`, `agentModalAnchorPoint`, `copiedAgentPrompt`, `agentPromptTagSnippet`, `agentPromptSelectionContext`, `preloadAgentPromptSnippet`, `handleAskAgent`, `handleAgentModalSubmit` |
| `usePreviewInteraction` | ~150 | `handlePreviewCanvasMouseDown`, `handlePreviewCanvasPointerMove`, `handlePreviewCanvasPointerLeave`, `handleBlockedDomMove`, `handleDomManualDragStart` |

**Dependency chain**: `useDomSelection` is the leaf. `useDomEditCommits` and `usePreviewInteraction` both depend on it. `useAskAgentModal` depends on `useDomSelection`. A thin `useDomEditSession` remains as the orchestrator (~50 lines) that calls all four and returns their combined API — existing consumers don't change.

The ~300 lines of local helper functions at the top of the file (font injection, path resolution, preview pointer helpers) move to the existing utility files (`studioFontHelpers.ts`, `studioHelpers.ts`, `studioPreviewHelpers.ts`) where they already have duplicates. The hook-local copies were created by the extraction agent and should be consolidated.

### 3. File-Size Lint Rule (500 LOC max)

Add an oxlint or custom lint rule that warns on files exceeding 500 lines.

**Implementation**: A lefthook `pre-commit` script that runs `wc -l` on staged `.ts`/`.tsx` files and fails if any exceed 500 lines. Simpler and more reliable than a custom oxlint plugin.

```bash
# In .lefthook/pre-commit/check-file-size.sh
MAX_LINES=500
OVER=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx)$' | while read f; do
  lines=$(wc -l < "$f")
  if [ "$lines" -gt "$MAX_LINES" ]; then
    echo "$f: $lines lines (max $MAX_LINES)"
  fi
done)
if [ -n "$OVER" ]; then
  echo "Files exceed $MAX_LINES line limit:"
  echo "$OVER"
  exit 1
fi
```

**Exceptions**: Test files (`*.test.ts`) and generated files are excluded via the grep pattern. Existing large files that predate the rule are grandfathered — the rule only fires on files in the staged changeset.

## What stays the same

- Hook implementations don't change (except useDomEditSession split).
- The hooks still own all state and logic — contexts are just distribution.
- The existing `usePlayerStore` (Zustand) pattern for player state is untouched.
- The caption store (`useCaptionStore`) stays as-is.

## File inventory

New files:
- `packages/studio/src/contexts/PanelLayoutContext.tsx`
- `packages/studio/src/contexts/FileManagerContext.tsx`
- `packages/studio/src/contexts/DomEditContext.tsx`
- `packages/studio/src/contexts/StudioContext.tsx`
- `packages/studio/src/hooks/useDomSelection.ts`
- `packages/studio/src/hooks/useDomEditCommits.ts`
- `packages/studio/src/hooks/useAskAgentModal.ts`
- `packages/studio/src/hooks/usePreviewInteraction.ts`
- `.lefthook/pre-commit/check-file-size.sh`

Modified files:
- `packages/studio/src/App.tsx` — wrap JSX in providers, drop prop forwarding
- `packages/studio/src/components/StudioHeader.tsx` — replace props with context
- `packages/studio/src/components/StudioLeftSidebar.tsx` — replace props with context
- `packages/studio/src/components/StudioPreviewArea.tsx` — replace props with context
- `packages/studio/src/components/StudioRightPanel.tsx` — replace props with context
- `packages/studio/src/hooks/useDomEditSession.ts` — becomes thin orchestrator
- `packages/studio/src/utils/studioFontHelpers.ts` — absorb duplicate helpers from useDomEditSession
- `packages/studio/src/utils/studioHelpers.ts` — absorb duplicate helpers
- `packages/studio/src/utils/studioPreviewHelpers.ts` — absorb duplicate helpers
- `lefthook.yml` — add file-size check

## Verification

- `npx tsc --noEmit` — 0 errors
- All 464 studio tests pass
- Full `bun run build` succeeds
- No file exceeds 500 LOC (except test files)
- App.tsx drops from 588 to ~350 lines
- Sub-component prop interfaces shrink to 0–3 props each (only truly local props like `children` or event overrides)

## Execution order

1. Add the file-size lint rule (standalone, can merge immediately)
2. Consolidate duplicate helpers from useDomEditSession into utility files
3. Split useDomEditSession into 4 hooks + thin orchestrator
4. Create the 4 context files
5. Wire providers in App.tsx
6. Update sub-components to consume contexts
7. Remove prop interfaces
