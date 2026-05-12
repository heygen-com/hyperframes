# Studio Domain Contexts, Hook Split & File-Size Lint

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate prop drilling across studio sub-components by introducing 4 domain React contexts, split the 1672-line useDomEditSession monolith into 4 focused hooks, and add a file-size lint guard in both pre-commit and CI.

**Architecture:** Each domain context wraps the return value of its corresponding hook. App.tsx creates the providers; sub-components consume via `useXxxContext()` hooks. The useDomEditSession split produces 4 leaf hooks + a thin orchestrator that preserves the existing API.

**Tech Stack:** React Context, TypeScript, lefthook, GitHub Actions

---

### Task 1: Add file-size lint rule (pre-commit + CI)

**Files:**
- Modify: `lefthook.yml`
- Create: `.github/workflows/ci.yml` (add job)

- [ ] **Step 1: Add file-size check to lefthook**

In `lefthook.yml`, add a new command under `pre-commit.commands`:

```yaml
    filesize:
      glob: "*.{ts,tsx}"
      exclude: "(\\.test\\.(ts|tsx)$|\\.generated\\.)"
      run: |
        for f in {staged_files}; do
          lines=$(wc -l < "$f")
          if [ "$lines" -gt 500 ]; then
            echo "ERROR: $f has $lines lines (max 500)"
            exit 1
          fi
        done
```

- [ ] **Step 2: Add LOC checker job to CI**

In `.github/workflows/ci.yml`, add a new job after the existing `changes` job. This runs on all PRs, not gated by path filters, to catch any file in the repo:

```yaml
  filesize:
    name: File size check
    runs-on: ubuntu-latest
    timeout-minutes: 1
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
      - name: Check file sizes (max 500 lines)
        run: |
          EXIT=0
          while IFS= read -r f; do
            lines=$(wc -l < "$f")
            if [ "$lines" -gt 500 ]; then
              echo "::error file=$f::$f has $lines lines (max 500)"
              EXIT=1
            fi
          done < <(find packages -name '*.ts' -o -name '*.tsx' | grep -vE '\.(test|spec)\.(ts|tsx)$|\.generated\.')
          exit $EXIT
```

- [ ] **Step 3: Verify pre-commit catches large files**

Run: `echo '// test' > /tmp/bigfile.ts && for i in $(seq 1 501); do echo "export const x$i = $i;" >> /tmp/bigfile.ts; done && wc -l /tmp/bigfile.ts`
Expected: 502 lines — would be caught.

- [ ] **Step 4: Commit**

```bash
git add lefthook.yml .github/workflows/ci.yml
git commit -m "ci: add 500 LOC file-size limit (pre-commit + CI)"
```

---

### Task 2: Consolidate duplicate helpers from useDomEditSession

The agent that created `useDomEditSession.ts` copied ~300 lines of helper functions that already exist in the utility files. Remove the duplicates and import from the canonical locations.

**Files:**
- Modify: `packages/studio/src/hooks/useDomEditSession.ts`
- Modify: `packages/studio/src/utils/studioHelpers.ts` (add any missing exports)
- Modify: `packages/studio/src/utils/studioFontHelpers.ts` (add any missing exports)
- Modify: `packages/studio/src/utils/studioPreviewHelpers.ts` (add any missing exports)

- [ ] **Step 1: Identify duplicate helpers**

Run: `grep -n '^function \|^const GENERIC' packages/studio/src/hooks/useDomEditSession.ts | head -20`

These are the local helpers to remove and replace with imports:
- `GENERIC_FONT_FAMILIES`, `primaryFontFamilyFromCss`, `injectPreviewGoogleFont`, `primaryFontFamilyValue`, `injectPreviewImportedFont`, `ensureImportedFontFace` → already in `studioFontHelpers.ts`
- `normalizeProjectAssetPath`, `toRelativeProjectAssetPath`, `isAbsoluteFilePath`, `toProjectAbsolutePath` → already in `studioHelpers.ts`
- `resolvePreviewLocalPointer`, `getPreviewLocalPointer`, `getPreviewTargetFromPointer`, `buildRasterClickSelectionContext`, `objectLike`, `callPlaybackMethod`, `readPlaybackTime`, `getPreviewPlayer`, `seekStudioPreview`, `pauseStudioPreviewPlayback` → already in `studioPreviewHelpers.ts`
- `domEditSelectionsTargetSame`, `domEditSelectionInGroup`, `toggleDomEditGroupSelection`, `replaceDomEditGroupSelection`, `seedDomEditGroupWithSelection` → already in `domEditHelpers.ts`

Check if the utility files already export every function listed. If any are missing, add the export.

- [ ] **Step 2: Replace local helpers with imports**

Delete lines ~124–500 (the local helper block) from `useDomEditSession.ts`. Add imports at the top:

```ts
import {
  toProjectAbsolutePath,
  normalizeDomEditStyleValue,
  isImageBackgroundValue,
  isManualGeometryStyleProperty,
  findMatchingTimelineElementId,
} from "../utils/studioHelpers";
import {
  getPreviewLocalPointer,
  getPreviewTargetFromPointer,
  buildRasterClickSelectionContext,
  seekStudioPreview,
  pauseStudioPreviewPlayback,
} from "../utils/studioPreviewHelpers";
import {
  domEditSelectionsTargetSame,
  domEditSelectionInGroup,
  toggleDomEditGroupSelection,
  replaceDomEditGroupSelection,
  seedDomEditGroupWithSelection,
} from "../utils/domEditHelpers";
import {
  primaryFontFamilyValue,
  injectPreviewGoogleFont,
  injectPreviewImportedFont,
  ensureImportedFontFace,
} from "../utils/studioFontHelpers";
```

Also check if `normalizeDomEditStyleValue`, `isImageBackgroundValue`, `isManualGeometryStyleProperty`, `findMatchingTimelineElementId` are exported from `studioHelpers.ts`. If not, add exports.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit --project packages/studio/tsconfig.json && cd packages/studio && npx vitest run`
Expected: 0 errors, 464 tests pass.

- [ ] **Step 4: Check line count**

Run: `wc -l packages/studio/src/hooks/useDomEditSession.ts`
Expected: ~1370 lines (down from 1672 — ~300 lines of helpers removed).

- [ ] **Step 5: Commit**

```bash
git add packages/studio/src/hooks/useDomEditSession.ts packages/studio/src/utils/*.ts
git commit -m "refactor(studio): consolidate duplicate helpers in useDomEditSession"
```

---

### Task 3: Extract useDomSelection hook

**Files:**
- Create: `packages/studio/src/hooks/useDomSelection.ts`
- Modify: `packages/studio/src/hooks/useDomEditSession.ts`

- [ ] **Step 1: Create useDomSelection.ts**

Extract from `useDomEditSession.ts`:

**State:**
- `domEditSelection`, `domEditGroupSelections`, `domEditHoverSelection`
- `domEditSelectionRef`, `domEditGroupSelectionsRef`, `domEditHoverSelectionRef`

**Callbacks:**
- `applyDomSelection`
- `clearDomSelection`
- `buildDomSelectionFromTarget`
- `resolveDomSelectionFromPreviewPoint`
- `updateDomEditHoverSelection`
- `buildDomSelectionForTimelineElement`
- `handleTimelineElementSelect`
- `refreshDomEditSelectionFromPreview`
- `refreshDomEditGroupSelectionsFromPreview`

**Effects:**
- All hover-cleanup effects (caption mode, composition change, matching selection, disconnected element)

The hook receives the same params as the parts of `UseDomEditSessionParams` that these callbacks use: `activeCompPath`, `isMasterView`, `compIdToSrc`, `captionEditMode`, `compositionLoading`, `previewIframeRef`, `timelineElements`, `currentTime`, `setSelectedTimelineElementId`, `setRightCollapsed`, `setRightPanelTab`, `refreshPreviewDocumentVersion`, `previewIframe`, `refreshKey`, `rightPanelTab`, `syncPreviewHistoryHotkey`.

Return all state + callbacks listed above.

- [ ] **Step 2: Update useDomEditSession to use useDomSelection**

Replace the extracted state/callbacks/effects in `useDomEditSession.ts` with a call to `useDomSelection(...)`. Spread its return into the combined return object.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit --project packages/studio/tsconfig.json && cd packages/studio && npx vitest run`
Expected: 0 errors, 464 tests pass.

- [ ] **Step 4: Check line counts**

Run: `wc -l packages/studio/src/hooks/useDomSelection.ts packages/studio/src/hooks/useDomEditSession.ts`
Expected: useDomSelection ~300 lines, useDomEditSession ~1100 lines.

- [ ] **Step 5: Commit**

```bash
git add packages/studio/src/hooks/useDomSelection.ts packages/studio/src/hooks/useDomEditSession.ts
git commit -m "refactor(studio): extract useDomSelection from useDomEditSession"
```

---

### Task 4: Extract useAskAgentModal hook

**Files:**
- Create: `packages/studio/src/hooks/useAskAgentModal.ts`
- Modify: `packages/studio/src/hooks/useDomEditSession.ts`

- [ ] **Step 1: Create useAskAgentModal.ts**

Extract from `useDomEditSession.ts`:

**State:** `agentModalOpen`, `agentModalAnchorPoint`, `copiedAgentPrompt`, `agentPromptTagSnippet`, `agentPromptSelectionContext`, `copiedAgentTimerRef`

**Callbacks:** `preloadAgentPromptSnippet`, `handleAskAgent`, `handleAgentModalSubmit`

**Effects:** `copiedAgentTimerRef` cleanup

Params: `projectId`, `activeCompPath`, `projectDir`, `projectIdRef`, `showToast`, `domEditSelectionRef` (from useDomSelection), `currentTime`.

- [ ] **Step 2: Wire into useDomEditSession**

Replace extracted code with `useAskAgentModal(...)` call. Merge return.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit --project packages/studio/tsconfig.json && cd packages/studio && npx vitest run`

- [ ] **Step 4: Commit**

```bash
git add packages/studio/src/hooks/useAskAgentModal.ts packages/studio/src/hooks/useDomEditSession.ts
git commit -m "refactor(studio): extract useAskAgentModal from useDomEditSession"
```

---

### Task 5: Extract usePreviewInteraction hook

**Files:**
- Create: `packages/studio/src/hooks/usePreviewInteraction.ts`
- Modify: `packages/studio/src/hooks/useDomEditSession.ts`

- [ ] **Step 1: Create usePreviewInteraction.ts**

Extract: `handlePreviewCanvasMouseDown`, `handlePreviewCanvasPointerMove`, `handlePreviewCanvasPointerLeave`, `handleBlockedDomMove`, `handleDomManualDragStart`.

Params: `captionEditMode`, `compositionLoading`, `previewIframeRef`, `activeCompPath`, `showToast`, + `applyDomSelection`, `resolveDomSelectionFromPreviewPoint`, `updateDomEditHoverSelection`, `preloadAgentPromptSnippet` from the other sub-hooks.

- [ ] **Step 2: Wire into useDomEditSession**

- [ ] **Step 3: Verify + commit**

```bash
git add packages/studio/src/hooks/usePreviewInteraction.ts packages/studio/src/hooks/useDomEditSession.ts
git commit -m "refactor(studio): extract usePreviewInteraction from useDomEditSession"
```

---

### Task 6: Verify useDomEditSession is now a thin orchestrator

**Files:**
- Check: `packages/studio/src/hooks/useDomEditSession.ts`

- [ ] **Step 1: Check line count**

Run: `wc -l packages/studio/src/hooks/useDomEditSession.ts`
Expected: <500 lines. The file now calls `useDomSelection`, `useDomEditCommits` (the remaining commit handlers — still inline at this point), `useAskAgentModal`, and `usePreviewInteraction`, then merges their returns.

- [ ] **Step 2: If over 500 LOC, extract useDomEditCommits**

If `useDomEditSession.ts` still exceeds 500 lines, the remaining commit handlers (`handleDomStyleCommit`, `handleDomTextCommit`, `handleDomPathOffsetCommit`, etc.) need extraction into `useDomEditCommits.ts`. Same mechanical process as Tasks 3–5.

- [ ] **Step 3: Final verify**

Run: `npx tsc --noEmit --project packages/studio/tsconfig.json && cd packages/studio && npx vitest run && bun run build`
Expected: 0 errors, 464 tests, build succeeds.
Run: `wc -l packages/studio/src/hooks/useDom*.ts`
Expected: All files <500 LOC.

- [ ] **Step 4: Commit if any changes**

---

### Task 7: Create PanelLayoutContext

**Files:**
- Create: `packages/studio/src/contexts/PanelLayoutContext.tsx`

- [ ] **Step 1: Create the context file**

```tsx
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { usePanelLayout } from "../hooks/usePanelLayout";

type PanelLayoutValue = ReturnType<typeof usePanelLayout>;

const PanelLayoutContext = createContext<PanelLayoutValue | null>(null);

export function usePanelLayoutContext(): PanelLayoutValue {
  const ctx = useContext(PanelLayoutContext);
  if (!ctx) throw new Error("usePanelLayoutContext must be used within PanelLayoutProvider");
  return ctx;
}

export function PanelLayoutProvider({
  value,
  children,
}: {
  value: PanelLayoutValue;
  children: ReactNode;
}) {
  const stable = useMemo(
    () => value,
    [
      value.leftWidth,
      value.rightWidth,
      value.leftCollapsed,
      value.rightCollapsed,
      value.rightPanelTab,
      value.setLeftWidth,
      value.setLeftCollapsed,
      value.setRightCollapsed,
      value.setRightPanelTab,
      value.toggleLeftSidebar,
      value.handlePanelResizeStart,
      value.handlePanelResizeMove,
      value.handlePanelResizeEnd,
    ],
  );
  return <PanelLayoutContext value={stable}>{children}</PanelLayoutContext>;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit --project packages/studio/tsconfig.json`

- [ ] **Step 3: Commit**

```bash
git add packages/studio/src/contexts/PanelLayoutContext.tsx
git commit -m "feat(studio): add PanelLayoutContext"
```

---

### Task 8: Create FileManagerContext

**Files:**
- Create: `packages/studio/src/contexts/FileManagerContext.tsx`

Same pattern as Task 7 but wrapping `useFileManager` return. Use `ReturnType<typeof useFileManager>` for the type. Include all members from the hook's return in the `useMemo` deps array.

- [ ] **Step 1: Create the context file** (same pattern as Task 7)
- [ ] **Step 2: Verify + commit**

---

### Task 9: Create DomEditContext

**Files:**
- Create: `packages/studio/src/contexts/DomEditContext.tsx`

Same pattern, wrapping `useDomEditSession` return.

- [ ] **Step 1: Create the context file**
- [ ] **Step 2: Verify + commit**

---

### Task 10: Create StudioContext

**Files:**
- Create: `packages/studio/src/contexts/StudioContext.tsx`

This context is different — it's not wrapping a single hook. It provides cross-cutting values assembled in App.tsx:

```ts
interface StudioContextValue {
  projectId: string;
  activeCompPath: string | null;
  setActiveCompPath: (path: string | null) => void;
  showToast: (message: string, tone?: "error" | "info") => void;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  captionEditMode: boolean;
  compositionLoading: boolean;
  refreshKey: number;
  setRefreshKey: React.Dispatch<React.SetStateAction<number>>;
  currentTime: number;
  timelineElements: TimelineElement[];
  isPlaying: boolean;
  editHistory: { canUndo: boolean; canRedo: boolean; undoLabel: string | undefined; redoLabel: string | undefined };
  handleUndo: () => Promise<void>;
  handleRedo: () => Promise<void>;
  renderQueue: ReturnType<typeof useRenderQueue>;
  compositionDimensions: CompositionDimensions | null;
  waitForPendingDomEditSaves: () => Promise<void>;
}
```

- [ ] **Step 1: Create the context file**
- [ ] **Step 2: Verify + commit**

---

### Task 11: Wire providers in App.tsx

**Files:**
- Modify: `packages/studio/src/App.tsx`

- [ ] **Step 1: Import all 4 providers**

```ts
import { PanelLayoutProvider } from "./contexts/PanelLayoutContext";
import { FileManagerProvider } from "./contexts/FileManagerContext";
import { DomEditProvider } from "./contexts/DomEditContext";
import { StudioProvider } from "./contexts/StudioContext";
```

- [ ] **Step 2: Wrap the JSX return in providers**

The nesting order follows the dependency chain (outermost = fewest deps):

```tsx
<StudioProvider value={studioCtxValue}>
  <PanelLayoutProvider value={panelLayout}>
    <FileManagerProvider value={fileManager}>
      <DomEditProvider value={domEditSession}>
        {/* existing JSX */}
      </DomEditProvider>
    </FileManagerProvider>
  </PanelLayoutProvider>
</StudioProvider>
```

Build the `studioCtxValue` object with `useMemo` from the cross-cutting values.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit --project packages/studio/tsconfig.json && cd packages/studio && npx vitest run`

- [ ] **Step 4: Commit**

```bash
git add packages/studio/src/App.tsx
git commit -m "feat(studio): wire context providers in App.tsx"
```

---

### Task 12: Migrate StudioHeader to contexts

**Files:**
- Modify: `packages/studio/src/components/StudioHeader.tsx`
- Modify: `packages/studio/src/App.tsx` (remove props)

- [ ] **Step 1: Replace props with context calls**

Remove the `StudioHeaderProps` interface. Replace prop destructuring with:

```ts
const { rightCollapsed, setRightCollapsed, setRightPanelTab } = usePanelLayoutContext();
const { projectId, editHistory, handleUndo, handleRedo } = useStudioContext();
const { clearDomSelection } = useDomEditContext();
```

Keep only truly local props that come from App.tsx computations: `captureFrameHref`, `captureFrameFilename`, `handleCaptureFrameClick`, `refreshCaptureFrameTime`, `inspectorButtonActive`, `inspectorPanelActive`. Or compute those inside the component from context values.

- [ ] **Step 2: Update App.tsx** — remove the props from `<StudioHeader>`

- [ ] **Step 3: Verify + commit**

---

### Task 13: Migrate StudioLeftSidebar to contexts

**Files:**
- Modify: `packages/studio/src/components/StudioLeftSidebar.tsx`
- Modify: `packages/studio/src/App.tsx`

Same pattern. Replace file manager props with `useFileManagerContext()`, panel props with `usePanelLayoutContext()`. Keep only `onSelectComposition` and `handleLint`/`linting` as props (or move lint to context if cleaner).

- [ ] **Step 1: Replace props with context**
- [ ] **Step 2: Update App.tsx**
- [ ] **Step 3: Verify + commit**

---

### Task 14: Migrate StudioPreviewArea to contexts

**Files:**
- Modify: `packages/studio/src/components/StudioPreviewArea.tsx`
- Modify: `packages/studio/src/App.tsx`

The biggest prop interface (37 props). Replace with `useDomEditContext()` for selection/overlay handlers, `useStudioContext()` for projectId/refreshKey/captionEditMode.

- [ ] **Step 1: Replace props with context**
- [ ] **Step 2: Update App.tsx**
- [ ] **Step 3: Verify + commit**

---

### Task 15: Migrate StudioRightPanel to contexts

**Files:**
- Modify: `packages/studio/src/components/StudioRightPanel.tsx`
- Modify: `packages/studio/src/App.tsx`

Second biggest (36 props). Uses all 4 contexts.

- [ ] **Step 1: Replace props with context**
- [ ] **Step 2: Update App.tsx**
- [ ] **Step 3: Verify + commit**

---

### Task 16: Final verification + cleanup

**Files:**
- All modified files

- [ ] **Step 1: Full verification suite**

```bash
npx tsc --noEmit --project packages/studio/tsconfig.json
cd packages/studio && npx vitest run
bun run build
bunx oxlint packages/studio/src/**/*.{ts,tsx}
bunx oxfmt --check packages/studio/src/**/*.{ts,tsx}
```

All must pass.

- [ ] **Step 2: File size check**

```bash
find packages/studio/src -name '*.ts' -o -name '*.tsx' | grep -vE '\.(test|spec)\.' | xargs wc -l | sort -rn | head -10
```

No file should exceed 500 lines.

- [ ] **Step 3: Prop interface check**

```bash
for f in packages/studio/src/components/Studio*.tsx; do
  echo "$(basename $f): $(grep -c '^\s\s[a-zA-Z].*:' $f) props"
done
```

Expected: 0–5 props each (only truly local props like `children`).

- [ ] **Step 4: App.tsx line count**

Run: `wc -l packages/studio/src/App.tsx`
Expected: ~350 lines.

- [ ] **Step 5: Commit + push**

```bash
git push
```
