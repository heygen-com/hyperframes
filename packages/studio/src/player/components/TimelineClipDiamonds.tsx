import { memo, useEffect, useRef, useState } from "react";
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
  onDragKeyframe?: (percentage: number, newPercentage: number) => void;
  onContextMenuKeyframe?: (e: React.MouseEvent, elementId: string, percentage: number) => void;
  /** Snap a clip-relative percentage to the nearest beat (returns it unchanged
   *  when no beat is within range). Drives live beat-snapping while dragging. */
  snapPct?: (percentage: number) => number;
  /** Select this element when a keyframe drag begins, so its GSAP session is
   *  loaded by the time the move commits (diamonds render on unselected clips
   *  too, and a drag suppresses the selecting click). */
  onPickForDrag?: () => void;
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
  onDragKeyframe,
  onContextMenuKeyframe,
  snapPct,
  onPickForDrag,
}: TimelineClipDiamondsProps) {
  // Live drag: which keyframe (by original %) is being dragged and its current
  // (beat-snapped) %, so the diamond + its connecting lines follow the cursor.
  const dragRef = useRef<{ origPct: number; pct: number; moved: boolean } | null>(null);
  const [drag, setDrag] = useState<{ origPct: number; pct: number } | null>(null);
  // Commit through the latest callback, not the one captured at pointer-down:
  // selecting the element on drag-start loads its GSAP session asynchronously,
  // and the commit must use the closure that sees the loaded session.
  const onDragKeyframeRef = useRef(onDragKeyframe);
  onDragKeyframeRef.current = onDragKeyframe;
  // Optimistic hold: after a commit, keep the diamond at the dropped position
  // until the cache reflects the change (the file round-trip rewrites
  // keyframesData), so it doesn't flash back to the old spot in between.
  const pendingRef = useRef(false);
  const pendingHeldPctRef = useRef<number | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cleanup for an in-flight drag's document listeners, so an unmount mid-drag
  // (clip deleted, comp switch, zoom-out → early return) doesn't leak them.
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!pendingRef.current) return;
    // Only release the optimistic hold once the cache actually reflects the
    // committed position (a keyframe near the held %). An unrelated cache
    // rebuild (e.g. elementCount change) rebuilds keyframesData with the SAME
    // percentages — releasing then would flash the diamond back to the old spot.
    const held = pendingHeldPctRef.current;
    if (held != null && !keyframesData.keyframes.some((k) => Math.abs(k.percentage - held) < 0.3)) {
      return;
    }
    pendingRef.current = false;
    pendingHeldPctRef.current = null;
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    setDrag(null);
  }, [keyframesData]);

  useEffect(
    () => () => {
      clearTimeout(pendingTimerRef.current ?? undefined);
      dragCleanupRef.current?.();
    },
    [],
  );

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

  const handlePointerDown = (e: React.PointerEvent, pct: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Ignore a new drag while a prior drop is still settling: `pct` comes from
    // props (the pre-drop position) but the diamond is held at its dropped spot
    // via effPct(), so a re-grab would track from a stale origin and commit
    // against the wrong tween. The hold clears on the cache round-trip (≤2s).
    if (pendingRef.current) return;
    // Select the element up front so its GSAP session loads during the drag and
    // the commit (which resolves the animation from the selection) isn't a no-op.
    onPickForDrag?.();
    const startX = e.clientX;
    dragRef.current = { origPct: pct, pct, moved: false };

    const handleMove = (me: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = me.clientX - startX;
      // 4px dead zone so a click doesn't register as a drag.
      if (!d.moved && Math.abs(dx) <= 4) return;
      d.moved = true;
      const rawPct = Math.max(0, Math.min(100, pct + (dx / clipWidthPx) * 100));
      const snapped = snapPct ? snapPct(rawPct) : rawPct;
      d.pct = snapped;
      setDrag({ origPct: pct, pct: snapped });
    };

    const handleUp = () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      dragCleanupRef.current = null;
      const d = dragRef.current;
      dragRef.current = null;
      const willCommit = !!(d && d.moved && Math.abs(d.pct - d.origPct) > 0.5);
      if (willCommit && d) {
        // Hold the dropped position optimistically; the effect clears it once the
        // cache round-trip lands (fallback timeout in case it never does).
        pendingRef.current = true;
        pendingHeldPctRef.current = d.pct;
        setDrag({ origPct: d.origPct, pct: d.pct });
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = setTimeout(() => {
          pendingRef.current = false;
          pendingHeldPctRef.current = null;
          setDrag(null);
        }, 2000);
        onDragKeyframeRef.current?.(d.origPct, d.pct);
      } else {
        setDrag(null);
      }
    };

    dragCleanupRef.current = () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
  };

  const effPct = (p: number): number => (drag && drag.origPct === p ? drag.pct : p);

  return (
    <div className="absolute inset-0" style={{ zIndex: 3, pointerEvents: "none" }}>
      {sorted.map((kf, i) => {
        if (i === 0) return null;
        const prev = sorted[i - 1]!;
        const x1 = Math.max(
          0,
          Math.min(clipWidthPx, (effPct(prev.percentage) / 100) * clipWidthPx),
        );
        const x2 = Math.max(0, Math.min(clipWidthPx, (effPct(kf.percentage) / 100) * clipWidthPx));
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
        const leftPx = (effPct(kf.percentage) / 100) * clipWidthPx - half;
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
