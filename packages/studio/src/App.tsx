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
  buildStudioContextValue,
  useDragOverlay,
  useInspectorState,
} from "./hooks/useStudioContextValue";
import { buildAgentContextPreview } from "./components/editor/domEditingAgentPrompt";
import type { DomEditSelection } from "./components/editor/domEditing";
import { AskAgentModal } from "./components/AskAgentModal";
import { StudioGlobalDragOverlay } from "./components/StudioGlobalDragOverlay";
import { StudioHeader } from "./components/StudioHeader";
import { useGestureRecording } from "./hooks/useGestureRecording";
import { simplifyGestureSamples } from "./utils/rdpSimplify";

import { GestureTrailOverlay } from "./components/editor/GestureTrailOverlay";
import { StudioLeftSidebar } from "./components/StudioLeftSidebar";
import { StudioPreviewArea } from "./components/StudioPreviewArea";
import { StudioRightPanel } from "./components/StudioRightPanel";
import { TimelineToolbar } from "./components/TimelineToolbar";
import { StudioProvider } from "./contexts/StudioContext";
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

// fallow-ignore-next-line complexity
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

  const blockCtx = useMemo(
    () => ({
      activeCompPath,
      timelineElements,
      readProjectFile: fileManager.readProjectFile,
      writeProjectFile: fileManager.writeProjectFile,
      recordEdit: editHistory.recordEdit,
      refreshFileTree: fileManager.refreshFileTree,
      reloadPreview,
      showToast,
    }),
    [
      activeCompPath,
      timelineElements,
      fileManager,
      editHistory.recordEdit,
      reloadPreview,
      showToast,
    ],
  );
  const handleAddBlock = useCallback(
    (blockName: string) => {
      if (!projectId) return;
      void (async () => {
        const result = await addBlockToProject({
          projectId,
          blockName,
          ...blockCtx,
          previewIframe: previewIframeRef.current,
          currentTime: usePlayerStore.getState().currentTime,
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
    [projectId, blockCtx, panelLayout],
  );
  const handleTimelineBlockDrop = useCallback(
    (blockName: string, placement: { start: number; track: number }) => {
      if (!projectId) return;
      void addBlockToProject({
        projectId,
        blockName,
        placement,
        ...blockCtx,
        previewIframe: previewIframeRef.current,
        currentTime: usePlayerStore.getState().currentTime,
      });
    },
    [projectId, blockCtx],
  );
  const handlePreviewBlockDrop = useCallback(
    (blockName: string, position: { left: number; top: number }) => {
      if (!projectId) return;
      void addBlockToProject({
        projectId,
        blockName,
        visualPosition: position,
        ...blockCtx,
        previewIframe: previewIframeRef.current,
        currentTime: usePlayerStore.getState().currentTime,
      });
    },
    [projectId, blockCtx],
  );

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
    onToggleRecording: () => handleToggleRecordingRef.current(),
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
    const sk = usePlayerStore.getState().selectedKeyframes;
    const a = domEditSession.selectedGsapAnimations.find((x) => x.keyframes);
    if (!a || sk.size === 0) return;
    sk.forEach((k) => {
      const p = Number(k.split(":")[1]);
      if (Number.isFinite(p)) domEditSession.handleGsapRemoveKeyframe(a.id, p);
    });
  };
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

  const dragOverlay = useDragOverlay(fileManager.handleImportFiles);

  // Gesture recording
  const gestureRecording = useGestureRecording();
  const [gestureState, setGestureState] = useState<"idle" | "recording">("idle");
  // Synchronous mirror of gestureState — immune to React batching.
  // Prevents double-R-press within a single render cycle from swallowing the stop.
  const gestureStateRef = useRef<"idle" | "recording">("idle");
  const recordingAutoStopRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const recordingStartTimeRef = useRef(0);
  const commitInFlightRef = useRef(false);
  const handleToggleRecordingRef = useRef<() => void>(() => {});
  const domEditSessionRef = useRef(domEditSession);
  domEditSessionRef.current = domEditSession;

  // Unmount: clear auto-stop interval
  useEffect(() => () => clearInterval(recordingAutoStopRef.current), []);

  // fallow-ignore-next-line complexity
  const stopAndCommitRecording = useCallback(async () => {
    clearInterval(recordingAutoStopRef.current);
    if (commitInFlightRef.current) return;
    commitInFlightRef.current = true;
    gestureStateRef.current = "idle";
    isGestureRecordingRef.current = false;
    const frozenSamples = gestureRecording.stopRecording();
    const store = usePlayerStore.getState();
    store.setIsPlaying(false);
    try {
      const liveSession = domEditSessionRef.current;
      const sel = liveSession.domEditSelection;
      if (!sel) {
        if (frozenSamples.length > 2) {
          showToast("Selection lost during recording", "error");
        }
        return;
      }
      const duration = frozenSamples.length > 0 ? frozenSamples[frozenSamples.length - 1]!.time : 0;

      if (frozenSamples.length <= 2) {
        showToast("No gesture detected — move the pointer while recording", "error");
        return;
      }
      if (duration <= 0) {
        showToast("Recording too short — try again", "error");
        return;
      }

      const simplified = simplifyGestureSamples(frozenSamples, duration, 5);
      const sortedPcts = Array.from(simplified.keys()).sort((a, b) => a - b);

      // Always create a new tween scoped to the recording range.
      // Injecting into an existing tween creates keyframes before the recording
      // start (from the convert-to-keyframes step), causing wrong positions.
      const selector = sel.id ? `#${sel.id}` : sel.selector;
      if (!selector) {
        showToast("Cannot save — element has no selector", "error");
        return;
      }
      if (liveSession.commitMutation) {
        const recStart = recordingStartTimeRef.current;
        const keyframes = sortedPcts.map((pct) => ({
          percentage: pct,
          properties: simplified.get(pct) as Record<string, number | string>,
        }));

        await liveSession.commitMutation(
          {
            type: "add-with-keyframes",
            targetSelector: selector,
            position: Math.round(recStart * 1000) / 1000,
            duration: Math.round(duration * 1000) / 1000,
            keyframes,
          },
          { label: "Gesture recording", softReload: true },
        );
      }
      showToast(`Recorded ${sortedPcts.length} keyframes`, "info");
    } finally {
      store.requestSeek(recordingStartTimeRef.current);
      gestureRecording.clearSamples();
      setGestureState("idle");
      commitInFlightRef.current = false;
    }
  }, [gestureRecording, showToast]);

  const handleToggleRecording = useCallback(() => {
    if (gestureStateRef.current === "recording") {
      void stopAndCommitRecording();
      return;
    }
    const sel = domEditSessionRef.current.domEditSelection;
    if (!sel) {
      showToast("Select an element first", "error");
      return;
    }
    const iframe = previewIframeRef.current;
    if (!iframe) {
      showToast("Preview not ready — try again", "error");
      return;
    }

    const store = usePlayerStore.getState();
    recordingStartTimeRef.current = store.currentTime;
    const elStart = Number.parseFloat(sel.dataAttributes?.start ?? "0") || 0;
    const elDur = Number.parseFloat(sel.dataAttributes?.duration ?? "0") || 0;
    const elementEnd = elDur > 0 ? elStart + elDur : undefined;
    gestureRecording.startRecording(sel.element, iframe, elementEnd);
    gestureStateRef.current = "recording";
    isGestureRecordingRef.current = true;
    setGestureState("recording");

    clearInterval(recordingAutoStopRef.current);
    const autoStopAt = elementEnd ?? Infinity;
    recordingAutoStopRef.current = setInterval(() => {
      const { currentTime: t, duration: d } = usePlayerStore.getState();
      const limit = Math.min(autoStopAt, d);
      if (limit > 0 && t >= limit - 0.05) {
        void stopAndCommitRecording();
      }
    }, 100);
  }, [gestureRecording, showToast, stopAndCommitRecording]);
  handleToggleRecordingRef.current = handleToggleRecording;

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
    selectedStudioMotion,
    designPanelActive,
    motionPanelActive,
    inspectorPanelActive,
    inspectorButtonActive,
    shouldShowSelectedDomBounds,
  } = useInspectorState(
    panelLayout.rightPanelTab,
    panelLayout.rightCollapsed,
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
  });
  if (resolving || waitingForServer || !projectId)
    return <StudioSplash waiting={waitingForServer} />;
  const timelineToolbar = (
    <TimelineToolbar
      toggleTimelineVisibility={toggleTimelineVisibility}
      domEditSession={domEditSession}
      onSplitElement={timelineEditing.handleTimelineElementSplit}
    />
  );
  return (
    <StudioProvider value={studioCtxValue}>
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
                onExport={() => void renderQueue.startRender()}
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
                  handleTimelineElementSplit={timelineEditing.handleTimelineElementSplit}
                  setCompIdToSrc={setCompIdToSrc}
                  setCompositionLoading={setCompositionLoading}
                  shouldShowSelectedDomBounds={shouldShowSelectedDomBounds}
                  isGestureRecording={gestureState === "recording"}
                  blockPreview={blockPreview}
                  gestureOverlay={
                    gestureState === "recording" && previewIframe ? (
                      <GestureTrailOverlay
                        samples={gestureRecording.samplesRef.current}
                        sampleCount={gestureRecording.samplesRef.current.length}
                        trail={gestureRecording.trailRef.current}
                        canvasRect={(() => {
                          const r = previewIframe.getBoundingClientRect();
                          return { left: r.left, top: r.top, width: r.width, height: r.height };
                        })()}
                        compositionSize={compositionDimensions ?? undefined}
                        mode="recording"
                      />
                    ) : undefined
                  }
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
                    recordingState={gestureState}
                    recordingDuration={gestureRecording.recordingDuration}
                    onToggleRecording={handleToggleRecording}
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
    </StudioProvider>
  );
}
