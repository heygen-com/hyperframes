import { memo } from "react";
import type { TimelineTheme } from "./timelineTheme";
import type { TimelineRangeSelection } from "./timelineEditing";
import { GUTTER, RULER_H, formatTimelineTickLabel } from "./timelineLayout";
import type { MusicBeatAnalysis } from "@hyperframes/core/beats";

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
  beatAnalysis?: MusicBeatAnalysis | null;
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
  beatAnalysis,
}: TimelineRulerProps) {
  const beatTimes = beatAnalysis?.beatTimes ?? [];
  const beatStrengths = beatAnalysis?.beatStrengths ?? [];

  // Only draw beat lines when they'd be at least 5px apart
  const avgBeatInterval =
    beatTimes.length > 1
      ? (beatTimes[beatTimes.length - 1]! - beatTimes[0]!) / (beatTimes.length - 1)
      : null;
  const showBeats = avgBeatInterval !== null && avgBeatInterval * pps >= 5;

  return (
    <>
      {/* Grid lines (major ticks + beat lines) — behind the tracks (background).
          Opaque track rows hide them; only the beat dots show on tracks. */}
      <svg
        className="absolute pointer-events-none"
        style={{ left: GUTTER, width: trackContentWidth, zIndex: 0 }}
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
        {showBeats &&
          beatTimes.map((t, i) => {
            const x = t * pps;
            // Louder beats → brighter line. Gamma curve widens the contrast.
            const strength = Math.pow(Math.min(1, beatStrengths[i] ?? 0.5), 2.2);
            const opacity = 0.08 + strength * 0.62;
            return (
              <line
                key={`b-${t}-${i}`}
                x1={x}
                y1={0}
                x2={x}
                y2={totalH}
                stroke={`rgba(34, 197, 94, ${opacity.toFixed(3)})`}
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
