import type { RefObject } from "react";
import { PropertyPanel } from "./editor/PropertyPanel";
import { MotionPanel } from "./editor/MotionPanel";
import { CaptionPropertyPanel } from "../captions/components/CaptionPropertyPanel";
import { RenderQueue, type CompositionDimensions } from "./renders/RenderQueue";
import type { RightPanelTab } from "../utils/studioHelpers";
import type { DomEditSelection } from "./editor/domEditing";
import type { StudioGsapMotion } from "./editor/studioMotion";
import type { ImportedFontAsset } from "./editor/fontAssets";
import type { RenderJob, ResolutionPreset } from "./renders/useRenderQueue";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_MOTION_PANEL_ENABLED,
} from "./editor/manualEditingAvailability";

export interface StudioRightPanelProps {
  rightWidth: number;
  rightPanelTab: RightPanelTab;
  setRightPanelTab: (tab: RightPanelTab) => void;
  handlePanelResizeStart: (side: "left" | "right", e: React.PointerEvent) => void;
  handlePanelResizeMove: (e: React.PointerEvent) => void;
  handlePanelResizeEnd: (e: React.PointerEvent) => void;
  captionEditMode: boolean;
  previewIframeRef: RefObject<HTMLIFrameElement | null>;
  // Design panel
  projectId: string;
  assets: string[];
  domEditSelection: DomEditSelection | null;
  domEditGroupSelections: DomEditSelection[];
  copiedAgentPrompt: boolean;
  clearDomSelection: () => void;
  handleDomStyleCommit: (prop: string, value: string) => void | Promise<void>;
  handleDomPathOffsetCommit: (element: DomEditSelection, next: { x: number; y: number }) => void;
  handleDomBoxSizeCommit: (
    element: DomEditSelection,
    next: { width: number; height: number },
  ) => void;
  handleDomTextCommit: (value: string, fieldKey?: string) => void;
  handleDomTextFieldStyleCommit: (fieldKey: string, property: string, value: string) => void;
  handleDomAddTextField: (afterFieldKey?: string) => string | Promise<string | null> | null;
  handleDomRemoveTextField: (fieldKey: string) => void;
  handleDomManualEditsReset: (element: DomEditSelection) => void;
  handleAskAgent: () => void;
  handleImportFiles: (files: FileList) => Promise<string[]>;
  fontAssets: ImportedFontAsset[];
  handleImportFonts: (files: FileList | File[]) => Promise<ImportedFontAsset[]>;
  // Motion panel
  selectedStudioMotion: StudioGsapMotion | null;
  handleDomMotionCommit: (
    element: DomEditSelection,
    motion: Omit<StudioGsapMotion, "kind" | "target" | "updatedAt">,
  ) => void;
  handleDomMotionClear: (element: DomEditSelection) => void;
  // Design panel active states
  designPanelActive: boolean;
  motionPanelActive: boolean;
  // Render panel
  renderQueueJobs: RenderJob[];
  renderQueueDeleteRender: (jobId: string) => void;
  renderQueueClearCompleted: () => void;
  renderQueueStartRender: (options: {
    fps?: number;
    quality?: "draft" | "standard" | "high";
    format?: "mp4" | "webm" | "mov";
    resolution?: ResolutionPreset | "auto";
  }) => Promise<void>;
  renderQueueIsRendering: boolean;
  compositionDimensions: CompositionDimensions | null;
  waitForPendingDomEditSaves: () => Promise<void>;
}

export function StudioRightPanel({
  rightWidth,
  rightPanelTab,
  setRightPanelTab,
  handlePanelResizeStart,
  handlePanelResizeMove,
  handlePanelResizeEnd,
  captionEditMode,
  previewIframeRef,
  projectId,
  assets,
  domEditSelection,
  domEditGroupSelections,
  copiedAgentPrompt,
  clearDomSelection,
  handleDomStyleCommit,
  handleDomPathOffsetCommit,
  handleDomBoxSizeCommit,
  handleDomTextCommit,
  handleDomTextFieldStyleCommit,
  handleDomAddTextField,
  handleDomRemoveTextField,
  handleDomManualEditsReset,
  handleAskAgent,
  handleImportFiles,
  fontAssets,
  handleImportFonts,
  selectedStudioMotion,
  handleDomMotionCommit,
  handleDomMotionClear,
  designPanelActive,
  motionPanelActive,
  renderQueueJobs,
  renderQueueDeleteRender,
  renderQueueClearCompleted,
  renderQueueStartRender,
  renderQueueIsRendering,
  compositionDimensions,
  waitForPendingDomEditSaves,
}: StudioRightPanelProps) {
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
                {renderQueueJobs.length > 0 ? `Renders (${renderQueueJobs.length})` : "Renders"}
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
                  onSetText={handleDomTextCommit}
                  onSetTextFieldStyle={handleDomTextFieldStyleCommit}
                  onAddTextField={handleDomAddTextField}
                  onRemoveTextField={handleDomRemoveTextField}
                  onResetManualEdits={handleDomManualEditsReset}
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
                  jobs={renderQueueJobs}
                  projectId={projectId}
                  onDelete={renderQueueDeleteRender}
                  onClearCompleted={renderQueueClearCompleted}
                  onStartRender={async (format, quality, resolution, fps) => {
                    await waitForPendingDomEditSaves();
                    await renderQueueStartRender({ fps, quality, format, resolution });
                  }}
                  compositionDimensions={compositionDimensions}
                  isRendering={renderQueueIsRendering}
                />
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
