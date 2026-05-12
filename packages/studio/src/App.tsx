import { useState, useCallback, useRef, useMemo } from "react";
import { useMountEffect } from "./hooks/useMountEffect";
import type { LeftSidebarHandle } from "./components/sidebar/LeftSidebar";
import { useRenderQueue } from "./components/renders/useRenderQueue";
import { usePlayerStore } from "./player";
import { LintModal } from "./components/LintModal";
import { useCaptionStore } from "./captions/store";
import { useCaptionSync } from "./captions/hooks/useCaptionSync";
import { usePersistentEditHistory } from "./hooks/usePersistentEditHistory";
import { usePanelLayout } from "./hooks/usePanelLayout";
import { useFileManager } from "./hooks/useFileManager";
import { useManifestPersistence } from "./hooks/useManifestPersistence";
import { useTimelineEditing } from "./hooks/useTimelineEditing";
import { useDomEditSession } from "./hooks/useDomEditSession";
import { useAppHotkeys } from "./hooks/useAppHotkeys";
import { useCaptionDetection } from "./hooks/useCaptionDetection";
import { useRenderClipContent } from "./hooks/useRenderClipContent";
import { useConsoleErrorCapture } from "./hooks/useConsoleErrorCapture";
import { useFrameCapture } from "./hooks/useFrameCapture";
import { useLintModal } from "./hooks/useLintModal";
import { useCompositionDimensions } from "./hooks/useCompositionDimensions";
import { buildProjectHash, parseProjectIdFromHash } from "./utils/projectRouting";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_MOTION_PANEL_ENABLED,
} from "./components/editor/manualEditingAvailability";
import { getStudioMotionForSelection } from "./components/editor/studioMotion";
import { getTimelineElementKey, isTimelineElementActiveAtTime } from "./utils/timelineInspector";
import type { DomEditSelection } from "./components/editor/domEditing";
import type { AppToast } from "./utils/studioHelpers";
import { AskAgentModal } from "./components/AskAgentModal";
import { StudioHeader } from "./components/StudioHeader";
import { StudioLeftSidebar } from "./components/StudioLeftSidebar";
import { StudioPreviewArea } from "./components/StudioPreviewArea";
import { StudioRightPanel } from "./components/StudioRightPanel";
import { TimelineToolbar } from "./components/TimelineToolbar";
import { StudioProvider, type StudioContextValue } from "./contexts/StudioContext";
import { PanelLayoutProvider } from "./contexts/PanelLayoutContext";
import { FileManagerProvider } from "./contexts/FileManagerContext";
import { DomEditProvider } from "./contexts/DomEditContext";

export function StudioApp() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  useMountEffect(() => {
    const hashProjectId = parseProjectIdFromHash(window.location.hash);
    if (hashProjectId) {
      setProjectId(hashProjectId);
      setResolving(false);
      return;
    }
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        const first = (data.projects ?? [])[0];
        if (first) {
          setProjectId(first.id);
          window.location.hash = buildProjectHash(first.id);
        }
      })
      .catch(() => {})
      .finally(() => setResolving(false));
  });

  const [activeCompPath, setActiveCompPath] = useState<string | null>(null);
  const [compIdToSrc, setCompIdToSrc] = useState<Map<string, string>>(new Map());
  const [previewIframe, setPreviewIframe] = useState<HTMLIFrameElement | null>(null);
  const [compositionLoading, setCompositionLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [, setPreviewDocumentVersion] = useState(0);

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
  const selectedTimelineElementId = usePlayerStore((s) => s.selectedElementId);
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

  const [timelineVisible, setTimelineVisible] = useState(true);
  const toggleTimelineVisibility = useCallback(() => setTimelineVisible((v) => !v), []);
  const [appToast, setAppToast] = useState<AppToast | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string, tone: AppToast["tone"] = "error") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setAppToast({ message, tone });
    toastTimerRef.current = setTimeout(() => setAppToast(null), 4000);
  }, []);

  useMountEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  });

  const panelLayout = usePanelLayout();
  const editHistory = usePersistentEditHistory({ projectId });
  const domEditSaveTimestampRef = useRef(0);
  const reloadPreview = useCallback(() => {
    try {
      previewIframeRef.current?.contentWindow?.location.reload();
    } catch {
      setRefreshKey((k) => k + 1);
    }
  }, []);

  const fileManager = useFileManager({
    projectId,
    showToast,
    recordEdit: editHistory.recordEdit,
    domEditSaveTimestampRef,
    setRefreshKey,
  });

  const manifestPersistence = useManifestPersistence({
    projectId,
    showToast,
    readOptionalProjectFile: fileManager.readOptionalProjectFile,
    writeProjectFile: fileManager.writeProjectFile,
    recordEdit: editHistory.recordEdit,
    previewIframeRef,
    activeCompPathRef,
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
    uploadProjectFiles: fileManager.uploadProjectFiles,
  });

  const clearDomSelectionRef = useRef<() => void>(() => {});
  const domEditSelectionBridgeRef = useRef<DomEditSelection | null>(null);
  const handleDomEditElementDeleteRef = useRef<(selection: DomEditSelection) => Promise<void>>(
    async () => {},
  );

  const appHotkeys = useAppHotkeys({
    toggleTimelineVisibility,
    handleTimelineElementDelete: timelineEditing.handleTimelineElementDelete,
    handleDomEditElementDelete: async (s: DomEditSelection) =>
      handleDomEditElementDeleteRef.current(s),
    domEditSelectionRef: domEditSelectionBridgeRef,
    clearDomSelectionRef,
    editHistory,
    readOptionalProjectFile: fileManager.readOptionalProjectFile,
    readProjectFile: fileManager.readProjectFile,
    writeProjectFile: fileManager.writeProjectFile,
    domEditSaveTimestampRef,
    showToast,
    syncHistoryPreviewAfterApply: manifestPersistence.syncHistoryPreviewAfterApply,
    waitForPendingDomEditSaves: manifestPersistence.waitForPendingDomEditSaves,
    leftSidebarRef,
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
    currentTime,
    setSelectedTimelineElementId,
    setRightCollapsed: panelLayout.setRightCollapsed,
    setRightPanelTab: panelLayout.setRightPanelTab,
    showToast,
    refreshPreviewDocumentVersion,
    commitStudioManualEditManifestOptimistically:
      manifestPersistence.commitStudioManualEditManifestOptimistically,
    commitStudioMotionManifestOptimistically:
      manifestPersistence.commitStudioMotionManifestOptimistically,
    applyCurrentStudioManualEditsToPreview:
      manifestPersistence.applyCurrentStudioManualEditsToPreview,
    applyCurrentStudioMotionToPreview: manifestPersistence.applyCurrentStudioMotionToPreview,
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
    applyStudioManualEditsToPreviewRef: manifestPersistence.applyStudioManualEditsToPreviewRef,
    applyStudioMotionToPreviewRef: manifestPersistence.applyStudioMotionToPreviewRef,
    syncPreviewHistoryHotkey: appHotkeys.syncPreviewHistoryHotkey,
    reloadPreview,
    setRefreshKey,
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
    waitForPendingDomEditSaves: manifestPersistence.waitForPendingDomEditSaves,
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
      ? getStudioMotionForSelection(
          manifestPersistence.studioMotionManifestRef.current,
          domEditSession.domEditSelection,
        )
      : null;
  const selectedTimelineElement = useMemo(
    () =>
      selectedTimelineElementId
        ? (timelineElements.find((el) => getTimelineElementKey(el) === selectedTimelineElementId) ??
          null)
        : null,
    [selectedTimelineElementId, timelineElements],
  );
  const designPanelActive =
    STUDIO_INSPECTOR_PANELS_ENABLED && panelLayout.rightPanelTab === "design";
  const motionPanelActive =
    STUDIO_INSPECTOR_PANELS_ENABLED &&
    STUDIO_MOTION_PANEL_ENABLED &&
    panelLayout.rightPanelTab === "motion";
  const inspectorPanelActive = designPanelActive || motionPanelActive;
  const shouldShowSelectedDomBounds =
    inspectorPanelActive &&
    !panelLayout.rightCollapsed &&
    !isPlaying &&
    (!selectedTimelineElement ||
      isTimelineElementActiveAtTime(currentTime, selectedTimelineElement));
  const inspectorButtonActive =
    STUDIO_INSPECTOR_PANELS_ENABLED && !panelLayout.rightCollapsed && inspectorPanelActive;

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
    waitForPendingDomEditSaves: manifestPersistence.waitForPendingDomEditSaves,
    handlePreviewIframeRef,
    refreshPreviewDocumentVersion,
    timelineVisible,
    toggleTimelineVisibility,
  };

  if (resolving || !projectId) {
    return (
      <div className="h-full w-full bg-neutral-950 flex items-center justify-center">
        <div className="w-4 h-4 rounded-full bg-studio-accent animate-pulse" />
      </div>
    );
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
                  onLint={handleLint}
                  linting={linting}
                />
                <StudioPreviewArea
                  timelineToolbar={timelineToolbar}
                  renderClipContent={renderClipContent}
                  handleTimelineElementDelete={timelineEditing.handleTimelineElementDelete}
                  handleTimelineAssetDrop={timelineEditing.handleTimelineAssetDrop}
                  handleTimelineFileDrop={timelineEditing.handleTimelineFileDrop}
                  handleTimelineElementMove={timelineEditing.handleTimelineElementMove}
                  handleTimelineElementResize={timelineEditing.handleTimelineElementResize}
                  handleBlockedTimelineEdit={timelineEditing.handleBlockedTimelineEdit}
                  setCompIdToSrc={setCompIdToSrc}
                  setCompositionLoading={setCompositionLoading}
                  shouldShowSelectedDomBounds={shouldShowSelectedDomBounds}
                />

                {!panelLayout.rightCollapsed && (
                  <StudioRightPanel
                    selectedStudioMotion={selectedStudioMotion}
                    designPanelActive={designPanelActive}
                    motionPanelActive={motionPanelActive}
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

              {globalDragOver && (
                <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm pointer-events-none">
                  <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-xl border-2 border-dashed border-studio-accent/60 bg-studio-accent/[0.06]">
                    <svg
                      width="32"
                      height="32"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-studio-accent"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span className="text-sm font-medium text-studio-accent">
                      Drop files to import into project
                    </span>
                  </div>
                </div>
              )}

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
