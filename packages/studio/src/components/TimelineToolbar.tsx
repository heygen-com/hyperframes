import { useRef } from "react";
import { useEnableKeyframes, type EnableKeyframesSession } from "../hooks/useEnableKeyframes";
import {
  getNextTimelineZoomPercent,
  getTimelineZoomPercent,
} from "../player/components/timelineZoom";
import { getTimelineToggleTitle } from "../utils/timelineDiscovery";
import { usePlayerStore, type TimelineElement } from "../player";
import { STUDIO_KEYFRAMES_ENABLED } from "./editor/manualEditingAvailability";
import { Tooltip } from "./ui";
import { Scissors } from "../icons/SystemIcons";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "./editor/domEditingTypes";

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
  if (kfAnim?.keyframes && sel) {
    const elStart = Number.parseFloat(sel.dataAttributes?.start ?? "0") || 0;
    const elDuration = Number.parseFloat(sel.dataAttributes?.duration ?? "1") || 1;
    const pct =
      elDuration > 0
        ? Math.max(0, Math.min(100, Math.round(((currentTime - elStart) / elDuration) * 1000) / 10))
        : 0;
    state = kfAnim.keyframes.keyframes.some((k) => Math.abs(k.percentage - pct) <= 1)
      ? "active"
      : "inactive";
  }

  return { state, onToggle: sel ? onToggle : undefined };
}

export function TimelineToolbar({
  toggleTimelineVisibility,
  domEditSession,
  onSplitElement,
}: TimelineToolbarProps) {
  const zoomMode = usePlayerStore((s) => s.zoomMode);
  const manualZoomPercent = usePlayerStore((s) => s.manualZoomPercent);
  const setZoomMode = usePlayerStore((s) => s.setZoomMode);
  const setManualZoomPercent = usePlayerStore((s) => s.setManualZoomPercent);
  const displayedTimelineZoomPercent = getTimelineZoomPercent(zoomMode, manualZoomPercent);
  const { state: keyframeState, onToggle: onToggleKeyframe } = useKeyframeToggle(domEditSession);

  return (
    <div className="border-b border-neutral-800/40 bg-neutral-950/96">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-500">
            Timeline
          </div>
          {STUDIO_KEYFRAMES_ENABLED && onToggleKeyframe && (
            <Tooltip
              label={
                keyframeState === "active"
                  ? "Remove keyframe at playhead"
                  : keyframeState === "inactive"
                    ? "Add keyframe at playhead"
                    : "Enable keyframes"
              }
            >
              <button
                type="button"
                onClick={onToggleKeyframe}
                className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
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
          {onSplitElement &&
            (() => {
              const { selectedElementId, elements, currentTime } = usePlayerStore.getState();
              const el = selectedElementId
                ? elements.find((e) => (e.key ?? e.id) === selectedElementId)
                : null;
              const splittable =
                el && !el.compositionSrc && ["video", "audio", "img"].includes(el.tag);
              if (!splittable) return null;
              const canSplit = currentTime > el.start && currentTime < el.start + el.duration;
              return (
                <Tooltip label="Split clip at playhead (S)">
                  <button
                    type="button"
                    disabled={!canSplit}
                    onClick={() => {
                      if (canSplit) onSplitElement(el, currentTime);
                    }}
                    className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
                      canSplit
                        ? "text-neutral-500 hover:text-neutral-200"
                        : "text-neutral-700 cursor-not-allowed"
                    }`}
                  >
                    <Scissors size={15} />
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
