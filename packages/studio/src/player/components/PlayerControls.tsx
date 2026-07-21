import { useRef, useCallback, useEffect, memo } from "react";
import gsap from "gsap";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";
import { formatFrameTime, formatTime, stepFrameTime } from "../lib/time";
import { usePlayerStore } from "../store/playerStore";
import { trackStudioEvent } from "../../utils/studioTelemetry";
import { Tooltip } from "../../components/ui";
import { ShortcutsPanel } from "./ShortcutsPanel";
import { SpeedMenu } from "./SpeedMenu";
import { useSeekBarDrag, resolveSeekPercent } from "./useSeekBarDrag";

export { resolveSeekPercent };

/* ── Icon sub-components ─────────────────────────────────────────── */

gsap.registerPlugin(MorphSVGPlugin);

// Play glyph: the right-hand blade from the HyperFrames favicon (points right).
// Pause glyph: two bars centred in the same coordinate space so MorphSVG can
// tween one `d` into the other. Both shapes live in the favicon's 0-100 space
// and the svg viewBox frames the blade's bounding box.
const PLAY_BLADE_D =
  "M87.5129 57.5141L56.9696 73.5433C52.8371 75.7098 48.7046 73.2553 49.6688 69.2104L58.9483 30.1391C59.9125 26.0942 65.2097 23.6397 68.3154 25.8062L91.2447 41.8354C96.4668 45.4796 94.4631 53.8699 87.5129 57.5141Z";
const PAUSE_BARS_D = "M56 28H67V71H56Z M73 28H84V71H73Z";

// Morph the play blade <-> pause bars on toggle via GSAP MorphSVG. Both glyphs
// are one path whose `d` tweens; the initial render matches `playing` with no
// animation, and prefers-reduced-motion snaps instead of tweening.
function PlayPauseMorphIcon({ playing }: { playing: boolean }) {
  const pathRef = useRef<SVGPathElement>(null);
  const isFirstRun = useRef(true);
  useEffect(() => {
    const el = pathRef.current;
    if (!el) return;
    const target = playing ? PAUSE_BARS_D : PLAY_BLADE_D;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (isFirstRun.current || reduceMotion) {
      isFirstRun.current = false;
      gsap.set(el, { morphSVG: target });
      return;
    }
    const tween = gsap.to(el, { duration: 0.28, ease: "power2.inOut", morphSVG: target });
    return () => {
      tween.kill();
    };
  }, [playing]);
  return (
    <span className="relative inline-flex h-3 w-3 items-center justify-center" aria-hidden="true">
      <svg width="12" height="12" viewBox="46 21 54 56" fill="#FAFAFA">
        <path ref={pathRef} d={playing ? PAUSE_BARS_D : PLAY_BLADE_D} />
      </svg>
    </span>
  );
}

/* ── Button sub-components ───────────────────────────────────────── */

const MuteButton = memo(function MuteButton({
  audioMuted,
  controlsDisabled,
  setAudioMuted,
}: {
  audioMuted: boolean;
  controlsDisabled: boolean;
  setAudioMuted: (v: boolean) => void;
}) {
  const label = audioMuted ? "Unmute audio" : "Mute audio";
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={() => {
          trackStudioEvent("playback", { action: "mute_toggle", muted: !audioMuted });
          setAudioMuted(!audioMuted);
        }}
        disabled={controlsDisabled}
        aria-label={label}
        aria-pressed={audioMuted}
        className={`h-7 w-7 flex-shrink-0 flex items-center justify-center rounded-md border transition-colors disabled:pointer-events-none ${
          audioMuted
            ? "text-studio-accent bg-studio-accent/10 border-studio-accent/30"
            : "border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:bg-neutral-800"
        }`}
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
          <path d="M11 5 6 9H3v6h3l5 4V5Z" />
          {audioMuted ? (
            <>
              <path d="m19 9-6 6" />
              <path d="m13 9 6 6" />
            </>
          ) : (
            <>
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              <path d="M18.5 5.5a9 9 0 0 1 0 13" />
            </>
          )}
        </svg>
      </button>
    </Tooltip>
  );
});

const LoopButton = memo(function LoopButton({
  loopEnabled,
  disabled,
  setLoopEnabled,
}: {
  loopEnabled: boolean;
  disabled: boolean;
  setLoopEnabled: (v: boolean) => void;
}) {
  return (
    <Tooltip label="Loop playback">
      <button
        type="button"
        onClick={() => {
          trackStudioEvent("playback", { action: "loop_toggle", enabled: !loopEnabled });
          setLoopEnabled(!loopEnabled);
        }}
        disabled={disabled}
        className={`h-7 w-7 flex items-center justify-center rounded-md border transition-colors ${
          loopEnabled
            ? "text-studio-accent bg-studio-accent/10 border-studio-accent/30"
            : "border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:bg-neutral-800"
        }`}
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
    </Tooltip>
  );
});

const FullscreenButton = memo(function FullscreenButton({
  isFullscreen,
  onToggleFullscreen,
}: {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  return (
    <Tooltip label={isFullscreen ? "Exit fullscreen (F)" : "Enter fullscreen (F)"}>
      <button
        type="button"
        onClick={() => {
          trackStudioEvent("playback", { action: "fullscreen_toggle", active: !isFullscreen });
          onToggleFullscreen();
        }}
        className={`h-7 w-7 flex-shrink-0 flex items-center justify-center rounded-md border transition-colors ${
          isFullscreen
            ? "text-studio-accent bg-studio-accent/10 border-studio-accent/30"
            : "border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:bg-neutral-800"
        }`}
        aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
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
          {isFullscreen ? (
            <>
              <path d="M8 3v3a2 2 0 0 1-2 2H3" />
              <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
              <path d="M3 16h3a2 2 0 0 1 2 2v3" />
              <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
            </>
          ) : (
            <>
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
              <path d="M3 16v3a2 2 0 0 0 2 2h3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
            </>
          )}
        </svg>
      </button>
    </Tooltip>
  );
});

/* ── Seek bar sub-component ──────────────────────────────────────── */

function SeekBarMarker({ position, duration }: { position: number; duration: number }) {
  if (duration <= 0) return null;
  return (
    <div
      className="absolute z-[3] pointer-events-none"
      style={{
        left: `${Math.min(100, (position / duration) * 100)}%`,
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: "2px",
        height: "10px",
        background: "#3CE6AC",
        borderRadius: "1px",
      }}
    />
  );
}

function WorkAreaOverlay({
  inPoint,
  outPoint,
  duration,
}: {
  inPoint: number | null;
  outPoint: number | null;
  duration: number;
}) {
  if ((inPoint === null && outPoint === null) || duration <= 0) return null;
  return (
    <>
      <div
        className="absolute top-0 bottom-0 pointer-events-none"
        style={{
          left: `${inPoint !== null ? Math.min(100, (inPoint / duration) * 100) : 0}%`,
          right: `${outPoint !== null ? 100 - Math.min(100, (outPoint / duration) * 100) : 0}%`,
          background: "rgba(60,230,172,0.15)",
        }}
      />
      {inPoint !== null && <SeekBarMarker position={inPoint} duration={duration} />}
      {outPoint !== null && <SeekBarMarker position={outPoint} duration={duration} />}
    </>
  );
}

const SeekBar = memo(function SeekBar({
  disabled,
  duration,
  inPoint,
  outPoint,
  progressFillRef,
  progressThumbRef,
  seekBarRef,
  sliderRef,
  onPointerDown,
  onKeyDown,
}: {
  disabled: boolean;
  duration: number;
  inPoint: number | null;
  outPoint: number | null;
  progressFillRef: React.RefObject<HTMLDivElement | null>;
  progressThumbRef: React.RefObject<HTMLDivElement | null>;
  seekBarRef: React.RefObject<HTMLDivElement | null>;
  sliderRef: React.RefObject<HTMLDivElement | null>;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  return (
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
      className={`min-w-[96px] flex-1 h-6 flex items-center group outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <div
        className="w-full rounded-full relative"
        style={{ background: "rgba(255,255,255,0.15)", height: "3px" }}
      >
        <WorkAreaOverlay inPoint={inPoint} outPoint={outPoint} duration={duration} />
        <div
          ref={progressFillRef}
          className="absolute top-0 bottom-0 left-0 z-[1] rounded-full"
          style={{ background: "linear-gradient(90deg, var(--hf-accent, #3CE6AC), #2BBFA0)" }}
        />
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
  );
});

/* ── Main component ──────────────────────────────────────────────── */

interface PlayerControlsProps {
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  disabled?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const PlayerControls = memo(function PlayerControls({
  onTogglePlay,
  onSeek,
  disabled = false,
  isFullscreen = false,
  onToggleFullscreen,
}: PlayerControlsProps) {
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
  const timeDisplayMode = usePlayerStore((s) => s.timeDisplayMode);
  const setTimeDisplayMode = usePlayerStore.getState().setTimeDisplayMode;

  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressThumbRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const currentTimeRef = useRef(0);
  const timeDisplayModeRef = useRef(timeDisplayMode);
  timeDisplayModeRef.current = timeDisplayMode;

  const durationRef = useRef(duration);
  durationRef.current = duration;
  const controlsDisabled = disabled || !timelineReady;

  useEffect(() => {
    if (!timeDisplayRef.current) return;
    const t = currentTimeRef.current;
    timeDisplayRef.current.textContent =
      timeDisplayMode === "frame" ? formatFrameTime(t, duration) : formatTime(t);
  }, [duration, timeDisplayMode]);

  const { handlePointerDown } = useSeekBarDrag(
    {
      seekBarRef,
      progressFillRef,
      progressThumbRef,
      sliderRef,
      timeDisplayRef,
      isDraggingRef,
      durationRef,
      currentTimeRef,
      timeDisplayModeRef,
    },
    onSeek,
    disabled,
    duration,
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

  return (
    <div
      // No own background/border: the transport blends into the preview
      // panel's surface — buttons carry their own chrome.
      className="px-4 py-2 flex flex-wrap items-center gap-x-2 gap-y-1"
      aria-disabled={disabled || undefined}
      style={{
        paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))",
      }}
    >
      <Tooltip label={isPlaying ? "Pause" : "Play"}>
        <button
          type="button"
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={() => {
            trackStudioEvent("playback", { action: isPlaying ? "pause" : "play" });
            onTogglePlay();
          }}
          disabled={controlsDisabled}
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg disabled:opacity-30 disabled:pointer-events-none transition-colors"
          style={{ background: "rgba(255,255,255,0.06)" }}
        >
          <PlayPauseMorphIcon playing={isPlaying} />
        </button>
      </Tooltip>

      <Tooltip
        label={timeDisplayMode === "time" ? "Switch to frame display" : "Switch to time display"}
      >
        <button
          type="button"
          onClick={() => setTimeDisplayMode(timeDisplayMode === "time" ? "frame" : "time")}
          disabled={disabled}
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
      </Tooltip>

      <SeekBar
        disabled={disabled}
        duration={duration}
        inPoint={inPoint}
        outPoint={outPoint}
        progressFillRef={progressFillRef}
        progressThumbRef={progressThumbRef}
        seekBarRef={seekBarRef}
        sliderRef={sliderRef}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
      />

      <MuteButton
        audioMuted={audioMuted}
        controlsDisabled={controlsDisabled}
        setAudioMuted={setAudioMuted}
      />

      <SpeedMenu
        playbackRate={playbackRate}
        setPlaybackRate={setPlaybackRate}
        disabled={disabled}
      />

      <LoopButton loopEnabled={loopEnabled} disabled={disabled} setLoopEnabled={setLoopEnabled} />

      {onToggleFullscreen && (
        <FullscreenButton isFullscreen={isFullscreen} onToggleFullscreen={onToggleFullscreen} />
      )}

      <ShortcutsPanel
        disabled={disabled}
        duration={duration}
        inPoint={inPoint}
        outPoint={outPoint}
        setInPoint={setInPoint}
        setOutPoint={setOutPoint}
        onSeek={onSeek}
      />
    </div>
  );
});
