import { useRef, useState, useCallback, memo } from "react";
import { formatTime } from "../lib/time";
import { usePlayerStore, liveTime } from "../store/playerStore";
import { useMountEffect } from "../lib/useMountEffect";

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2] as const;

interface PlayerControlsProps {
  /** @deprecated Pass via store — kept for backwards compat */
  isPlaying?: boolean;
  /** @deprecated Pass via store — kept for backwards compat */
  duration?: number;
  /** @deprecated Pass via store — kept for backwards compat */
  timelineReady?: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
}

export const PlayerControls = memo(function PlayerControls({ onTogglePlay, onSeek, ...overrides }: PlayerControlsProps) {
  // Subscribe to only the fields we render — each selector prevents cascading re-renders
  const storeIsPlaying = usePlayerStore((s) => s.isPlaying);
  const storeDuration = usePlayerStore((s) => s.duration);
  const storeTimelineReady = usePlayerStore((s) => s.timelineReady);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const setPlaybackRate = usePlayerStore.getState().setPlaybackRate;
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  const isPlaying = overrides.isPlaying ?? storeIsPlaying;
  const duration = overrides.duration ?? storeDuration;
  const timelineReady = overrides.timelineReady ?? storeTimelineReady;

  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressThumbRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const currentTimeRef = useRef(0);

  const durationRef = useRef(duration);
  durationRef.current = duration;
  useMountEffect(() => {
    const unsub = liveTime.subscribe((t) => {
      currentTimeRef.current = t;
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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!timelineReady || duration <= 0) return;
      const step = e.shiftKey ? 5 : 1;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onSeek(Math.max(0, currentTimeRef.current - step));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onSeek(Math.min(duration, currentTimeRef.current + step));
      }
    },
    [timelineReady, duration, onSeek],
  );

  return (
    <div className="px-3 py-2 flex items-center gap-3">
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

      <span className="text-neutral-500 font-mono text-xs tabular-nums flex-shrink-0 min-w-[80px]">
        <span ref={timeDisplayRef}>{formatTime(0)}</span>
        <span className="text-neutral-700 mx-0.5">/</span>
        <span className="text-neutral-600">{formatTime(duration)}</span>
      </span>

      <div
        ref={seekBarRef}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={0}
        className="flex-1 h-6 flex items-center cursor-pointer group"
        style={{ touchAction: "manipulation" }}
        onMouseDown={handleMouseDown}
        onKeyDown={handleKeyDown}
      >
        <div className="w-full h-[3px] bg-neutral-800 rounded-full relative">
          <div
            ref={progressFillRef}
            className="absolute inset-y-0 left-0 bg-white/80 rounded-full"
            style={{ width: 0 }}
          />
          <div
            ref={progressThumbRef}
            className="absolute top-1/2 w-2 h-2 bg-white rounded-full -translate-y-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
            style={{ left: 0 }}
          />
        </div>
      </div>

      {/* Speed control */}
      <div className="relative flex-shrink-0">
        <button
          type="button"
          onClick={() => setShowSpeedMenu((v) => !v)}
          className="px-1.5 py-0.5 rounded text-[11px] font-mono tabular-nums text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
        >
          {playbackRate === 1 ? "1x" : `${playbackRate}x`}
        </button>
        {showSpeedMenu && (
          <div className="absolute bottom-full right-0 mb-1 py-1 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl z-50 min-w-[60px]">
            {SPEED_OPTIONS.map((rate) => (
              <button
                key={rate}
                onClick={() => { setPlaybackRate(rate); setShowSpeedMenu(false); }}
                className={`block w-full px-3 py-1 text-xs text-left font-mono tabular-nums transition-colors ${
                  rate === playbackRate ? "text-white bg-neutral-800" : "text-neutral-400 hover:text-white hover:bg-neutral-800"
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
