import { useRef, useCallback } from "react";
import { formatTime } from "../utils/time";

interface PlayerControlsProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  timelineReady: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
}

export function PlayerControls({
  isPlaying,
  currentTime,
  duration,
  timelineReady,
  onTogglePlay,
  onSeek,
}: PlayerControlsProps) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const seekBarRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const bar = seekBarRef.current;
      if (!bar || duration <= 0) return;
      const rect = bar.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onSeek(percent * duration);
    },
    [duration, onSeek],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      seekFromClientX(e.clientX);

      const onMouseMove = (me: MouseEvent) => {
        if (isDraggingRef.current) seekFromClientX(me.clientX);
      };
      const onMouseUp = () => {
        isDraggingRef.current = false;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [seekFromClientX],
  );

  return (
    <div className="px-4 pt-3 pb-2 flex items-center gap-3">
      {/* Play/Pause */}
      <button
        onClick={onTogglePlay}
        disabled={!timelineReady}
        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all flex-shrink-0 ${
          !timelineReady
            ? "text-neutral-300 cursor-not-allowed"
            : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/60"
        }`}
      >
        {isPlaying ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Time */}
      <span className="text-neutral-400 font-mono text-[11px] tabular-nums flex-shrink-0 min-w-[90px]">
        {formatTime(currentTime)}
        <span className="text-neutral-300 mx-1">/</span>
        {formatTime(duration)}
      </span>

      {/* Seek bar */}
      <div
        ref={seekBarRef}
        className="flex-1 h-5 flex items-center cursor-pointer group"
        onMouseDown={handleMouseDown}
      >
        <div className="w-full h-1 bg-neutral-200 rounded-full relative">
          <div
            className="absolute inset-y-0 left-0 bg-neutral-800 rounded-full transition-[width] duration-75"
            style={{ width: `${progress}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-neutral-800 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `calc(${progress}% - 5px)` }}
          />
        </div>
      </div>
    </div>
  );
}
