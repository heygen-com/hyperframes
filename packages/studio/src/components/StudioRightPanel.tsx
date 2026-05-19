import type { BlockParam } from "@hyperframes/core/registry";
import { CaptionPropertyPanel } from "../captions/components/CaptionPropertyPanel";
import { useDomEditContext } from "../contexts/DomEditContext";
import { useFileManagerContext } from "../contexts/FileManagerContext";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
import { useStudioContext } from "../contexts/StudioContext";
import { INSPECTOR_PANEL_TABS } from "../utils/studioHelpers";
import { BlockParamsPanel } from "./editor/BlockParamsPanel";
import { LayerCssRulesPanel } from "./editor/LayerCssRulesPanel";
import { LayersPanel } from "./editor/LayersPanel";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_MOTION_PANEL_ENABLED,
} from "./editor/manualEditingAvailability";
import { MotionPanel } from "./editor/MotionPanel";
import { PropertyPanel } from "./editor/PropertyPanel";
import type { StudioGsapMotion } from "./editor/studioMotion";
import { RenderQueue } from "./renders/RenderQueue";
import type { RenderJob } from "./renders/useRenderQueue";

/** Motion data without targeting metadata. */
type StudioMotionData = Omit<StudioGsapMotion, "kind" | "target" | "updatedAt">;

export interface StudioRightPanelProps {
  selectedStudioMotion: StudioMotionData | null;
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
  activeBlockParams,
  onCloseBlockParams,
}: StudioRightPanelProps) {
  const {
    rightWidth,
    rightPanelTabs,
    rightPanelFocusTab,
    focusRightPanelTab,
    toggleRightPanelTab,
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
  const isTabOpen = (tab: (typeof INSPECTOR_PANEL_TABS)[number] | "renders") =>
    rightPanelTabs.includes(tab);
  const inspectorTabsInOrder = STUDIO_INSPECTOR_PANELS_ENABLED
    ? INSPECTOR_PANEL_TABS.filter((tab) => {
        if (tab === "motion" && !STUDIO_MOTION_PANEL_ENABLED) return false;
        return isTabOpen(tab);
      })
    : [];
  const showRenders = isTabOpen("renders");
  const showAnyInspector = inspectorTabsInOrder.length > 0;
  const singleInspectorTab = inspectorTabsInOrder.length === 1;
  const showBlockParams = rightPanelFocusTab === "block-params" && Boolean(activeBlockParams);

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
                    onClick={() => toggleRightPanelTab("design")}
                    className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors ${
                      isTabOpen("design")
                        ? "bg-neutral-800 text-white"
                        : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
                    }`}
                  >
                    Design
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleRightPanelTab("layers")}
                    className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors ${
                      isTabOpen("layers")
                        ? "bg-neutral-800 text-white"
                        : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
                    }`}
                  >
                    Layers
                  </button>
                  {STUDIO_MOTION_PANEL_ENABLED && (
                    <button
                      type="button"
                      onClick={() => toggleRightPanelTab("motion")}
                      className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors ${
                        isTabOpen("motion")
                          ? "bg-neutral-800 text-white"
                          : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
                      }`}
                    >
                      Motion
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleRightPanelTab("css")}
                    className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors ${
                      isTabOpen("css")
                        ? "bg-neutral-800 text-white"
                        : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
                    }`}
                  >
                    CSS
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => toggleRightPanelTab("renders")}
                className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors ${
                  isTabOpen("renders")
                    ? "bg-neutral-800 text-white"
                    : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
                }`}
              >
                {renderJobs.length > 0 ? `Renders (${renderJobs.length})` : "Renders"}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {showBlockParams && activeBlockParams ? (
                <BlockParamsPanel
                  blockName={activeBlockParams.blockName}
                  blockTitle={activeBlockParams.blockTitle}
                  params={activeBlockParams.params}
                  compositionPath={activeBlockParams.compositionPath}
                  onClose={onCloseBlockParams ?? (() => {})}
                />
              ) : null}
              {!showBlockParams && showAnyInspector ? (
                <div className={singleInspectorTab ? "flex h-full p-2" : "space-y-2 p-2"}>
                  {inspectorTabsInOrder.map((tab) => (
                    <section
                      key={tab}
                      className={`min-h-0 rounded-xl border border-neutral-800 bg-neutral-900/70 ${
                        singleInspectorTab ? "flex h-full w-full flex-col" : ""
                      } ${rightPanelFocusTab === tab ? "ring-1 ring-white/10" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => focusRightPanelTab(tab)}
                        className="flex w-full items-center justify-between border-b border-neutral-800 px-3 py-2 text-[11px] font-medium text-neutral-300"
                      >
                        <span className="uppercase tracking-wide">{tab}</span>
                        {rightPanelFocusTab === tab ? (
                          <span className="text-[10px] text-neutral-500">Active</span>
                        ) : null}
                      </button>
                      <div
                        className={
                          singleInspectorTab
                            ? "min-h-0 flex-1 overflow-y-auto"
                            : "h-[320px] min-h-0 overflow-y-auto"
                        }
                      >
                        {tab === "layers" ? (
                          <LayersPanel />
                        ) : tab === "css" ? (
                          <LayerCssRulesPanel />
                        ) : tab === "design" ? (
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
                        ) : (
                          <MotionPanel
                            element={domEditGroupSelections.length > 1 ? null : domEditSelection}
                            motion={selectedStudioMotion}
                            onClearSelection={clearDomSelection}
                            onSetMotion={handleDomMotionCommit}
                            onClearMotion={handleDomMotionClear}
                          />
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}
              {showRenders ? (
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
              ) : null}
            </div>
          </>
        )}
      </div>
    </>
  );
}
