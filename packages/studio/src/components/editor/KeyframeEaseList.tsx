import type { GsapPercentageKeyframe } from "@hyperframes/core/gsap-parser";
import { EASE_LABELS } from "./gsapAnimationConstants";
import { EaseCurveSection } from "./EaseCurveSection";

// The full GSAP easing vocabulary offered by the "Set all…" bulk control —
// every standard family in in/out/inOut, so authors aren't limited to a curated
// few. All are valid GSAP runtime eases; the non-cubic families (sine/circ/
// elastic/bounce) approximate in the per-segment curve preview.
const APPLY_ALL_EASES = [
  "none",
  "power1.in",
  "power1.out",
  "power1.inOut",
  "power2.in",
  "power2.out",
  "power2.inOut",
  "power3.in",
  "power3.out",
  "power3.inOut",
  "power4.in",
  "power4.out",
  "power4.inOut",
  "sine.in",
  "sine.out",
  "sine.inOut",
  "expo.in",
  "expo.out",
  "expo.inOut",
  "circ.in",
  "circ.out",
  "circ.inOut",
  "back.in",
  "back.out",
  "back.inOut",
  "elastic.in",
  "elastic.out",
  "elastic.inOut",
  "bounce.in",
  "bounce.out",
  "bounce.inOut",
] as const;

export function KeyframeEaseList({
  keyframes,
  globalEase,
  expandedPct,
  onToggle,
  onEaseCommit,
  onApplyAll,
}: {
  keyframes: GsapPercentageKeyframe[];
  globalEase: string;
  expandedPct: number | null;
  onToggle: (pct: number | null) => void;
  onEaseCommit: (pct: number, ease: string) => void;
  /** Apply one ease to every segment at once (clears per-segment overrides). */
  onApplyAll?: (ease: string) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-neutral-500">
          Per-keyframe easing
        </p>
        {onApplyAll && (
          <select
            aria-label="Apply one ease to all segments"
            title="Apply one ease to every segment (clears per-segment overrides)"
            value=""
            onChange={(e) => {
              const next = e.target.value;
              if (next) onApplyAll(next);
            }}
            className="ml-auto cursor-pointer rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] text-neutral-300 outline-none hover:bg-neutral-700 focus:ring-1 focus:ring-panel-accent/40"
          >
            <option value="" disabled>
              Set all…
            </option>
            {APPLY_ALL_EASES.map((name) => (
              <option key={name} value={name}>
                {EASE_LABELS[name] ?? name}
              </option>
            ))}
          </select>
        )}
      </div>
      {keyframes.map((kf, i) => {
        if (i === 0) return null;
        const segEase = kf.ease ?? globalEase;
        const isExpanded = expandedPct === kf.percentage;
        const label = `${keyframes[i - 1].percentage}% → ${kf.percentage}%`;
        const easeLabel = segEase.startsWith("custom(")
          ? "Custom"
          : (EASE_LABELS[segEase] ?? segEase);
        return (
          <div key={`${i}-${kf.percentage}`} className="rounded-md bg-neutral-900/50">
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
