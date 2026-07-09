import { isHfColorGradingActive } from "@hyperframes/core/color-grading";
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
  const { grading, compareEnabled, runtimeStatus, commitCompare, resetGrading } = state;
  const gradingActive = isHfColorGradingActive(grading);

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
          commitCompare(true);
          const release = () => {
            commitCompare(false);
            window.removeEventListener("pointerup", release);
            window.removeEventListener("pointercancel", release);
          };
          window.addEventListener("pointerup", release);
          window.addEventListener("pointercancel", release);
        }}
        title="Hold to show original"
        className="flex-shrink-0 text-panel-text-3 hover:text-panel-text-1 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Compare size={12} />
      </button>
      <span
        data-flat-grade-status-dot="true"
        title={runtimeStatus.message}
        className={`h-[5px] w-[5px] flex-shrink-0 rounded-full ${STATUS_DOT_CLASS[runtimeStatus.state]}`}
      />
      <button
        type="button"
        data-flat-grade-reset="true"
        title="Reset color grading"
        onClick={(e) => {
          e.stopPropagation();
          resetGrading();
        }}
        className="flex-shrink-0 text-panel-text-3 hover:text-panel-text-1"
      >
        <RotateCcw size={12} />
      </button>
    </span>
  );
}
