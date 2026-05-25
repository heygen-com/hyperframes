import { Tooltip } from "./ui";
import { PropertyPanel } from "./editor/PropertyPanel";
import { MotionPanel } from "./editor/MotionPanel";
import { LayersPanel } from "./editor/LayersPanel";
import { CaptionPropertyPanel } from "../captions/components/CaptionPropertyPanel";
import { BlockParamsPanel } from "./editor/BlockParamsPanel";
import { RenderQueue } from "./renders/RenderQueue";
import type { RenderJob } from "./renders/useRenderQueue";
import type { StudioGsapMotion } from "./editor/studioMotion";
import type { BlockParam } from "@hyperframes/core/registry";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_MOTION_PANEL_ENABLED,
} from "./editor/manualEditingAvailability";

/** Motion data without targeting metadata. */
type StudioMotionData = Omit<StudioGsapMotion, "kind" | "target" | "updatedAt">;

import { useStudioContext } from "../contexts/StudioContext";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
import { useFileManagerContext } from "../contexts/FileManagerContext";
import { useDomEditContext } from "../contexts/DomEditContext";

export interface StudioRightPanelProps {
  selectedStudioMotion: StudioMotionData | null;
  designPanelActive: boolean;
  motionPanelActive: boolean;
  activeBlockParams?: {
    blockName: string;
    blockTitle: string;
    params: BlockParam[];
    compositionPath: string;
  } | null;
  onCloseBlockParams?: () => void;
}

export function StudioRightPanel({
  selectedStudioMotion,
  designPanelActive,
  motionPanelActive,
  activeBlockParams,
  onCloseBlockParams,
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
    handleDomAttributeCommit,
    handleDomHtmlAttributeCommit,
    handleDomPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomTextCommit,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
    handleAskAgent,
    handleDomMotionCommit,
    handleDomMotionClear,
  } = useDomEditContext();

  const { assets, fontAssets, projectDir, handleImportFiles, handleImportFonts } =
    useFileManagerContext();

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
                  <Tooltip label="Element styles and properties" side="bottom">
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
                  </Tooltip>
                  <Tooltip label="Composition layer stack" side="bottom">
                    <button
                      type="button"
                      onClick={() => setRightPanelTab("layers")}
                      className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors ${
                        rightPanelTab === "layers"
                          ? "bg-neutral-800 text-white"
                          : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
                      }`}
                    >
                      Layers
                    </button>
                  </Tooltip>
                  {STUDIO_MOTION_PANEL_ENABLED && (
                    <Tooltip label="Animation and motion" side="bottom">
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
                    </Tooltip>
                  )}
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
              ) : rightPanelTab === "layers" ? (
                <LayersPanel />
              ) : designPanelActive ? (
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
                    const composition =
                      activeCompPath && activeCompPath !== "index.html"
                        ? activeCompPath
                        : undefined;
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
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
