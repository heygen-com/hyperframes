import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Tooltip } from "./ui";
import { PropertyPanel } from "./editor/PropertyPanel";
import { LayersPanel } from "./editor/LayersPanel";
import { CaptionPropertyPanel } from "../captions/components/CaptionPropertyPanel";
import { BlockParamsPanel } from "./editor/BlockParamsPanel";
import { RenderQueue } from "./renders/RenderQueue";
import { SlideshowPanel } from "./panels/SlideshowPanel";
import type { SceneInfo } from "./panels/SlideshowPanel";
import type { RenderJob } from "./renders/useRenderQueue";
import type { BlockParam } from "@hyperframes/core/registry";
import type { IframeWindow } from "../player/lib/playbackTypes";
import { STUDIO_INSPECTOR_PANELS_ENABLED } from "./editor/manualEditingAvailability";
import type { Composition } from "@hyperframes/sdk";
import type { EditHistoryKind } from "../utils/editHistory";
import { useSlideshowPersist } from "../hooks/useSlideshowPersist";

import { useStudioPlaybackContext, useStudioShellContext } from "../contexts/StudioContext";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
import { useFileManagerContext } from "../contexts/FileManagerContext";
import { useDomEditContext } from "../contexts/DomEditContext";
import { usePlayerStore } from "../player";
import { waitForMediaJob } from "./studioMediaJobs";
import {
  applyColorGradingScopeUpdate,
  EMPTY_COLOR_GRADING_SCOPE_RESULT,
  type ColorGradingScope,
} from "./studioColorGradingScope";
import type { BackgroundRemovalProgress } from "./editor/propertyPanelTypes";

const MIN_INSPECTOR_SPLIT_PERCENT = 20;
const MAX_INSPECTOR_SPLIT_PERCENT = 75;

export interface StudioRightPanelProps {
  designPanelActive: boolean;
  activeBlockParams?: {
    blockName: string;
    blockTitle: string;
    params: BlockParam[];
    compositionPath: string;
  } | null;
  onCloseBlockParams?: () => void;
  recordingState?: "idle" | "recording" | "preview";
  recordingDuration?: number;
  onToggleRecording?: () => void;
  /** Dependencies for the Slideshow persist callback, threaded from App.tsx. */
  sdkSession: Composition | null;
  reloadPreview: () => void;
  domEditSaveTimestampRef: MutableRefObject<number>;
  recordEdit: (entry: {
    label: string;
    kind: EditHistoryKind;
    files: Record<string, { before: string; after: string }>;
  }) => Promise<void>;
  onToggleElementHidden?: (elementKey: string, hidden: boolean) => Promise<void> | void;
}

// fallow-ignore-next-line complexity
export function StudioRightPanel({
  designPanelActive,
  activeBlockParams,
  onCloseBlockParams,
  recordingState,
  recordingDuration,
  onToggleRecording,
  sdkSession,
  reloadPreview,
  domEditSaveTimestampRef,
  recordEdit,
  onToggleElementHidden,
}: StudioRightPanelProps) {
  const {
    rightWidth,
    setRightWidth,
    rightPanelTab,
    setRightPanelTab,
    rightInspectorPanes,
    toggleRightInspectorPane,
    handlePanelResizeStart,
    handlePanelResizeMove,
    handlePanelResizeEnd,
  } = usePanelLayoutContext();

  const {
    previewIframeRef,
    projectId,
    activeCompPath,
    showToast,
    compositionDimensions,
    waitForPendingDomEditSaves,
    renderQueue,
  } = useStudioShellContext();
  const { captionEditMode, refreshKey } = useStudioPlaybackContext();

  const {
    domEditSelection,
    domEditGroupSelections,
    copiedAgentPrompt,
    clearDomSelection,
    handleUngroupSelection,
    handleDomStyleCommit,
    handleDomAttributeCommit,
    handleDomAttributeLiveCommit,
    handleDomHtmlAttributeCommit,
    handleDomPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomTextCommit,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
    handleAskAgent,
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
    commitAnimatedProperty,
    commitAnimatedProperties,
    handleSetArcPath,
    handleUpdateArcSegment,
    handleUnroll,
    handleUpdateKeyframeEase,
    handleSetAllKeyframeEases,
    handleGsapAddKeyframe,
    handleGsapRemoveKeyframe,
    handleGsapConvertToKeyframes,
  } = useDomEditContext();

  const {
    assets,
    fontAssets,
    projectDir,
    handleImportFiles,
    handleImportFonts,
    refreshFileTree,
    readProjectFile,
    writeProjectFile,
    fileTree,
  } = useFileManagerContext();

  // Discrete ops (toggle, reorder, add/delete, hotspot): persist immediately,
  // no coalescing — each is a distinct user action that deserves its own undo entry.
  const onPersistSlideshow = useSlideshowPersist({
    sdkSession,
    activeCompPath,
    readProjectFile,
    writeProjectFile,
    recordEdit,
    reloadPreview,
    domEditSaveTimestampRef,
  });

  // Notes path: persists are debounced in SlideshowPanel; coalesceKey ensures
  // rapid writes collapse into a single undo entry via the save-queue infra.
  const onPersistSlideshowNotes = useSlideshowPersist({
    sdkSession,
    activeCompPath,
    readProjectFile,
    writeProjectFile,
    recordEdit,
    reloadPreview,
    domEditSaveTimestampRef,
    coalesceKey: activeCompPath ? `slideshow-notes:${activeCompPath}` : "slideshow-notes",
  });

  const [layersPanePercent, setLayersPanePercent] = useState(40);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef<{
    startY: number;
    startPercent: number;
    height: number;
  } | null>(null);
  const backgroundRemovalAbortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      backgroundRemovalAbortRef.current?.abort();
    },
    [],
  );

  const renderJobs = renderQueue.jobs as RenderJob[];
  const inspectorTabActive = rightPanelTab === "design" || rightPanelTab === "layers";

  // Derive scene list from the live clip manifest in the preview iframe.
  // fallow-ignore-next-line complexity
  const slideshowScenes = useMemo<SceneInfo[]>(() => {
    try {
      const win = previewIframeRef.current?.contentWindow as IframeWindow | null;
      return (win?.__clipManifest?.scenes ?? []).map((s) => ({
        id: s.id,
        label: s.label,
        start: s.start,
        duration: s.duration,
      }));
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewIframeRef, rightPanelTab, refreshKey]);
  const designPaneOpen = inspectorTabActive && rightInspectorPanes.design && designPanelActive;
  const layersPaneOpen =
    inspectorTabActive && rightInspectorPanes.layers && STUDIO_INSPECTOR_PANELS_ENABLED;

  const handleInspectorPaneButtonClick = (pane: "design" | "layers") => {
    if (!inspectorTabActive) {
      setRightPanelTab(pane);
      return;
    }
    toggleRightInspectorPane(pane);
  };

  const handleInspectorSplitResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const height = splitContainerRef.current?.getBoundingClientRect().height ?? 0;
      splitDragRef.current = {
        startY: event.clientY,
        startPercent: layersPanePercent,
        height,
      };
    },
    [layersPanePercent],
  );

  const handleInspectorSplitResizeMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = splitDragRef.current;
    if (!drag || drag.height <= 0) return;
    const deltaPercent = ((event.clientY - drag.startY) / drag.height) * 100;
    const next = Math.min(
      MAX_INSPECTOR_SPLIT_PERCENT,
      Math.max(MIN_INSPECTOR_SPLIT_PERCENT, drag.startPercent + deltaPercent),
    );
    setLayersPanePercent(next);
  }, []);

  const handleInspectorSplitResizeEnd = useCallback(() => {
    splitDragRef.current = null;
  }, []);

  const handleApplyColorGradingScope = useCallback(
    async (scope: ColorGradingScope, value: string | null) =>
      applyColorGradingScopeUpdate({
        scope,
        value,
        selectedSourceFile: domEditSelection?.sourceFile || activeCompPath || "index.html",
        fileTree,
        projectId,
        domEditSaveTimestampRef,
        waitForPendingDomEditSaves,
        readProjectFile,
        writeProjectFile,
        recordEdit,
        reloadPreview,
        showToast,
      }).catch((error) => {
        showToast(
          `Couldn't apply color grading: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return EMPTY_COLOR_GRADING_SCOPE_RESULT;
      }),
    [
      activeCompPath,
      domEditSaveTimestampRef,
      domEditSelection?.sourceFile,
      fileTree,
      projectId,
      readProjectFile,
      recordEdit,
      reloadPreview,
      showToast,
      waitForPendingDomEditSaves,
      writeProjectFile,
    ],
  );

  const handleRemoveBackground = useCallback(
    // fallow-ignore-next-line complexity
    async (
      inputPath: string,
      options: {
        createBackgroundPlate?: boolean;
        quality?: "fast" | "balanced" | "best";
        onProgress?: (progress: BackgroundRemovalProgress) => void;
      },
    ) => {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/media/remove-background`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inputPath,
            createBackgroundPlate: options.createBackgroundPlate === true,
            quality: options.quality ?? "balanced",
          }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        jobId?: string;
        error?: string;
      };
      if (!response.ok || !data.jobId) {
        throw new Error(data.error || `Background removal failed (${response.status})`);
      }
      showToast("Removing background...", "info");
      backgroundRemovalAbortRef.current?.abort();
      const controller = new AbortController();
      backgroundRemovalAbortRef.current = controller;
      try {
        const result = await waitForMediaJob(data.jobId, options.onProgress, controller.signal);
        await refreshFileTree();
        showToast(`Created transparent asset: ${result.outputPath.split("/").pop()}`, "info");
        return result;
      } finally {
        if (backgroundRemovalAbortRef.current === controller) {
          backgroundRemovalAbortRef.current = null;
        }
      }
    },
    [projectId, refreshFileTree, showToast],
  );

  const propertyPanel = (
    <PropertyPanel
      projectId={projectId}
      projectDir={projectDir}
      assets={assets}
      element={domEditGroupSelections.length > 1 ? null : domEditSelection}
      multiSelectCount={domEditGroupSelections.length}
      copiedAgentPrompt={copiedAgentPrompt}
      onClearSelection={clearDomSelection}
      onToggleElementHidden={onToggleElementHidden}
      onUngroup={handleUngroupSelection}
      onSetStyle={handleDomStyleCommit}
      onSetAttribute={handleDomAttributeCommit}
      onSetAttributeLive={handleDomAttributeLiveCommit}
      onApplyColorGradingScope={handleApplyColorGradingScope}
      onSetHtmlAttribute={handleDomHtmlAttributeCommit}
      onRemoveBackground={handleRemoveBackground}
      onSetManualOffset={handleDomPathOffsetCommit}
      onSetManualSize={handleDomBoxSizeCommit}
      onSetManualRotation={handleDomRotationCommit}
      onSetText={handleDomTextCommit}
      onSetTextFieldStyle={handleDomTextFieldStyleCommit}
      onAddTextField={handleDomAddTextField}
      onRemoveTextField={handleDomRemoveTextField}
      onAskAgent={handleAskAgent}
      onImportAssets={handleImportFiles}
      fontAssets={fontAssets}
      onImportFonts={handleImportFonts}
      previewIframeRef={previewIframeRef}
      gsapAnimations={selectedGsapAnimations}
      gsapMultipleTimelines={gsapMultipleTimelines}
      gsapUnsupportedTimelinePattern={gsapUnsupportedTimelinePattern}
      onUpdateGsapProperty={handleGsapUpdateProperty}
      onUpdateGsapMeta={handleGsapUpdateMeta}
      onDeleteGsapAnimation={handleGsapDeleteAnimation}
      onAddGsapProperty={handleGsapAddProperty}
      onRemoveGsapProperty={handleGsapRemoveProperty}
      onUpdateGsapFromProperty={handleGsapUpdateFromProperty}
      onAddGsapFromProperty={handleGsapAddFromProperty}
      onRemoveGsapFromProperty={handleGsapRemoveFromProperty}
      onAddGsapAnimation={handleGsapAddAnimation}
      onCommitAnimatedProperty={commitAnimatedProperty}
      onCommitAnimatedProperties={commitAnimatedProperties}
      onAddKeyframe={handleGsapAddKeyframe}
      onRemoveKeyframe={handleGsapRemoveKeyframe}
      onConvertToKeyframes={(animId, duration) =>
        handleGsapConvertToKeyframes(animId, undefined, duration)
      }
      onSeekToTime={(t) => usePlayerStore.getState().requestSeek(t)}
      onSetArcPath={handleSetArcPath}
      onUpdateArcSegment={handleUpdateArcSegment}
      onUnroll={handleUnroll}
      onUpdateKeyframeEase={handleUpdateKeyframeEase}
      onSetAllKeyframeEases={handleSetAllKeyframeEases}
      recordingState={recordingState}
      recordingDuration={recordingDuration}
      onToggleRecording={onToggleRecording}
    />
  );

  const renderQueuePanel = (
    <RenderQueue
      jobs={renderJobs}
      projectId={projectId}
      onDelete={renderQueue.deleteRender}
      onCancel={renderQueue.cancelRender}
      loadError={renderQueue.loadError}
      onRetryLoad={renderQueue.reloadRenders}
      actionError={renderQueue.actionError}
      onDismissActionError={renderQueue.dismissActionError}
      onClearCompleted={renderQueue.clearCompleted}
      onStartRender={async (format, quality, resolution, fps) => {
        await waitForPendingDomEditSaves();
        const composition =
          activeCompPath && activeCompPath !== "index.html" ? activeCompPath : undefined;
        await renderQueue.startRender({
          fps,
          quality,
          format,
          resolution,
          composition,
        });
      }}
      compositionDimensions={compositionDimensions}
      isRendering={renderQueue.isRendering}
    />
  );

  return (
    <>
      <div
        role="separator"
        aria-label="Resize inspector panel"
        aria-orientation="vertical"
        tabIndex={0}
        className="group w-2 flex-shrink-0 cursor-col-resize flex items-center justify-center outline-none focus-visible:bg-studio-accent/20"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => handlePanelResizeStart("right", e)}
        onPointerMove={handlePanelResizeMove}
        onPointerUp={handlePanelResizeEnd}
        onPointerCancel={handlePanelResizeEnd}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          // Panel is right-anchored: ArrowLeft grows it, ArrowRight shrinks it.
          const delta = e.key === "ArrowLeft" ? 16 : -16;
          setRightWidth(Math.max(160, Math.min(600, rightWidth + delta)));
        }}
      >
        <div className="h-[52px] w-px bg-white/12 transition-colors group-hover:bg-white/18 group-active:bg-white/24" />
      </div>
      <div
        className="flex min-w-0 flex-shrink-0 flex-col overflow-hidden border-l border-neutral-800 bg-neutral-900"
        style={{ width: rightWidth }}
      >
        {captionEditMode ? (
          <CaptionPropertyPanel iframeRef={previewIframeRef} />
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-1 overflow-hidden border-b border-neutral-800 px-3 py-2">
              {STUDIO_INSPECTOR_PANELS_ENABLED && (
                <>
                  <Tooltip label="Element styles and properties" side="bottom">
                    <button
                      type="button"
                      onClick={() => handleInspectorPaneButtonClick("design")}
                      aria-pressed={designPaneOpen}
                      className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors active:scale-[0.98] ${
                        designPaneOpen
                          ? "bg-neutral-800 text-white"
                          : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
                      }`}
                    >
                      Design
                    </button>
                  </Tooltip>
                  <Tooltip label="Composition layer stack" side="bottom">
                    <button
                      type="button"
                      onClick={() => handleInspectorPaneButtonClick("layers")}
                      aria-pressed={layersPaneOpen}
                      className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors active:scale-[0.98] ${
                        layersPaneOpen
                          ? "bg-neutral-800 text-white"
                          : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
                      }`}
                    >
                      Layers
                    </button>
                  </Tooltip>
                </>
              )}
              <Tooltip label="Render queue and exports" side="bottom">
                <button
                  type="button"
                  onClick={() => setRightPanelTab("renders")}
                  aria-pressed={rightPanelTab === "renders"}
                  className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors active:scale-[0.98] ${
                    rightPanelTab === "renders"
                      ? "bg-neutral-800 text-white"
                      : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
                  }`}
                >
                  {renderJobs.length > 0 ? `Renders (${renderJobs.length})` : "Renders"}
                </button>
              </Tooltip>
              <Tooltip label="Slideshow branching editor" side="bottom">
                <button
                  type="button"
                  onClick={() => setRightPanelTab("slideshow")}
                  aria-pressed={rightPanelTab === "slideshow"}
                  className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors active:scale-[0.98] ${
                    rightPanelTab === "slideshow"
                      ? "bg-neutral-800 text-white"
                      : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
                  }`}
                >
                  Slideshow
                </button>
              </Tooltip>
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              {rightPanelTab === "block-params" && activeBlockParams ? (
                <BlockParamsPanel
                  blockName={activeBlockParams.blockName}
                  blockTitle={activeBlockParams.blockTitle}
                  params={activeBlockParams.params}
                  compositionPath={activeBlockParams.compositionPath}
                  onClose={onCloseBlockParams ?? (() => {})}
                />
              ) : rightPanelTab === "slideshow" ? (
                <SlideshowPanel
                  scenes={slideshowScenes}
                  onPersist={onPersistSlideshow}
                  onPersistNotes={onPersistSlideshowNotes}
                />
              ) : layersPaneOpen && designPaneOpen ? (
                <div ref={splitContainerRef} className="flex h-full min-h-0 min-w-0 flex-col">
                  <div
                    className="min-h-[120px] overflow-hidden"
                    style={{ flexBasis: `${layersPanePercent}%`, flexShrink: 0 }}
                  >
                    <LayersPanel />
                  </div>
                  <div
                    role="separator"
                    aria-label="Resize Layers and Design panes"
                    aria-orientation="horizontal"
                    className="group flex h-2 flex-shrink-0 cursor-row-resize items-center justify-center border-y border-neutral-800 bg-neutral-900"
                    style={{ touchAction: "none" }}
                    onPointerDown={handleInspectorSplitResizeStart}
                    onPointerMove={handleInspectorSplitResizeMove}
                    onPointerUp={handleInspectorSplitResizeEnd}
                    onPointerCancel={handleInspectorSplitResizeEnd}
                  >
                    <div className="h-px w-10 rounded-full bg-white/12 transition-colors group-hover:bg-white/24 group-active:bg-studio-accent/70" />
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden">{propertyPanel}</div>
                </div>
              ) : layersPaneOpen ? (
                <LayersPanel />
              ) : designPaneOpen ? (
                propertyPanel
              ) : inspectorTabActive ? (
                // Inspector tab selected but no pane can render (panes toggled
                // off, or inspector inactive during playback/recording): show an
                // explanation instead of silently rendering the render queue
                // under a highlighted inspector tab.
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <p className="text-xs text-neutral-500">
                    Inspector is unavailable right now — select the Design or Layers pane above, or
                    pause playback/recording to inspect elements.
                  </p>
                  <button
                    type="button"
                    onClick={() => setRightPanelTab("renders")}
                    className="h-7 rounded-md border border-neutral-800 px-3 text-[11px] font-medium text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-200 active:scale-[0.98]"
                  >
                    Show Renders
                  </button>
                </div>
              ) : (
                renderQueuePanel
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
