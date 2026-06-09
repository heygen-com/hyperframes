import { memo, useCallback, useRef } from "react";

interface DopesheetKeyframe {
  percentage: number;
  properties: Record<string, number | string>;
  ease?: string;
}

interface DopesheetStripProps {
  keyframes: DopesheetKeyframe[];
  selectedPercentage: number | null;
  currentPercentage: number;
  accentColor?: string;
  onSelectKeyframe: (percentage: number) => void;
  onDragKeyframe?: (fromPct: number, toPct: number) => void;
}

const DIAMOND_SIZE = 8;
const HALF = DIAMOND_SIZE / 2;
const STRIP_HEIGHT = 20;
const PADDING_X = 8;

export const DopesheetStrip = memo(function DopesheetStrip({
  keyframes,
  selectedPercentage,
  currentPercentage,
  accentColor = "#3CE6AC",
  onSelectKeyframe,
  onDragKeyframe,
}: DopesheetStripProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startPct: number } | null>(null);

  const sorted = keyframes.slice().sort((a, b) => a.percentage - b.percentage);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, pct: number) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const startX = e.clientX;

      const handleMove = (me: PointerEvent) => {
        if (Math.abs(me.clientX - startX) > 4) {
          dragRef.current = { startX, startPct: pct };
        }
      };

      const handleUp = (ue: PointerEvent) => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);
        if (dragRef.current && containerRef.current && onDragKeyframe) {
          const rect = containerRef.current.getBoundingClientRect();
          const usableWidth = rect.width - PADDING_X * 2;
          const dx = ue.clientX - dragRef.current.startX;
          const dpct = (dx / usableWidth) * 100;
          const newPct = Math.max(0, Math.min(100, Math.round((pct + dpct) * 10) / 10));
          if (newPct !== pct) onDragKeyframe(pct, newPct);
        } else {
          onSelectKeyframe(pct);
        }
        dragRef.current = null;
      };

      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleUp);
    },
    [onSelectKeyframe, onDragKeyframe],
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full rounded-md bg-neutral-900/60 border border-neutral-800/50"
      style={{ height: STRIP_HEIGHT }}
    >
      {/* Playhead indicator */}
      <div
        className="absolute top-0 bottom-0 w-px bg-white/30"
        style={{
          left: `${PADDING_X + (currentPercentage / 100) * (100 - PADDING_X * 2)}%`,
          marginLeft: -0.5,
        }}
      />

      {/* Diamond markers */}
      <svg
        className="absolute inset-0 w-full"
        style={{ height: STRIP_HEIGHT }}
        viewBox={`0 0 100 ${STRIP_HEIGHT}`}
        preserveAspectRatio="none"
      >
        {sorted.map((kf) => {
          const x = PADDING_X + (kf.percentage / 100) * (100 - PADDING_X * 2);
          const y = STRIP_HEIGHT / 2;
          const isSelected =
            selectedPercentage !== null && Math.abs(kf.percentage - selectedPercentage) < 0.5;
          const isHold = kf.ease === "steps(1)";
          const fillColor = isSelected ? accentColor : "#737373";

          return (
            <g
              key={kf.percentage}
              onPointerDown={(e) => handlePointerDown(e, kf.percentage)}
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

      {/* Time labels */}
      {sorted.length > 0 && (
        <div
          className="absolute bottom-0 left-0 right-0 flex justify-between px-2 text-[8px] text-neutral-600 pointer-events-none"
          style={{ lineHeight: "10px" }}
        >
          <span>{sorted[0].percentage}%</span>
          {sorted.length > 1 && <span>{sorted[sorted.length - 1].percentage}%</span>}
        </div>
      )}
    </div>
  );
});
