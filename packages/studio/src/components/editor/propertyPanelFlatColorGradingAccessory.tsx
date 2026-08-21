import { useEffect, useRef } from "react";
import { isHfColorGradingActive } from "@hyperframes/core/color-grading";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { Compare, RotateCcw } from "../../icons/SystemIcons";
import type { ColorGradingControllerState } from "./useColorGradingController";

const STATUS_DOT_CLASS: Record<ColorGradingControllerState["runtimeStatus"]["state"], string> = {
  active: "bg-emerald-400",
  pending: "bg-amber-300",
  unavailable: "bg-red-400",
  missing: "bg-panel-text-5",
  inactive: "bg-panel-text-5",
};

export function FlatColorGradingAccessory({
  state,
}: {
  state: Pick<
    ColorGradingControllerState,
    "grading" | "compareEnabled" | "runtimeStatus" | "commitCompare" | "resetGrading"
  >;
}) {
  const track = useTrackDesignInput();
  const { grading, compareEnabled, runtimeStatus, commitCompare, resetGrading } = state;
  const gradingActive = isHfColorGradingActive(grading);
  const releaseRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      releaseRef.current?.();
      releaseRef.current = null;
    },
    [],
  );

  return (
    <span className="flex items-center gap-2.5">
      <button
        type="button"
        aria-pressed={compareEnabled}
        aria-label="Hold to show original"
        disabled={!gradingActive}
        onPointerDown={(e) => {
          if (!gradingActive) return;
          e.preventDefault();
          e.stopPropagation();
          track("button", "Compare original");
          commitCompare(true);
          const release = () => {
            commitCompare(false);
            window.removeEventListener("pointerup", release);
            window.removeEventListener("pointercancel", release);
            window.removeEventListener("blur", release);
            releaseRef.current = null;
          };
          releaseRef.current = release;
          window.addEventListener("pointerup", release);
          window.addEventListener("pointercancel", release);
          window.addEventListener("blur", release);
        }}
        onBlur={() => {
          if (compareEnabled) commitCompare(false);
        }}
        onKeyDown={(e) => {
          if (!gradingActive || (e.key !== " " && e.key !== "Enter")) return;
          e.preventDefault();
          if (!compareEnabled) {
            track("button", "Compare original");
            commitCompare(true);
          }
        }}
        onKeyUp={(e) => {
          if (!gradingActive || (e.key !== " " && e.key !== "Enter")) return;
          e.preventDefault();
          commitCompare(false);
        }}
        title="Hold to show original"
        className="flex-shrink-0 text-panel-text-3 hover:text-panel-text-1 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Compare size={12} />
      </button>
      <span className="flex min-w-0 items-center gap-1" title={runtimeStatus.message}>
        <span
          data-flat-grade-status-dot="true"
          title={runtimeStatus.message}
          className={`h-[5px] w-[5px] flex-shrink-0 rounded-full ${STATUS_DOT_CLASS[runtimeStatus.state]}`}
        />
        <span
          data-flat-grade-status-message="true"
          className="max-w-[84px] truncate text-[9px] text-panel-text-4"
        >
          {runtimeStatus.message}
        </span>
      </span>
      <button
        type="button"
        data-flat-grade-reset="true"
        title="Reset color grading"
        onClick={(e) => {
          e.stopPropagation();
          track("button", "Reset color grading");
          resetGrading();
        }}
        className="flex-shrink-0 text-panel-text-3 hover:text-panel-text-1"
      >
        <RotateCcw size={12} />
      </button>
    </span>
  );
}
