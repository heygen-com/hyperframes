import { useRef, useCallback } from "react";
import { formatTime } from "../lib/time";
import { usePlayerStore, liveTime } from "../store/playerStore";
import { useMountEffect } from "../lib/useMountEffect";

interface PlayerControlsProps {
  isPlaying: boolean;
  duration: number;
  timelineReady: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
}

export function PlayerControls({ isPlaying, duration, timelineReady, onTogglePlay, onSeek }: PlayerControlsProps) {
  const { currentTime } = usePlayerStore();

  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressThumbRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Direct DOM updates for playback position — bypasses React for performance
  const durationRef = useRef(duration);
  durationRef.current = duration;
  useMountEffect(() => {
    const unsub = liveTime.subscribe((t) => {
      const dur = durationRef.current;
      const pct = dur > 0 ? (t / dur) * 100 : 0;
      if (progressFillRef.current) progressFillRef.current.style.width = `${pct}%`;
      if (progressThumbRef.current) progressThumbRef.current.style.left = `${pct}%`;
      if (timeDisplayRef.current) timeDisplayRef.current.textContent = formatTime(t);
    });
    return unsub;
  });

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

  // Keyboard seek: left/right arrows
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!timelineReady || duration <= 0) return;
      const step = e.shiftKey ? 5 : 1;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onSeek(Math.max(0, currentTime - step));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onSeek(Math.min(duration, currentTime + step));
      }
    },
    [timelineReady, duration, currentTime, onSeek],
  );

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="px-3 py-2 flex items-center gap-3">
      {/* Play / Pause */}
      <button
        type="button"
        aria-label={isPlaying ? "Pause" : "Play"}
        onClick={onTogglePlay}
        disabled={!timelineReady}
        className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-neutral-300 hover:text-white hover:bg-neutral-800 disabled:opacity-40 disabled:pointer-events-none transition-colors"
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Time display — direct DOM updates via ref for RAF performance */}
      <span className="text-neutral-500 font-mono text-xs tabular-nums flex-shrink-0 min-w-[80px]">
        <span ref={timeDisplayRef}>{formatTime(currentTime)}</span>
        <span className="text-neutral-700 mx-0.5">/</span>
        <span className="text-neutral-600">{formatTime(duration)}</span>
      </span>

      {/* Seek bar */}
      <div
        ref={seekBarRef}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={formatTime(currentTime)}
        className="flex-1 h-6 flex items-center cursor-pointer group"
        style={{ touchAction: "manipulation" }}
        onMouseDown={handleMouseDown}
        onKeyDown={handleKeyDown}
      >
        <div className="w-full h-[3px] bg-neutral-800 rounded-full relative">
          {/* Progress fill */}
          <div
            ref={progressFillRef}
            className="absolute inset-y-0 left-0 bg-white/80 rounded-full"
            style={{ width: `${progress}%` }}
          />
          {/* Thumb */}
          <div
            ref={progressThumbRef}
            className="absolute top-1/2 w-2 h-2 bg-white rounded-full -translate-y-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
            style={{ left: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
