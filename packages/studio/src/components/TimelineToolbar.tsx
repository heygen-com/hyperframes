import { useRef } from "react";
import {
  useEnableKeyframes,
  isPlayheadWithinTween,
  type EnableKeyframesSession,
} from "../hooks/useEnableKeyframes";
import { computeElementPercentage } from "../hooks/gsapShared";
import { useKeyframeKeyboard } from "../hooks/useKeyframeKeyboard";
import {
  getNextTimelineZoomPercent,
  getTimelineZoomPercent,
} from "../player/components/timelineZoom";
import { useTimelineZoom } from "../player/components/useTimelineZoom";
import { getTimelineToggleTitle } from "../utils/timelineDiscovery";
import { usePlayerStore, type TimelineElement } from "../player";
import {
  STUDIO_KEYFRAMES_ENABLED,
  STUDIO_RAZOR_TOOL_ENABLED,
} from "./editor/manualEditingAvailability";
import { Tooltip } from "./ui";
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
  toggleTimelineVisibility: () => void;
  domEditSession?: DomEditSessionSlice;
  onSplitElement?: (element: TimelineElement, splitTime: number) => void;
}

function useKeyframeToggle(session?: DomEditSessionSlice) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const onToggle = useEnableKeyframes(
    sessionRef as React.RefObject<EnableKeyframesSession | undefined>,
  );

  if (!session) return { state: "none" as const, onToggle: undefined };

  const sel = session.domEditSelection;
  const anims = session.selectedGsapAnimations;
  const kfAnim = anims.find((a) => a.keyframes);

  let state: "active" | "inactive" | "none" = "none";
  // Outside the tween, clicking extends the animation to the playhead rather than
  // toggling a (clamped) edge keyframe — so the button stays an "add" affordance.
  let willExtend = false;
  if (kfAnim?.keyframes && sel) {
    if (!isPlayheadWithinTween(kfAnim, currentTime)) {
      state = "inactive";
      willExtend = true;
    } else {
      // Tween-relative percentage (not the clip range) so the button state matches
      // where the keyframe would actually land.
      const pct = computeElementPercentage(currentTime, sel, kfAnim);
      state = kfAnim.keyframes.keyframes.some((k) => Math.abs(k.percentage - pct) <= 1)
        ? "active"
        : "inactive";
    }
  }

  return { state, willExtend, onToggle: sel ? onToggle : undefined };
}

// fallow-ignore-next-line complexity
export function TimelineToolbar({
  toggleTimelineVisibility,
  domEditSession,
  onSplitElement,
}: TimelineToolbarProps) {
  const activeTool = usePlayerStore((s) => s.activeTool);
  const setActiveTool = usePlayerStore((s) => s.setActiveTool);
  const autoKeyframeEnabled = usePlayerStore((s) => s.autoKeyframeEnabled);
  const setAutoKeyframeEnabled = usePlayerStore((s) => s.setAutoKeyframeEnabled);
  // Subscribe so the add-beat button reacts to playhead movement and analysis load.
  const currentTime = usePlayerStore((s) => s.currentTime);
  const beatAnalysisReady = usePlayerStore((s) => s.beatAnalysis !== null);
  const { zoomMode, manualZoomPercent, setZoomMode, setManualZoomPercent } = useTimelineZoom();
  const displayedTimelineZoomPercent = getTimelineZoomPercent(zoomMode, manualZoomPercent);
  const {
    state: keyframeState,
    willExtend: keyframeWillExtend,
    onToggle: onToggleKeyframe,
  } = useKeyframeToggle(domEditSession);

  // Wire the "Add keyframe (K)" shortcut the toolbar advertises. Active only when
  // there's a keyframeable selection; otherwise K stays JKL-pause in playback.
  useKeyframeKeyboard({
    enabled: STUDIO_KEYFRAMES_ENABLED && Boolean(onToggleKeyframe),
    onAddKeyframe: onToggleKeyframe,
  });

  return (
    <div className="border-b border-neutral-800/40 bg-neutral-950/96">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-500">
            Timeline
          </div>
          {STUDIO_RAZOR_TOOL_ENABLED && (
            <div className="flex items-center border border-neutral-800 rounded overflow-hidden">
              <Tooltip label="Selection tool (V)">
                <button
                  type="button"
                  onClick={() => setActiveTool("select")}
                  aria-label="Selection tool"
                  aria-pressed={activeTool === "select"}
                  className={`flex h-6 w-6 items-center justify-center transition-colors active:scale-[0.98] ${
                    activeTool === "select"
                      ? "bg-neutral-700 text-neutral-200"
                      : "text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M2 0.5L10 6L6.5 6.5L8.5 11L6.5 11.5L4.5 7L2 9Z" />
                  </svg>
                </button>
              </Tooltip>
              <Tooltip label="Razor tool (B) — Shift+click splits all tracks">
                <button
                  type="button"
                  onClick={() => setActiveTool("razor")}
                  aria-label="Razor tool"
                  aria-pressed={activeTool === "razor"}
                  className={`flex h-6 w-6 items-center justify-center transition-colors active:scale-[0.98] ${
                    activeTool === "razor"
                      ? "bg-neutral-700 text-neutral-200"
                      : "text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  <Scissors size={11} />
                </button>
              </Tooltip>
            </div>
          )}
          {STUDIO_KEYFRAMES_ENABLED && onToggleKeyframe && (
            <Tooltip
              label={
                keyframeState === "active"
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
                onClick={onToggleKeyframe}
                aria-label={
                  keyframeState === "active"
                    ? "Remove keyframe at playhead"
                    : "Add keyframe at playhead"
                }
                className={`flex h-7 w-7 items-center justify-center rounded transition-colors active:scale-[0.98] ${
                  keyframeState === "active"
                    ? "text-studio-accent"
                    : keyframeState === "inactive"
                      ? "text-neutral-400 hover:text-studio-accent"
                      : "text-neutral-600 hover:text-neutral-400"
                }`}
              >
                <svg width="18" height="18" viewBox="0 0 10 10" fill="currentColor">
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
              </button>
            </Tooltip>
          )}
          {STUDIO_KEYFRAMES_ENABLED && (
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
                className={`flex h-7 w-7 items-center justify-center rounded transition-colors active:scale-[0.98] ${
                  autoKeyframeEnabled
                    ? "text-red-400 hover:text-red-300"
                    : "text-neutral-600 hover:text-neutral-400"
                }`}
              >
                <svg width="18" height="18" viewBox="0 0 10 10" fill="none">
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
              </button>
            </Tooltip>
          )}
          {onSplitElement &&
            (() => {
              // Render the button unconditionally (disabled when unusable):
              // mounting/unmounting mid-task shifts the neighboring controls.
              const { selectedElementId, elements, currentTime } = usePlayerStore.getState();
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
                      ? "Split clip at playhead (S)"
                      : splittable
                        ? "Move the playhead inside the clip to split"
                        : "Select a clip to split"
                  }
                >
                  <button
                    type="button"
                    disabled={!canSplit}
                    aria-label="Split clip at playhead"
                    onClick={() => {
                      if (canSplit && el) onSplitElement(el, currentTime);
                    }}
                    className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
                      canSplit
                        ? "text-neutral-500 hover:text-neutral-200 active:scale-[0.98]"
                        : "text-neutral-700 cursor-not-allowed"
                    }`}
                  >
                    <Scissors size={15} />
                  </button>
                </Tooltip>
              );
            })()}
          {beatAnalysisReady &&
            (() => {
              const canAdd = canAddBeatAt(currentTime);
              return (
                <Tooltip
                  label={canAdd ? "Add beat at playhead" : "A beat already exists at the playhead"}
                >
                  <button
                    type="button"
                    disabled={!canAdd}
                    aria-label="Add beat at playhead"
                    onClick={() => {
                      if (canAdd) addBeatAtCompositionTime(currentTime);
                    }}
                    className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
                      canAdd
                        ? "text-neutral-500 hover:text-[#22c55e] active:scale-[0.98]"
                        : "text-neutral-700 cursor-not-allowed"
                    }`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M21 10C21 12.2091 16.9706 14 12 14M21 10C21 7.79086 16.9706 6 12 6C7.02944 6 3 7.79086 3 10M21 10V16C21 18.2091 16.9706 20 12 20M12 14C7.02944 14 3 12.2091 3 10M12 14V20M3 10V16C3 18.2091 7.02944 20 12 20M7 19.3264V13.3264M17 19.3264V13.3264M12 10L20 4"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </Tooltip>
              );
            })()}
        </div>
        <div className="flex items-center gap-1">
          <Tooltip label="Fit timeline to width">
            <button
              type="button"
              onClick={() => setZoomMode("fit")}
              className={`h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors ${
                zoomMode === "fit"
                  ? "border-studio-accent/30 bg-studio-accent/10 text-studio-accent"
                  : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
              }`}
            >
              Fit
            </button>
          </Tooltip>
          <Tooltip label="Zoom out">
            <button
              type="button"
              onClick={() => {
                setZoomMode("manual");
                setManualZoomPercent(
                  getNextTimelineZoomPercent("out", zoomMode, manualZoomPercent),
                );
              }}
              className="h-7 w-7 rounded-md border border-neutral-800 text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-200"
            >
              -
            </button>
          </Tooltip>
          <div className="min-w-[58px] text-center text-[10px] font-medium tabular-nums text-neutral-500">
            {`${displayedTimelineZoomPercent}%`}
          </div>
          <Tooltip label="Zoom in">
            <button
              type="button"
              onClick={() => {
                setZoomMode("manual");
                setManualZoomPercent(getNextTimelineZoomPercent("in", zoomMode, manualZoomPercent));
              }}
              className="h-7 w-7 rounded-md border border-neutral-800 text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-200"
            >
              +
            </button>
          </Tooltip>
          <Tooltip label={getTimelineToggleTitle(true)}>
            <button
              type="button"
              onClick={toggleTimelineVisibility}
              className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-200"
              aria-label="Hide timeline editor"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 7h14" />
                <path d="m8 11 4 4 4-4" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
