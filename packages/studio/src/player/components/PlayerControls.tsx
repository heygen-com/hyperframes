import { useRef, useState, useCallback, useEffect, memo } from "react";
import { formatTime } from "../lib/time";
import { usePlayerStore, liveTime } from "../store/playerStore";

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2] as const;

interface PlayerControlsProps {
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
}

export const PlayerControls = memo(function PlayerControls({
  onTogglePlay,
  onSeek,
}: PlayerControlsProps) {
  // Subscribe to only the fields we render — each selector prevents cascading re-renders
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const duration = usePlayerStore((s) => s.duration);
  const timelineReady = usePlayerStore((s) => s.timelineReady);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const setPlaybackRate = usePlayerStore.getState().setPlaybackRate;
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressThumbRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const currentTimeRef = useRef(0);

  const durationRef = useRef(duration);
  durationRef.current = duration;
  useEffect(() => {
    const updateProgress = (t: number) => {
      currentTimeRef.current = t;
      const dur = durationRef.current;
      const pct = dur > 0 ? Math.min(100, (t / dur) * 100) : 0;
      if (progressFillRef.current) progressFillRef.current.style.width = `${pct}%`;
      if (progressThumbRef.current) progressThumbRef.current.style.left = `${pct}%`;
      if (timeDisplayRef.current) timeDisplayRef.current.textContent = formatTime(t);
    };
    const unsub = liveTime.subscribe(updateProgress);
    updateProgress(usePlayerStore.getState().currentTime);

    // Also poll every 500ms as a fallback in case liveTime doesn't fire
    const interval = setInterval(() => {
      const t = usePlayerStore.getState().currentTime;
      const dur = usePlayerStore.getState().duration;
      if (dur > 0 && t > 0) {
        const pct = Math.min(100, (t / dur) * 100);
        if (progressFillRef.current) progressFillRef.current.style.width = `${pct}%`;
        if (progressThumbRef.current) progressThumbRef.current.style.left = `${pct}%`;
      }
    }, 500);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, []);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const bar = seekBarRef.current;
      if (!bar || duration <= 0) return;
      const rect = bar.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      // Immediately update progress bar visuals (don't wait for liveTime round-trip)
      const pct = percent * 100;
      if (progressFillRef.current) progressFillRef.current.style.width = `${pct}%`;
      if (progressThumbRef.current) progressThumbRef.current.style.left = `${pct}%`;
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
    <div
      className="px-4 py-2 flex items-center gap-3"
      style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
    >
      {/* Play/Pause button */}
      <button
        type="button"
        aria-label={isPlaying ? "Pause" : "Play"}
        onClick={onTogglePlay}
        disabled={!timelineReady}
        className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg disabled:opacity-30 disabled:pointer-events-none transition-colors"
        style={{ background: "rgba(255,255,255,0.06)" }}
      >
        {isPlaying ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#FAFAFA" aria-hidden="true">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#FAFAFA" aria-hidden="true">
            <polygon points="6,3 20,12 6,21" />
          </svg>
        )}
      </button>

      {/* Time display */}
      <span
        className="font-mono text-[11px] tabular-nums flex-shrink-0 min-w-[72px]"
        style={{ color: "#A1A1AA" }}
      >
        <span ref={timeDisplayRef}>{formatTime(0)}</span>
        <span style={{ color: "#3F3F46", margin: "0 2px" }}>/</span>
        <span style={{ color: "#52525B" }}>{formatTime(duration)}</span>
      </span>

      {/* Seek bar — teal progress fill */}
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
        <div
          className="w-full rounded-full relative"
          style={{ background: "rgba(255,255,255,0.15)", height: "3px" }}
        >
          {/* Progress fill — width is controlled imperatively via ref to avoid React re-render resets */}
          <div
            ref={progressFillRef}
            className="absolute top-0 bottom-0 left-0 z-[1] rounded-full"
            style={{ background: "linear-gradient(90deg, var(--hf-accent, #3CE6AC), #2BBFA0)" }}
          />
          {/* Playhead thumb — left is controlled imperatively via ref */}
          <div
            ref={progressThumbRef}
            className="absolute top-1/2 z-[2] w-3 h-3 rounded-full -translate-y-1/2 -translate-x-1/2 transition-transform group-hover:scale-125"
            style={{
              background: "var(--hf-accent, #3CE6AC)",
              boxShadow: "0 0 6px rgba(60,230,172,0.4), 0 1px 4px rgba(0,0,0,0.4)",
            }}
          />
        </div>
      </div>

      {/* Speed control */}
      <div className="relative flex-shrink-0">
        <button
          type="button"
          onClick={() => setShowSpeedMenu((v) => !v)}
          className="px-2 py-1 rounded-md text-[10px] font-mono tabular-nums transition-colors"
          style={{ color: "#71717A", background: "rgba(255,255,255,0.04)" }}
        >
          {playbackRate === 1 ? "1x" : `${playbackRate}x`}
        </button>
        {showSpeedMenu && (
          <div
            className="absolute bottom-full right-0 mb-1.5 rounded-lg shadow-xl z-50 min-w-[56px] overflow-hidden"
            style={{ background: "#161618", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {SPEED_OPTIONS.map((rate) => (
              <button
                key={rate}
                onClick={() => {
                  setPlaybackRate(rate);
                  setShowSpeedMenu(false);
                }}
                className="block w-full px-3 py-1.5 text-[11px] text-left font-mono tabular-nums transition-colors"
                style={{
                  color: rate === playbackRate ? "#FAFAFA" : "#71717A",
                  background: rate === playbackRate ? "rgba(255,255,255,0.06)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (rate !== playbackRate)
                    e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                }}
                onMouseLeave={(e) => {
                  if (rate !== playbackRate) e.currentTarget.style.background = "transparent";
                }}
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
