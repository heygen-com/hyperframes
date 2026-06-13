import { useCallback, useEffect, useRef } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import {
  STUDIO_GSAP_DRAG_INTERCEPT_ENABLED,
  STUDIO_GSAP_PANEL_ENABLED,
} from "../components/editor/manualEditingAvailability";
import { type DomEditSelection } from "../components/editor/domEditing";
import { useDomEditPreviewSync } from "./useDomEditPreviewSync";
import type { ImportedFontAsset } from "../components/editor/fontAssets";
import type { EditHistoryKind } from "../utils/editHistory";
import type { RightPanelTab } from "../utils/studioHelpers";
import type { PatchTarget } from "../utils/sourcePatcher";
import type { SidebarTab } from "../components/sidebar/LeftSidebar";
import { useAskAgentModal } from "./useAskAgentModal";
import { useDomSelection } from "./useDomSelection";
import { usePreviewInteraction } from "./usePreviewInteraction";
import { GSAP_CSS_FALLBACK_BLOCKED_MESSAGE, useDomEditCommits } from "./useDomEditCommits";
import { useGsapScriptCommits } from "./useGsapScriptCommits";
import {
  useGsapAnimationsForElement,
  useGsapCacheVersion,
  usePopulateKeyframeCacheForFile,
} from "./useGsapTweenCache";
import {
  tryGsapDragIntercept,
  tryGsapResizeIntercept,
  tryGsapRotationIntercept,
} from "./gsapRuntimeBridge";
import { useAnimatedPropertyCommit } from "./useAnimatedPropertyCommit";
import { useGsapAnimationFetchFallback } from "./useGsapAnimationFetchFallback";
import { useGsapInteractionFailureTelemetry } from "./useGsapInteractionFailureTelemetry";
import { useGsapSelectionHandlers } from "./useGsapSelectionHandlers";

// ── Types ──

interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

export interface UseDomEditSessionParams {
  projectId: string | null;
  activeCompPath: string | null;
  isMasterView: boolean;
  compIdToSrc: Map<string, string>;
  captionEditMode: boolean;
  compositionLoading: boolean;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  timelineElements: TimelineElement[];
  setSelectedTimelineElementId: (id: string | null) => void;
  setRightCollapsed: (collapsed: boolean) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  showToast: (message: string, tone?: "error" | "info") => void;
  refreshPreviewDocumentVersion: () => void;
  queueDomEditSave: (save: () => Promise<void>) => Promise<void>;
  readProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  updateEditingFileContent: (path: string, content: string) => void;
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  editHistory: { recordEdit: (entry: RecordEditInput) => Promise<void> };
  fileTree: string[];
  importedFontAssetsRef: React.MutableRefObject<ImportedFontAsset[]>;
  projectDir: string | null;
  projectIdRef: React.MutableRefObject<string | null>;
  previewIframe: HTMLIFrameElement | null;
  refreshKey: number;
  rightPanelTab: RightPanelTab;
  applyStudioManualEditsToPreviewRef: React.MutableRefObject<
    (iframe: HTMLIFrameElement) => Promise<void>
  >;
  syncPreviewHistoryHotkey: (iframe: HTMLIFrameElement | null) => void;
  reloadPreview: () => void;
  setRefreshKey: React.Dispatch<React.SetStateAction<number>>;
  openSourceForSelection?: (sourceFile: string, target: PatchTarget) => void;
  selectSidebarTab?: (tab: SidebarTab) => void;
  getSidebarTab?: () => SidebarTab;
}

// ── Hook ──

// fallow-ignore-next-line complexity
export function useDomEditSession({
  projectId,
  activeCompPath,
  isMasterView,
  compIdToSrc,
  captionEditMode,
  compositionLoading,
  previewIframeRef,
  timelineElements,
  setSelectedTimelineElementId,
  setRightCollapsed,
  setRightPanelTab,
  showToast,
  refreshPreviewDocumentVersion,
  queueDomEditSave,
  readProjectFile: _readProjectFile,
  writeProjectFile,
  updateEditingFileContent,
  domEditSaveTimestampRef,
  editHistory,
  fileTree,
  importedFontAssetsRef,
  projectDir,
  projectIdRef,
  previewIframe,
  refreshKey,
  rightPanelTab,
  applyStudioManualEditsToPreviewRef,
  syncPreviewHistoryHotkey,
  reloadPreview,
  setRefreshKey: _setRefreshKey,
  openSourceForSelection,
  selectSidebarTab,
  getSidebarTab,
}: UseDomEditSessionParams) {
  void _setRefreshKey;

  const onClickToSource = useCallback(
    (selection: DomEditSelection) => {
      if (!openSourceForSelection || !selectSidebarTab) return;
      if (!selection.sourceFile) return;
      selectSidebarTab("code");
      openSourceForSelection(selection.sourceFile, {
        id: selection.id,
        selector: selection.selector,
        selectorIndex: selection.selectorIndex,
      });
    },
    [openSourceForSelection, selectSidebarTab],
  );

  // ── Selection (delegated to useDomSelection) ──

  const {
    domEditSelection,
    domEditGroupSelections,
    domEditHoverSelection,
    domEditSelectionRef,
    applyDomSelection,
    clearDomSelection,
    buildDomSelectionFromTarget,
    resolveDomSelectionFromPreviewPoint,
    resolveAllDomSelectionsFromPreviewPoint,
    updateDomEditHoverSelection,
    buildDomSelectionForTimelineElement,
    handleTimelineElementSelect,
    refreshDomEditSelectionFromPreview,
  } = useDomSelection({
    projectId,
    activeCompPath,
    isMasterView,
    compIdToSrc,
    captionEditMode,
    previewIframeRef,
    timelineElements,
    setSelectedTimelineElementId,
    setRightCollapsed,
    setRightPanelTab,
    previewIframe,
    refreshKey,
    rightPanelTab,
  });

  // ── Agent modal (delegated to useAskAgentModal) ──

  const {
    agentModalOpen,
    agentModalAnchorPoint,
    copiedAgentPrompt,
    agentPromptSelectionContext,
    setAgentModalOpen,
    setAgentPromptSelectionContext,
    setAgentModalAnchorPoint,
    handleAskAgent,
    handleAgentModalSubmit,
  } = useAskAgentModal({
    projectId,
    activeCompPath,
    projectDir,
    projectIdRef,
    showToast,
    domEditSelectionRef,
    domEditSelection,
  });

  // ── Preview interaction (delegated to usePreviewInteraction) ──

  const {
    handlePreviewCanvasMouseDown,
    handlePreviewCanvasPointerMove,
    handlePreviewCanvasPointerLeave,
    handleBlockedDomMove,
    handleDomManualDragStart,
  } = usePreviewInteraction({
    captionEditMode,
    compositionLoading,
    previewIframeRef,
    showToast,
    applyDomSelection,
    resolveDomSelectionFromPreviewPoint,
    resolveAllDomSelectionsFromPreviewPoint,
    updateDomEditHoverSelection,
    onClickToSource,
  });

  // Sync DOM selection → timeline selectedElementId so that clip selection
  // highlights and diamond playhead fills work on cold-load URL restore.
  useEffect(() => {
    if (!domEditSelection?.id) return;
    const { selectedElementId, elements, setSelectedElementId } = usePlayerStore.getState();
    const matchKey = elements.find(
      (el) => el.domId === domEditSelection.id || el.id === domEditSelection.id,
    );
    const key = matchKey ? (matchKey.key ?? matchKey.id) : null;
    if (key && key !== selectedElementId) setSelectedElementId(key);
  }, [domEditSelection?.id]);

  // ── GSAP script editing ──

  const { version: gsapCacheVersion, bump: bumpGsapCache } = useGsapCacheVersion();

  // Bump GSAP cache when refreshKey changes (code-tab edits trigger iframe
  // reload via refreshKey but don't go through commitMutation, so the cache
  // would otherwise retain stale keyframe entries).
  const prevRefreshKeyRef = useRef(refreshKey);
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (refreshKey !== prevRefreshKeyRef.current) {
      prevRefreshKeyRef.current = refreshKey;
      bumpGsapCache();
    }
  }, [refreshKey, bumpGsapCache]);

  const gsapSourceFile = domEditSelection?.sourceFile || activeCompPath || "index.html";

  usePopulateKeyframeCacheForFile(
    STUDIO_GSAP_PANEL_ENABLED ? (projectId ?? null) : null,
    gsapSourceFile,
    gsapCacheVersion,
    previewIframeRef,
  );

  const {
    animations: selectedGsapAnimations,
    multipleTimelines: gsapMultipleTimelines,
    unsupportedTimelinePattern: gsapUnsupportedTimelinePattern,
  } = useGsapAnimationsForElement(
    STUDIO_GSAP_PANEL_ENABLED ? (projectId ?? null) : null,
    gsapSourceFile,
    domEditSelection
      ? { id: domEditSelection.id ?? null, selector: domEditSelection.selector ?? null }
      : null,
    gsapCacheVersion,
  );

  const {
    commitMutation: gsapCommitMutation,
    updateGsapProperty,
    updateGsapMeta,
    deleteGsapAnimation,
    deleteAllForSelector,
    addGsapAnimation,
    addGsapProperty,
    removeGsapProperty,
    updateGsapFromProperty,
    addGsapFromProperty,
    removeGsapFromProperty,
    addKeyframe,
    addKeyframeBatch,
    removeKeyframe,
    convertToKeyframes,
    removeAllKeyframes,
    setArcPath,
    updateArcSegment,
  } = useGsapScriptCommits({
    projectIdRef,
    activeCompPath,
    previewIframeRef,
    editHistory,
    domEditSaveTimestampRef,
    reloadPreview,
    onCacheInvalidate: bumpGsapCache,
    onFileContentChanged: updateEditingFileContent,
    showToast,
  });

  // ── Commit handlers (delegated to useDomEditCommits) ──

  const {
    resolveImportedFontAsset,
    handleDomStyleCommit,
    handleDomAttributeCommit,
    handleDomHtmlAttributeCommit,
    handleDomTextCommit,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
    handleDomPathOffsetCommit,
    handleDomGroupPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomManualEditsReset,
    handleDomEditElementDelete,
    handleDomZIndexReorderCommit,
  } = useDomEditCommits({
    activeCompPath,
    previewIframeRef,
    showToast,
    queueDomEditSave,
    writeProjectFile,
    domEditSaveTimestampRef,
    editHistory,
    fileTree,
    importedFontAssetsRef,
    projectId,
    projectIdRef,
    reloadPreview,
    domEditSelection,
    applyDomSelection,
    clearDomSelection,
    refreshDomEditSelectionFromPreview,
    buildDomSelectionFromTarget,
  });

  const trackGsapInteractionFailure = useGsapInteractionFailureTelemetry(activeCompPath, showToast);

  const makeFetchFallback = useGsapAnimationFetchFallback(projectId, gsapSourceFile);

  // GSAP-aware: intercept offset/resize/rotation to commit via script mutation when animated.
  const handleGsapAwarePathOffsetCommit = useCallback(
    async (selection: DomEditSelection, next: { x: number; y: number }) => {
      const hasGsapAnims = selectedGsapAnimations.length > 0;
      if (hasGsapAnims && !STUDIO_GSAP_DRAG_INTERCEPT_ENABLED) {
        showToast(GSAP_CSS_FALLBACK_BLOCKED_MESSAGE, "error");
        throw new Error(GSAP_CSS_FALLBACK_BLOCKED_MESSAGE);
      }
      if (STUDIO_GSAP_DRAG_INTERCEPT_ENABLED && gsapCommitMutation) {
        try {
          const handled = await tryGsapDragIntercept(
            selection,
            next,
            selectedGsapAnimations,
            previewIframeRef.current,
            gsapCommitMutation,
            makeFetchFallback(selection),
          );
          if (handled) return;
        } catch (error) {
          trackGsapInteractionFailure(error, selection, "drag", "Move animated layer");
          throw error;
        }
      }
      return handleDomPathOffsetCommit(selection, next);
    },
    [
      handleDomPathOffsetCommit,
      selectedGsapAnimations,
      gsapCommitMutation,
      previewIframeRef,
      makeFetchFallback,
      trackGsapInteractionFailure,
      showToast,
    ],
  );

  const handleGsapAwareBoxSizeCommit = useCallback(
    async (selection: DomEditSelection, next: { width: number; height: number }) => {
      if (STUDIO_GSAP_DRAG_INTERCEPT_ENABLED && gsapCommitMutation) {
        try {
          const handled = await tryGsapResizeIntercept(
            selection,
            next,
            selectedGsapAnimations,
            previewIframeRef.current,
            gsapCommitMutation,
            makeFetchFallback(selection),
          );
          if (handled) return;
        } catch (error) {
          trackGsapInteractionFailure(error, selection, "resize", "Resize animated layer");
          throw error;
        }
      }
      return handleDomBoxSizeCommit(selection, next);
    },
    [
      handleDomBoxSizeCommit,
      selectedGsapAnimations,
      gsapCommitMutation,
      previewIframeRef,
      makeFetchFallback,
      trackGsapInteractionFailure,
    ],
  );

  const handleGsapAwareRotationCommit = useCallback(
    async (selection: DomEditSelection, next: { angle: number }) => {
      if (STUDIO_GSAP_DRAG_INTERCEPT_ENABLED && gsapCommitMutation) {
        try {
          const handled = await tryGsapRotationIntercept(
            selection,
            next.angle,
            selectedGsapAnimations,
            previewIframeRef.current,
            gsapCommitMutation,
            makeFetchFallback(selection),
          );
          if (handled) return;
        } catch (error) {
          trackGsapInteractionFailure(error, selection, "rotation", "Rotate animated layer");
          throw error;
        }
      }
      return handleDomRotationCommit(selection, next);
    },
    [
      handleDomRotationCommit,
      selectedGsapAnimations,
      gsapCommitMutation,
      previewIframeRef,
      makeFetchFallback,
      trackGsapInteractionFailure,
    ],
  );

  const {
    handleGsapUpdateProperty,
    handleGsapUpdateMeta,
    handleGsapDeleteAnimation,
    handleGsapDeleteAllForElement,
    handleGsapAddAnimation,
    handleGsapAddProperty,
    handleGsapRemoveProperty,
    handleGsapUpdateFromProperty,
    handleGsapAddFromProperty,
    handleGsapRemoveFromProperty,
    handleGsapAddKeyframe,
    handleGsapAddKeyframeBatch,
    handleGsapRemoveKeyframe,
    handleGsapConvertToKeyframes,
    handleGsapRemoveAllKeyframes,
    handleResetSelectedElementKeyframes,
  } = useGsapSelectionHandlers({
    domEditSelection,
    updateGsapProperty,
    updateGsapMeta,
    deleteGsapAnimation,
    deleteAllForSelector,
    addGsapAnimation,
    addGsapProperty,
    removeGsapProperty,
    updateGsapFromProperty,
    addGsapFromProperty,
    removeGsapFromProperty,
    addKeyframe,
    addKeyframeBatch,
    removeKeyframe,
    convertToKeyframes,
    removeAllKeyframes,
    handleDomManualEditsReset,
    selectedGsapAnimations,
  });

  const commitAnimatedProperty = useAnimatedPropertyCommit({
    selectedGsapAnimations,
    gsapCommitMutation,
    addGsapAnimation: (sel, method, time) => addGsapAnimation(sel, method, time),
    convertToKeyframes: (sel, animId) => convertToKeyframes(sel, animId),
    previewIframeRef,
    bumpGsapCache,
  });

  const handleSetArcPath = useCallback(
    (animId: string, config: Parameters<typeof setArcPath>[2]) => {
      if (!domEditSelection) return;
      setArcPath(domEditSelection, animId, config);
    },
    [domEditSelection, setArcPath],
  );

  const handleUpdateArcSegment = useCallback(
    (animId: string, segmentIndex: number, update: Parameters<typeof updateArcSegment>[3]) => {
      if (!domEditSelection) return;
      updateArcSegment(domEditSelection, animId, segmentIndex, update);
    },
    [domEditSelection, updateArcSegment],
  );

  useDomEditPreviewSync({
    previewIframe,
    activeCompPath,
    captionEditMode,
    domEditSelectionRef,
    domEditSelection,
    applyDomSelection,
    buildDomSelectionFromTarget,
    refreshPreviewDocumentVersion,
    syncPreviewHistoryHotkey,
    applyStudioManualEditsToPreviewRef,
    openSourceForSelection,
    getSidebarTab,
  });

  return {
    // State
    domEditSelection,
    domEditGroupSelections,
    domEditHoverSelection,
    agentModalOpen,
    agentModalAnchorPoint,
    copiedAgentPrompt,
    agentPromptSelectionContext,
    // Refs
    domEditSelectionRef,
    // Callbacks
    handleTimelineElementSelect,
    handlePreviewCanvasMouseDown,
    handlePreviewCanvasPointerMove,
    handlePreviewCanvasPointerLeave,
    applyDomSelection,
    clearDomSelection,
    handleDomStyleCommit,
    handleDomAttributeCommit,
    handleDomHtmlAttributeCommit,
    handleDomPathOffsetCommit: handleGsapAwarePathOffsetCommit,
    handleDomGroupPathOffsetCommit,
    handleDomZIndexReorderCommit,
    handleDomBoxSizeCommit: handleGsapAwareBoxSizeCommit,
    handleDomRotationCommit: handleGsapAwareRotationCommit,
    handleDomManualEditsReset,
    handleDomTextCommit,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
    handleAskAgent,
    handleAgentModalSubmit,
    handleBlockedDomMove,
    handleDomManualDragStart,
    handleDomEditElementDelete,
    buildDomSelectionFromTarget,
    buildDomSelectionForTimelineElement,
    updateDomEditHoverSelection,
    resolveImportedFontAsset,
    setAgentModalOpen,
    setAgentPromptSelectionContext,
    setAgentModalAnchorPoint,

    // GSAP script editing
    selectedGsapAnimations,
    gsapMultipleTimelines,
    gsapUnsupportedTimelinePattern,
    handleGsapUpdateProperty,
    handleGsapUpdateMeta,
    handleGsapDeleteAnimation,
    handleGsapDeleteAllForElement,
    handleGsapAddAnimation,
    handleGsapAddProperty,
    handleGsapRemoveProperty,
    handleGsapUpdateFromProperty,
    handleGsapAddFromProperty,
    handleGsapRemoveFromProperty,
    handleGsapAddKeyframe,
    handleGsapAddKeyframeBatch,
    handleGsapRemoveKeyframe,
    handleGsapConvertToKeyframes,
    handleGsapRemoveAllKeyframes,
    handleResetSelectedElementKeyframes,
    commitAnimatedProperty,
    handleSetArcPath,
    handleUpdateArcSegment,
    invalidateGsapCache: bumpGsapCache,
    previewIframeRef,
    commitMutation: async (
      mutation: Record<string, unknown>,
      options: { label: string; softReload?: boolean },
    ) => {
      if (!domEditSelection) return;
      await gsapCommitMutation(domEditSelection, mutation, options);
    },
  };
}
