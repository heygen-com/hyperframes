import { useRef, useState, useCallback, useEffect, memo } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { formatTime } from "../lib/time";
import { usePlayerStore, liveTime } from "../store/playerStore";

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2] as const;
const SEEK_EDGE_SNAP_PX = 8;

export function resolveSeekPercent(clientX: number, rectLeft: number, rectWidth: number): number {
  if (!Number.isFinite(rectWidth) || rectWidth <= 0) return 0;
  const rawPercent = (clientX - rectLeft) / rectWidth;
  const clamped = Math.max(0, Math.min(1, rawPercent));
  const snapThreshold = Math.min(0.5, SEEK_EDGE_SNAP_PX / rectWidth);
  if (clamped <= snapThreshold) return 0;
  if (clamped >= 1 - snapThreshold) return 1;
  return clamped;
}

interface PlayerControlsProps {
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  timelineVisible?: boolean;
  onToggleTimeline?: () => void;
}

export const PlayerControls = memo(function PlayerControls({
  onTogglePlay,
  onSeek,
  timelineVisible,
  onToggleTimeline,
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
  const sliderRef = useRef<HTMLDivElement>(null);
  const speedMenuContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const currentTimeRef = useRef(0);

  const durationRef = useRef(duration);
  durationRef.current = duration;
  useMountEffect(() => {
    const updateProgress = (t: number) => {
      currentTimeRef.current = t;
      const dur = durationRef.current;
      const pct = dur > 0 ? Math.min(100, (t / dur) * 100) : 0;
      if (progressFillRef.current) progressFillRef.current.style.width = `${pct}%`;
      if (progressThumbRef.current) progressThumbRef.current.style.left = `${pct}%`;
      if (timeDisplayRef.current) timeDisplayRef.current.textContent = formatTime(t);
      if (sliderRef.current) sliderRef.current.setAttribute("aria-valuenow", String(Math.round(t)));
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
  });

  useEffect(() => {
    if (!showSpeedMenu) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (
        speedMenuContainerRef.current &&
        !speedMenuContainerRef.current.contains(e.target as Node)
      ) {
        setShowSpeedMenu(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [showSpeedMenu]);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const bar = seekBarRef.current;
      if (!bar || duration <= 0) return;
      const rect = bar.getBoundingClientRect();
      const percent = resolveSeekPercent(clientX, rect.left, rect.width);
      // Immediately update progress bar visuals (don't wait for liveTime round-trip)
      const pct = percent * 100;
      if (progressFillRef.current) progressFillRef.current.style.width = `${pct}%`;
      if (progressThumbRef.current) progressThumbRef.current.style.left = `${pct}%`;
      onSeek(percent * duration);
    },
    [duration, onSeek],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Ignore secondary mouse buttons — only primary (left click / touch /
      // pen contact) should start a drag.
      if (e.button !== 0) return;
      e.preventDefault();
      // preventDefault() on pointerdown also suppresses the implicit focus
      // transfer that click normally grants a `tabIndex=0` element — which
      // matches native `<input type="range">` behavior, but it also means a
      // click-then-arrow-key workflow wouldn't work. Restore focus explicitly
      // so seeking by click and nudging by arrow keys compose naturally.
      e.currentTarget.focus();
      isDraggingRef.current = true;

      // `setPointerCapture` routes every subsequent pointermove/up to the
      // slider element even when the pointer leaves its bounding box. Without
      // it, fast drags on touch would lose events the moment the finger
      // slips outside the 6 px-tall hit zone.
      const target = e.currentTarget;
      const pointerId = e.pointerId;
      try {
        target.setPointerCapture(pointerId);
      } catch {
        /* non-supporting browsers fall back to window listeners below */
      }

      seekFromClientX(e.clientX);

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        if (isDraggingRef.current) seekFromClientX(ev.clientX);
      };
      const cleanup = () => {
        isDraggingRef.current = false;
        try {
          target.releasePointerCapture(pointerId);
        } catch {
          /* Already released after the first cleanup — second invocation
             via the window-fallback or visibility path is a no-op throw. */
        }
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("blur", cleanup);
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        cleanup();
      };
      // iOS Safari does not reliably fire `pointercancel` when the page is
      // backgrounded mid-drag (alt-tab, incoming call, switch apps). Without
      // a release path the ref stays `true` until the next pointerdown — a
      // stuck-scrubber class bug waiting to happen if anyone later gates
      // rendering on `isDragging`. Synthesize the release on hide / blur.
      const onVisibilityChange = () => {
        if (document.visibilityState === "hidden") cleanup();
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
      // Window-level fallback in case capture fails and the pointer release
      // lands outside the element (rare, but defensive).
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("blur", cleanup);
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
      style={{
        borderTop: "1px solid rgba(255,255,255,0.04)",
        // Add iOS safe-area inset so Safari's bottom URL bar doesn't occlude
        // the Play button + timecode on iPhone. `env(safe-area-inset-bottom)`
        // is 0 everywhere else, so this is a no-op on desktop.
        paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))",
      }}
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
        ref={(el) => {
          (seekBarRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
          (sliderRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={0}
        className="flex-1 h-6 flex items-center cursor-pointer group"
        // `touch-action: none` tells the browser we're handling every
        // pointer gesture on this element ourselves. Without it, iOS
        // Safari consumes horizontal swipes for its own swipe-back-to-
        // previous-page navigation and the scrubber can't drag left.
        style={{ touchAction: "none" }}
        onPointerDown={handlePointerDown}
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
      <div ref={speedMenuContainerRef} className="relative flex-shrink-0">
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

      {/* Timeline toggle */}
      {onToggleTimeline !== undefined && (
        <button
          onClick={onToggleTimeline}
          className={`w-7 h-7 flex items-center justify-center rounded-md border transition-colors ${
            timelineVisible
              ? "text-studio-accent bg-studio-accent/10 border-studio-accent/30"
              : "border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
          }`}
          title={timelineVisible ? "Hide timeline" : "Show timeline"}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <rect x="3" y="13" width="18" height="8" rx="1" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="3" y1="5" x2="21" y2="5" />
          </svg>
        </button>
      )}
    </div>
  );
});
