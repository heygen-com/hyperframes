import { useState, useCallback, useRef, useMemo, useEffect, useLayoutEffect } from "react";
import type { LeftSidebarHandle, SidebarTab } from "./components/sidebar/LeftSidebar";
import { useRenderQueue } from "./components/renders/useRenderQueue";
import { usePlayerStore, type TimelineElement } from "./player";
import { StudioOverlays } from "./components/StudioOverlays";
import { SaveQueuePausedBanner } from "./components/SaveQueuePausedBanner";
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
  type TimelineMoveOperation,
} from "./hooks/timelineMoveAdapter";
import type { TimelineZIndexReorderCommit } from "./hooks/useTimelineEditingTypes";
import type { TimelineStackingReorderIntent } from "./player/components/timelineStacking";
import type { BlockPreviewInfo } from "./components/sidebar/BlocksTab";
import { useDomEditSession } from "./hooks/useDomEditSession";
import { useSdkSelectionSync } from "./hooks/useSdkSelectionSync";
import { useStudioSdkSessions } from "./hooks/useStudioSdkSessions";
import { useBlockHandlers } from "./hooks/useBlockHandlers";
import { useAddAssetAtPlayhead } from "./hooks/useAddAssetAtPlayhead";
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
import {
  buildStudioContextValue,
  useGlobalFileDrop,
  useInspectorState,
} from "./hooks/useStudioContextValue";
import type { DomEditSelection } from "./components/editor/domEditing";
import { StudioHeader } from "./components/StudioHeader";
import { useGestureCommit } from "./hooks/useGestureCommit";
import { STUDIO_KEYFRAMES_ENABLED } from "./components/editor/manualEditingAvailability";
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
import {
  normalizeStudioCompositionPath,
  readStudioUrlStateFromWindow,
  resolveMasterCompositionPath,
} from "./utils/studioUrlState";
import { trackStudioSessionStart } from "./telemetry/events";
import { hasFiredSessionStart, markSessionStartFired } from "./telemetry/config";
type CanvasRect = { left: number; top: number; width: number; height: number };
// fallow-ignore-next-line complexity
export function StudioApp() {
  const { projectId, resolving, waitingForServer } = useServerConnection();
  const initialUrlStateRef = useRef(readStudioUrlStateFromWindow());
  const viewModeValue = useViewModeState();
  useEffect(() => {
    if (resolving || waitingForServer) return;
    if (hasFiredSessionStart()) return;
    markSessionStartFired();
    trackStudioSessionStart({ has_project: projectId != null });
  }, [projectId, resolving, waitingForServer]);
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
  const activeCompPathRef = useRef(activeCompPath);
  activeCompPathRef.current = activeCompPath;
  const leftSidebarRef = useRef<LeftSidebarHandle>(null);
  const renderQueue = useRenderQueue(projectId);
  const captionEditMode = useCaptionStore((s) => s.isEditMode);
  const captionHasSelection = useCaptionStore((s) => s.selectedSegmentIds.size > 0);
  const captionSync = useCaptionSync(projectId);
  const timelineElements = usePlayerStore((s) => s.elements);
  const setSelectedTimelineElementId = usePlayerStore((s) => s.setSelectedElementId);
  const timelineDuration = usePlayerStore((s) => s.duration);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isMasterView = !activeCompPath || activeCompPath === "index.html";
  const activePreviewUrl = activeCompPath
    ? `/api/projects/${projectId}/preview/comp/${activeCompPath}`
    : null;
  const effectiveTimelineDuration = useMemo(() => {
    const maxEnd =
      timelineElements.length > 0
        ? Math.max(...timelineElements.map((el) => el.start + el.duration))
        : 0;
    return Math.max(timelineDuration, maxEnd);
  }, [timelineDuration, timelineElements]);
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
    domEditSaveTimestampRef,
    masterCompPath,
  );
  useEffect(() => {
    if (activeCompPathHydrated) return;
    if (!fileManager.fileTreeLoaded) return;
    const nextCompPath = normalizeStudioCompositionPath(
      initialUrlStateRef.current.activeCompPath,
      fileManager.fileTree,
    );
    setActiveCompPath((current) => (current === nextCompPath ? current : nextCompPath));
    setActiveCompPathHydrated(true);
  }, [activeCompPathHydrated, fileManager.fileTree, fileManager.fileTreeLoaded]);
  const previewPersistence = usePreviewPersistence({
    projectId,
    showToast,
    readOptionalProjectFile: fileManager.readOptionalProjectFile,
    writeProjectFile: fileManager.writeProjectFile,
    recordEdit: editHistory.recordEdit,
    previewIframeRef,
    activeCompPathRef,
    domEditSaveTimestampRef,
    reloadPreview: () => setRefreshKey((k) => k + 1),
    pendingTimelineEditPathRef,
  });
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
    handleDomZIndexReorderCommitRef,
  });
  const handleTimelineElementsMove = useCallback(
    async (
      edits: Array<{
        element: TimelineElement;
        updates: Pick<TimelineElement, "start" | "track"> & {
          stackingReorder?: TimelineStackingReorderIntent | null;
        };
      }>,
      coalesceKey?: string,
      operation: TimelineMoveOperation = "timing",
      coalesceMs?: number,
    ) => {
      const deps = { handleTimelineGroupMove: timelineEditing.handleTimelineGroupMove };
      await persistTimelineMoveEditsAtomically(edits, coalesceKey, operation, deps, coalesceMs);
    },
    [timelineEditing.handleTimelineGroupMove],
  );
  const handleAddAssetAtPlayhead = useAddAssetAtPlayhead(timelineEditing.handleTimelineAssetDrop);
  const {
    activeBlockParams,
    setActiveBlockParams,
    handleAddBlock,
    handleTimelineBlockDrop,
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
  const handleDomEditElementDeleteRef = useRef<(s: DomEditSelection) => Promise<void>>(
    async () => {},
  );
  const domEditDeleteBridge = (s: DomEditSelection) => handleDomEditElementDeleteRef.current(s);
  const resetKeyframesRef = useRef<() => boolean>(() => false);
  const deleteSelectedKeyframesRef = useRef<() => void>(() => {});
  const invalidateGsapCacheRef = useRef<() => void>(() => {});
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
    handleTimelineElementDelete: timelineEditing.handleTimelineElementDelete,
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
    onToggleRecording: STUDIO_KEYFRAMES_ENABLED
      ? () => handleToggleRecordingRef.current()
      : undefined,
  });
  const sidebarTabRef = useRef({
    select: (t: SidebarTab) => leftSidebarRef.current?.selectTab(t),
    get: () => leftSidebarRef.current?.getTab() ?? "compositions",
  });
  const domEditSession = useDomEditSession({
    projectId,
    activeCompPath,
    isMasterView,
    compIdToSrc,
    captionEditMode,
    compositionLoading,
    previewIframeRef,
    timelineElements,
    setSelectedTimelineElementId,
    setRightCollapsed: panelLayout.setRightCollapsed,
    setRightPanelTab: panelLayout.setRightPanelTab,
    showToast,
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
    syncPreviewHistoryHotkey: appHotkeys.syncPreviewHistoryHotkey,
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
    activePreviewUrl,
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
  const recordingToggle = STUDIO_KEYFRAMES_ENABLED ? handleToggleRecording : undefined;
  const canvasRectRef = useRef<CanvasRect | null>(null);
  useLayoutEffect(() => {
    if (gestureState !== "recording" || !previewIframe) {
      canvasRectRef.current = null;
      return;
    }
    const r = previewIframe.getBoundingClientRect();
    canvasRectRef.current = { left: r.left, top: r.top, width: r.width, height: r.height };
  }, [gestureState, previewIframe]);
  const handlePreviewIframeRef = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      previewIframeRef.current = iframe;
      setPreviewIframe(iframe);
      appHotkeys.syncPreviewTimelineHotkey(iframe);
      appHotkeys.syncPreviewHistoryHotkey(iframe);
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
    shouldShowSelectedDomBounds,
  } = useInspectorState(
    panelLayout.rightPanelTab,
    panelLayout.rightInspectorPanes,
    panelLayout.rightCollapsed,
    isPlaying,
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
                  {previewPersistence.domEditSaveQueuePaused && (
                    <SaveQueuePausedBanner
                      message={previewPersistence.domEditSaveQueuePaused}
                      onRetry={previewPersistence.resetDomEditSaveQueueBreaker}
                    />
                  )}
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
                      />
                    }
                    right={
                      panelLayout.rightCollapsed ? null : (
                        <StudioRightPanel
                          designPanelActive={designPanelActive}
                          activeBlockParams={activeBlockParams}
                          onCloseBlockParams={() => {
                            setActiveBlockParams(null);
                            panelLayout.setRightPanelTab("design");
                          }}
                          recordingState={gestureState}
                          recordingDuration={gestureRecording.recordingDuration}
                          onToggleRecording={recordingToggle}
                          sdkSession={sdkHandle.session}
                          publishSdkSession={sdkHandle.publish}
                          forceReloadSdkSession={sdkHandle.forceReload}
                          reloadPreview={reloadPreview}
                          domEditSaveTimestampRef={domEditSaveTimestampRef}
                          recordEdit={editHistory.recordEdit}
                          onToggleElementHidden={timelineEditing.handleToggleElementHidden}
                        />
                      )
                    }
                    timelineToolbar={timelineToolbar}
                    renderClipContent={renderClipContent}
                    handleTimelineElementDelete={timelineEditing.handleTimelineElementDelete}
                    handleTimelineAssetDrop={timelineEditing.handleTimelineAssetDrop}
                    handleTimelineBlockDrop={handleTimelineBlockDrop}
                    handlePreviewBlockDrop={handlePreviewBlockDrop}
                    handleTimelineFileDrop={timelineEditing.handleTimelineFileDrop}
                    handleTimelineElementMove={timelineEditing.handleTimelineElementMove}
                    handleTimelineElementsMove={handleTimelineElementsMove}
                    handleTimelineElementResize={timelineEditing.handleTimelineElementResize}
                    handleTimelineGroupResize={timelineEditing.handleTimelineGroupResize}
                    handleToggleTrackHidden={timelineEditing.handleToggleTrackHidden}
                    handleBlockedTimelineEdit={timelineEditing.handleBlockedTimelineEdit}
                    handleTimelineElementSplit={timelineEditing.handleTimelineElementSplit}
                    handleRazorSplit={timelineEditing.handleRazorSplit}
                    handleRazorSplitAll={timelineEditing.handleRazorSplitAll}
                    setCompIdToSrc={setCompIdToSrc}
                    setCompositionLoading={setCompositionLoading}
                    shouldShowSelectedDomBounds={shouldShowSelectedDomBounds}
                    isGestureRecording={gestureState === "recording"}
                    recordingState={gestureState}
                    onToggleRecording={recordingToggle}
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
