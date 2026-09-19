import { useEffect, useRef } from "react";
import {
  useEnableKeyframes,
  isPlayheadWithinTween,
  type EnableKeyframesSession,
} from "../hooks/useEnableKeyframes";
import { computeElementPercentage, KEYFRAME_PCT_MATCH } from "../hooks/gsapShared";
import { useKeyframeKeyboard } from "../hooks/useKeyframeKeyboard";
import {
  getNextTimelineZoomPercent,
  getTimelineZoomPercent,
  timelineZoomPercentToSlider,
  timelineSliderToZoomPercent,
} from "../player/components/timelineZoom";
import { useTimelineZoom } from "../player/components/useTimelineZoom";
import { usePlayerStore, type TimelineElement } from "../player";
import { Tooltip } from "./ui";
import { flatActive, flatBtn, flatDisabled, flatIdle } from "./timelineToolbarStyles";
import { TimelineHistoryButtons } from "./TimelineHistoryButtons";
import { Icon } from "../icons";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "./editor/domEditingTypes";
import { canSplitElement } from "../utils/timelineElementSplit";
import { canAddBeatAt, addBeatAtCompositionTime } from "../utils/beatEditActions";

interface DomEditSessionSlice extends EnableKeyframesSession {
  domEditSelection: DomEditSelection | null;
  selectedGsapAnimations: GsapAnimation[];
}

interface TimelineToolbarProps {
  domEditSession?: DomEditSessionSlice;
  onSplitElement?: (element: TimelineElement, splitTime: number) => void;
}

interface KeyframeToggleState {
  state: "active" | "inactive" | "none";
  isMotionPath: boolean;
  pathEndpoint: boolean;
  willExtend: boolean;
}

const NO_KEYFRAME_TOGGLE: KeyframeToggleState = {
  state: "none",
  isMotionPath: false,
  pathEndpoint: false,
  willExtend: false,
};

function isMotionPathEndpoint(animation: GsapAnimation | undefined, percentage: number): boolean {
  if (!animation?.keyframes) return false;
  const keyframes = animation.keyframes.keyframes;
  return (
    Math.abs((keyframes[0]?.percentage ?? -Infinity) - percentage) <= KEYFRAME_PCT_MATCH ||
    Math.abs((keyframes.at(-1)?.percentage ?? Infinity) - percentage) <= KEYFRAME_PCT_MATCH
  );
}

function resolveKeyframeToggleState(
  session: DomEditSessionSlice | undefined,
  currentTime: number,
): KeyframeToggleState {
  if (!session?.domEditSelection) return NO_KEYFRAME_TOGGLE;
  const arcAnimation = session.selectedGsapAnimations.find(
    (animation) => animation.arcPath && animation.keyframes,
  );
  const animation =
    arcAnimation ??
    session.selectedGsapAnimations.find((candidate) => candidate.keyframes && !candidate.arcPath);
  if (!animation?.keyframes) return NO_KEYFRAME_TOGGLE;

  const isMotionPath = Boolean(arcAnimation);
  if (!isPlayheadWithinTween(animation, currentTime, session.domEditSelection)) {
    return { state: "inactive", isMotionPath, pathEndpoint: false, willExtend: true };
  }

  const percentage = computeElementPercentage(currentTime, session.domEditSelection, animation);
  const pathEndpoint = isMotionPathEndpoint(arcAnimation, percentage);
  const active = animation.keyframes.keyframes.some(
    (keyframe) => Math.abs(keyframe.percentage - percentage) <= KEYFRAME_PCT_MATCH,
  );
  return {
    state: pathEndpoint ? "none" : active ? "active" : "inactive",
    isMotionPath,
    pathEndpoint,
    willExtend: false,
  };
}

/**
 * Can this element be keyframed at all?
 *
 * An audio clip cannot. It has no box on the canvas, so there is nothing to move,
 * scale or fade — and "add a keyframe" on one seeds a tween from the position
 * properties, which produced a position lane on a track that has no position. Audio
 * is automated instead: volume and effect parameters, on their own lanes.
 */
function isKeyframeable(element: TimelineElement | undefined): boolean {
  return element?.tag !== "audio";
}

function useKeyframeToggle(session?: DomEditSessionSlice) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const elements = usePlayerStore((s) => s.elements);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const onToggle = useEnableKeyframes(
    sessionRef as React.RefObject<EnableKeyframesSession | undefined>,
  );

  const selected = elements.find((element) => (element.key ?? element.id) === selectedElementId);
  if (!isKeyframeable(selected)) return { ...NO_KEYFRAME_TOGGLE, onToggle: undefined };

  const toggleState = resolveKeyframeToggleState(session, currentTime);

  return {
    ...toggleState,
    onToggle: session?.domEditSelection && !toggleState.pathEndpoint ? onToggle : undefined,
  };
}

// fallow-ignore-next-line complexity
export function TimelineToolbar({ domEditSession, onSplitElement }: TimelineToolbarProps) {
  const activeTool = usePlayerStore((s) => s.activeTool);
  const setActiveTool = usePlayerStore((s) => s.setActiveTool);
  const timelineSnapEnabled = usePlayerStore((s) => s.timelineSnapEnabled);
  const setTimelineSnapEnabled = usePlayerStore((s) => s.setTimelineSnapEnabled);
  const rippleEditEnabled = usePlayerStore((s) => s.rippleEditEnabled);
  const setRippleEditEnabled = usePlayerStore((s) => s.setRippleEditEnabled);
  const autoKeyframeEnabled = usePlayerStore((s) => s.autoKeyframeEnabled);
  const setAutoKeyframeEnabled = usePlayerStore((s) => s.setAutoKeyframeEnabled);
  const thumbnailMode = usePlayerStore((s) => s.thumbnailMode);
  const setThumbnailMode = usePlayerStore((s) => s.setThumbnailMode);
  const thumbnailsVisible = thumbnailMode === "adaptive";
  // Subscribe so the add-beat button reacts to playhead movement and analysis load.
  const currentTime = usePlayerStore((s) => s.currentTime);
  const beatAnalysisReady = usePlayerStore((s) => s.beatAnalysis !== null);
  // Subscribe (not getState) so the split button enables/disables the moment
  // the selection changes, not only on the next playhead tick.
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const elements = usePlayerStore((s) => s.elements);
  const timelineFitPps = usePlayerStore((s) => s.timelineFitPps);
  const { zoomMode, manualZoomPercent, setZoomMode, setManualZoomPercent } = useTimelineZoom();
  const displayedTimelineZoomPercent = getTimelineZoomPercent(
    zoomMode,
    manualZoomPercent,
    timelineFitPps,
  );
  const {
    state: keyframeState,
    isMotionPath: keyframeIsMotionPath,
    pathEndpoint: keyframePathEndpoint,
    willExtend: keyframeWillExtend,
    onToggle: onToggleKeyframe,
  } = useKeyframeToggle(domEditSession);

  // Wire the "Add keyframe (K)" shortcut the toolbar advertises. Active only when
  // there's a keyframeable selection; otherwise K stays JKL-pause in playback.
  useKeyframeKeyboard({
    enabled: Boolean(onToggleKeyframe),
    onAddKeyframe: onToggleKeyframe,
  });

  // "N" toggles timeline snapping (industry convention: Resolve/FCP).
  // Skip when typing in an input/contenteditable.
  useEffect(() => {
    // fallow-ignore-next-line complexity
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.isContentEditable) return;
      const tag = target?.tagName?.toLowerCase() ?? "";
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const store = usePlayerStore.getState();
      store.setTimelineSnapEnabled(!store.timelineSnapEnabled);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    // The "TIMELINE" label is dropped for CapCut-like density — the pane's
    // position (tracks right below) makes it self-evident.
    <div className="border-b border-neutral-800/60">
      <div className="flex items-center justify-between px-2 py-0.5">
        <div className="flex items-center gap-0.5">
          <TimelineHistoryButtons />
          <Tooltip label="Selection tool (V)">
            <button
              type="button"
              onClick={() => setActiveTool("select")}
              aria-label="Selection tool"
              aria-pressed={activeTool === "select"}
              className={activeTool === "select" ? flatActive : flatIdle}
            >
              <Icon name="select" filled={activeTool === "select"} />
            </button>
          </Tooltip>
          <Tooltip label="Razor tool (B) — Shift+click splits all tracks">
            <button
              type="button"
              onClick={() => setActiveTool("razor")}
              aria-label="Razor tool"
              aria-pressed={activeTool === "razor"}
              className={activeTool === "razor" ? flatActive : flatIdle}
            >
              <Icon name="razor" filled={activeTool === "razor"} />
            </button>
          </Tooltip>
          {/* Divider: tool-mode | editing-actions */}
          <div aria-hidden="true" className="mx-1 h-4 w-px bg-neutral-800" />
          <Tooltip label={timelineSnapEnabled ? "Snapping on (N)" : "Snapping off (N)"}>
            <button
              type="button"
              onClick={() => setTimelineSnapEnabled(!timelineSnapEnabled)}
              aria-label="Toggle timeline snapping"
              aria-pressed={timelineSnapEnabled}
              className={timelineSnapEnabled ? flatActive : flatIdle}
            >
              <Icon name="magnet" />
            </button>
          </Tooltip>
          <Tooltip
            label={
              rippleEditEnabled
                ? "Ripple on — keeps the main track gapless"
                : "Ripple off — deleting a main-track clip leaves a gap"
            }
          >
            <button
              type="button"
              onClick={() => setRippleEditEnabled(!rippleEditEnabled)}
              aria-label="Toggle ripple edit"
              aria-pressed={rippleEditEnabled}
              className={rippleEditEnabled ? flatActive : flatIdle}
            >
              <Icon name="waves" />
            </button>
          </Tooltip>
          {/* Always rendered (CapCut-style): with no keyframeable selection the
              button fades to a disabled state instead of unmounting, so the
              toolbar layout never shifts. */}
          <Tooltip
            label={
              keyframePathEndpoint
                ? "Motion path endpoints cannot be removed"
                : !onToggleKeyframe
                  ? "Select an animated element to add keyframes"
                  : keyframeIsMotionPath
                    ? keyframeWillExtend
                      ? "Extend motion path to playhead (K)"
                      : keyframeState === "active"
                        ? "Remove waypoint from motion path (K)"
                        : "Add waypoint to motion path (K)"
                    : keyframeState === "active"
                      ? "Remove keyframe at playhead (K)"
                      : keyframeState === "inactive"
                        ? keyframeWillExtend
                          ? "Add keyframe at playhead, extends animation (K)"
                          : "Add keyframe at playhead (K)"
                        : "Add keyframe (K)"
            }
          >
            <button
              type="button"
              disabled={!onToggleKeyframe}
              onClick={onToggleKeyframe}
              aria-label={
                keyframePathEndpoint
                  ? "Motion path endpoint"
                  : keyframeIsMotionPath
                    ? keyframeState === "active"
                      ? "Remove motion path waypoint"
                      : keyframeWillExtend
                        ? "Extend motion path to playhead"
                        : "Add motion path waypoint"
                    : keyframeState === "active"
                      ? "Remove keyframe at playhead"
                      : "Add keyframe at playhead"
              }
              className={
                !onToggleKeyframe
                  ? flatDisabled
                  : `${flatBtn} active:scale-[0.98] hover:bg-white/6 ${
                      keyframeState === "active"
                        ? "text-studio-accent"
                        : keyframeState === "inactive"
                          ? "text-neutral-400 hover:text-studio-accent"
                          : "text-neutral-600 hover:text-neutral-400"
                    }`
              }
            >
              <Icon name="keyframe" filled={keyframeState === "active"} />
            </button>
          </Tooltip>
          <Tooltip
            label={
              autoKeyframeEnabled
                ? "Auto-record manual edits as keyframes (click to turn off)"
                : "Manual edits will not be recorded as keyframes (click to turn on)"
            }
          >
            <button
              type="button"
              onClick={() => setAutoKeyframeEnabled(!autoKeyframeEnabled)}
              aria-label="Auto-record manual edits as keyframes"
              aria-pressed={autoKeyframeEnabled}
              className={`${flatBtn} active:scale-[0.98] hover:bg-white/6 ${
                autoKeyframeEnabled
                  ? "text-red-400 hover:text-red-300"
                  : "text-neutral-600 hover:text-neutral-400"
              }`}
            >
              <Icon name="keyframe-auto" filled={autoKeyframeEnabled} />
            </button>
          </Tooltip>
          {onSplitElement &&
            (() => {
              // Render the button unconditionally (disabled when unusable):
              // mounting/unmounting mid-task shifts the neighboring controls.
              // Mirrors the S-key gate: selected clip + playhead strictly inside it.
              const el = selectedElementId
                ? elements.find((e) => (e.key ?? e.id) === selectedElementId)
                : null;
              const splittable = el != null && canSplitElement(el);
              const canSplit =
                splittable && currentTime > el.start && currentTime < el.start + el.duration;
              return (
                <Tooltip
                  label={
                    canSplit
                      ? "Split at playhead (S)"
                      : splittable
                        ? "Move the playhead inside the clip to split"
                        : "Select a clip to split"
                  }
                >
                  <button
                    type="button"
                    disabled={!canSplit}
                    aria-label="Split at playhead"
                    onClick={() => {
                      if (canSplit && el) onSplitElement(el, currentTime);
                    }}
                    className={canSplit ? flatIdle : flatDisabled}
                  >
                    <Icon name="split" />
                  </button>
                </Tooltip>
              );
            })()}
          {(() => {
            // Always rendered (CapCut-style): before beat analysis loads (or when
            // the project has no analyzed music) the button fades to a disabled
            // state instead of unmounting, so the toolbar layout never shifts.
            const canAdd = beatAnalysisReady && canAddBeatAt(currentTime);
            return (
              <Tooltip
                label={
                  !beatAnalysisReady
                    ? "Add a music track with beat analysis to place beats"
                    : canAdd
                      ? "Add beat at playhead"
                      : "A beat already exists at the playhead"
                }
              >
                <button
                  type="button"
                  disabled={!canAdd}
                  aria-label="Add beat at playhead"
                  onClick={() => {
                    if (canAdd) addBeatAtCompositionTime(currentTime);
                  }}
                  className={
                    canAdd
                      ? `${flatBtn} text-neutral-400 hover:bg-white/6 hover:text-[#22c55e] active:scale-[0.98]`
                      : flatDisabled
                  }
                >
                  <Icon name="beat" />
                </button>
              </Tooltip>
            );
          })()}
        </div>
        <div className="flex items-center gap-0.5">
          <Tooltip
            label={
              thumbnailsVisible
                ? "Hide thumbnails — labels only"
                : "Show thumbnails — posters stay visible; richer previews appear on interaction"
            }
          >
            <button
              type="button"
              aria-label={
                thumbnailsVisible
                  ? "Hide thumbnails — labels only"
                  : "Show thumbnails — posters stay visible; richer previews appear on interaction"
              }
              aria-pressed={thumbnailsVisible}
              onClick={() => setThumbnailMode(thumbnailsVisible ? "hidden" : "adaptive")}
              className={`h-7 px-2 rounded-md text-[11px] font-medium transition-colors ${
                thumbnailsVisible
                  ? "bg-studio-accent/10 text-studio-accent"
                  : "text-neutral-400 hover:bg-white/6 hover:text-neutral-200"
              }`}
            >
              <Icon name="image" />
            </button>
          </Tooltip>
          <Tooltip label="Fit timeline to width">
            <button
              type="button"
              onClick={() => setZoomMode("fit")}
              className={`h-7 px-2 rounded-md text-[11px] font-medium transition-colors ${
                zoomMode === "fit"
                  ? "bg-studio-accent/10 text-studio-accent"
                  : "text-neutral-400 hover:bg-white/6 hover:text-neutral-200"
              }`}
            >
              Fit
            </button>
          </Tooltip>
          <Tooltip label="Zoom out">
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => {
                setZoomMode("manual");
                setManualZoomPercent(
                  getNextTimelineZoomPercent("out", zoomMode, manualZoomPercent, timelineFitPps),
                );
              }}
              className={flatIdle}
            >
              <Icon name="zoom-out" />
            </button>
          </Tooltip>
          <input
            type="range"
            min="0"
            max="100"
            value={timelineZoomPercentToSlider(displayedTimelineZoomPercent, timelineFitPps)}
            title={`${displayedTimelineZoomPercent}%`}
            aria-label="Timeline zoom"
            onChange={(e) => {
              setZoomMode("manual");
              setManualZoomPercent(
                timelineSliderToZoomPercent(Number(e.target.value), timelineFitPps),
              );
            }}
            // h-6 on the input is the 24x24 WCAG 2.2 (2.5.8) target: the visible
            // track stays 2px and the thumb 10px, only the pointer box grows.
            className="mx-1 h-6 w-[96px] cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-[2px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-neutral-700 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[10px] [&::-webkit-slider-thumb]:h-[10px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:shadow-[0_0_0_2px_#0a0a0a,0_1px_3px_rgba(0,0,0,0.5)] [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb:active]:cursor-grabbing"
          />
          <Tooltip label="Zoom in">
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => {
                setZoomMode("manual");
                setManualZoomPercent(
                  getNextTimelineZoomPercent("in", zoomMode, manualZoomPercent, timelineFitPps),
                );
              }}
              className={flatIdle}
            >
              <Icon name="zoom-in" />
            </button>
          </Tooltip>
          {/* Numeric zoom readout (main-parity): "Fit" in fit mode, N% in manual. */}
          <span
            className="ml-1 w-[38px] text-right font-mono text-[11px] tabular-nums text-neutral-500 select-none"
            aria-label="Timeline zoom level"
          >
            {zoomMode === "fit" ? "Fit" : `${displayedTimelineZoomPercent}%`}
          </span>
        </div>
      </div>
    </div>
  );
}
