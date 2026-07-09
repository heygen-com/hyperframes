import { useCallback } from "react";
import { trackStudioEvent } from "../utils/studioTelemetry";
import type { TimelineElement } from "../player";
import type { ImportedFontAsset } from "../components/editor/fontAssets";
import type { EditHistoryKind } from "../utils/editHistory";
import type { RightPanelTab } from "../utils/studioHelpers";
import type { PatchTarget } from "../utils/sourcePatcher";
import type { SidebarTab } from "../components/sidebar/LeftSidebar";
import type { Composition } from "@hyperframes/sdk";
import { sdkCutoverPersist, sdkDeletePersist } from "../utils/sdkCutover";
import { runResolverShadow, recordResolverParity } from "../utils/sdkResolverShadow";
import { useAskAgentModal } from "./useAskAgentModal";
import { useDomSelection } from "./useDomSelection";
import { usePreviewInteraction } from "./usePreviewInteraction";
import { useDomEditCommits } from "./useDomEditCommits";
import { useGroupCommits } from "./useGroupCommits";
import { useGsapScriptCommits } from "./useGsapScriptCommits";
import { useAnimeScriptCommits } from "./useAnimeScriptCommits";
import { useGsapCacheVersion } from "./useGsapTweenCache";
import { useDomEditWiring } from "./useDomEditWiring";
import { useGsapAwareEditing } from "./useGsapAwareEditing";
import { useStudioSelectionPublisher } from "./useStudioSelectionPublisher";
import { useKeyframeEaseHandlers } from "./useKeyframeEaseHandlers";

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
  previewDocumentVersion: number;
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
  sdkSession?: Composition | null;
  forceReloadSdkSession?: () => void;
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
  setSelectedTimelineElementId,
  setRightCollapsed,
  setRightPanelTab,
  showToast,
  refreshPreviewDocumentVersion,
  queueDomEditSave,
  readProjectFile,
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
  previewDocumentVersion,
  rightPanelTab,
  applyStudioManualEditsToPreviewRef,
  syncPreviewHistoryHotkey,
  reloadPreview,
  setRefreshKey: _setRefreshKey,
  openSourceForSelection,
  selectSidebarTab,
  getSidebarTab,
  sdkSession,
  forceReloadSdkSession,
}: UseDomEditSessionParams) {
  void _setRefreshKey;

  const {
    domEditSelection,
    domEditGroupSelections,
    domEditHoverSelection,
    activeGroupElement,
    domEditSelectionRef,
    domEditGroupSelectionsRef,
    setActiveGroupElement,
    applyDomSelection,
    clearDomSelection,
    buildDomSelectionFromTarget,
    resolveDomSelectionFromPreviewPoint,
    resolveAllDomSelectionsFromPreviewPoint,
    updateDomEditHoverSelection,
    buildDomSelectionForTimelineElement,
    handleTimelineElementSelect,
    refreshDomEditSelectionFromPreview,
    applyMarqueeSelection,
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

  useStudioSelectionPublisher({
    projectId,
    domEditSelection,
    domEditSelectionRef,
    refreshKey,
    previewDocumentVersion,
    refreshDomEditSelectionFromPreview,
  });

  const { version: gsapCacheVersion, bump: bumpGsapCache } = useGsapCacheVersion();
  const { version: animeCacheVersion, bump: bumpAnimeCache } = useGsapCacheVersion();
  const bumpAnimationCaches = useCallback(() => {
    bumpGsapCache();
    bumpAnimeCache();
  }, [bumpAnimeCache, bumpGsapCache]);

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
    moveKeyframe,
    resizeKeyframedTween,
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
    sdkSession,
    writeProjectFile,
    forceReloadSdkSession,
  });

  const {
    commitMutation: animeCommitMutation,
    updateAnimeProperty,
    updateAnimeMeta,
    deleteAnimeAnimation,
    addAnimeAnimation,
    addAnimeProperty,
    removeAnimeProperty,
    updateAnimePropertyKeyframe,
  } = useAnimeScriptCommits({
    projectIdRef,
    activeCompPath,
    previewIframeRef,
    editHistory,
    domEditSaveTimestampRef,
    reloadPreview,
    onCacheInvalidate: bumpAnimeCache,
    onFileContentChanged: updateEditingFileContent,
    showToast,
    forceReloadSdkSession,
  });

  const {
    resolveImportedFontAsset,
    handleDomStyleCommit,
    handleDomAttributeCommit,
    handleDomAttributeLiveCommit,
    handleDomHtmlAttributeCommit,
    handleDomTextCommit,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
    handleDomBoxSizeCommit,
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
    forceReloadSdkSession,
    onTrySdkPersist: sdkSession
      ? (selection, operations, originalContent, targetPath, options) => {
          // Resolver shadow runs regardless of the cutover flag — decoupled tripwire.
          // Pass originalContent so the runtime-node filter can suppress hf-ids
          // absent from source (script-created nodes the SDK can't model).
          runResolverShadow(sdkSession, selection.hfId, operations, originalContent);
          return sdkCutoverPersist(
            selection,
            operations,
            originalContent,
            targetPath,
            sdkSession,
            {
              editHistory,
              writeProjectFile,
              reloadPreview,
              domEditSaveTimestampRef,
              compositionPath: activeCompPath,
            },
            options,
          );
        }
      : undefined,
    onTrySdkDelete: sdkSession
      ? (hfId, originalContent, targetPath) =>
          sdkDeletePersist(hfId, originalContent, targetPath, sdkSession, {
            editHistory,
            writeProjectFile,
            reloadPreview,
            domEditSaveTimestampRef,
            compositionPath: activeCompPath,
          })
      : undefined,
    // Resolver shadow for the z-index reorder edit: it takes the server path (no
    // SDK persist), but the tripwire is decoupled from cutover — record whether
    // the SDK resolves each reordered element (the reorderElements op's targets).
    onReorderShadow: sdkSession
      ? (targets: string[]) => {
          // Single-flight: every target in one reorder batch shares the same file, so
          // memoize the read instead of firing one fetch per unresolved target.
          let reorderSrcPromise: Promise<string> | undefined;
          const reorderSrc = activeCompPath
            ? () => (reorderSrcPromise ??= readProjectFile(activeCompPath))
            : undefined;
          for (const target of targets)
            void recordResolverParity(sdkSession, target, "reorderElements", reorderSrc);
        }
      : undefined,
  });

  const { groupSelection, ungroupSelection } = useGroupCommits({
    activeCompPath,
    showToast,
    writeProjectFile,
    domEditSaveTimestampRef,
    editHistory,
    projectIdRef,
    reloadPreview,
    clearDomSelection,
    forceReloadSdkSession,
  });

  const handleGroupSelection = useCallback(() => {
    const group = domEditGroupSelectionsRef.current;
    const single = domEditSelectionRef.current;
    const members = group.length > 0 ? group : single ? [single] : [];
    if (members.length < 2) {
      showToast("Select at least 2 elements to group", "info");
      return;
    }
    trackStudioEvent("group", { action: "create", count: members.length });
    void groupSelection(members);
  }, [domEditGroupSelectionsRef, domEditSelectionRef, groupSelection, showToast]);

  const handleUngroupSelection = useCallback(() => {
    const sel = domEditSelectionRef.current;
    if (!sel?.element.hasAttribute("data-hf-group")) {
      showToast("Select a group to ungroup", "info");
      return;
    }
    // Dissolving the group exits any drill-in (the wrapper is about to vanish).
    trackStudioEvent("group", { action: "ungroup" });
    setActiveGroupElement(null);
    void ungroupSelection(sel);
  }, [domEditSelectionRef, ungroupSelection, setActiveGroupElement, showToast]);

  const {
    onClickToSource,
    selectedGsapAnimations,
    gsapMultipleTimelines,
    gsapUnsupportedTimelinePattern,
    trackGsapInteractionFailure,
    makeFetchFallback,
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
    handleGsapMoveKeyframeToPlayhead,
    handleGsapMoveKeyframe,
    handleGsapResizeKeyframedTween,
    handleGsapConvertToKeyframes,
    handleGsapRemoveAllKeyframes,
    handleResetSelectedElementKeyframes,
    handleGsapUpdateKeyframeEase: tryUpdateAnimeKeyframeEase,
  } = useDomEditWiring({
    // fallow-ignore-next-line code-duplication
    projectId,
    activeCompPath,
    domEditSelection,
    domEditSelectionRef,
    previewIframeRef,
    previewIframe,
    captionEditMode,
    refreshKey,
    gsapCacheVersion,
    bumpGsapCache,
    animeCacheVersion,
    bumpAnimeCache,
    showToast,
    refreshPreviewDocumentVersion,
    syncPreviewHistoryHotkey,
    applyStudioManualEditsToPreviewRef,
    applyDomSelection,
    buildDomSelectionFromTarget,
    openSourceForSelection,
    selectSidebarTab,
    getSidebarTab,
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
    moveKeyframe,
    resizeKeyframedTween,
    convertToKeyframes,
    removeAllKeyframes,
    updateAnimeProperty,
    updateAnimeMeta,
    deleteAnimeAnimation,
    addAnimeAnimation,
    addAnimeProperty,
    removeAnimeProperty,
    updateAnimePropertyKeyframe,
    handleDomManualEditsReset,
  });

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
    setActiveGroupElement,
    onClickToSource,
  });

  const {
    handleGsapAwarePathOffsetCommit,
    handleGsapAwareGroupPathOffsetCommit,
    handleGsapAwareBoxSizeCommit,
    handleGsapAwareRotationCommit,
    commitAnimatedProperty,
    commitAnimatedProperties,
    handleSetArcPath,
    handleUpdateArcSegment,
    handleUnroll,
    commitMutation,
  } = useGsapAwareEditing({
    domEditSelection,
    selectedGsapAnimations,
    gsapCommitMutation,
    animeCommitMutation,
    previewIframeRef,
    showToast,
    bumpGsapCache: bumpAnimationCaches,
    makeFetchFallback,
    trackGsapInteractionFailure,
    handleDomBoxSizeCommit,
    addGsapAnimation,
    convertToKeyframes,
    setArcPath,
    updateArcSegment,
  });

  const { handleUpdateKeyframeEase, handleSetAllKeyframeEases } = useKeyframeEaseHandlers({
    domEditSelectionRef,
    commitMutation: gsapCommitMutation,
    tryUpdateAnimeKeyframeEase,
  });

  return {
    // State
    domEditSelection,
    domEditGroupSelections,
    domEditHoverSelection,
    activeGroupElement,
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
    handleDomAttributeLiveCommit,
    handleDomHtmlAttributeCommit,
    handleDomPathOffsetCommit: handleGsapAwarePathOffsetCommit,
    handleDomGroupPathOffsetCommit: handleGsapAwareGroupPathOffsetCommit,
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
    handleGroupSelection,
    handleUngroupSelection,
    setActiveGroupElement,
    buildDomSelectionFromTarget,
    buildDomSelectionForTimelineElement,
    updateDomEditHoverSelection,
    applyMarqueeSelection,
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
    handleGsapMoveKeyframeToPlayhead,
    handleGsapMoveKeyframe,
    handleGsapResizeKeyframedTween,
    handleGsapConvertToKeyframes,
    handleGsapRemoveAllKeyframes,
    handleResetSelectedElementKeyframes,
    handleUpdateKeyframeEase,
    handleSetAllKeyframeEases,
    commitAnimatedProperty,
    commitAnimatedProperties,
    handleSetArcPath,
    handleUpdateArcSegment,
    handleUnroll,
    invalidateGsapCache: bumpAnimationCaches,
    previewIframeRef,
    commitMutation,
  };
}
