import { useCallback, useEffect, useRef } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_GSAP_PANEL_ENABLED,
} from "../components/editor/manualEditingAvailability";
import { findElementForSelection, type DomEditSelection } from "../components/editor/domEditing";
import { reapplyPositionEditsAfterSeek } from "../components/editor/manualEdits";
import type { ImportedFontAsset } from "../components/editor/fontAssets";
import type { EditHistoryKind } from "../utils/editHistory";
import type { RightPanelTab } from "../utils/studioHelpers";
import type { PatchTarget } from "../utils/sourcePatcher";
import type { SidebarTab } from "../components/sidebar/LeftSidebar";
import { useAskAgentModal } from "./useAskAgentModal";
import { useDomSelection } from "./useDomSelection";
import { usePreviewInteraction } from "./usePreviewInteraction";
import { useDomEditCommits } from "./useDomEditCommits";
import { useGsapScriptCommits } from "./useGsapScriptCommits";
import {
  useGsapAnimationsForElement,
  useGsapCacheVersion,
  usePopulateKeyframeCacheForFile,
  fetchParsedAnimations,
  getAnimationsForElement,
} from "./useGsapTweenCache";
import {
  tryGsapDragIntercept,
  tryGsapResizeIntercept,
  tryGsapRotationIntercept,
} from "./gsapRuntimeBridge";
import { useAnimatedPropertyCommit } from "./useAnimatedPropertyCommit";
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
  currentTime: number;
  setSelectedTimelineElementId: (id: string | null) => void;
  setRightCollapsed: (collapsed: boolean) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  showToast: (message: string, tone?: "error" | "info") => void;
  refreshPreviewDocumentVersion: () => void;
  queueDomEditSave: (save: () => Promise<void>) => Promise<void>;
  readProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
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
  currentTime,
  setSelectedTimelineElementId,
  setRightCollapsed,
  setRightPanelTab,
  showToast,
  refreshPreviewDocumentVersion,
  queueDomEditSave,
  readProjectFile: _readProjectFile,
  writeProjectFile,
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
    currentTime,
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

  const gsapSourceFile = domEditSelection?.sourceFile || activeCompPath || "index.html";

  usePopulateKeyframeCacheForFile(
    STUDIO_GSAP_PANEL_ENABLED ? (projectId ?? null) : null,
    gsapSourceFile,
    gsapCacheVersion,
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
    addGsapAnimation,
    addGsapProperty,
    removeGsapProperty,
    updateGsapFromProperty,
    addGsapFromProperty,
    removeGsapFromProperty,
    addKeyframe,
    removeKeyframe,
    convertToKeyframes,
    removeAllKeyframes,
  } = useGsapScriptCommits({
    projectIdRef,
    activeCompPath,
    previewIframeRef,
    editHistory,
    domEditSaveTimestampRef,
    reloadPreview,
    onCacheInvalidate: bumpGsapCache,
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
    handleDomMotionCommit,
    handleDomMotionClear,
    handleDomEditElementDelete,
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

  // GSAP-aware: intercept offset/resize/rotation to commit via script mutation when animated.
  const handleGsapAwarePathOffsetCommit = useCallback(
    async (selection: DomEditSelection, next: { x: number; y: number }) => {
      if (gsapCommitMutation) {
        const handled = await tryGsapDragIntercept(
          selection,
          next,
          selectedGsapAnimations,
          previewIframeRef.current,
          gsapCommitMutation,
          async () => {
            const pid = projectId;
            if (!pid) return [];
            const parsed = await fetchParsedAnimations(pid, gsapSourceFile);
            if (!parsed) return [];
            const target = { id: selection.id ?? null, selector: selection.selector ?? null };
            return getAnimationsForElement(parsed.animations, target);
          },
        );
        if (handled) return;
      }
      handleDomPathOffsetCommit(selection, next);
    },
    [
      handleDomPathOffsetCommit,
      selectedGsapAnimations,
      gsapCommitMutation,
      previewIframeRef,
      projectId,
      gsapSourceFile,
    ],
  );

  const makeFetchFallback = useCallback(
    (selection: DomEditSelection) => async () => {
      const pid = projectId;
      if (!pid) return [];
      const parsed = await fetchParsedAnimations(pid, gsapSourceFile);
      if (!parsed) return [];
      return getAnimationsForElement(parsed.animations, {
        id: selection.id ?? null,
        selector: selection.selector ?? null,
      });
    },
    [projectId, gsapSourceFile],
  );

  const handleGsapAwareBoxSizeCommit = useCallback(
    async (selection: DomEditSelection, next: { width: number; height: number }) => {
      if (gsapCommitMutation) {
        const handled = await tryGsapResizeIntercept(
          selection,
          next,
          selectedGsapAnimations,
          previewIframeRef.current,
          gsapCommitMutation,
          makeFetchFallback(selection),
        );
        if (handled) return;
      }
      handleDomBoxSizeCommit(selection, next);
    },
    [
      handleDomBoxSizeCommit,
      selectedGsapAnimations,
      gsapCommitMutation,
      previewIframeRef,
      makeFetchFallback,
    ],
  );

  const handleGsapAwareRotationCommit = useCallback(
    async (selection: DomEditSelection, next: { angle: number }) => {
      if (gsapCommitMutation) {
        const handled = await tryGsapRotationIntercept(
          selection,
          next.angle,
          selectedGsapAnimations,
          previewIframeRef.current,
          gsapCommitMutation,
          makeFetchFallback(selection),
        );
        if (handled) return;
      }
      handleDomRotationCommit(selection, next);
    },
    [
      handleDomRotationCommit,
      selectedGsapAnimations,
      gsapCommitMutation,
      previewIframeRef,
      makeFetchFallback,
    ],
  );

  const {
    handleGsapUpdateProperty,
    handleGsapUpdateMeta,
    handleGsapDeleteAnimation,
    handleGsapAddAnimation,
    handleGsapAddProperty,
    handleGsapRemoveProperty,
    handleGsapUpdateFromProperty,
    handleGsapAddFromProperty,
    handleGsapRemoveFromProperty,
    handleGsapAddKeyframe,
    handleGsapRemoveKeyframe,
    handleGsapConvertToKeyframes,
    handleGsapRemoveAllKeyframes,
    handleResetSelectedElementKeyframes,
  } = useGsapSelectionHandlers({
    domEditSelection,
    updateGsapProperty,
    updateGsapMeta,
    deleteGsapAnimation,
    addGsapAnimation,
    addGsapProperty,
    removeGsapProperty,
    updateGsapFromProperty,
    addGsapFromProperty,
    removeGsapFromProperty,
    addKeyframe,
    removeKeyframe,
    convertToKeyframes,
    removeAllKeyframes,
    currentTime,
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

  // Sync selection from preview document on load / refresh
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!previewIframe) return;

    // fallow-ignore-next-line complexity
    const syncSelectionFromDocument = async () => {
      if (!STUDIO_INSPECTOR_PANELS_ENABLED || captionEditMode) return;
      const currentSelection = domEditSelectionRef.current;
      if (!currentSelection) return;
      let doc: Document | null = null;
      try {
        doc = previewIframe.contentDocument;
      } catch {
        return;
      }
      if (!doc) return;

      reapplyPositionEditsAfterSeek(doc);

      const nextElement = findElementForSelection(doc, currentSelection, activeCompPath);
      if (!nextElement) {
        applyDomSelection(null, { revealPanel: false });
        return;
      }

      const nextSelection = await buildDomSelectionFromTarget(nextElement);
      if (nextSelection) {
        applyDomSelection(nextSelection, { revealPanel: false, preserveGroup: true });
      }
    };

    syncPreviewHistoryHotkey(previewIframe);
    void applyStudioManualEditsToPreviewRef.current(previewIframe);
    void syncSelectionFromDocument();
    refreshPreviewDocumentVersion();

    const handleLoad = () => {
      syncPreviewHistoryHotkey(previewIframe);
      void applyStudioManualEditsToPreviewRef.current(previewIframe);
      void syncSelectionFromDocument();
      refreshPreviewDocumentVersion();
    };

    previewIframe.addEventListener("load", handleLoad);
    return () => {
      previewIframe.removeEventListener("load", handleLoad);
    };
  }, [
    activeCompPath,
    applyDomSelection,
    buildDomSelectionFromTarget,
    captionEditMode,
    domEditSelectionRef,
    previewIframe,
    refreshPreviewDocumentVersion,
    syncPreviewHistoryHotkey,
    applyStudioManualEditsToPreviewRef,
  ]);

  // Auto-reveal source when an element is selected while the Code tab is active.
  // Use a ref for the callback so the effect only fires on selection changes,
  // not when openSourceForSelection is recreated due to editingFile content updates.
  const openSourceRef = useRef(openSourceForSelection);
  openSourceRef.current = openSourceForSelection;
  useEffect(
    // fallow-ignore-next-line complexity
    () => {
      if (!domEditSelection || !openSourceRef.current || !getSidebarTab) return;
      if (!domEditSelection.sourceFile) return;
      if (getSidebarTab() !== "code") return;
      openSourceRef.current(domEditSelection.sourceFile, {
        id: domEditSelection.id,
        selector: domEditSelection.selector,
        selectorIndex: domEditSelection.selectorIndex,
      });
    },
    [domEditSelection, getSidebarTab],
  );

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
    handleDomBoxSizeCommit: handleGsapAwareBoxSizeCommit,
    handleDomRotationCommit: handleGsapAwareRotationCommit,
    handleDomManualEditsReset,
    handleDomMotionCommit,
    handleDomMotionClear,
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
    handleGsapAddAnimation,
    handleGsapAddProperty,
    handleGsapRemoveProperty,
    handleGsapUpdateFromProperty,
    handleGsapAddFromProperty,
    handleGsapRemoveFromProperty,
    handleGsapAddKeyframe,
    handleGsapRemoveKeyframe,
    handleGsapConvertToKeyframes,
    handleGsapRemoveAllKeyframes,
    handleResetSelectedElementKeyframes,
    commitAnimatedProperty,
    invalidateGsapCache: bumpGsapCache,
    previewIframeRef,
  };
}
