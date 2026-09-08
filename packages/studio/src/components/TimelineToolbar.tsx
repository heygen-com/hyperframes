import { useEffect, useRef } from "react";
import { Image, Magnet, MagnifyingGlassMinus, MagnifyingGlassPlus } from "@phosphor-icons/react";
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
import { Button, IconButton, Slider, Tooltip } from "./ui";
import { Scissors } from "../icons/SystemIcons";
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

/**
 * The pressed look for a toolbar toggle that is an on/off switch (tool mode,
 * snapping). `IconButton`'s ghost variant already owns idle, hover, focus and
 * disabled; a toggle only has to say what "on" looks like, and it says it by
 * holding the hover wash down, so pressed and hovered stay one system.
 */
const TOGGLE_ON = "bg-hover text-text-0";

/**
 * The pressed look for the two view controls on the right (thumbnails, Fit).
 * They tint rather than fill because they change what the timeline SHOWS
 * rather than what a click does, which is the same distinction the header's
 * view toggle draws.
 */
const VIEW_ON = "bg-accent/10 text-accent";

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

  const applyZoomSlider = (sliderValue: number) => {
    setZoomMode("manual");
    setManualZoomPercent(timelineSliderToZoomPercent(sliderValue, timelineFitPps));
  };

  return (
    // The "TIMELINE" label is dropped for CapCut-like density — the pane's
    // position (tracks right below) makes it self-evident.
    <div className="border-b border-border">
      <div className="flex items-center justify-between px-2 py-0.5">
        <div className="flex items-center gap-0.5">
          <Tooltip label="Selection tool (V)">
            <IconButton
              onClick={() => setActiveTool("select")}
              aria-label="Selection tool"
              aria-pressed={activeTool === "select"}
              className={activeTool === "select" ? TOGGLE_ON : undefined}
              icon={
                <svg width="16" height="16" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M2 0.5L10 6L6.5 6.5L8.5 11L6.5 11.5L4.5 7L2 9Z" />
                </svg>
              }
            />
          </Tooltip>
          <Tooltip label="Razor tool (B) — Shift+click splits all tracks">
            <IconButton
              onClick={() => setActiveTool("razor")}
              aria-label="Razor tool"
              aria-pressed={activeTool === "razor"}
              className={activeTool === "razor" ? TOGGLE_ON : undefined}
              icon={<Scissors size={16} />}
            />
          </Tooltip>
          {/* Divider: tool-mode | editing-actions */}
          <div aria-hidden="true" className="mx-1 h-4 w-px bg-border-strong" />
          <Tooltip label={timelineSnapEnabled ? "Snapping on (N)" : "Snapping off (N)"}>
            <IconButton
              onClick={() => setTimelineSnapEnabled(!timelineSnapEnabled)}
              aria-label="Toggle timeline snapping"
              aria-pressed={timelineSnapEnabled}
              className={timelineSnapEnabled ? TOGGLE_ON : undefined}
              icon={<Magnet size={16} weight="bold" aria-hidden="true" />}
            />
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
            <IconButton
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
              // `enabled:hover:` matches the ghost variant's own prefix, so `cn`
              // sees one text-colour decision and the accent replaces it rather
              // than racing it on specificity.
              className={
                keyframeState === "active"
                  ? "text-accent"
                  : keyframeState === "inactive"
                    ? "enabled:hover:text-accent"
                    : "text-text-3"
              }
              icon={
                <svg width="16" height="16" viewBox="0 0 10 10" fill="currentColor">
                  {keyframeState === "active" ? (
                    <path d="M5 0.5L9.5 5L5 9.5L0.5 5Z" />
                  ) : (
                    <path
                      d="M5 1.2L8.8 5L5 8.8L1.2 5Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.2"
                    />
                  )}
                </svg>
              }
            />
          </Tooltip>
          <Tooltip
            label={
              autoKeyframeEnabled
                ? "Auto-record manual edits as keyframes (click to turn off)"
                : "Manual edits will not be recorded as keyframes (click to turn on)"
            }
          >
            <IconButton
              onClick={() => setAutoKeyframeEnabled(!autoKeyframeEnabled)}
              aria-label="Auto-record manual edits as keyframes"
              aria-pressed={autoKeyframeEnabled}
              className={autoKeyframeEnabled ? "text-danger" : "text-text-3"}
              icon={
                <svg width="16" height="16" viewBox="0 0 10 10" fill="none">
                  {/* Same diamond outline as the Add-keyframe icon, with a
                      record-style dot inside: filled = auto-recording,
                      hollow = manual edits won't be keyframed. */}
                  <path d="M5 0.7L9.3 5L5 9.3L0.7 5Z" stroke="currentColor" strokeWidth="1" />
                  <circle
                    cx="5"
                    cy="5"
                    r="1.8"
                    fill={autoKeyframeEnabled ? "currentColor" : "none"}
                    stroke="currentColor"
                    strokeWidth="1"
                  />
                </svg>
              }
            />
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
                  <IconButton
                    disabled={!canSplit}
                    aria-label="Split at playhead"
                    onClick={() => {
                      if (canSplit && el) onSplitElement(el, currentTime);
                    }}
                    icon={
                      /* "][" split glyph: two outward-facing brackets with a center gap */
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        {/* Right bracket of left half: ] */}
                        <path d="M5 3 L7 3 L7 13 L5 13" />
                        {/* Left bracket of right half: [ */}
                        <path d="M11 3 L9 3 L9 13 L11 13" />
                      </svg>
                    }
                  />
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
                <IconButton
                  disabled={!canAdd}
                  aria-label="Add beat at playhead"
                  onClick={() => {
                    if (canAdd) addBeatAtCompositionTime(currentTime);
                  }}
                  className="enabled:hover:text-accent"
                  icon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M21 10C21 12.2091 16.9706 14 12 14M21 10C21 7.79086 16.9706 6 12 6C7.02944 6 3 7.79086 3 10M21 10V16C21 18.2091 16.9706 20 12 20M12 14C7.02944 14 3 12.2091 3 10M12 14V20M3 10V16C3 18.2091 7.02944 20 12 20M7 19.3264V13.3264M17 19.3264V13.3264M12 10L20 4"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  }
                />
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
            <IconButton
              aria-label={
                thumbnailsVisible
                  ? "Hide thumbnails — labels only"
                  : "Show thumbnails — posters stay visible; richer previews appear on interaction"
              }
              aria-pressed={thumbnailsVisible}
              onClick={() => setThumbnailMode(thumbnailsVisible ? "hidden" : "adaptive")}
              className={thumbnailsVisible ? VIEW_ON : undefined}
              icon={<Image size={16} aria-hidden="true" />}
            />
          </Tooltip>
          <Tooltip label="Fit timeline to width">
            {/* The one labelled control in the group, so it keeps the icon
                buttons' height and the toolbar's 11px type rather than the
                default md button's 12px. */}
            <Button
              variant="ghost"
              onClick={() => setZoomMode("fit")}
              className={`px-2 text-step-11 ${zoomMode === "fit" ? VIEW_ON : ""}`}
            >
              Fit
            </Button>
          </Tooltip>
          <Tooltip label="Zoom out">
            <IconButton
              aria-label="Zoom out"
              onClick={() => {
                setZoomMode("manual");
                setManualZoomPercent(
                  getNextTimelineZoomPercent("out", zoomMode, manualZoomPercent, timelineFitPps),
                );
              }}
              icon={<MagnifyingGlassMinus size={16} aria-hidden="true" />}
            />
          </Tooltip>
          {/* Zoom is a view control, not a saved value: every intermediate step
              applies, so preview and commit are the same call. */}
          <Slider
            label="Timeline zoom"
            value={timelineZoomPercentToSlider(displayedTimelineZoomPercent, timelineFitPps)}
            min={0}
            max={100}
            onPreview={applyZoomSlider}
            onCommit={applyZoomSlider}
            className="mx-1 w-24"
          />
          <Tooltip label="Zoom in">
            <IconButton
              aria-label="Zoom in"
              onClick={() => {
                setZoomMode("manual");
                setManualZoomPercent(
                  getNextTimelineZoomPercent("in", zoomMode, manualZoomPercent, timelineFitPps),
                );
              }}
              icon={<MagnifyingGlassPlus size={16} aria-hidden="true" />}
            />
          </Tooltip>
          {/* Numeric zoom readout. Always a percentage, including in fit mode:
              printing the word "Fit" next to the Fit button put two identical
              labels side by side, and the readout was the one that looked like
              a button that did nothing. */}
          <span
            className="ml-1 w-[38px] text-right font-mono text-step-11 tabular-nums text-text-4 select-none"
            aria-label="Timeline zoom level"
          >
            {displayedTimelineZoomPercent}%
          </span>
        </div>
      </div>
    </div>
  );
}
