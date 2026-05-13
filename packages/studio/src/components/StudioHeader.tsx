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

function HyperframesIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={Math.round(size * (42 / 74))}
      viewBox="190 -2 74 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="hf-icon-g0"
          x1="225.869"
          y1="0"
          x2="222.845"
          y2="37.482"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#06E3FA" />
          <stop offset="1" stopColor="#4FDB5E" />
        </linearGradient>
        <linearGradient
          id="hf-icon-g1"
          x1="230.87"
          y1="39"
          x2="244.661"
          y2="6.303"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#06E3FA" />
          <stop offset="1" stopColor="#4FDB5E" />
        </linearGradient>
      </defs>
      <path
        d="M195.219 26.1937L213.529 38.9937C216.009 40.7237 220.239 38.7637 221.009 35.5337L228.419 4.33374C229.189 1.10374 225.879 -0.856262 222.589 0.873738L198.199 13.6737C192.649 16.5837 191.059 23.2837 195.219 26.1937Z"
        fill="url(#hf-icon-g0)"
      />
      <path
        d="M256.97 25.9638L232.58 38.7638C229.28 40.4938 225.98 38.5338 226.75 35.3038L234.16 4.10376C234.93 0.873757 239.16 -1.08624 241.64 0.643757L259.95 13.4438C264.12 16.3538 262.52 23.0538 256.97 25.9638Z"
        fill="url(#hf-icon-g1)"
      />
    </svg>
  );
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
      {/* Left: logo + project name */}
      <div className="flex items-center gap-2">
        <HyperframesIcon size={28} />
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
