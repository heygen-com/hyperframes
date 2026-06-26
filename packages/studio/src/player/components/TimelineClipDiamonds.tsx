import { memo } from "react";
import { BEAT_BAND_H } from "./BeatStrip";

interface KeyframeEntry {
  percentage: number;
  properties: Record<string, number | string>;
  ease?: string;
}

interface KeyframeCacheEntry {
  format: string;
  keyframes: KeyframeEntry[];
  ease?: string;
  easeEach?: string;
}

interface TimelineClipDiamondsProps {
  keyframesData: KeyframeCacheEntry;
  clipWidthPx: number;
  clipHeightPx: number;
  /** Beat-dot strip is shown on this track → shrink diamonds + drop them into
   *  the bottom half so they clear the strip at the top. */
  beatsActive?: boolean;
  accentColor: string;
  isSelected: boolean;
  currentPercentage: number;
  elementId: string;
  selectedKeyframes: Set<string>;
  onClickKeyframe?: (percentage: number) => void;
  onShiftClickKeyframe?: (elementId: string, percentage: number) => void;
  onContextMenuKeyframe?: (e: React.MouseEvent, elementId: string, percentage: number) => void;
}

const DIAMOND_RATIO = 0.8;
// Percentage tolerance for rendering keyframes near clip boundaries. Keyframes
// slightly outside [0, 100] (from rounding or stale cache during the async
// persist → reload cycle) are still rendered (the clip is overflow-visible) at
// their true position rather than hidden.
const KF_MIN_PCT = -5;
const KF_MAX_PCT = 105;

export const TimelineClipDiamonds = memo(function TimelineClipDiamonds({
  keyframesData,
  clipWidthPx,
  clipHeightPx,
  beatsActive,
  accentColor,
  isSelected,
  currentPercentage,
  elementId,
  selectedKeyframes,
  onClickKeyframe,
  onShiftClickKeyframe,
  onContextMenuKeyframe,
}: TimelineClipDiamondsProps) {
  if (clipWidthPx < 20) return null;

  // When the beat strip occupies the top band, shrink the diamonds and center
  // them in the remaining bottom region so they don't collide with it.
  const diamondSize = Math.round(clipHeightPx * (beatsActive ? 0.45 : DIAMOND_RATIO));
  const half = diamondSize / 2;
  const centerY = beatsActive ? BEAT_BAND_H + (clipHeightPx - BEAT_BAND_H) / 2 : clipHeightPx / 2;
  const sorted = keyframesData.keyframes
    .filter((kf) => kf.percentage >= KF_MIN_PCT && kf.percentage <= KF_MAX_PCT)
    .sort((a, b) => a.percentage - b.percentage);
  const baseColor = isSelected ? accentColor : "#a3a3a3";
  const baseOpacity = isSelected ? 0.4 : 0.25;

  const handleClick = (e: React.MouseEvent, pct: number) => {
    e.stopPropagation();
    if (e.shiftKey) {
      onShiftClickKeyframe?.(elementId, pct);
    } else {
      onClickKeyframe?.(pct);
    }
  };

  return (
    <div className="absolute inset-0" style={{ zIndex: 3, pointerEvents: "none" }}>
      {sorted.map((kf, i) => {
        if (i === 0) return null;
        const prev = sorted[i - 1]!;
        const x1 = Math.max(0, Math.min(clipWidthPx, (prev.percentage / 100) * clipWidthPx));
        const x2 = Math.max(0, Math.min(clipWidthPx, (kf.percentage / 100) * clipWidthPx));
        if (x2 - x1 < 1) return null;
        return (
          <div
            key={`line-${i}-${prev.percentage}-${kf.percentage}`}
            className="absolute"
            style={{
              left: x1,
              top: centerY,
              width: x2 - x1,
              height: 2,
              transform: "translateY(-1px)",
              background: baseColor,
              opacity: baseOpacity,
              borderRadius: 1,
            }}
          />
        );
      })}

      {sorted.map((kf, i) => {
        // Center the diamond ON its keyframe %: left = (% · width) − half so the
        // diamond's midpoint sits exactly at the percentage. At 0% the midpoint
        // is the clip's left edge (the diamond's left half overflows, which the
        // overflow-visible clip shows) — NOT shifted fully inside. No clamp, or
        // boundary keyframes (0% / 100%) would render off-center.
        const leftPx = (kf.percentage / 100) * clipWidthPx - half;
        const kfKey = `${elementId}:${kf.percentage}`;
        const isKfSelected = selectedKeyframes.has(kfKey);
        const atPlayhead = isSelected && Math.abs(kf.percentage - currentPercentage) < 0.5;
        const isHighlighted = isKfSelected || atPlayhead;
        const color = isHighlighted ? accentColor : "#a3a3a3";
        return (
          <button
            key={`${i}-${kf.percentage}`}
            type="button"
            className="absolute"
            style={{
              left: leftPx,
              top: centerY,
              transform: "translateY(-50%)",
              width: diamondSize,
              height: diamondSize,
              zIndex: isHighlighted ? 2 : 1,
              pointerEvents: "auto",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
            onClick={(e) => handleClick(e, kf.percentage)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenuKeyframe?.(e, elementId, kf.percentage);
            }}
            title={`${kf.percentage}%`}
          >
            <svg width={diamondSize} height={diamondSize} viewBox="0 0 10 10">
              {isKfSelected && (
                <path
                  d="M5 0L10 5L5 10L0 5Z"
                  fill="none"
                  stroke={accentColor}
                  strokeWidth="0.8"
                  opacity={0.5}
                />
              )}
              <path
                d="M5 1L9 5L5 9L1 5Z"
                fill={color}
                opacity={isKfSelected || atPlayhead ? 1 : 0.55}
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
});
