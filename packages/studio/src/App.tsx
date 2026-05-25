import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type { LeftSidebarHandle, SidebarTab } from "./components/sidebar/LeftSidebar";
import { useRenderQueue } from "./components/renders/useRenderQueue";
import { usePlayerStore } from "./player";
import { LintModal } from "./components/LintModal";
import { useCaptionStore } from "./captions/store";
import { useCaptionSync } from "./captions/hooks/useCaptionSync";
import { usePersistentEditHistory } from "./hooks/usePersistentEditHistory";
import { usePanelLayout } from "./hooks/usePanelLayout";
import { useFileManager } from "./hooks/useFileManager";
import { usePreviewPersistence } from "./hooks/usePreviewPersistence";
import { useTimelineEditing } from "./hooks/useTimelineEditing";
import { addBlockToProject } from "./utils/blockInstaller";
import type { BlockParam } from "@hyperframes/core/registry";
import type { BlockPreviewInfo } from "./components/sidebar/BlocksTab";
import { useDomEditSession } from "./hooks/useDomEditSession";
import { useAppHotkeys } from "./hooks/useAppHotkeys";
import { useClipboard } from "./hooks/useClipboard";
import { readStudioUiPreferences, writeStudioUiPreferences } from "./utils/studioUiPreferences";
import { useCaptionDetection } from "./hooks/useCaptionDetection";
import { useRenderClipContent } from "./hooks/useRenderClipContent";
import { useConsoleErrorCapture } from "./hooks/useConsoleErrorCapture";
import { useFrameCapture } from "./hooks/useFrameCapture";
import { useLintModal } from "./hooks/useLintModal";
import { useCompositionDimensions } from "./hooks/useCompositionDimensions";
import { useToast } from "./hooks/useToast";
import { useStudioUrlState } from "./hooks/useStudioUrlState";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_MOTION_PANEL_ENABLED,
} from "./components/editor/manualEditingAvailability";
import { readStudioMotionFromElement } from "./components/editor/studioMotion";
import type { DomEditSelection } from "./components/editor/domEditing";
import { AskAgentModal } from "./components/AskAgentModal";
import { StudioGlobalDragOverlay } from "./components/StudioGlobalDragOverlay";
import { StudioHeader } from "./components/StudioHeader";
import { StudioLeftSidebar } from "./components/StudioLeftSidebar";
import { StudioPreviewArea } from "./components/StudioPreviewArea";
import { StudioRightPanel } from "./components/StudioRightPanel";
import { TimelineToolbar } from "./components/TimelineToolbar";
import { StudioProvider, type StudioContextValue } from "./contexts/StudioContext";
import { PanelLayoutProvider } from "./contexts/PanelLayoutContext";
import { FileManagerProvider } from "./contexts/FileManagerContext";
import { DomEditProvider } from "./contexts/DomEditContext";
import { StudioSplash } from "./components/StudioSplash";
import { useServerConnection } from "./hooks/useServerConnection";
import {
  normalizeStudioCompositionPath,
  readStudioUrlStateFromWindow,
} from "./utils/studioUrlState";
import { trackStudioSessionStart } from "./telemetry/events";
import { hasFiredSessionStart, markSessionStartFired } from "./telemetry/config";

export function StudioApp() {
  const { projectId, resolving, waitingForServer } = useServerConnection();
  const initialUrlStateRef = useRef(readStudioUrlStateFromWindow());

  // Fire once per browser tab session — sessionStorage-backed so HMR
  // remounts, route changes, and any future StudioApp remount within the
  // same tab don't refire `studio_session_start`. `has_project` lets us
  // tell scratch-open from project-context-open.
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
  const [activeBlockParams, setActiveBlockParams] = useState<{
    blockName: string;
    blockTitle: string;
    params: BlockParam[];
    compositionPath: string;
  } | null>(null);
  const [blockPreview, setBlockPreview] = useState<BlockPreviewInfo | null>(null);

  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const activeCompPathRef = useRef(activeCompPath);
  activeCompPathRef.current = activeCompPath;
  const leftSidebarRef = useRef<LeftSidebarHandle>(null);
  const renderQueue = useRenderQueue(projectId);
  const captionEditMode = useCaptionStore((s) => s.isEditMode);
  const captionHasSelection = useCaptionStore((s) => s.selectedSegmentIds.size > 0);
  const captionSync = useCaptionSync(projectId);
  const currentTime = usePlayerStore((s) => s.currentTime);
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
  const refreshPreviewDocumentVersion = useCallback(() => {
    setPreviewDocumentVersion((v) => v + 1);
    window.setTimeout(() => setPreviewDocumentVersion((v) => v + 1), 80);
    window.setTimeout(() => setPreviewDocumentVersion((v) => v + 1), 300);
  }, []);

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
  const { appToast, showToast } = useToast();
  const panelLayout = usePanelLayout({
    rightCollapsed: initialUrlStateRef.current.rightCollapsed,
    rightPanelTab: initialUrlStateRef.current.rightPanelTab,
  });
  const editHistory = usePersistentEditHistory({ projectId });
  const domEditSaveTimestampRef = useRef(0);
  const pendingTimelineEditPathRef = useRef(new Set<string>());
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
  });

  const handleAddBlock = useCallback(
    (blockName: string) => {
      if (!projectId) return;
      void (async () => {
        const result = await addBlockToProject({
          projectId,
          blockName,
          activeCompPath,
          previewIframe: previewIframeRef.current,
          currentTime: usePlayerStore.getState().currentTime,
          timelineElements,
          readProjectFile: fileManager.readProjectFile,
          writeProjectFile: fileManager.writeProjectFile,
          recordEdit: editHistory.recordEdit,
          refreshFileTree: fileManager.refreshFileTree,
          reloadPreview,
          showToast,
        });
        const params = result?.block.type === "hyperframes:block" ? result.block.params : undefined;
        if (params?.length) {
          setActiveBlockParams({
            blockName: result!.block.name,
            blockTitle: result!.block.title,
            params,
            compositionPath: result!.compositionPath,
          });
          panelLayout.setRightCollapsed(false);
          panelLayout.setRightPanelTab("block-params");
        }
      })();
    },
    [
      projectId,
      activeCompPath,
      timelineElements,
      fileManager.readProjectFile,
      fileManager.writeProjectFile,
      fileManager.refreshFileTree,
      editHistory.recordEdit,
      reloadPreview,
      showToast,
      panelLayout,
    ],
  );

  const handleTimelineBlockDrop = useCallback(
    (blockName: string, placement: { start: number; track: number }) => {
      if (!projectId) return;
      void addBlockToProject({
        projectId,
        blockName,
        activeCompPath,
        placement,
        previewIframe: previewIframeRef.current,
        currentTime: usePlayerStore.getState().currentTime,
        timelineElements,
        readProjectFile: fileManager.readProjectFile,
        writeProjectFile: fileManager.writeProjectFile,
        recordEdit: editHistory.recordEdit,
        refreshFileTree: fileManager.refreshFileTree,
        reloadPreview,
        showToast,
      });
    },
    [
      projectId,
      activeCompPath,
      timelineElements,
      fileManager.readProjectFile,
      fileManager.writeProjectFile,
      fileManager.refreshFileTree,
      editHistory.recordEdit,
      reloadPreview,
      showToast,
    ],
  );

  const handlePreviewBlockDrop = useCallback(
    (blockName: string, position: { left: number; top: number }) => {
      if (!projectId) return;
      void addBlockToProject({
        projectId,
        blockName,
        activeCompPath,
        visualPosition: position,
        previewIframe: previewIframeRef.current,
        currentTime: usePlayerStore.getState().currentTime,
        timelineElements,
        readProjectFile: fileManager.readProjectFile,
        writeProjectFile: fileManager.writeProjectFile,
        recordEdit: editHistory.recordEdit,
        refreshFileTree: fileManager.refreshFileTree,
        reloadPreview,
        showToast,
      });
    },
    [
      projectId,
      activeCompPath,
      timelineElements,
      fileManager.readProjectFile,
      fileManager.writeProjectFile,
      fileManager.refreshFileTree,
      editHistory.recordEdit,
      reloadPreview,
      showToast,
    ],
  );

  const clearDomSelectionRef = useRef<() => void>(() => {});
  const domEditSelectionBridgeRef = useRef<DomEditSelection | null>(null);
  const handleDomEditElementDeleteRef = useRef<(s: DomEditSelection) => Promise<void>>(
    async () => {},
  );
  const domEditDeleteBridge = async (s: DomEditSelection) =>
    handleDomEditElementDeleteRef.current(s);
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
  });

  const selectSidebarTabStable = useCallback(
    (tab: SidebarTab) => leftSidebarRef.current?.selectTab(tab),
    [],
  );
  const getSidebarTabStable = useCallback(
    () => leftSidebarRef.current?.getTab() ?? "compositions",
    [],
  );

  const domEditSession = useDomEditSession({
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
    setRightCollapsed: panelLayout.setRightCollapsed,
    setRightPanelTab: panelLayout.setRightPanelTab,
    showToast,
    refreshPreviewDocumentVersion,
    queueDomEditSave: previewPersistence.queueDomEditSave,
    readProjectFile: fileManager.readProjectFile,
    writeProjectFile: fileManager.writeProjectFile,
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
  const { lintModal, linting, handleLint, closeLintModal } = useLintModal(projectId);
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

  const [globalDragOver, setGlobalDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const { syncPreviewTimelineHotkey, syncPreviewHistoryHotkey } = appHotkeys;
  const handlePreviewIframeRef = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      previewIframeRef.current = iframe;
      setPreviewIframe(iframe);
      syncPreviewTimelineHotkey(iframe);
      syncPreviewHistoryHotkey(iframe);
      resetConsoleErrors();
      refreshPreviewDocumentVersion();
    },
    [
      refreshPreviewDocumentVersion,
      resetConsoleErrors,
      syncPreviewHistoryHotkey,
      syncPreviewTimelineHotkey,
    ],
  );

  const handleSelectComposition = useCallback(
    (comp: string) => {
      setActiveCompPath(comp === "index.html" || comp.startsWith("compositions/") ? comp : null);
      fileManager.setEditingFile({ path: comp, content: null });
      fetch(`/api/projects/${projectId}/files/${comp}`)
        .then((r) => r.json())
        .then((data) => fileManager.setEditingFile({ path: comp, content: data.content }))
        .catch(() => {});
    },
    [projectId, fileManager],
  );

  const selectedStudioMotion =
    STUDIO_INSPECTOR_PANELS_ENABLED && domEditSession.domEditSelection
      ? readStudioMotionFromElement(domEditSession.domEditSelection.element)
      : null;
  const layersPanelActive =
    STUDIO_INSPECTOR_PANELS_ENABLED && panelLayout.rightPanelTab === "layers";
  const designPanelActive =
    STUDIO_INSPECTOR_PANELS_ENABLED && panelLayout.rightPanelTab === "design";
  const motionPanelActive =
    STUDIO_INSPECTOR_PANELS_ENABLED &&
    STUDIO_MOTION_PANEL_ENABLED &&
    panelLayout.rightPanelTab === "motion";
  const inspectorPanelActive = layersPanelActive || designPanelActive || motionPanelActive;
  const shouldShowSelectedDomBounds =
    inspectorPanelActive && !panelLayout.rightCollapsed && !isPlaying;
  const inspectorButtonActive =
    STUDIO_INSPECTOR_PANELS_ENABLED && !panelLayout.rightCollapsed && inspectorPanelActive;

  useStudioUrlState({
    projectId,
    activeCompPath,
    currentTime,
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

  // StudioProvider performs its own useMemo — no need for a second memo here.
  const studioCtxValue: StudioContextValue = {
    projectId: projectId!,
    activeCompPath,
    setActiveCompPath,
    showToast,
    previewIframeRef,
    captionEditMode,
    compositionLoading,
    refreshKey,
    setRefreshKey,
    currentTime,
    timelineElements,
    isPlaying,
    editHistory: {
      canUndo: editHistory.canUndo,
      canRedo: editHistory.canRedo,
      undoLabel: editHistory.undoLabel,
      redoLabel: editHistory.redoLabel,
    },
    handleUndo: appHotkeys.handleUndo,
    handleRedo: appHotkeys.handleRedo,
    renderQueue: {
      jobs: renderQueue.jobs,
      isRendering: renderQueue.isRendering,
      deleteRender: renderQueue.deleteRender,
      clearCompleted: renderQueue.clearCompleted,
      startRender: renderQueue.startRender as (options: unknown) => Promise<void>,
    },
    compositionDimensions,
    waitForPendingDomEditSaves: previewPersistence.waitForPendingDomEditSaves,
    handlePreviewIframeRef,
    refreshPreviewDocumentVersion,
    timelineVisible,
    toggleTimelineVisibility,
  };

  if (resolving || waitingForServer || !projectId) {
    return <StudioSplash waiting={waitingForServer} />;
  }

  const timelineToolbar = <TimelineToolbar toggleTimelineVisibility={toggleTimelineVisibility} />;
  return (
    <StudioProvider value={studioCtxValue}>
      <PanelLayoutProvider value={panelLayout}>
        <FileManagerProvider value={fileManager}>
          <DomEditProvider value={domEditSession}>
            <div
              className="flex flex-col h-full w-full bg-neutral-950 relative"
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
              }}
              onDragEnter={(e) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                dragCounterRef.current++;
                setGlobalDragOver(true);
              }}
              onDragLeave={() => {
                dragCounterRef.current--;
                if (dragCounterRef.current === 0) setGlobalDragOver(false);
              }}
              onDrop={(e) => {
                dragCounterRef.current = 0;
                setGlobalDragOver(false);
                if (e.defaultPrevented) return;
                e.preventDefault();
                if (e.dataTransfer.files.length)
                  fileManager.handleImportFiles(e.dataTransfer.files);
              }}
            >
              <StudioHeader
                captureFrameHref={frameCapture.captureFrameHref}
                captureFrameFilename={frameCapture.captureFrameFilename}
                handleCaptureFrameClick={frameCapture.handleCaptureFrameClick}
                refreshCaptureFrameTime={frameCapture.refreshCaptureFrameTime}
                inspectorButtonActive={inspectorButtonActive}
                inspectorPanelActive={inspectorPanelActive}
              />

              <div className="flex flex-1 min-h-0">
                <StudioLeftSidebar
                  leftSidebarRef={leftSidebarRef}
                  onSelectComposition={handleSelectComposition}
                  onAddBlock={handleAddBlock}
                  onPreviewBlock={setBlockPreview}
                  onLint={handleLint}
                  linting={linting}
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
                  setCompIdToSrc={setCompIdToSrc}
                  setCompositionLoading={setCompositionLoading}
                  shouldShowSelectedDomBounds={shouldShowSelectedDomBounds}
                  blockPreview={blockPreview}
                />

                {!panelLayout.rightCollapsed && (
                  <StudioRightPanel
                    selectedStudioMotion={selectedStudioMotion}
                    designPanelActive={designPanelActive}
                    motionPanelActive={motionPanelActive}
                    activeBlockParams={activeBlockParams}
                    onCloseBlockParams={() => {
                      setActiveBlockParams(null);
                      panelLayout.setRightPanelTab("design");
                    }}
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
                  anchorPoint={domEditSession.agentModalAnchorPoint}
                  onSubmit={domEditSession.handleAgentModalSubmit}
                  onClose={() => {
                    domEditSession.setAgentModalOpen(false);
                    domEditSession.setAgentPromptSelectionContext(undefined);
                    domEditSession.setAgentModalAnchorPoint(null);
                  }}
                />
              )}

              {globalDragOver && <StudioGlobalDragOverlay />}

              {appToast && (
                <div
                  className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-[91] px-4 py-2 rounded-lg border text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2 ${
                    appToast.tone === "error"
                      ? "bg-red-900/90 border-red-700/50 text-red-200"
                      : "bg-neutral-900/95 border-neutral-700/60 text-neutral-100"
                  }`}
                >
                  {appToast.message}
                </div>
              )}
            </div>
          </DomEditProvider>
        </FileManagerProvider>
      </PanelLayoutProvider>
    </StudioProvider>
  );
}
