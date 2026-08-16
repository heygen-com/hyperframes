import { useState, useCallback, useRef, useMemo, useLayoutEffect } from "react";
import type { LeftSidebarHandle, SidebarTab } from "./components/sidebar/LeftSidebar";
import { useRenderQueue } from "./components/renders/useRenderQueue";
import { usePlayerStore } from "./player";
import { StudioOverlays } from "./components/StudioOverlays";
import { SaveQueuePausedBanner } from "./components/SaveQueuePausedBanner";
import { ExternalFileConflictBanner } from "./components/ExternalFileConflictBanner";
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
import { useCompositionContentLoader } from "./hooks/useCompositionContentLoader";
import { useStudioUrlState } from "./hooks/useStudioUrlState";
import { useEffectiveTimelineDuration } from "./hooks/useEffectiveTimelineDuration";
import { useAudioSoloBridge } from "./hooks/useAudioSoloBridge";
import {
  buildStudioContextValue,
  useGlobalFileDrop,
  useInspectorState,
} from "./hooks/useStudioContextValue";
import type { DomEditSelection } from "./components/editor/domEditing";
import { StudioHeader } from "./components/StudioHeader";
import { useGestureCommit } from "./hooks/useGestureCommit";
import { GestureTrailOverlay } from "./components/editor/GestureTrailOverlay";
import { StudioLeftSidebar } from "./components/StudioLeftSidebar";
import { EditorShell } from "./components/EditorShell";
import { StudioRightPanel } from "./components/StudioRightPanel";
import { TimelineToolbar } from "./components/TimelineToolbar";
import { StudioPlaybackProvider, StudioShellProvider } from "./contexts/StudioContext";
import { PanelLayoutProvider } from "./contexts/PanelLayoutContext";
import { ViewModeProvider, useViewModeState } from "./contexts/ViewModeContext";
import { StoryboardView } from "./components/storyboard/StoryboardView";
import { FileManagerProvider } from "./contexts/FileManagerContext";
import { DomEditProvider } from "./contexts/DomEditContext";
import { StudioSplash } from "./components/StudioSplash";
import { useServerConnection } from "./hooks/useServerConnection";
import { useStudioSessionStart } from "./hooks/useStudioSessionStart";
import { useTimelineAddAtPlayhead } from "./hooks/useTimelineAddAtPlayhead";
import { readStudioUrlStateFromWindow, resolveMasterCompositionPath } from "./utils/studioUrlState";
import { useHydrateActiveCompPathFromUrl } from "./hooks/useHydrateActiveCompPathFromUrl";
const getTimelineSelectionSet = () => usePlayerStore.getState().selectedElementIds;
// fallow-ignore-next-line complexity
export function StudioApp() {
  const { projectId, resolving, waitingForServer } = useServerConnection();
  const initialUrlStateRef = useRef(readStudioUrlStateFromWindow());
  const viewModeValue = useViewModeState();
  useStudioSessionStart(projectId, resolving, waitingForServer);
  const [activeCompPath, setActiveCompPath] = useState<string | null>(null);
  const [activeCompPathHydrated, setActiveCompPathHydrated] = useState(
    () => initialUrlStateRef.current.activeCompPath == null,
  );
  const [compIdToSrc, setCompIdToSrc] = useState<Map<string, string>>(new Map());
  const [previewIframe, setPreviewIframe] = useState<HTMLIFrameElement | null>(null);
  const [compositionLoading, setCompositionLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [previewDocumentVersion, refreshPreviewDocumentVersion] = usePreviewDocumentVersion();
  const [blockPreview, setBlockPreview] = useState<BlockPreviewInfo | null>(null);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  useAudioSoloBridge(previewIframeRef);
  const activeCompPathRef = useRef(activeCompPath);
  activeCompPathRef.current = activeCompPath;
  const leftSidebarRef = useRef<LeftSidebarHandle>(null);
  const renderQueue = useRenderQueue(projectId);
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
  const domEditSaveTimestampRef = useRef(0);
  const handleDomZIndexReorderCommitRef = useRef<TimelineZIndexReorderCommit | null>(null);
  const pendingTimelineEditPathRef = useRef(new Set<string>());
  const isGestureRecordingRef = useRef(false);
  const reloadPreview = useCallback(() => setRefreshKey((k) => k + 1), []);
  const fileManager = useFileManager({
    projectId,
    showToast,
    recordEdit: editHistory.recordEdit,
    domEditSaveTimestampRef,
    setRefreshKey,
  });
  const masterCompPath = useMemo(
    () => resolveMasterCompositionPath(fileManager.fileTree),
    [fileManager.fileTree],
  );
  const { sdkHandle, editFlowSdkSession } = useStudioSdkSessions(
    projectId,
    activeCompPath,
    masterCompPath,
  );
  useHydrateActiveCompPathFromUrl({
    hydrated: activeCompPathHydrated,
    fileTreeLoaded: fileManager.fileTreeLoaded,
    fileTree: fileManager.fileTree,
    initialUrlStateRef,
    setActiveCompPath,
    setHydrated: setActiveCompPathHydrated,
  });
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
    domEditSaveTimestampRef,
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
  const clearDomSelectionRef = useRef<() => void>(() => {});
  const domEditSelectionBridgeRef = useRef<DomEditSelection | null>(null);
  type DomEditDelete = (s: DomEditSelection, o?: { expandGroup?: boolean }) => Promise<void>;
  const handleDomEditElementDeleteRef = useRef<DomEditDelete>(async () => {});
  const domEditDeleteBridge: DomEditDelete = (s, o) => handleDomEditElementDeleteRef.current(s, o);
  const resetKeyframesRef = useRef<() => boolean>(() => false);
  const deleteSelectedKeyframesRef = useRef<() => void>(() => {});
  const { handleCopy, handlePaste, handleCut } = useClipboard({
    projectId,
    activeCompPath,
    domEditSelectionRef: domEditSelectionBridgeRef,
    showToast,
    writeProjectFile: fileManager.writeProjectFile,
    recordEdit: editHistory.recordEdit,
    domEditSaveTimestampRef,
    reloadPreview,
    handleTimelineElementDelete: timelineEditing.handleTimelineElementDelete,
    handleDomEditElementDelete: domEditDeleteBridge,
    previewIframeRef,
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
    domEditSaveTimestampRef,
    showToast,
    syncHistoryPreviewAfterApply: previewPersistence.syncHistoryPreviewAfterApply,
    waitForPendingDomEditSaves: previewPersistence.waitForPendingDomEditSaves,
    leftSidebarRef,
    handleCopy,
    handlePaste,
    handleCut,
    onResetKeyframes: () => resetKeyframesRef.current(),
    onDeleteSelectedKeyframes: () => deleteSelectedKeyframesRef.current(),
    onAfterUndoRedo: () => invalidateGsapCacheRef.current(),
    onGroupSelection: () => domEditSessionRef.current.handleGroupSelection(),
    onUngroupSelection: () => domEditSessionRef.current.handleUngroupSelection(),
    activeCompPath,
    forceReloadSdkSession: sdkHandle.forceReload,
    onToggleRecording: () => handleToggleRecordingRef.current(),
  });
  const sidebarTabRef = useRef({
    select: (t: SidebarTab) => leftSidebarRef.current?.selectTab(t),
    get: () => leftSidebarRef.current?.getTab() ?? "compositions",
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
    setRightPanelTab: panelLayout.setRightPanelTab,
    showToast,
    isRecordingRef: isGestureRecordingRef,
    refreshPreviewDocumentVersion,
    queueDomEditSave: previewPersistence.queueDomEditSave,
    readProjectFile: fileManager.readProjectFile,
    writeProjectFile: fileManager.writeProjectFile,
    updateEditingFileContent: fileManager.updateEditingFileContent,
    domEditSaveTimestampRef,
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
    selectSidebarTab: sidebarTabRef.current.select,
    getSidebarTab: sidebarTabRef.current.get,
    sdkSession: editFlowSdkSession,
    publishSdkSession: sdkHandle.publish,
    forceReloadSdkSession: sdkHandle.forceReload,
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
    activePreviewUrl: activeCompPath
      ? `/api/projects/${projectId}/preview/comp/${activeCompPath}`
      : null,
    effectiveTimelineDuration,
  });
  const compositionDimensions = useCompositionDimensions();
  const { lintModal, linting, handleLint, closeLintModal, findingsByFile } = useLintModal(
    projectId,
    refreshKey,
  );
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
  const dragOverlay = useGlobalFileDrop(timelineEditing.handleTimelineFileDrop);
  const handleToggleRecordingRef = useRef<() => void>(() => {});
  const domEditSessionRef = useRef(domEditSession);
  domEditSessionRef.current = domEditSession;
  const { gestureState, gestureRecording, handleToggleRecording } = useGestureCommit({
    domEditSessionRef,
    previewIframeRef,
    showToast,
    isGestureRecordingRef,
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
      setPreviewIframe(iframe);
      appHotkeys.syncPreviewHotkeys(iframe);
      resetConsoleErrors();
      refreshPreviewDocumentVersion();
    },
    [appHotkeys, resetConsoleErrors, refreshPreviewDocumentVersion],
  );
  const { setEditingFile } = fileManager;
  const handleSelectComposition = useCompositionContentLoader({
    projectId,
    setEditingFile,
    setActiveCompPath,
    showToast,
  });
  const {
    designPanelActive,
    inspectorPanelActive,
    inspectorButtonActive,
    shouldShowMotionPath,
    shouldShowSelectedDomBounds,
  } = useInspectorState(
    panelLayout.rightPanelTab,
    panelLayout.rightInspectorPanes,
    panelLayout.effectiveRightCollapsed,
    isPlaying,
    domEditSession.domEditSelection,
    gestureState === "recording",
  );
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
    setRightPanelTab: panelLayout.setRightPanelTab,
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
        <ViewModeProvider value={viewModeValue}>
          <PanelLayoutProvider value={panelLayout}>
            <FileManagerProvider value={fileManager}>
              <DomEditProvider value={domEditSession}>
                <div
                  className="flex flex-col h-full w-full bg-neutral-950 relative"
                  onDragOver={dragOverlay.onDragOver}
                  onDragEnter={dragOverlay.onDragEnter}
                  onDragLeave={dragOverlay.onDragLeave}
                  onDrop={dragOverlay.onDrop}
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
                  {viewModeValue.viewMode === "storyboard" && (
                    <StoryboardView
                      projectId={projectId}
                      onSelectComposition={handleSelectComposition}
                    />
                  )}
                  <EditorShell
                    hidden={viewModeValue.viewMode === "storyboard"}
                    left={
                      <StudioLeftSidebar
                        leftSidebarRef={leftSidebarRef}
                        onSelectComposition={handleSelectComposition}
                        onAddBlock={handleAddBlock}
                        onPreviewBlock={setBlockPreview}
                        onLint={handleLint}
                        linting={linting}
                        lintFindingCount={lintModal?.length ?? findingsByFile.size}
                        lintFindingsByFile={findingsByFile}
                        onAddAssetToTimeline={handleAddAssetAtPlayhead}
                        onAddCompositionToTimeline={handleAddCompositionAtPlayhead}
                      />
                    }
                    right={
                      panelLayout.effectiveRightCollapsed ? null : (
                        <StudioRightPanel
                          designPanelActive={designPanelActive}
                          activeBlockParams={activeBlockParams}
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
                          domEditSaveTimestampRef={domEditSaveTimestampRef}
                          recordEdit={editHistory.recordEdit}
                          onToggleElementHidden={timelineEditing.handleToggleElementHidden}
                          onAutoGroupCarveSources={timelineEditing.handleAutoGroupCarveSources}
                          onAddMediaOverlay={handleAddMediaOverlay}
                        />
                      )
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
                    handleBlockedTimelineEdit={timelineEditing.handleBlockedTimelineEdit}
                    handleTimelineElementSplit={timelineEditing.handleTimelineElementSplit}
                    handleRazorSplit={timelineEditing.handleRazorSplit}
                    handleRazorSplitAll={timelineEditing.handleRazorSplitAll}
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
                    dragOverlayActive={dragOverlay.active}
                    toasts={toasts}
                    dismissToast={dismissToast}
                  />
                </div>
              </DomEditProvider>
            </FileManagerProvider>
          </PanelLayoutProvider>
        </ViewModeProvider>
      </StudioPlaybackProvider>
    </StudioShellProvider>
  );
}
