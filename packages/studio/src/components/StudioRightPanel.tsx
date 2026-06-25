import {
  useCallback,
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
}: StudioRightPanelProps) {
  const {
    rightWidth,
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
    readProjectFile,
    writeProjectFile,
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

  const propertyPanel = (
    <PropertyPanel
      projectId={projectId}
      projectDir={projectDir}
      assets={assets}
      element={domEditGroupSelections.length > 1 ? null : domEditSelection}
      multiSelectCount={domEditGroupSelections.length}
      copiedAgentPrompt={copiedAgentPrompt}
      onClearSelection={clearDomSelection}
      onSetStyle={handleDomStyleCommit}
      onSetAttribute={handleDomAttributeCommit}
      onSetAttributeLive={handleDomAttributeLiveCommit}
      onSetHtmlAttribute={handleDomHtmlAttributeCommit}
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
        className="group w-2 flex-shrink-0 cursor-col-resize flex items-center justify-center"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => handlePanelResizeStart("right", e)}
        onPointerMove={handlePanelResizeMove}
        onPointerUp={handlePanelResizeEnd}
      >
        <div className="h-[52px] w-px bg-white/12 transition-colors group-hover:bg-white/18 group-active:bg-white/24" />
      </div>
      <div
        className="flex flex-col border-l border-neutral-800 bg-neutral-900 flex-shrink-0"
        style={{ width: rightWidth }}
      >
        {captionEditMode ? (
          <CaptionPropertyPanel iframeRef={previewIframeRef} />
        ) : (
          <>
            <div className="flex items-center gap-1 border-b border-neutral-800 px-3 py-2">
              {STUDIO_INSPECTOR_PANELS_ENABLED && (
                <>
                  <Tooltip label="Element styles and properties" side="bottom">
                    <button
                      type="button"
                      onClick={() => handleInspectorPaneButtonClick("design")}
                      className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors ${
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
                      className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors ${
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
                  className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors ${
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
                  className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors ${
                    rightPanelTab === "slideshow"
                      ? "bg-neutral-800 text-white"
                      : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
                  }`}
                >
                  Slideshow
                </button>
              </Tooltip>
            </div>
            <div className="min-h-0 flex-1">
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
                <div ref={splitContainerRef} className="flex h-full min-h-0 flex-col">
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
