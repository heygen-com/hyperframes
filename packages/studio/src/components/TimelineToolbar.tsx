import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Magnet, MagnifyingGlassMinus, MagnifyingGlassPlus } from "@phosphor-icons/react";
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
  timelineZoomPercentToSlider,
  timelineSliderToZoomPercent,
} from "../player/components/timelineZoom";
import { useTimelineZoom } from "../player/components/useTimelineZoom";
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
export function TimelineToolbar({ domEditSession, onSplitElement }: TimelineToolbarProps) {
  const activeTool = usePlayerStore((s) => s.activeTool);
  const setActiveTool = usePlayerStore((s) => s.setActiveTool);
  const timelineSnapEnabled = usePlayerStore((s) => s.timelineSnapEnabled);
  const setTimelineSnapEnabled = usePlayerStore((s) => s.setTimelineSnapEnabled);
  const autoKeyframeEnabled = usePlayerStore((s) => s.autoKeyframeEnabled);
  const setAutoKeyframeEnabled = usePlayerStore((s) => s.setAutoKeyframeEnabled);
  // Subscribe so the add-beat button reacts to playhead movement and analysis load.
  const currentTime = usePlayerStore((s) => s.currentTime);
  const beatAnalysisReady = usePlayerStore((s) => s.beatAnalysis !== null);
  // Subscribe (not getState) so the split button enables/disables the moment
  // the selection changes, not only on the next playhead tick.
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const elements = usePlayerStore((s) => s.elements);
  const { zoomMode, manualZoomPercent, setZoomMode, setManualZoomPercent } = useTimelineZoom();
  const { t } = useTranslation();
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

  // CapCut-flat icon buttons: no per-button border/box chrome — a transparent
  // 28px hit area with a subtle rounded hover wash, consistent 16px glyphs.
  const flatBtn = "flex h-7 w-7 items-center justify-center rounded-md transition-colors";
  const flatIdle = `${flatBtn} text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200 active:scale-[0.98]`;
  const flatActive = `${flatBtn} bg-white/[0.08] text-neutral-100 active:scale-[0.98]`;
  const flatDisabled = `${flatBtn} text-neutral-700 cursor-not-allowed`;

  return (
    // The "TIMELINE" label is dropped for CapCut-like density — the pane's
    // position (tracks right below) makes it self-evident.
    <div className="border-b border-neutral-800/60">
      <div className="flex items-center justify-between px-2 py-0.5">
        <div className="flex items-center gap-0.5">
          {STUDIO_RAZOR_TOOL_ENABLED && (
            <>
              <Tooltip label={t("timelineToolbar.selectionTool")}>
                <button
                  type="button"
                  onClick={() => setActiveTool("select")}
                  aria-label={t("timelineToolbar.selectionToolAria")}
                  aria-pressed={activeTool === "select"}
                  className={activeTool === "select" ? flatActive : flatIdle}
                >
                  <svg width="16" height="16" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M2 0.5L10 6L6.5 6.5L8.5 11L6.5 11.5L4.5 7L2 9Z" />
                  </svg>
                </button>
              </Tooltip>
              <Tooltip label={t("timelineToolbar.razorTool")}>
                <button
                  type="button"
                  onClick={() => setActiveTool("razor")}
                  aria-label={t("timelineToolbar.razorToolAria")}
                  aria-pressed={activeTool === "razor"}
                  className={activeTool === "razor" ? flatActive : flatIdle}
                >
                  <Scissors size={16} />
                </button>
              </Tooltip>
              {/* Divider: tool-mode | editing-actions */}
              <div aria-hidden="true" className="mx-1 h-4 w-px bg-neutral-800" />
            </>
          )}
          <Tooltip
            label={
              timelineSnapEnabled
                ? t("timelineToolbar.snapEnabled")
                : t("timelineToolbar.snapDisabled")
            }
          >
            <button
              type="button"
              onClick={() => setTimelineSnapEnabled(!timelineSnapEnabled)}
              aria-label={t("timelineToolbar.toggleSnappingAria")}
              aria-pressed={timelineSnapEnabled}
              className={timelineSnapEnabled ? flatActive : flatIdle}
            >
              <Magnet size={16} weight="bold" aria-hidden="true" />
            </button>
          </Tooltip>
          {STUDIO_KEYFRAMES_ENABLED && (
            // Always rendered (CapCut-style): with no keyframeable selection the
            // button fades to a disabled state instead of unmounting, so the
            // toolbar layout never shifts.
            <Tooltip
              label={
                !onToggleKeyframe
                  ? t("timelineToolbar.selectElementForKeyframes")
                  : keyframeState === "active"
                    ? t("timelineToolbar.removeKeyframeK")
                    : keyframeState === "inactive"
                      ? keyframeWillExtend
                        ? t("timelineToolbar.addKeyframeExtend")
                        : t("timelineToolbar.addKeyframeK")
                      : t("timelineToolbar.addKeyframeShortcut")
              }
            >
              <button
                type="button"
                disabled={!onToggleKeyframe}
                onClick={onToggleKeyframe}
                aria-label={
                  keyframeState === "active"
                    ? t("timelineToolbar.removeKeyframeAria")
                    : t("timelineToolbar.addKeyframeAria")
                }
                className={
                  !onToggleKeyframe
                    ? flatDisabled
                    : `${flatBtn} active:scale-[0.98] hover:bg-white/[0.06] ${
                        keyframeState === "active"
                          ? "text-studio-accent"
                          : keyframeState === "inactive"
                            ? "text-neutral-400 hover:text-studio-accent"
                            : "text-neutral-600 hover:text-neutral-400"
                      }`
                }
              >
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
              </button>
            </Tooltip>
          )}
          {STUDIO_KEYFRAMES_ENABLED && (
            <Tooltip
              label={
                autoKeyframeEnabled
                  ? t("timelineToolbar.autoRecordOn")
                  : t("timelineToolbar.autoRecordOff")
              }
            >
              <button
                type="button"
                onClick={() => setAutoKeyframeEnabled(!autoKeyframeEnabled)}
                aria-label={t("timelineToolbar.autoRecordAria")}
                aria-pressed={autoKeyframeEnabled}
                className={`${flatBtn} active:scale-[0.98] hover:bg-white/[0.06] ${
                  autoKeyframeEnabled
                    ? "text-red-400 hover:text-red-300"
                    : "text-neutral-600 hover:text-neutral-400"
                }`}
              >
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
              </button>
            </Tooltip>
          )}
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
                      ? t("timelineToolbar.splitClip")
                      : splittable
                        ? t("timelineToolbar.movePlayheadInside")
                        : t("timelineToolbar.noElementToSplit")
                  }
                >
                  <button
                    type="button"
                    disabled={!canSplit}
                    aria-label={t("timelineToolbar.splitAtPlayhead")}
                    onClick={() => {
                      if (canSplit && el) onSplitElement(el, currentTime);
                    }}
                    className={canSplit ? flatIdle : flatDisabled}
                  >
                    {/* "][" split glyph: two outward-facing brackets with a center gap */}
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
                    ? t("timelineToolbar.addMusicTrackForBeats")
                    : canAdd
                      ? t("timelineToolbar.addBeatAtPlayhead")
                      : t("timelineToolbar.beatAlreadyExists")
                }
              >
                <button
                  type="button"
                  disabled={!canAdd}
                  aria-label={t("timelineToolbar.addBeatAtPlayhead")}
                  onClick={() => {
                    if (canAdd) addBeatAtCompositionTime(currentTime);
                  }}
                  className={
                    canAdd
                      ? `${flatBtn} text-neutral-400 hover:bg-white/[0.06] hover:text-[#22c55e] active:scale-[0.98]`
                      : flatDisabled
                  }
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
        <div className="flex items-center gap-0.5">
          <Tooltip label={t("timelineToolbar.fitTimeline")}>
            <button
              type="button"
              onClick={() => setZoomMode("fit")}
              className={`h-7 px-2 rounded-md text-[11px] font-medium transition-colors ${
                zoomMode === "fit"
                  ? "bg-studio-accent/10 text-studio-accent"
                  : "text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200"
              }`}
            >
              Fit
            </button>
          </Tooltip>
          <Tooltip label={t("timelineToolbar.zoomOut")}>
            <button
              type="button"
              aria-label={t("timelineToolbar.zoomOut")}
              onClick={() => {
                setZoomMode("manual");
                setManualZoomPercent(
                  getNextTimelineZoomPercent("out", zoomMode, manualZoomPercent),
                );
              }}
              className={flatIdle}
            >
              <MagnifyingGlassMinus size={16} aria-hidden="true" />
            </button>
          </Tooltip>
          <input
            type="range"
            min="0"
            max="100"
            value={timelineZoomPercentToSlider(displayedTimelineZoomPercent)}
            title={`${displayedTimelineZoomPercent}%`}
            aria-label={t("timelineToolbar.timelineZoom")}
            onChange={(e) => {
              setZoomMode("manual");
              setManualZoomPercent(timelineSliderToZoomPercent(Number(e.target.value)));
            }}
            className="mx-1 w-[96px] cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-[2px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-neutral-700 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[10px] [&::-webkit-slider-thumb]:h-[10px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:shadow-[0_0_0_2px_#0a0a0a,0_1px_3px_rgba(0,0,0,0.5)] [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb:active]:cursor-grabbing"
          />
          <Tooltip label={t("timelineToolbar.zoomIn")}>
            <button
              type="button"
              aria-label={t("timelineToolbar.zoomIn")}
              onClick={() => {
                setZoomMode("manual");
                setManualZoomPercent(getNextTimelineZoomPercent("in", zoomMode, manualZoomPercent));
              }}
              className={flatIdle}
            >
              <MagnifyingGlassPlus size={16} aria-hidden="true" />
            </button>
          </Tooltip>
          {/* Numeric zoom readout (main-parity): "Fit" in fit mode, N% in manual. */}
          <span
            className="ml-1 w-[38px] text-right font-mono text-[11px] tabular-nums text-neutral-500 select-none"
            aria-label={t("timelineToolbar.timelineZoomLevel")}
          >
            {zoomMode === "fit" ? "Fit" : `${displayedTimelineZoomPercent}%`}
          </span>
        </div>
      </div>
    </div>
  );
}
