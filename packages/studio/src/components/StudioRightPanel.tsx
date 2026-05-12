import { PropertyPanel } from "./editor/PropertyPanel";
import { MotionPanel } from "./editor/MotionPanel";
import { CaptionPropertyPanel } from "../captions/components/CaptionPropertyPanel";
import { RenderQueue } from "./renders/RenderQueue";
import type { RenderJob } from "./renders/useRenderQueue";
import type { StudioGsapMotion } from "./editor/studioMotion";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_MOTION_PANEL_ENABLED,
} from "./editor/manualEditingAvailability";
import { useCallback } from "react";
import { resolveDomEditSelection, type DomEditLayerItem } from "./editor/domEditing";
import { useStudioContext } from "../contexts/StudioContext";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
import { useFileManagerContext } from "../contexts/FileManagerContext";
import { useDomEditContext } from "../contexts/DomEditContext";

export interface StudioRightPanelProps {
  selectedStudioMotion: StudioGsapMotion | null;
  designPanelActive: boolean;
  motionPanelActive: boolean;
}

export function StudioRightPanel({
  selectedStudioMotion,
  designPanelActive,
  motionPanelActive,
}: StudioRightPanelProps) {
  const {
    rightWidth,
    rightPanelTab,
    setRightPanelTab,
    handlePanelResizeStart,
    handlePanelResizeMove,
    handlePanelResizeEnd,
  } = usePanelLayoutContext();

  const {
    captionEditMode,
    previewIframeRef,
    projectId,
    activeCompPath,
    compositionDimensions,
    waitForPendingDomEditSaves,
    renderQueue,
  } = useStudioContext();

  const {
    domEditSelection,
    domEditGroupSelections,
    copiedAgentPrompt,
    clearDomSelection,
    handleDomStyleCommit,
    handleDomPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomTextCommit,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
    handleDomManualEditsReset,
    handleAskAgent,
    handleDomMotionCommit,
    handleDomMotionClear,
    applyDomSelection,
  } = useDomEditContext();

  const { assets, fontAssets, handleImportFiles, handleImportFonts } = useFileManagerContext();

  const isMasterView = !activeCompPath || activeCompPath === "index.html";
  const handleSelectLayer = useCallback(
    (layer: DomEditLayerItem) => {
      const selection = resolveDomEditSelection(layer.element, {
        activeCompositionPath: activeCompPath,
        isMasterView,
        preferClipAncestor: false,
      });
      if (selection) applyDomSelection(selection);
    },
    [activeCompPath, isMasterView, applyDomSelection],
  );

  const renderJobs = renderQueue.jobs as RenderJob[];

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
                  <button
                    type="button"
                    onClick={() => setRightPanelTab("design")}
                    className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors ${
                      rightPanelTab === "design"
                        ? "bg-neutral-800 text-white"
                        : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
                    }`}
                  >
                    Design
                  </button>
                  {STUDIO_MOTION_PANEL_ENABLED && (
                    <button
                      type="button"
                      onClick={() => setRightPanelTab("motion")}
                      className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors ${
                        rightPanelTab === "motion"
                          ? "bg-neutral-800 text-white"
                          : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
                      }`}
                    >
                      Motion
                    </button>
                  )}
                </>
              )}
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
            </div>
            <div className="min-h-0 flex-1">
              {designPanelActive ? (
                <PropertyPanel
                  projectId={projectId}
                  assets={assets}
                  element={domEditGroupSelections.length > 1 ? null : domEditSelection}
                  multiSelectCount={domEditGroupSelections.length}
                  copiedAgentPrompt={copiedAgentPrompt}
                  onClearSelection={clearDomSelection}
                  onSetStyle={handleDomStyleCommit}
                  onSetManualOffset={handleDomPathOffsetCommit}
                  onSetManualSize={handleDomBoxSizeCommit}
                  onSetManualRotation={handleDomRotationCommit}
                  onSetText={handleDomTextCommit}
                  onSetTextFieldStyle={handleDomTextFieldStyleCommit}
                  onAddTextField={handleDomAddTextField}
                  onRemoveTextField={handleDomRemoveTextField}
                  onResetManualEdits={handleDomManualEditsReset}
                  onAskAgent={handleAskAgent}
                  onImportAssets={handleImportFiles}
                  fontAssets={fontAssets}
                  onImportFonts={handleImportFonts}
                  activeCompositionPath={activeCompPath}
                  onSelectLayer={handleSelectLayer}
                />
              ) : motionPanelActive ? (
                <MotionPanel
                  element={domEditGroupSelections.length > 1 ? null : domEditSelection}
                  motion={selectedStudioMotion}
                  onClearSelection={clearDomSelection}
                  onSetMotion={handleDomMotionCommit}
                  onClearMotion={handleDomMotionClear}
                />
              ) : (
                <RenderQueue
                  jobs={renderJobs}
                  projectId={projectId}
                  onDelete={renderQueue.deleteRender}
                  onClearCompleted={renderQueue.clearCompleted}
                  onStartRender={async (format, quality, resolution, fps) => {
                    await waitForPendingDomEditSaves();
                    await renderQueue.startRender({ fps, quality, format, resolution });
                  }}
                  compositionDimensions={compositionDimensions}
                  isRendering={renderQueue.isRendering}
                />
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
