import { useCallback, useEffect } from "react";
import type { TimelineElement } from "../player";
import { STUDIO_INSPECTOR_PANELS_ENABLED } from "../components/editor/manualEditingAvailability";
import { findElementForSelection, type DomEditSelection } from "../components/editor/domEditing";
import type { ImportedFontAsset } from "../components/editor/fontAssets";
import type { EditHistoryKind } from "../utils/editHistory";
import type { RightPanelTab } from "../utils/studioHelpers";
import type { PatchTarget } from "../utils/sourcePatcher";
import type { SidebarTab } from "../components/sidebar/LeftSidebar";
import { useAskAgentModal } from "./useAskAgentModal";
import { useDomSelection } from "./useDomSelection";
import { usePreviewInteraction } from "./usePreviewInteraction";
import { useDomEditCommits } from "./useDomEditCommits";

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
}

// ── Hook ──

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
    preloadAgentPromptSnippet,
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
    updateDomEditHoverSelection,
    preloadAgentPromptSnippet,
    setAgentPromptSelectionContext,
    setAgentModalAnchorPoint,
    setAgentModalOpen,
    onClickToSource,
  });

  // ── Commit handlers (delegated to useDomEditCommits) ──

  const {
    resolveImportedFontAsset,
    handleDomStyleCommit,
    handleDomAttributeCommit,
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

  // ── Effects ──

  // Sync selection from preview document on load / refresh
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!previewIframe) return;

    const syncSelectionFromDocument = () => {
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

      const nextElement = findElementForSelection(doc, currentSelection, activeCompPath);
      if (!nextElement) {
        applyDomSelection(null, { revealPanel: false });
        return;
      }

      const nextSelection = buildDomSelectionFromTarget(nextElement);
      if (nextSelection) {
        applyDomSelection(nextSelection, { revealPanel: false, preserveGroup: true });
      }
    };

    syncPreviewHistoryHotkey(previewIframe);
    void applyStudioManualEditsToPreviewRef.current(previewIframe);
    syncSelectionFromDocument();
    refreshPreviewDocumentVersion();

    const handleLoad = () => {
      syncPreviewHistoryHotkey(previewIframe);
      void applyStudioManualEditsToPreviewRef.current(previewIframe);
      syncSelectionFromDocument();
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
    handleDomPathOffsetCommit,
    handleDomGroupPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
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
  };
}
