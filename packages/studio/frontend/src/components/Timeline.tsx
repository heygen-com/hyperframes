import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { usePlayerStore } from "../store/playerStore";

const GUTTER = 36;

const TAG_STYLES: Record<string, { bg: string; border: string; text: string }> =
  {
    video: {
      bg: "bg-blue-100",
      border: "border-blue-300/60",
      text: "text-blue-700",
    },
    audio: {
      bg: "bg-emerald-100",
      border: "border-emerald-300/60",
      text: "text-emerald-700",
    },
    img: {
      bg: "bg-violet-100",
      border: "border-violet-300/60",
      text: "text-violet-700",
    },
    div: {
      bg: "bg-amber-100",
      border: "border-amber-300/60",
      text: "text-amber-700",
    },
  };
const DEFAULT_STYLE = {
  bg: "bg-neutral-100",
  border: "border-neutral-300/60",
  text: "text-neutral-600",
};

function getStyle(tag: string) {
  return TAG_STYLES[tag] ?? DEFAULT_STYLE;
}

function generateTicks(duration: number): number[] {
  if (duration <= 0) return [];
  const intervals = [0.5, 1, 2, 5, 10, 15, 30, 60];
  const target = duration / 8;
  const interval = intervals.find((i) => i >= target) ?? 60;
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += interval) {
    ticks.push(t);
  }
  return ticks;
}

function formatTick(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface DragState {
  elementId: string;
  originalStart: number;
  startX: number;
  trackWidth: number;
}

interface TimelineProps {
  onMoveElement?: (elementId: string, newStart: number) => void;
}

export function Timeline({ onMoveElement }: TimelineProps) {
  const {
    elements,
    currentTime,
    duration,
    timelineReady,
    selectedElementId,
    setSelectedElementId,
  } = usePlayerStore();

  const dragRef = useRef<DragState | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    elementId: string;
    newStart: number;
  } | null>(null);

  const tracks = useMemo(() => {
    const map = new Map<number, typeof elements>();
    for (const el of elements) {
      const list = map.get(el.track) ?? [];
      list.push(el);
      map.set(el.track, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [elements]);

  const ticks = useMemo(() => generateTicks(duration), [duration]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, elementId: string, originalStart: number) => {
      e.stopPropagation();
      e.preventDefault();

      const trackContentEl = (e.currentTarget as HTMLElement).parentElement;
      if (!trackContentEl) return;

      dragRef.current = {
        elementId,
        originalStart,
        startX: e.clientX,
        trackWidth: trackContentEl.getBoundingClientRect().width,
      };
      setDragPreview({ elementId, newStart: originalStart });
      setSelectedElementId(elementId);
    },
    [setSelectedElementId]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const deltaX = e.clientX - drag.startX;
      const deltaTime = (deltaX / drag.trackWidth) * duration;
      const newStart = Math.max(0, drag.originalStart + deltaTime);
      setDragPreview({ elementId: drag.elementId, newStart });
    };

    const handleMouseUp = () => {
      const drag = dragRef.current;
      const preview = dragPreview;
      if (!drag || !preview) {
        dragRef.current = null;
        setDragPreview(null);
        return;
      }

      const newStart = Math.round(preview.newStart * 1000) / 1000;
      dragRef.current = null;
      setDragPreview(null);

      if (Math.abs(newStart - drag.originalStart) > 0.01 && onMoveElement) {
        onMoveElement(drag.elementId, newStart);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [duration, dragPreview, onMoveElement]);

  if (!timelineReady || elements.length === 0) return null;

  const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const trackH = 32;
  const rulerH = 22;

  return (
    <div className="border-t border-neutral-200/80 bg-white select-none overflow-x-hidden overflow-y-auto max-h-[200px]">
      <div
        className="relative"
        style={{ height: rulerH + tracks.length * trackH }}
      >
        {/* ── Ruler ── */}
        <div
          className="relative border-b border-neutral-100"
          style={{ height: rulerH, marginLeft: GUTTER }}
        >
          {ticks.map((t) => {
            const pct = (t / duration) * 100;
            return (
              <div
                key={t}
                className="absolute bottom-0 flex flex-col items-center"
                style={{ left: `${pct}%` }}
              >
                <span className="text-[10px] text-neutral-400 font-mono leading-none mb-1">
                  {formatTick(t)}
                </span>
                <div className="w-px h-1.5 bg-neutral-200" />
              </div>
            );
          })}
        </div>

        {/* ── Tracks ── */}
        {tracks.map(([trackNum, els], idx) => (
          <div
            key={trackNum}
            className={`relative flex ${
              idx % 2 === 0 ? "bg-neutral-50/50" : "bg-white"
            }`}
            style={{ height: trackH }}
          >
            {/* Gutter label */}
            <div
              className="flex-shrink-0 flex items-center justify-end pr-2 border-r border-neutral-100"
              style={{ width: GUTTER }}
            >
              <span className="text-[10px] text-neutral-400 font-mono">
                {trackNum}
              </span>
            </div>

            {/* Track content */}
            <div
              className="flex-1 relative"
              onClick={() => setSelectedElementId(null)}
            >
              {els.map((el, i) => {
                const isDragging = dragPreview?.elementId === el.id;
                const displayStart = isDragging
                  ? dragPreview.newStart
                  : el.start;
                const leftPct = (displayStart / duration) * 100;
                const widthPct = (el.duration / duration) * 100;
                const style = getStyle(el.tag);
                const isSelected = selectedElementId === el.id;
                return (
                  <div
                    key={`${el.id}-${i}`}
                    className={`absolute top-1 bottom-1 rounded ${style.bg} ${
                      style.border
                    } border flex items-center overflow-hidden ${
                      isSelected ? "ring-2 ring-blue-500 ring-offset-1" : ""
                    } ${
                      isDragging
                        ? "opacity-80 shadow-md z-20 cursor-grabbing"
                        : "cursor-grab"
                    } ${
                      onMoveElement ? "hover:brightness-95" : "cursor-pointer"
                    }`}
                    style={{
                      left: `${leftPct}%`,
                      width: `${Math.max(widthPct, 0.5)}%`,
                      transition: isDragging ? "none" : "left 0.15s ease-out",
                    }}
                    title={`${el.id} (${el.tag}) ${displayStart.toFixed(
                      1
                    )}s – ${(displayStart + el.duration).toFixed(1)}s`}
                    onMouseDown={(e) => {
                      if (onMoveElement) {
                        handleMouseDown(e, el.id, el.start);
                      }
                    }}
                    onClick={(e) => {
                      if (!onMoveElement) {
                        e.stopPropagation();
                        setSelectedElementId(el.id);
                      }
                    }}
                  >
                    <span
                      className={`text-[10px] ${style.text} font-medium truncate px-1.5 leading-none`}
                    >
                      {el.id || el.tag}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* ── Playhead ── */}
        <div
          className="absolute top-0 bottom-0 pointer-events-none z-10"
          style={{
            left: `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${
              playheadPct / 100
            })`,
          }}
        >
          <div className="w-px h-full bg-red-500/80" />
          <div className="absolute -top-px left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-r-[4px] border-t-[5px] border-l-transparent border-r-transparent border-t-red-500" />
        </div>
      </div>
    </div>
  );
}
