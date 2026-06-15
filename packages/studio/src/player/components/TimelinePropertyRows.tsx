import { memo } from "react";
import type { KeyframeCacheEntry } from "../store/playerStore";
import { KF_MIN_PCT, KF_MAX_PCT } from "./TimelineClipDiamonds";

const SUB_TRACK_H = 24;
const DIAMOND_SIZE = 6;
const HALF = DIAMOND_SIZE / 2;

interface TimelinePropertyRowsProps {
  keyframesData: KeyframeCacheEntry;
  clipWidthPx: number;
  clipLeftPx: number;
  accentColor: string;
  isSelected: boolean;
  currentPercentage: number;
  elementId: string;
  selectedKeyframes: Set<string>;
  onClickKeyframe?: (percentage: number) => void;
}

function extractProperties(data: KeyframeCacheEntry): string[] {
  const props = new Set<string>();
  for (const kf of data.keyframes) {
    for (const key of Object.keys(kf.properties)) {
      props.add(key);
    }
  }
  return Array.from(props).sort();
}

export const TimelinePropertyRows = memo(function TimelinePropertyRows({
  keyframesData,
  clipWidthPx,
  clipLeftPx,
  accentColor,
  isSelected,
  currentPercentage,
  elementId,
  selectedKeyframes,
  onClickKeyframe,
}: TimelinePropertyRowsProps) {
  const properties = extractProperties(keyframesData);
  if (properties.length === 0 || clipWidthPx < 20) return null;

  return (
    <div className="flex flex-col">
      {properties.map((prop) => {
        const propKeyframes = keyframesData.keyframes
          .filter((kf) => prop in kf.properties)
          .filter((kf) => kf.percentage >= KF_MIN_PCT && kf.percentage <= KF_MAX_PCT);
        if (propKeyframes.length === 0) return null;

        return (
          <div key={prop} className="relative flex items-center" style={{ height: SUB_TRACK_H }}>
            <span className="absolute left-1 text-[8px] font-medium text-neutral-600 z-10 select-none">
              {prop}
            </span>
            <svg
              className="absolute"
              style={{ left: clipLeftPx, width: clipWidthPx, height: SUB_TRACK_H }}
              viewBox={`0 0 ${clipWidthPx} ${SUB_TRACK_H}`}
            >
              <line
                x1={0}
                y1={SUB_TRACK_H / 2}
                x2={clipWidthPx}
                y2={SUB_TRACK_H / 2}
                stroke={isSelected ? accentColor : "#525252"}
                strokeOpacity={0.15}
                strokeWidth={1}
              />
              {propKeyframes.map((kf) => {
                const x = Math.max(
                  HALF,
                  Math.min(clipWidthPx - HALF, (kf.percentage / 100) * clipWidthPx),
                );
                const y = SUB_TRACK_H / 2;
                const key = `${elementId}:${kf.percentage}`;
                const isKfSelected = selectedKeyframes.has(key);
                const isHold = kf.ease === "steps(1)";
                const fillColor =
                  isKfSelected || (isSelected && Math.abs(kf.percentage - currentPercentage) < 0.5)
                    ? accentColor
                    : isSelected
                      ? `${accentColor}80`
                      : "#737373";

                return (
                  <g
                    key={kf.percentage}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClickKeyframe?.(kf.percentage);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    {isHold ? (
                      <rect
                        x={x - HALF}
                        y={y - HALF}
                        width={DIAMOND_SIZE}
                        height={DIAMOND_SIZE}
                        fill={fillColor}
                      />
                    ) : (
                      <rect
                        x={x - HALF}
                        y={y - HALF}
                        width={DIAMOND_SIZE}
                        height={DIAMOND_SIZE}
                        fill={fillColor}
                        transform={`rotate(45, ${x}, ${y})`}
                      />
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        );
      })}
    </div>
  );
});

export { SUB_TRACK_H };
