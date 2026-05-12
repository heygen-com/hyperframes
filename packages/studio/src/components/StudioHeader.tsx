import type { MouseEvent } from "react";
import { RotateCcw, RotateCw, Camera } from "../icons/SystemIcons";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_MANUAL_EDITING_DISABLED_TITLE,
} from "./editor/manualEditingAvailability";
import { getHistoryShortcutLabel } from "../utils/studioHelpers";
import { useStudioContext } from "../contexts/StudioContext";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
import { useDomEditContext } from "../contexts/DomEditContext";

export interface StudioHeaderProps {
  captureFrameHref: string;
  captureFrameFilename: string;
  handleCaptureFrameClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  refreshCaptureFrameTime: () => void;
  inspectorButtonActive: boolean;
  inspectorPanelActive: boolean;
}

export function StudioHeader({
  captureFrameHref,
  captureFrameFilename,
  handleCaptureFrameClick,
  refreshCaptureFrameTime,
  inspectorButtonActive,
  inspectorPanelActive,
}: StudioHeaderProps) {
  const { projectId, editHistory, handleUndo, handleRedo } = useStudioContext();
  const { rightCollapsed, setRightCollapsed, setRightPanelTab } = usePanelLayoutContext();
  const { clearDomSelection } = useDomEditContext();

  return (
    <div className="flex items-center justify-between h-10 px-3 bg-neutral-900 border-b border-neutral-800 flex-shrink-0">
      {/* Left: project name */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-neutral-400">{projectId}</span>
      </div>
      {/* Right: toolbar buttons */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void handleUndo()}
          disabled={!editHistory.canUndo}
          className={`h-7 w-7 flex items-center justify-center rounded-md border transition-colors ${
            editHistory.canUndo
              ? "border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:bg-neutral-800"
              : "border-neutral-900 text-neutral-700"
          }`}
          title={
            editHistory.undoLabel
              ? `Undo ${editHistory.undoLabel} (${getHistoryShortcutLabel("undo")})`
              : `Undo (${getHistoryShortcutLabel("undo")})`
          }
          aria-label="Undo"
        >
          <RotateCcw size={14} />
        </button>
        <button
          type="button"
          onClick={() => void handleRedo()}
          disabled={!editHistory.canRedo}
          className={`h-7 w-7 flex items-center justify-center rounded-md border transition-colors ${
            editHistory.canRedo
              ? "border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:bg-neutral-800"
              : "border-neutral-900 text-neutral-700"
          }`}
          title={
            editHistory.redoLabel
              ? `Redo ${editHistory.redoLabel} (${getHistoryShortcutLabel("redo")})`
              : `Redo (${getHistoryShortcutLabel("redo")})`
          }
          aria-label="Redo"
        >
          <RotateCw size={14} />
        </button>
        <a
          href={captureFrameHref}
          download={captureFrameFilename}
          onClick={handleCaptureFrameClick}
          onFocus={refreshCaptureFrameTime}
          onPointerDown={refreshCaptureFrameTime}
          className="h-7 flex items-center gap-1.5 px-2.5 rounded-md text-[11px] font-medium border border-neutral-700 text-neutral-300 transition-colors hover:border-neutral-500 hover:bg-neutral-800"
          title="Capture current frame"
          aria-label="Capture current frame"
        >
          <Camera size={14} />
          <span>Capture</span>
        </a>
        <button
          type="button"
          onClick={() => {
            if (!STUDIO_INSPECTOR_PANELS_ENABLED) return;
            if (rightCollapsed || !inspectorPanelActive) {
              setRightPanelTab("design");
              setRightCollapsed(false);
              return;
            }
            clearDomSelection();
            setRightCollapsed(true);
          }}
          disabled={!STUDIO_INSPECTOR_PANELS_ENABLED}
          className={`h-7 flex items-center gap-1.5 px-2.5 rounded-md text-[11px] font-medium border transition-colors ${
            inspectorButtonActive
              ? "text-studio-accent bg-studio-accent/10 border-studio-accent/30"
              : STUDIO_INSPECTOR_PANELS_ENABLED
                ? "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 border-transparent"
                : "cursor-not-allowed border-transparent text-neutral-700"
          }`}
          title={
            STUDIO_INSPECTOR_PANELS_ENABLED ? "Inspector" : STUDIO_MANUAL_EDITING_DISABLED_TITLE
          }
          aria-label={
            STUDIO_INSPECTOR_PANELS_ENABLED ? "Inspector" : STUDIO_MANUAL_EDITING_DISABLED_TITLE
          }
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <polygon points="10 8 16 12 10 16" fill="currentColor" stroke="none" />
          </svg>
          Inspector
        </button>
      </div>
    </div>
  );
}
