import { memo } from "react";
import type { TimelineTheme } from "./timelineTheme";
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

      {/* Ruler. The bar fills the full panel width (canvas is min 100% wide);
          calc(100% - GUTTER) equals trackContentWidth when zoomed in and extends
          past the content when zoomed out. Ticks stay at composition coordinates. */}
      <div
        className="relative overflow-hidden"
        style={{
          height: RULER_H,
          marginLeft: GUTTER,
          width: `calc(100% - ${GUTTER}px)`,
          background: theme.gutterBackground,
          borderBottom: `1px solid ${theme.rulerBorder}`,
        }}
      >
        {minor.map((t) => (
          <div key={`m-${t}`} className="absolute bottom-0" style={{ left: t * pps }}>
            <div className="w-px h-2" style={{ background: theme.tickMinor }} />
          </div>
        ))}

        {major.map((t) => (
          <div key={`M-${t}`} className="absolute top-0" style={{ left: t * pps }}>
            <span
              className="absolute font-mono tabular-nums leading-none whitespace-nowrap"
              style={{
                color: theme.tickText,
                left: 5,
                top: 5,
                fontSize: 10,
              }}
            >
              {formatTimelineTickLabel(t, effectiveDuration, majorTickInterval)}
            </span>
            <div className="w-px" style={{ height: RULER_H, background: theme.tickMajor }} />
          </div>
        ))}
      </div>
    </>
  );
});
