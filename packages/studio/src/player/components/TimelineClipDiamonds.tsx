import { memo, useRef } from "react";

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
  accentColor: string;
  isSelected: boolean;
  currentPercentage: number;
  elementId: string;
  selectedKeyframes: Set<string>;
  onClickKeyframe?: (percentage: number) => void;
  onShiftClickKeyframe?: (elementId: string, percentage: number) => void;
  onDragKeyframe?: (percentage: number, newPercentage: number) => void;
  onContextMenuKeyframe?: (e: React.MouseEvent, elementId: string, percentage: number) => void;
}

const DIAMOND_RATIO = 0.8;

export const TimelineClipDiamonds = memo(function TimelineClipDiamonds({
  keyframesData,
  clipWidthPx,
  clipHeightPx,
  accentColor,
  isSelected,
  currentPercentage,
  elementId,
  selectedKeyframes,
  onClickKeyframe,
  onShiftClickKeyframe,
  onDragKeyframe,
  onContextMenuKeyframe,
}: TimelineClipDiamondsProps) {
  const dragRef = useRef<{ startX: number; startPct: number } | null>(null);

  if (clipWidthPx < 20) return null;

  const diamondSize = Math.round(clipHeightPx * DIAMOND_RATIO);
  const half = diamondSize / 2;
  const sorted = keyframesData.keyframes.slice().sort((a, b) => a.percentage - b.percentage);
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

  const handlePointerDown = (e: React.PointerEvent, pct: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const startX = e.clientX;

    const handleMove = (me: PointerEvent) => {
      const dx = me.clientX - startX;
      if (Math.abs(dx) > 4) {
        dragRef.current = { startX, startPct: pct };
      }
    };

    const handleUp = (ue: PointerEvent) => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      const start = dragRef.current;
      dragRef.current = null;
      if (!start) return;
      const dx = ue.clientX - start.startX;
      const dPct = (dx / clipWidthPx) * 100;
      const newPct = Math.max(0, Math.min(100, Math.round(start.startPct + dPct)));
      if (Math.abs(newPct - start.startPct) > 0.5) {
        onDragKeyframe?.(start.startPct, newPct);
      }
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
  };

  return (
    <div className="absolute inset-0" style={{ zIndex: 3, pointerEvents: "none" }}>
      {sorted.map((kf, i) => {
        if (i === 0) return null;
        const prev = sorted[i - 1]!;
        const x1 = (prev.percentage / 100) * clipWidthPx;
        const x2 = (kf.percentage / 100) * clipWidthPx;
        return (
          <div
            key={`line-${i}-${prev.percentage}-${kf.percentage}`}
            className="absolute"
            style={{
              left: x1,
              top: "50%",
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
              top: "50%",
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
            onPointerDown={(e) => handlePointerDown(e, kf.percentage)}
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
