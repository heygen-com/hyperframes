import { useOwnPreviewIframe, usePreviewIframeStore } from "./player/store/previewIframeStore";
import { buildProjectApiPath } from "./utils/projectRouting";
import { useState, useCallback, useRef, useMemo, useLayoutEffect } from "react";
import { useDismissingTabSetter, useRightPanelIntent } from "./hooks/useRightPanelIntents";
import { useRenderQueue } from "./components/renders/useRenderQueue";
import { usePlayerStore } from "./player";
import { StudioOverlays } from "./components/StudioOverlays";
import { SaveQueuePausedBanner } from "./components/SaveQueuePausedBanner";
import { ExternalFileConflictBanner } from "./components/ExternalFileConflictBanner";
import { ProjectUnreachableBanner } from "./components/ProjectUnreachableBanner";
import { CompositionMissingBanner } from "./components/CompositionMissingBanner";
import { useCaptionStore } from "./captions/store";
import { useCaptionSync } from "./captions/hooks/useCaptionSync";
import { usePersistentEditHistory } from "./hooks/usePersistentEditHistory";
import { usePanelLayout } from "./hooks/usePanelLayout";
import { useFileManager } from "./hooks/useFileManager";
import { usePreviewPersistence } from "./hooks/usePreviewPersistence";
import { usePreviewDocumentVersion } from "./hooks/usePreviewDocumentVersion";
import { useTimelineEditing } from "./hooks/useTimelineEditing";
import {
  persistTimelineMoveEditsAtomically,
  type TimelineMoveEditsHandler,
  type TimelineMoveOperation,
} from "./hooks/timelineMoveAdapter";
import type { TimelineZIndexReorderCommit } from "./hooks/useTimelineEditingTypes";
import type { BlockPreviewInfo } from "./components/sidebar/BlocksTab";
import { useDomEditSession } from "./hooks/useDomEditSession";
import { useSdkSelectionSync } from "./hooks/useSdkSelectionSync";
import { useStudioSdkSessions } from "./hooks/useStudioSdkSessions";
import { useStudioExternalFileChanges } from "./hooks/useStudioExternalFileChanges";
import { useBlockHandlers } from "./hooks/useBlockHandlers";
import { useAppHotkeys } from "./hooks/useAppHotkeys";
import { useClipboard } from "./hooks/useClipboard";
import { deleteSelectedKeyframes } from "./hooks/timelineEditingHelpers";
import { useCaptionDetection } from "./hooks/useCaptionDetection";
import { useRenderClipContent } from "./hooks/useRenderClipContent";
import { useConsoleErrorCapture } from "./hooks/useConsoleErrorCapture";
import { useFrameCapture } from "./hooks/useFrameCapture";
import { useLintModal } from "./hooks/useLintModal";
import { useCompositionDimensions } from "./hooks/useCompositionDimensions";
import { useToast } from "./hooks/useToast";
import { useStudioUrlState } from "./hooks/useStudioUrlState";
import { useEffectiveTimelineDuration } from "./hooks/useEffectiveTimelineDuration";
import {
  buildStudioContextValue,
  useGlobalFileDrop,
  useInspectorState,
} from "./hooks/useStudioContextValue";
import type { DomEditSelection } from "./components/editor/domEditing";
import { StudioHeader } from "./components/StudioHeader";
import { useGestureCommit } from "./hooks/useGestureCommit";
import { GestureTrailOverlay } from "./components/editor/GestureTrailOverlay";
import { StudioLeftPanels } from "./components/StudioLeftPanels";
import { EditorShell } from "./components/EditorShell";
import { StudioRightPanels } from "./components/StudioRightPanels";
import { TimelineToolbar } from "./components/TimelineToolbar";
import { StudioPlaybackProvider, StudioShellProvider } from "./contexts/StudioContext";
import { PanelLayoutProvider } from "./contexts/PanelLayoutContext";
import { FileManagerProvider } from "./contexts/FileManagerContext";
import { DomEditProvider } from "./contexts/DomEditContext";
import { StudioSplash } from "./components/StudioSplash";
import { useServerConnection } from "./hooks/useServerConnection";
import { useStudioSessionStart } from "./hooks/useStudioSessionStart";
import { useTimelineAddAtPlayhead } from "./hooks/useTimelineAddAtPlayhead";
import { readStudioUrlStateFromWindow, resolveMasterCompositionPath } from "./utils/studioUrlState";
import { useActiveComposition } from "./hooks/useActiveComposition";
const getTimelineSelectionSet = () => usePlayerStore.getState().selectedElementIds;

export interface StudioAppProps {
  /** Clicks still select and report; the preview cannot move, edit or delete anything. */
  readOnlyPreview?: boolean;
  /** Short text shown on disabled hand-edit controls while `readOnlyPreview` is set. */
  readOnlyPreviewReason?: string;
}

// fallow-ignore-next-line complexity
export function StudioApp({ readOnlyPreview = false, readOnlyPreviewReason }: StudioAppProps = {}) {
  const { projectId, resolving, waitingForServer } = useServerConnection();
  const initialUrlStateRef = useRef(readStudioUrlStateFromWindow());
  useStudioSessionStart(projectId, resolving, waitingForServer);
  const [compIdToSrc, setCompIdToSrc] = useState<Map<string, string>>(new Map());
  const previewIframe = useOwnPreviewIframe();
  const [compositionLoading, setCompositionLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [previewDocumentVersion, refreshPreviewDocumentVersion] = usePreviewDocumentVersion();
  const [blockPreview, setBlockPreview] = useState<BlockPreviewInfo | null>(null);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const captionEditMode = useCaptionStore((s) => s.isEditMode);
  const captionHasSelection = useCaptionStore((s) => s.selectedSegmentIds.size > 0);
  const captionSync = useCaptionSync(projectId);
  const timelineElements = usePlayerStore((s) => s.elements);
  const setSelectedTimelineElementId = usePlayerStore((s) => s.setSelectedElementId);
  const setTimelineSelectionSet = usePlayerStore((s) => s.setSelectedElementIds);
  const timelineDuration = usePlayerStore((s) => s.duration);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const effectiveTimelineDuration = useEffectiveTimelineDuration(
    timelineDuration,
    timelineElements,
  );
  const { toasts, showToast, dismissToast } = useToast();
  const panelLayout = usePanelLayout({
    rightCollapsed: initialUrlStateRef.current.rightCollapsed,
    rightPanelTab: initialUrlStateRef.current.rightPanelTab,
  });
  const editHistory = usePersistentEditHistory({ projectId });
  const handleDomZIndexReorderCommitRef = useRef<TimelineZIndexReorderCommit | null>(null);
  const pendingTimelineEditPathRef = useRef(new Set<string>());
  const isGestureRecordingRef = useRef(false);
  const reloadPreview = useCallback(() => setRefreshKey((k) => k + 1), []);
  const fileManager = useFileManager({
    projectId,
    showToast,
    recordEdit: editHistory.recordEdit,
    setRefreshKey,
  });
  const masterCompPath = useMemo(
    () => resolveMasterCompositionPath(fileManager.compositions),
    [fileManager.compositions],
  );
  const { activeCompPath, activeCompPathHydrated, setActiveCompPath, handleSelectComposition } =
    useActiveComposition({
      projectId,
      initialUrlStateRef,
      fileTree: fileManager.fileTree,
      fileTreeLoaded: fileManager.fileTreeLoaded,
      masterCompPath,
      setEditingFile: fileManager.setEditingFile,
      showToast,
    });
  const { sdkHandle, editFlowSdkSession } = useStudioSdkSessions(
    projectId,
    activeCompPath,
    masterCompPath,
    fileManager.fileTree,
    fileManager.fileTreeLoaded,
    fileManager.refreshFileTree,
  );
  const activeCompPathRef = useRef(activeCompPath);
  activeCompPathRef.current = activeCompPath;
  const renderQueue = useRenderQueue(projectId, activeCompPathRef);
  const previewPersistence = usePreviewPersistence({
    showToast,
    readOptionalProjectFile: fileManager.readOptionalProjectFile,
    writeProjectFile: fileManager.writeProjectFile,
    recordEdit: editHistory.recordEdit,
    previewIframeRef,
    activeCompPathRef,
    reloadPreview: () => setRefreshKey((k) => k + 1),
  });
  const externalFileChanges = useStudioExternalFileChanges({
    projectId,
    activeCompPath,
    masterCompPath,
    fileManager,
    previewPersistence,
    pendingTimelineEditPathRef,
    reloadPreview,
  });
  const invalidateGsapCacheRef = useRef<() => void>(() => {});
  const invalidateGsapCache = useCallback(() => invalidateGsapCacheRef.current(), []);
  const timelineEditing = useTimelineEditing({
    projectId,
    activeCompPath,
    timelineElements,
    showToast,
    writeProjectFile: fileManager.writeProjectFile,
    observeProjectFileVersion: fileManager.observeProjectFileVersion,
    recordEdit: editHistory.recordEdit,
    reloadPreview,
    previewIframeRef,
    pendingTimelineEditPathRef,
    uploadProjectFiles: fileManager.uploadProjectFiles,
    isRecordingRef: isGestureRecordingRef,
    sdkSession: editFlowSdkSession,
    publishSdkSession: sdkHandle.publish,
    forceReloadSdkSession: sdkHandle.forceReload,
    invalidateGsapCache,
    handleDomZIndexReorderCommitRef,
  });
  const handleTimelineElementsMove: TimelineMoveEditsHandler = useCallback(
    async (edits, coalesceKey, operation: TimelineMoveOperation = "timing", coalesceMs) => {
      const deps = { handleTimelineGroupMove: timelineEditing.handleTimelineGroupMove };
      await persistTimelineMoveEditsAtomically(edits, coalesceKey, operation, deps, coalesceMs);
    },
    [timelineEditing.handleTimelineGroupMove],
  );
  const {
    addAssetAtPlayhead: handleAddAssetAtPlayhead,
    addCompositionAtPlayhead: handleAddCompositionAtPlayhead,
  } = useTimelineAddAtPlayhead(
    timelineEditing.handleTimelineAssetDrop,
    timelineEditing.handleTimelineCompositionDrop,
  );
  const {
    activeBlockParams,
    setActiveBlockParams,
    handleAddBlock,
    handleTimelineBlockDrop,
    handleAddMediaOverlay,
    handlePreviewBlockDrop,
  } = useBlockHandlers({
    projectId,
    blockCtxDeps: {
      activeCompPath,
      timelineElements,
      readProjectFile: fileManager.readProjectFile,
      writeProjectFile: fileManager.writeProjectFile,
      recordEdit: editHistory.recordEdit,
      refreshFileTree: fileManager.refreshFileTree,
      reloadPreview,
      showToast,
    },
    previewIframeRef,
    setRightCollapsed: panelLayout.setRightCollapsed,
    setRightPanelTab: panelLayout.setRightPanelTab,
  });
  const dismissBlockParams = useCallback(() => setActiveBlockParams(null), [setActiveBlockParams]);
  const setRightPanelTab = useDismissingTabSetter(panelLayout.setRightPanelTab, dismissBlockParams);
  const layout = useMemo(
    () => ({ ...panelLayout, setRightPanelTab }),
    [panelLayout, setRightPanelTab],
  );

  const clearDomSelectionRef = useRef<() => void>(() => {});
  const domEditSelectionBridgeRef = useRef<DomEditSelection | null>(null);
  type DomEditDelete = (s: DomEditSelection, o?: { expandGroup?: boolean }) => Promise<void>;
  const handleDomEditElementDeleteRef = useRef<DomEditDelete>(async () => {});
  const domEditDeleteBridge: DomEditDelete = (s, o) => handleDomEditElementDeleteRef.current(s, o);
  const resetKeyframesRef = useRef<() => boolean>(() => false);
  const deleteSelectedKeyframesRef = useRef<() => void>(() => {});
  const { handleCopy, handlePaste, handleCut, handleDuplicate, canPaste } = useClipboard({
    projectId,
    activeCompPath,
    domEditSelectionRef: domEditSelectionBridgeRef,
    showToast,
    writeProjectFile: fileManager.writeProjectFile,
    recordEdit: editHistory.recordEdit,
    reloadPreview,
    handleTimelineElementsDelete: timelineEditing.handleTimelineElementsDelete,
    handleDomEditElementDelete: domEditDeleteBridge,
    previewIframeRef,
    waitForPendingDomEditSaves: previewPersistence.waitForPendingDomEditSaves,
  });
  const appHotkeys = useAppHotkeys({
    handleTimelineElementsDelete: timelineEditing.handleTimelineElementsDelete,
    handleTimelineElementSplit: timelineEditing.handleTimelineElementSplit,
    handleDomEditElementDelete: domEditDeleteBridge,
    domEditSelectionRef: domEditSelectionBridgeRef,
    clearDomSelectionRef,
    editHistory,
    readOptionalProjectFile: fileManager.readOptionalProjectFile,
    readProjectFile: fileManager.readProjectFile,
    writeProjectFile: fileManager.writeProjectFile,
    showToast,
    syncHistoryPreviewAfterApply: previewPersistence.syncHistoryPreviewAfterApply,
    waitForPendingDomEditSaves: previewPersistence.waitForPendingDomEditSaves,
    handleCopy,
    handlePaste,
    handleCut,
    handleDuplicate,
    onResetKeyframes: () => resetKeyframesRef.current(),
    onDeleteSelectedKeyframes: () => deleteSelectedKeyframesRef.current(),
    onAfterUndoRedo: () => invalidateGsapCacheRef.current(),
    onGroupSelection: () => domEditSessionRef.current.handleGroupSelection(),
    onUngroupSelection: () => domEditSessionRef.current.handleUngroupSelection(),
    activeCompPath,
    forceReloadSdkSession: sdkHandle.forceReload,
    onToggleRecording: () => handleToggleRecordingRef.current(),
    readOnlyPreview,
  });
  const domEditSession = useDomEditSession({
    projectId,
    activeCompPath,
    compIdToSrc,
    captionEditMode,
    compositionLoading,
    previewIframeRef,
    timelineElements,
    getTimelineSelectionSet,
    setSelectedTimelineElementId,
    setTimelineSelectionSet,
    setRightCollapsed: panelLayout.setRightCollapsed,
    setRightPanelTab,
    showToast,
    isRecordingRef: isGestureRecordingRef,
    refreshPreviewDocumentVersion,
    queueDomEditSave: previewPersistence.queueDomEditSave,
    readProjectFile: fileManager.readProjectFile,
    writeProjectFile: fileManager.writeProjectFile,
    updateEditingFileContent: fileManager.updateEditingFileContent,
    editHistory: { recordEdit: editHistory.recordEdit },
    fileTree: fileManager.fileTree,
    importedFontAssetsRef: fileManager.importedFontAssetsRef,
    projectDir: fileManager.projectDir,
    projectIdRef: fileManager.projectIdRef,
    previewIframe,
    refreshKey,
    previewDocumentVersion,
    rightPanelTab: panelLayout.rightPanelTab,
    applyStudioManualEditsToPreviewRef: previewPersistence.applyStudioManualEditsToPreviewRef,
    syncPreviewHotkeys: appHotkeys.syncPreviewHotkeys,
    reloadPreview,
    setRefreshKey,
    openSourceForSelection: fileManager.openSourceForSelection,
    sdkSession: editFlowSdkSession,
    publishSdkSession: sdkHandle.publish,
    forceReloadSdkSession: sdkHandle.forceReload,
    handleTimelineElementsDelete: timelineEditing.handleTimelineElementsDelete,
    readOnlyPreview,
  });
  domEditSelectionBridgeRef.current = domEditSession.domEditSelection;
  handleDomZIndexReorderCommitRef.current = domEditSession.handleDomZIndexReorderCommit;
  clearDomSelectionRef.current = domEditSession.clearDomSelection;
  handleDomEditElementDeleteRef.current = domEditSession.handleDomEditElementDelete;
  resetKeyframesRef.current = domEditSession.handleResetSelectedElementKeyframes;
  invalidateGsapCacheRef.current = domEditSession.invalidateGsapCache;
  deleteSelectedKeyframesRef.current = () => deleteSelectedKeyframes(domEditSession);
  useSdkSelectionSync(
    editFlowSdkSession,
    domEditSession.domEditSelection,
    domEditSession.domEditGroupSelections,
  );
  useCaptionDetection({
    projectId,
    activeCompPath,
    compIdToSrc,
    captionEditMode,
    captionHasSelection,
    previewIframeRef,
    captionSync,
    setRightCollapsed: panelLayout.setRightCollapsed,
  });
  const renderClipContent = useRenderClipContent({
    projectIdRef: fileManager.projectIdRef,
    compIdToSrc,
    activePreviewUrl:
      activeCompPath && projectId
        ? buildProjectApiPath(projectId, `/preview/comp/${activeCompPath}`)
        : null,
    effectiveTimelineDuration,
  });
  const compositionDimensions = useCompositionDimensions(previewIframeRef);
  const { lintModal, linting, handleLint, closeLintModal, findingsByFile, hasLintError } =
    useLintModal(projectId, refreshKey);
  const frameCapture = useFrameCapture({
    projectId,
    activeCompPath,
    showToast,
    waitForPendingDomEditSaves: previewPersistence.waitForPendingDomEditSaves,
  });
  const {
    consoleErrors,
    setConsoleErrors,
    resetErrors: resetConsoleErrors,
  } = useConsoleErrorCapture(previewIframe);
  const fileDrop = useGlobalFileDrop(timelineEditing.handleTimelineFileDrop);
  const handleToggleRecordingRef = useRef<() => void>(() => {});
  const domEditSessionRef = useRef(domEditSession);
  domEditSessionRef.current = domEditSession;
  const { gestureState, gestureRecording, handleToggleRecording } = useGestureCommit({
    domEditSessionRef,
    previewIframeRef,
    showToast,
    isGestureRecordingRef,
    readOnlyPreview,
  });
  handleToggleRecordingRef.current = handleToggleRecording;
  const canvasRectRef = useRef<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (gestureState !== "recording" || !previewIframe) {
      canvasRectRef.current = null;
      return;
    }
    canvasRectRef.current = previewIframe.getBoundingClientRect();
  }, [gestureState, previewIframe]);
  const handlePreviewIframeRef = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      previewIframeRef.current = iframe;
      usePreviewIframeStore.getState().setIframe(iframe);
      appHotkeys.syncPreviewHotkeys(iframe);
      resetConsoleErrors();
      refreshPreviewDocumentVersion();
    },
    [appHotkeys, resetConsoleErrors, refreshPreviewDocumentVersion],
  );
  const rightPanel = useRightPanelIntent();
  const { inspectorPanelActive, shouldShowMotionPath, shouldShowSelectedDomBounds } =
    useInspectorState(
      rightPanel,
      isPlaying,
      domEditSession.domEditSelection,
      gestureState === "recording",
    );
  // The dock has no separate "railed by window width" state (it shrinks
  // panels, never auto-hides the group), so rightCollapsed is already the
  // value that decides whether the panel is actually showing.
  const inspectorButtonActive = !panelLayout.rightCollapsed && inspectorPanelActive;
  useStudioUrlState({
    projectId,
    activeCompPath,
    duration: effectiveTimelineDuration,
    isPlaying,
    compositionLoading,
    refreshKey,
    previewIframeRef,
    rightPanelTab: panelLayout.rightPanelTab,
    rightCollapsed: panelLayout.rightCollapsed,
    activeCompPathHydrated,
    domEditSelection: domEditSession.domEditSelection,
    domEditGroupSelections: domEditSession.domEditGroupSelections,
    applyMarqueeSelection: domEditSession.applyMarqueeSelection,
    buildDomSelectionFromTarget: domEditSession.buildDomSelectionFromTarget,
    applyDomSelection: domEditSession.applyDomSelection,
    setRightPanelTab,
    initialState: initialUrlStateRef.current,
  });
  const studioCtxValue = buildStudioContextValue({
    projectId: projectId!,
    activeCompPath,
    setActiveCompPath,
    showToast,
    previewIframeRef,
    captionEditMode,
    compositionLoading,
    refreshKey,
    setRefreshKey,
    timelineElements,
    isPlaying,
    editHistory,
    handleUndo: appHotkeys.handleUndo,
    handleRedo: appHotkeys.handleRedo,
    renderQueue,
    compositionDimensions,
    domEditSaveQueuePaused: previewPersistence.domEditSaveQueuePaused,
    externalFileConflict: externalFileChanges.blocked !== null,
    waitForPendingDomEditSaves: previewPersistence.waitForPendingDomEditSaves,
    handlePreviewIframeRef,
    refreshPreviewDocumentVersion,
  });
  const timelineToolbar = useMemo(
    () => (
      <TimelineToolbar
        domEditSession={domEditSession}
        onSplitElement={timelineEditing.handleTimelineElementSplit}
      />
    ),
    [domEditSession, timelineEditing.handleTimelineElementSplit],
  );
  if (resolving || waitingForServer || !projectId)
    return <StudioSplash waiting={waitingForServer} />;
  return (
    <StudioShellProvider value={studioCtxValue}>
      <StudioPlaybackProvider value={studioCtxValue}>
        <PanelLayoutProvider value={layout}>
          <FileManagerProvider value={fileManager}>
            <DomEditProvider value={domEditSession}>
              <div
                className="flex flex-col h-full w-full bg-neutral-950 relative"
                onDragOver={fileDrop.onDragOver}
                onDrop={fileDrop.onDrop}
              >
                <StudioHeader
                  captureFrameHref={frameCapture.captureFrameHref}
                  captureFrameFilename={frameCapture.captureFrameFilename}
                  handleCaptureFrameClick={frameCapture.handleCaptureFrameClick}
                  refreshCaptureFrameTime={frameCapture.refreshCaptureFrameTime}
                  capturing={frameCapture.capturing}
                  inspectorButtonActive={inspectorButtonActive}
                  inspectorPanelActive={inspectorPanelActive}
                  onExport={() => {
                    void (async () => {
                      await previewPersistence.waitForPendingDomEditSaves();
                      await renderQueue.startRender(undefined);
                    })();
                  }}
                />
                {previewPersistence.domEditSaveQueuePaused && !externalFileChanges.blocked && (
                  <SaveQueuePausedBanner
                    message={previewPersistence.domEditSaveQueuePaused}
                    onRetry={previewPersistence.resetDomEditSaveQueueBreaker}
                  />
                )}
                <ExternalFileConflictBanner coordinator={externalFileChanges} />
                {sdkHandle.unreachableProject && (
                  <ProjectUnreachableBanner projectId={sdkHandle.unreachableProject} />
                )}
                {sdkHandle.compositionMissing && activeCompPath && (
                  <CompositionMissingBanner path={activeCompPath} />
                )}
                <EditorShell
                  readOnlyPreview={readOnlyPreview}
                  readOnlyPreviewReason={readOnlyPreviewReason}
                  panels={
                    <>
                      <StudioLeftPanels
                        onSelectComposition={handleSelectComposition}
                        onAddBlock={handleAddBlock}
                        onPreviewBlock={setBlockPreview}
                        onLint={handleLint}
                        linting={linting}
                        lintFindingCount={lintModal?.length ?? findingsByFile.size}
                        lintFindingsByFile={findingsByFile}
                        lintHasError={hasLintError}
                        onAddAssetToTimeline={handleAddAssetAtPlayhead}
                        onAddCompositionToTimeline={handleAddCompositionAtPlayhead}
                      />
                      <StudioRightPanels
                        activeBlockParams={activeBlockParams}
                        onDismissBlockParams={dismissBlockParams}
                        onCloseBlockParams={() => {
                          setActiveBlockParams(null);
                          panelLayout.setRightPanelTab("design");
                        }}
                        recordingState={gestureState}
                        recordingDuration={gestureRecording.recordingDuration}
                        onToggleRecording={handleToggleRecording}
                        sdkSession={sdkHandle.session}
                        publishSdkSession={sdkHandle.publish}
                        forceReloadSdkSession={sdkHandle.forceReload}
                        reloadPreview={reloadPreview}
                        recordEdit={editHistory.recordEdit}
                        onToggleElementHidden={timelineEditing.handleToggleElementHidden}
                        onAutoGroupCarveSources={timelineEditing.handleAutoGroupCarveSources}
                        onAddMediaOverlay={handleAddMediaOverlay}
                      />
                    </>
                  }
                  timelineToolbar={timelineToolbar}
                  renderClipContent={renderClipContent}
                  handleTimelineElementDelete={timelineEditing.handleTimelineElementDelete}
                  handleTimelineAssetDrop={timelineEditing.handleTimelineAssetDrop}
                  handleTimelineBlockDrop={handleTimelineBlockDrop}
                  handleTimelineCompositionDrop={timelineEditing.handleTimelineCompositionDrop}
                  handlePreviewBlockDrop={handlePreviewBlockDrop}
                  handleTimelineFileDrop={timelineEditing.handleTimelineFileDrop}
                  handleTimelineElementMove={timelineEditing.handleTimelineElementMove}
                  handleTimelineElementsMove={handleTimelineElementsMove}
                  handleTimelineElementResize={timelineEditing.handleTimelineElementResize}
                  handleTimelineGroupResize={timelineEditing.handleTimelineGroupResize}
                  handleToggleTrackHidden={timelineEditing.handleToggleTrackHidden}
                  setAudioGroupAttribute={timelineEditing.setAudioGroupAttribute}
                  handleGroupClips={timelineEditing.handleAutoGroupCarveSources}
                  setElementFxAttribute={timelineEditing.setElementFxAttribute}
                  handleBlockedTimelineEdit={timelineEditing.handleBlockedTimelineEdit}
                  handleTimelineElementSplit={timelineEditing.handleTimelineElementSplit}
                  handleRazorSplit={timelineEditing.handleRazorSplit}
                  handleRazorSplitAll={timelineEditing.handleRazorSplitAll}
                  onCopyClip={handleCopy}
                  onPasteClip={handlePaste}
                  onDuplicateClip={handleDuplicate}
                  canPasteClip={canPaste}
                  setCompIdToSrc={setCompIdToSrc}
                  setCompositionLoading={setCompositionLoading}
                  shouldShowMotionPath={shouldShowMotionPath}
                  shouldShowSelectedDomBounds={shouldShowSelectedDomBounds}
                  isGestureRecording={gestureState === "recording"}
                  recordingState={gestureState}
                  onToggleRecording={handleToggleRecording}
                  blockPreview={blockPreview}
                  gestureOverlay={
                    gestureState === "recording" && previewIframe ? (
                      <GestureTrailOverlay
                        samples={gestureRecording.samplesRef.current}
                        sampleCount={gestureRecording.samplesRef.current.length}
                        trail={gestureRecording.trailRef.current}
                        canvasRect={canvasRectRef.current!}
                        compositionSize={compositionDimensions ?? undefined}
                        mode="recording"
                      />
                    ) : undefined
                  }
                />
                <StudioOverlays
                  projectId={projectId}
                  projectDir={fileManager.projectDir}
                  lintModal={lintModal}
                  closeLintModal={closeLintModal}
                  consoleErrors={consoleErrors}
                  clearConsoleErrors={() => setConsoleErrors(null)}
                  domEditSession={domEditSession}
                  activeCompPath={activeCompPath}
                  toasts={toasts}
                  dismissToast={dismissToast}
                />
              </div>
            </DomEditProvider>
          </FileManagerProvider>
        </PanelLayoutProvider>
      </StudioPlaybackProvider>
    </StudioShellProvider>
  );
}
