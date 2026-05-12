import { memo } from "react";
import type { TimelineTheme } from "./timelineTheme";
import type { TimelineRangeSelection } from "./timelineEditing";
import { GUTTER, RULER_H, formatTimelineTickLabel } from "./timelineLayout";

interface TimelineRulerProps {
  major: number[];
  minor: number[];
  pps: number;
  trackContentWidth: number;
  totalH: number;
  effectiveDuration: number;
  majorTickInterval: number;
  shiftHeld: boolean;
  rangeSelection: TimelineRangeSelection | null;
  theme: TimelineTheme;
}

export const TimelineRuler = memo(function TimelineRuler({
  major,
  minor,
  pps,
  trackContentWidth,
  totalH,
  effectiveDuration,
  majorTickInterval,
  shiftHeld,
  rangeSelection,
  theme,
}: TimelineRulerProps) {
  return (
    <>
      {/* Grid lines */}
      <svg
        className="absolute pointer-events-none"
        style={{ left: GUTTER, width: trackContentWidth }}
        height={totalH}
      >
        {major.map((t) => {
          const x = t * pps;
          return (
            <line
              key={`g-${t}`}
              x1={x}
              y1={RULER_H}
              x2={x}
              y2={totalH}
              stroke={theme.tickMinor}
              strokeWidth="1"
            />
          );
        })}
      </svg>

      {/* Ruler */}
      <div
        className="relative overflow-hidden"
        style={{ height: RULER_H, marginLeft: GUTTER, width: trackContentWidth }}
      >
        {shiftHeld && !rangeSelection && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <span className="text-[9px] font-medium" style={{ color: theme.textSecondary }}>
              Drag or click a clip to edit range
            </span>
          </div>
        )}
        {minor.map((t) => (
          <div key={`m-${t}`} className="absolute bottom-0" style={{ left: t * pps }}>
            <div className="w-px h-[3px]" style={{ background: theme.tickMinor }} />
          </div>
        ))}
        {major.map((t) => (
          <div
            key={`M-${t}`}
            className="absolute bottom-0 flex flex-col items-center"
            style={{ left: t * pps }}
          >
            <span
              className="text-[9px] font-mono tabular-nums leading-none mb-0.5"
              style={{ color: theme.tickText }}
            >
              {formatTimelineTickLabel(t, effectiveDuration, majorTickInterval)}
            </span>
            <div className="w-px h-[5px]" style={{ background: theme.tickMajor }} />
          </div>
        ))}
      </div>
    </>
  );
});
