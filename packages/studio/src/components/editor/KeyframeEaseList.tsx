import type { GsapPercentageKeyframe } from "@hyperframes/core/gsap-parser";
import { EASE_LABELS } from "./gsapAnimationConstants";
import { EaseCurveSection } from "./EaseCurveSection";

export function KeyframeEaseList({
  keyframes,
  globalEase,
  expandedPct,
  onToggle,
  onEaseCommit,
}: {
  keyframes: GsapPercentageKeyframe[];
  globalEase: string;
  expandedPct: number | null;
  onToggle: (pct: number | null) => void;
  onEaseCommit: (pct: number, ease: string) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-neutral-500">
        Per-keyframe easing
      </p>
      {keyframes.map((kf, i) => {
        if (i === 0) return null;
        const segEase = kf.ease ?? globalEase;
        const isExpanded = expandedPct === kf.percentage;
        const label = `${keyframes[i - 1].percentage}% → ${kf.percentage}%`;
        const easeLabel = segEase.startsWith("custom(")
          ? "Custom"
          : (EASE_LABELS[segEase] ?? segEase);
        return (
          <div key={kf.percentage} className="rounded-md bg-neutral-900/50">
            <button
              type="button"
              onClick={() => onToggle(isExpanded ? null : kf.percentage)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
            >
              <span className="text-[10px] font-medium text-neutral-400">{label}</span>
              <span className="ml-auto text-[9px] text-neutral-500">{easeLabel}</span>
              <svg
                width="8"
                height="8"
                viewBox="0 0 10 10"
                fill="currentColor"
                className={`text-neutral-500 transition-transform ${isExpanded ? "" : "-rotate-90"}`}
              >
                <path d="M2 3l3 4 3-4z" />
              </svg>
            </button>
            {isExpanded && (
              <div className="px-2 pb-2">
                <EaseCurveSection
                  ease={segEase}
                  onCustomEaseCommit={(ease) => onEaseCommit(kf.percentage, ease)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
