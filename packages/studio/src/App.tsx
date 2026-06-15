import { useState, useCallback, useRef, useMemo, useEffect, useLayoutEffect } from "react";
import type { LeftSidebarHandle, SidebarTab } from "./components/sidebar/LeftSidebar";
import { useRenderQueue } from "./components/renders/useRenderQueue";
import { usePlayerStore } from "./player";
import { LintModal } from "./components/LintModal";
import { SaveQueuePausedBanner } from "./components/SaveQueuePausedBanner";
import { useCaptionStore } from "./captions/store";
import { useCaptionSync } from "./captions/hooks/useCaptionSync";
import { usePersistentEditHistory } from "./hooks/usePersistentEditHistory";
import { usePanelLayout } from "./hooks/usePanelLayout";
import { useFileManager } from "./hooks/useFileManager";
import { usePreviewPersistence } from "./hooks/usePreviewPersistence";
import { useTimelineEditing } from "./hooks/useTimelineEditing";
import type { BlockPreviewInfo } from "./components/sidebar/BlocksTab";
import { useDomEditSession } from "./hooks/useDomEditSession";
import { useSdkSession } from "./hooks/useSdkSession";
import { useSdkSelectionSync } from "./hooks/useSdkSelectionSync";
import { useBlockHandlers } from "./hooks/useBlockHandlers";
import { useAppHotkeys } from "./hooks/useAppHotkeys";
import { useClipboard } from "./hooks/useClipboard";
import { readStudioUiPreferences, writeStudioUiPreferences } from "./utils/studioUiPreferences";
import { selectedKeyframePercentagesForElement } from "./utils/keyframeSelection";
import { useCaptionDetection } from "./hooks/useCaptionDetection";
import { useRenderClipContent } from "./hooks/useRenderClipContent";
import { useConsoleErrorCapture } from "./hooks/useConsoleErrorCapture";
import { useFrameCapture } from "./hooks/useFrameCapture";
import { useLintModal } from "./hooks/useLintModal";
import { useCompositionDimensions } from "./hooks/useCompositionDimensions";
import { useToast } from "./hooks/useToast";
import { useStudioUrlState } from "./hooks/useStudioUrlState";
import {
  buildStudioContextValue,
  useDragOverlay,
  useInspectorState,
} from "./hooks/useStudioContextValue";
import { buildAgentContextPreview } from "./components/editor/domEditingAgentPrompt";
import type { DomEditSelection } from "./components/editor/domEditing";
import { AskAgentModal } from "./components/AskAgentModal";
import { StudioGlobalDragOverlay } from "./components/StudioGlobalDragOverlay";
import { StudioHeader } from "./components/StudioHeader";
import { useGestureCommit } from "./hooks/useGestureCommit";
import { STUDIO_KEYFRAMES_ENABLED } from "./components/editor/manualEditingAvailability";
import { GestureTrailOverlay } from "./components/editor/GestureTrailOverlay";
import { StudioLeftSidebar } from "./components/StudioLeftSidebar";
import { StudioPreviewArea } from "./components/StudioPreviewArea";
import { StudioRightPanel } from "./components/StudioRightPanel";
import { TimelineToolbar } from "./components/TimelineToolbar";
import { StudioPlaybackProvider, StudioShellProvider } from "./contexts/StudioContext";
import { PanelLayoutProvider } from "./contexts/PanelLayoutContext";
import { FileManagerProvider } from "./contexts/FileManagerContext";
import { DomEditProvider } from "./contexts/DomEditContext";
import { StudioSplash } from "./components/StudioSplash";
import { StudioToast } from "./components/StudioToast";
import { useServerConnection } from "./hooks/useServerConnection";
import {
  normalizeStudioCompositionPath,
  readStudioUrlStateFromWindow,
} from "./utils/studioUrlState";
import { trackStudioSessionStart } from "./telemetry/events";
import { hasFiredSessionStart, markSessionStartFired } from "./telemetry/config";

type CanvasRect = { left: number; top: number; width: number; height: number };
// fallow-ignore-next-line complexity
export function StudioApp() {
  const { projectId, resolving, waitingForServer } = useServerConnection();
  const initialUrlStateRef = useRef(readStudioUrlStateFromWindow());

  // sessionStorage-backed: fires once per tab, survives HMR remounts
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
  const [, setPreviewDocumentVersion] = useState(0);
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
  const refreshTimersRef = useRef<number[]>([]);
  const refreshPreviewDocumentVersion = useCallback(() => {
    for (const id of refreshTimersRef.current) clearTimeout(id);
    refreshTimersRef.current = [];
    setPreviewDocumentVersion((v) => v + 1);
    refreshTimersRef.current.push(
      window.setTimeout(() => setPreviewDocumentVersion((v) => v + 1), 80),
      window.setTimeout(() => setPreviewDocumentVersion((v) => v + 1), 300),
    );
  }, []);
  useEffect(
    () => () => {
      for (const id of refreshTimersRef.current) clearTimeout(id);
    },
    [],
  );
  const [timelineVisible, setTimelineVisible] = useState(
    () =>
      initialUrlStateRef.current.timelineVisible ??
      readStudioUiPreferences().timelineVisible ??
      true,
  );
  const toggleTimelineVisibility = useCallback(() => {
    setTimelineVisible((v) => {
      writeStudioUiPreferences({ timelineVisible: !v });
      return !v;
    });
  }, []);
  const { appToast, showToast, dismissToast } = useToast();
  const panelLayout = usePanelLayout({
    rightCollapsed: initialUrlStateRef.current.rightCollapsed,
    rightPanelTab: initialUrlStateRef.current.rightPanelTab,
  });
  const editHistory = usePersistentEditHistory({ projectId });
  const domEditSaveTimestampRef = useRef(0);
  const pendingTimelineEditPathRef = useRef(new Set<string>());
  const isGestureRecordingRef = useRef(false);
  const reloadPreview = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);
  const fileManager = useFileManager({
    projectId,
    showToast,
    recordEdit: editHistory.recordEdit,
    domEditSaveTimestampRef,
    setRefreshKey,
  });
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
    recordEdit: editHistory.recordEdit,
    domEditSaveTimestampRef,
    reloadPreview,
    previewIframeRef,
    pendingTimelineEditPathRef,
    uploadProjectFiles: fileManager.uploadProjectFiles,
    isRecordingRef: isGestureRecordingRef,
  });
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
    toggleTimelineVisibility,
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
    onToggleRecording: STUDIO_KEYFRAMES_ENABLED
      ? () => handleToggleRecordingRef.current()
      : undefined,
  });
  const selectSidebarTabStable = useCallback(
    (tab: SidebarTab) => leftSidebarRef.current?.selectTab(tab),
    [],
  );
  const getSidebarTabStable = useCallback(
    () => leftSidebarRef.current?.getTab() ?? "compositions",
    [],
  );
  const sdkSession = useSdkSession(projectId, activeCompPath);
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
    rightPanelTab: panelLayout.rightPanelTab,
    applyStudioManualEditsToPreviewRef: previewPersistence.applyStudioManualEditsToPreviewRef,
    syncPreviewHistoryHotkey: appHotkeys.syncPreviewHistoryHotkey,
    reloadPreview,
    setRefreshKey,
    openSourceForSelection: fileManager.openSourceForSelection,
    selectSidebarTab: selectSidebarTabStable,
    getSidebarTab: getSidebarTabStable,
  });
  domEditSelectionBridgeRef.current = domEditSession.domEditSelection;
  clearDomSelectionRef.current = domEditSession.clearDomSelection;
  handleDomEditElementDeleteRef.current = domEditSession.handleDomEditElementDelete;
  resetKeyframesRef.current = domEditSession.handleResetSelectedElementKeyframes;
  invalidateGsapCacheRef.current = domEditSession.invalidateGsapCache;
  deleteSelectedKeyframesRef.current = () => {
    const { selectedKeyframes, selectedElementId } = usePlayerStore.getState();
    const a = domEditSession.selectedGsapAnimations.find((x) => x.keyframes);
    if (!a) return;
    // Only the active element's keyframes; a stale cross-element selection must not delete here.
    for (const p of selectedKeyframePercentagesForElement(selectedKeyframes, selectedElementId)) {
      domEditSession.handleGsapRemoveKeyframe(a.id, p);
    }
  };
  useSdkSelectionSync(
    sdkSession,
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
  const dragOverlay = useDragOverlay(fileManager.handleImportFiles);

  // Gesture recording
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
  const handleSelectComposition = useCallback(
    (comp: string) => {
      setActiveCompPath(comp.endsWith(".html") ? comp : null);
      fileManager.setEditingFile({ path: comp, content: null });
      fetch(`/api/projects/${projectId}/files/${comp}`)
        .then((r) => r.json())
        .then((data) => fileManager.setEditingFile({ path: comp, content: data.content }))
        .catch(() => {});
    },
    [projectId, fileManager],
  );
  const {
    designPanelActive,
    inspectorPanelActive,
    inspectorButtonActive,
    shouldShowSelectedDomBounds,
  } = useInspectorState(
    panelLayout.rightPanelTab,
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
    timelineVisible,
    activeCompPathHydrated,
    domEditSelection: domEditSession.domEditSelection,
    buildDomSelectionFromTarget: domEditSession.buildDomSelectionFromTarget,
    applyDomSelection: domEditSession.applyDomSelection,
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
    timelineVisible,
    toggleTimelineVisibility,
  });
  const timelineToolbar = useMemo(
    () => (
      <TimelineToolbar
        toggleTimelineVisibility={toggleTimelineVisibility}
        domEditSession={domEditSession}
        onSplitElement={timelineEditing.handleTimelineElementSplit}
      />
    ),
    [toggleTimelineVisibility, domEditSession, timelineEditing.handleTimelineElementSplit],
  );
  if (resolving || waitingForServer || !projectId)
    return <StudioSplash waiting={waitingForServer} />;
  return (
    <StudioShellProvider value={studioCtxValue}>
      <StudioPlaybackProvider value={studioCtxValue}>
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
                  inspectorButtonActive={inspectorButtonActive}
                  inspectorPanelActive={inspectorPanelActive}
                  onExport={() => void renderQueue.startRender(undefined)}
                />
                {previewPersistence.domEditSaveQueuePaused && (
                  <SaveQueuePausedBanner
                    message={previewPersistence.domEditSaveQueuePaused}
                    onDismiss={previewPersistence.resetDomEditSaveQueueBreaker}
                  />
                )}
                <div className="flex flex-1 min-h-0">
                  <StudioLeftSidebar
                    leftSidebarRef={leftSidebarRef}
                    onSelectComposition={handleSelectComposition}
                    onAddBlock={handleAddBlock}
                    onPreviewBlock={setBlockPreview}
                    onLint={handleLint}
                    linting={linting}
                    lintFindingCount={lintModal?.length ?? findingsByFile.size}
                    lintFindingsByFile={findingsByFile}
                  />
                  <StudioPreviewArea
                    timelineToolbar={timelineToolbar}
                    renderClipContent={renderClipContent}
                    handleTimelineElementDelete={timelineEditing.handleTimelineElementDelete}
                    handleTimelineAssetDrop={timelineEditing.handleTimelineAssetDrop}
                    handleTimelineBlockDrop={handleTimelineBlockDrop}
                    handlePreviewBlockDrop={handlePreviewBlockDrop}
                    handleTimelineFileDrop={timelineEditing.handleTimelineFileDrop}
                    handleTimelineElementMove={timelineEditing.handleTimelineElementMove}
                    handleTimelineElementResize={timelineEditing.handleTimelineElementResize}
                    handleBlockedTimelineEdit={timelineEditing.handleBlockedTimelineEdit}
                    handleTimelineElementSplit={timelineEditing.handleTimelineElementSplit}
                    handleRazorSplit={timelineEditing.handleRazorSplit}
                    handleRazorSplitAll={timelineEditing.handleRazorSplitAll}
                    setCompIdToSrc={setCompIdToSrc}
                    setCompositionLoading={setCompositionLoading}
                    shouldShowSelectedDomBounds={shouldShowSelectedDomBounds}
                    isGestureRecording={gestureState === "recording"}
                    recordingState={gestureState}
                    onToggleRecording={STUDIO_KEYFRAMES_ENABLED ? handleToggleRecording : undefined}
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
                  {!panelLayout.rightCollapsed && (
                    <StudioRightPanel
                      designPanelActive={designPanelActive}
                      activeBlockParams={activeBlockParams}
                      onCloseBlockParams={() => {
                        setActiveBlockParams(null);
                        panelLayout.setRightPanelTab("design");
                      }}
                      recordingState={gestureState}
                      recordingDuration={gestureRecording.recordingDuration}
                      onToggleRecording={
                        STUDIO_KEYFRAMES_ENABLED ? handleToggleRecording : undefined
                      }
                    />
                  )}
                </div>
                {lintModal !== null && (
                  <LintModal findings={lintModal} projectId={projectId} onClose={closeLintModal} />
                )}
                {consoleErrors !== null && consoleErrors.length > 0 && (
                  <LintModal
                    findings={consoleErrors}
                    projectId={projectId}
                    onClose={() => setConsoleErrors(null)}
                  />
                )}
                {domEditSession.agentModalOpen && domEditSession.domEditSelection && (
                  <AskAgentModal
                    selectionLabel={domEditSession.domEditSelection.label}
                    contextPreview={buildAgentContextPreview(
                      domEditSession.domEditSelection,
                      activeCompPath,
                    )}
                    anchorPoint={domEditSession.agentModalAnchorPoint}
                    onSubmit={domEditSession.handleAgentModalSubmit}
                    onClose={() => {
                      domEditSession.setAgentModalOpen(false);
                      domEditSession.setAgentPromptSelectionContext(undefined);
                      domEditSession.setAgentModalAnchorPoint(null);
                    }}
                  />
                )}

                {dragOverlay.active && <StudioGlobalDragOverlay />}
                {appToast && (
                  <StudioToast
                    message={appToast.message}
                    tone={appToast.tone}
                    onDismiss={dismissToast}
                  />
                )}
              </div>
            </DomEditProvider>
          </FileManagerProvider>
        </PanelLayoutProvider>
      </StudioPlaybackProvider>
    </StudioShellProvider>
  );
}
