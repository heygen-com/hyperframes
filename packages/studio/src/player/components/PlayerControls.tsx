import { useRef, useState, useCallback, useEffect, memo } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { formatFrameTime, frameToSeconds, stepFrameTime, formatTime } from "../lib/time";
import { shouldMutePreviewAudio } from "../lib/timelineIframeHelpers";
import { usePlayerStore, liveTime } from "../store/playerStore";

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2] as const;
const SEEK_EDGE_SNAP_PX = 8;
type TimeDisplayMode = "time" | "frame";
const SHORTCUT_SECTIONS = [
  {
    title: "Playback",
    hints: [
      { key: "Space", label: "Play / Pause" },
      { key: "J", label: "Play backward" },
      { key: "K", label: "Stop" },
      { key: "L", label: "Play forward" },
      { key: "←/→", label: "Step 1 frame" },
      { key: "⇧←/⇧→", label: "Step 10 frames" },
    ],
  },
  {
    title: "Work area",
    hints: [
      { key: "I", label: "Set in-point" },
      { key: "⇧I", label: "Clear in-point" },
      { key: "O", label: "Set out-point" },
      { key: "⇧O", label: "Clear out-point" },
      { key: "A", label: "Jump to in-point" },
      { key: "E", label: "Jump to out-point" },
    ],
  },
] as const;

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
  disabled?: boolean;
}

export const PlayerControls = memo(function PlayerControls({
  onTogglePlay,
  onSeek,
  disabled = false,
}: PlayerControlsProps) {
  // Subscribe to only the fields we render — each selector prevents cascading re-renders
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const duration = usePlayerStore((s) => s.duration);
  const timelineReady = usePlayerStore((s) => s.timelineReady);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const audioMuted = usePlayerStore((s) => s.audioMuted);
  const loopEnabled = usePlayerStore((s) => s.loopEnabled);
  const setPlaybackRate = usePlayerStore.getState().setPlaybackRate;
  const setAudioMuted = usePlayerStore.getState().setAudioMuted;
  const setLoopEnabled = usePlayerStore.getState().setLoopEnabled;
  const inPoint = usePlayerStore((s) => s.inPoint);
  const outPoint = usePlayerStore((s) => s.outPoint);
  const setInPoint = usePlayerStore.getState().setInPoint;
  const setOutPoint = usePlayerStore.getState().setOutPoint;
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [timeDisplayMode, setTimeDisplayMode] = useState<TimeDisplayMode>("time");
  const [jumpFrame, setJumpFrame] = useState("");

  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressThumbRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const speedMenuContainerRef = useRef<HTMLDivElement>(null);
  const shortcutsPanelRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const currentTimeRef = useRef(0);
  const timeDisplayModeRef = useRef(timeDisplayMode);
  timeDisplayModeRef.current = timeDisplayMode;

  const durationRef = useRef(duration);
  durationRef.current = duration;
  const controlsDisabled = disabled || !timelineReady;
  const audioAutoMuted = playbackRate > 1;
  const effectiveAudioMuted = shouldMutePreviewAudio(audioMuted, playbackRate);
  const muteButtonLabel = audioAutoMuted
    ? "Audio muted above 1x speed"
    : audioMuted
      ? "Unmute audio"
      : "Mute audio";
  useMountEffect(() => {
    const updateProgress = (t: number) => {
      currentTimeRef.current = t;
      const dur = durationRef.current;
      const pct = dur > 0 ? Math.min(100, (t / dur) * 100) : 0;
      if (progressFillRef.current) progressFillRef.current.style.width = `${pct}%`;
      if (progressThumbRef.current) progressThumbRef.current.style.left = `${pct}%`;
      if (timeDisplayRef.current) {
        timeDisplayRef.current.textContent =
          timeDisplayModeRef.current === "frame" ? formatFrameTime(t, dur) : formatTime(t);
      }
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
    if (!timeDisplayRef.current) return;
    const t = currentTimeRef.current;
    timeDisplayRef.current.textContent =
      timeDisplayMode === "frame" ? formatFrameTime(t, duration) : formatTime(t);
  }, [duration, timeDisplayMode]);

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

  useEffect(() => {
    if (!showShortcuts) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (shortcutsPanelRef.current && !shortcutsPanelRef.current.contains(e.target as Node)) {
        setShowShortcuts(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [showShortcuts]);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      if (disabled) return;
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
    [disabled, duration, onSeek],
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
      if (disabled || !timelineReady || duration <= 0) return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onSeek(stepFrameTime(currentTimeRef.current, -step));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onSeek(Math.min(duration, stepFrameTime(currentTimeRef.current, step)));
      }
    },
    [disabled, timelineReady, duration, onSeek],
  );

  const commitJumpFrame = useCallback(() => {
    if (disabled) return;
    const frame = Number.parseInt(jumpFrame, 10);
    if (!Number.isFinite(frame) || duration <= 0) return;
    onSeek(Math.min(duration, frameToSeconds(Math.max(0, frame))));
  }, [disabled, duration, jumpFrame, onSeek]);

  const handleJumpSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      commitJumpFrame();
    },
    [commitJumpFrame],
  );

  const handleJumpKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      commitJumpFrame();
    },
    [commitJumpFrame],
  );

  return (
    <div
      className="px-4 py-2 flex flex-wrap items-center gap-x-2 gap-y-1"
      aria-disabled={disabled || undefined}
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
        disabled={controlsDisabled}
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

      {/* Time display — click to toggle time/frame mode */}
      <button
        type="button"
        onClick={() => setTimeDisplayMode((m) => (m === "time" ? "frame" : "time"))}
        disabled={disabled}
        title={timeDisplayMode === "time" ? "Switch to frame display" : "Switch to time display"}
        className="font-mono text-[11px] tabular-nums flex-shrink-0 w-[118px] text-left transition-colors disabled:pointer-events-none hover:opacity-80"
        style={{ color: "#A1A1AA", cursor: "pointer" }}
      >
        <span ref={timeDisplayRef}>{formatTime(0)}</span>
        {timeDisplayMode === "time" ? (
          <>
            <span style={{ color: "#3F3F46", margin: "0 2px" }}>/</span>
            <span style={{ color: "#52525B" }}>{formatTime(duration)}</span>
          </>
        ) : null}
      </button>

      {/* Seek bar — teal progress fill */}
      <div
        ref={(el) => {
          (seekBarRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
          (sliderRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Seek"
        aria-disabled={disabled || undefined}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={0}
        className={`min-w-[96px] flex-1 h-6 flex items-center group ${
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        }`}
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
          {/* Work-area band between in/out points */}
          {(inPoint !== null || outPoint !== null) && duration > 0 && (
            <div
              className="absolute top-0 bottom-0 pointer-events-none"
              style={{
                left: `${inPoint !== null ? Math.min(100, (inPoint / duration) * 100) : 0}%`,
                right: `${outPoint !== null ? 100 - Math.min(100, (outPoint / duration) * 100) : 0}%`,
                background: "rgba(60,230,172,0.15)",
              }}
            />
          )}
          {/* Progress fill — width is controlled imperatively via ref to avoid React re-render resets */}
          <div
            ref={progressFillRef}
            className="absolute top-0 bottom-0 left-0 z-[1] rounded-full"
            style={{ background: "linear-gradient(90deg, var(--hf-accent, #3CE6AC), #2BBFA0)" }}
          />
          {/* In-point marker */}
          {inPoint !== null && duration > 0 && (
            <div
              className="absolute z-[3] pointer-events-none"
              style={{
                left: `${Math.min(100, (inPoint / duration) * 100)}%`,
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: "2px",
                height: "10px",
                background: "#3CE6AC",
                borderRadius: "1px",
              }}
            />
          )}
          {/* Out-point marker */}
          {outPoint !== null && duration > 0 && (
            <div
              className="absolute z-[3] pointer-events-none"
              style={{
                left: `${Math.min(100, (outPoint / duration) * 100)}%`,
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: "2px",
                height: "10px",
                background: "#3CE6AC",
                borderRadius: "1px",
              }}
            />
          )}
          {/* Playhead thumb — left is controlled imperatively via ref */}
          <div
            ref={progressThumbRef}
            className="absolute top-1/2 z-[4] w-3 h-3 rounded-full -translate-y-1/2 -translate-x-1/2 transition-transform group-hover:scale-125"
            style={{
              background: "var(--hf-accent, #3CE6AC)",
              boxShadow: "0 0 6px rgba(60,230,172,0.4), 0 1px 4px rgba(0,0,0,0.4)",
            }}
          />
        </div>
      </div>

      {/* Mute toggle */}
      <button
        type="button"
        onClick={() => {
          if (!audioAutoMuted) setAudioMuted(!audioMuted);
        }}
        disabled={controlsDisabled || audioAutoMuted}
        title={muteButtonLabel}
        aria-label={muteButtonLabel}
        aria-pressed={effectiveAudioMuted}
        className={`h-7 w-7 flex-shrink-0 flex items-center justify-center rounded-md border transition-colors disabled:pointer-events-none ${
          effectiveAudioMuted
            ? "text-studio-accent bg-studio-accent/10 border-studio-accent/30"
            : "border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:bg-neutral-800"
        } ${audioAutoMuted ? "opacity-70" : ""}`}
      >
        {effectiveAudioMuted ? (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M11 5 6 9H3v6h3l5 4V5Z" />
            <path d="m19 9-6 6" />
            <path d="m13 9 6 6" />
          </svg>
        ) : (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M11 5 6 9H3v6h3l5 4V5Z" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" />
          </svg>
        )}
      </button>

      {/* Speed control */}
      <div ref={speedMenuContainerRef} className="relative flex-shrink-0">
        <button
          type="button"
          onClick={() => setShowSpeedMenu((v) => !v)}
          disabled={disabled}
          className="w-10 px-2 py-1 rounded-md text-[10px] font-mono tabular-nums transition-colors"
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

      <button
        type="button"
        onClick={() => setLoopEnabled(!loopEnabled)}
        disabled={disabled}
        className={`h-7 w-7 flex items-center justify-center rounded-md border transition-colors ${
          loopEnabled
            ? "text-studio-accent bg-studio-accent/10 border-studio-accent/30"
            : "border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:bg-neutral-800"
        }`}
        title="Loop playback"
        aria-label={loopEnabled ? "Disable loop playback" : "Enable loop playback"}
        aria-pressed={loopEnabled}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M17 2l4 4-4 4" />
          <path d="M3 11V9a4 4 0 0 1 4-4h14" />
          <path d="M7 22l-4-4 4-4" />
          <path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </svg>
      </button>

      {/* Keyboard shortcuts + frame jump + work area — click to open panel */}
      <div ref={shortcutsPanelRef} className="relative flex-shrink-0">
        <button
          type="button"
          onClick={() => setShowShortcuts((v) => !v)}
          className={`w-6 h-6 flex items-center justify-center rounded border transition-colors ${
            showShortcuts
              ? "border-neutral-600 text-neutral-200 bg-neutral-800"
              : "border-neutral-800 text-neutral-600 hover:text-neutral-300 hover:border-neutral-600"
          }`}
          aria-label="Shortcuts and tools"
          aria-expanded={showShortcuts}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8" />
          </svg>
        </button>
        {showShortcuts && (
          <div
            className="absolute bottom-full right-0 mb-2 z-50 rounded-lg shadow-xl min-w-[220px] overflow-y-auto"
            style={{
              background: "#161618",
              border: "1px solid rgba(255,255,255,0.08)",
              maxHeight: "min(280px, calc(100vh - 80px))",
            }}
          >
            {/* Frame jump */}
            <div className="px-3 pt-3 pb-2.5">
              <p className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
                Jump to frame
              </p>
              <form onSubmit={handleJumpSubmit} className="flex items-center gap-1.5">
                <input
                  value={jumpFrame}
                  onChange={(e) => setJumpFrame(e.target.value)}
                  disabled={disabled}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  aria-label="Jump to frame"
                  placeholder="frame number"
                  className="h-6 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 text-[10px] font-mono tabular-nums text-neutral-200 outline-none transition-colors placeholder:text-neutral-600 focus:border-studio-accent/60"
                  onKeyDown={handleJumpKeyDown}
                  onBlur={commitJumpFrame}
                />
                <button
                  type="submit"
                  disabled={disabled}
                  className="h-6 px-2 rounded border border-neutral-700 text-[10px] text-neutral-300 transition-colors hover:border-neutral-500 hover:bg-neutral-800 disabled:opacity-40"
                >
                  Go
                </button>
              </form>
            </div>
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }} />
            {/* Work area */}
            <div className="px-3 pt-2.5 pb-2">
              <p className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
                Work area
              </p>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono text-[10px] rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 min-w-[20px] text-center"
                      style={{ background: "rgba(255,255,255,0.05)" }}
                    >
                      I
                    </span>
                    <span className="text-[10px] text-neutral-400">In-point</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {inPoint !== null ? (
                      <>
                        <span className="font-mono text-[10px] text-neutral-300">
                          {formatTime(inPoint)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setInPoint(null)}
                          className="w-4 h-4 flex items-center justify-center rounded text-neutral-500 hover:text-neutral-200 transition-colors"
                          aria-label="Clear in-point"
                        >
                          <svg
                            width="8"
                            height="8"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </>
                    ) : (
                      <span className="text-[10px] text-neutral-600">—</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono text-[10px] rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 min-w-[20px] text-center"
                      style={{ background: "rgba(255,255,255,0.05)" }}
                    >
                      O
                    </span>
                    <span className="text-[10px] text-neutral-400">Out-point</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {outPoint !== null ? (
                      <>
                        <span className="font-mono text-[10px] text-neutral-300">
                          {formatTime(outPoint)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setOutPoint(null)}
                          className="w-4 h-4 flex items-center justify-center rounded text-neutral-500 hover:text-neutral-200 transition-colors"
                          aria-label="Clear out-point"
                        >
                          <svg
                            width="8"
                            height="8"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </>
                    ) : (
                      <span className="text-[10px] text-neutral-600">—</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }} />
            {/* Shortcuts */}
            <div className="px-3 pt-2.5 pb-3 flex flex-col gap-3">
              {SHORTCUT_SECTIONS.map((section) => (
                <div key={section.title}>
                  <p className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
                    {section.title}
                  </p>
                  <div className="flex flex-col gap-1">
                    {section.hints.map((hint) => (
                      <div key={hint.key} className="flex items-center gap-3">
                        <span
                          className="font-mono text-[10px] rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 min-w-[36px] text-center"
                          style={{ background: "rgba(255,255,255,0.05)" }}
                        >
                          {hint.key}
                        </span>
                        <span className="text-[10px] text-neutral-400">{hint.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
