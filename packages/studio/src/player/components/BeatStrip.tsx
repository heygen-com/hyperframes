import { memo, useSyncExternalStore } from "react";
import { moveBeatCompositionTime, deleteBeatAtCompositionTime } from "../../utils/beatEditActions";
import { usePlayerStore } from "../store/playerStore";
import { CLIP_Y, getTimelineBeatEntries } from "./timelineLayout";
import type { TimelineTimeRange } from "../lib/timelineClipIndex";
import {
  applyTimelineAutoScrollStep,
  resolveTimelineAutoScrollLoopAction,
} from "./timelineEditing";
import { getTimelineElementIndexes } from "../lib/timelineElementIndexes";

export const BEAT_BAND_H = 14; // dark band height at top of track
const BEAT_HIT_W = 12; // grab width per beat (px)

interface BeatDragActor {
  readonly pointerId: number;
  readonly index: number;
  readonly startX: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly originalTime: number;
  readonly pixelsPerSecond: number;
  readonly startScrollLeft: number;
  readonly dx: number;
  readonly started: boolean;
  readonly sessionEpoch: number;
  readonly projectId: string | null;
  readonly musicElement: NonNullable<ReturnType<typeof getTimelineElementIndexes>["musicElement"]>;
  readonly musicKey: string;
  readonly musicSrc: string;
  readonly scroll: HTMLElement;
}

let beatDragActor: BeatDragActor | null = null;
let beatDragRaf = 0;
let unsubscribeBeatDragSession: (() => void) | null = null;
const beatDragSubscribers = new Set<() => void>();

function publishBeatDrag(next: BeatDragActor | null): void {
  beatDragActor = next;
  for (const subscriber of beatDragSubscribers) subscriber();
}

function subscribeBeatDrag(subscriber: () => void): () => void {
  beatDragSubscribers.add(subscriber);
  return () => beatDragSubscribers.delete(subscriber);
}

function getBeatDragSnapshot(): BeatDragActor | null {
  return beatDragActor;
}

function releaseBeatDragResources(actor: BeatDragActor): void {
  if (beatDragRaf !== 0) {
    cancelAnimationFrame(beatDragRaf);
    beatDragRaf = 0;
  }
  unsubscribeBeatDragSession?.();
  unsubscribeBeatDragSession = null;
  window.removeEventListener("pointermove", handleBeatDragPointerMove);
  window.removeEventListener("pointerup", handleBeatDragPointerUp);
  window.removeEventListener("pointercancel", handleBeatDragPointerCancel);
  window.removeEventListener("lostpointercapture", handleBeatDragPointerCancel);
  window.removeEventListener("keydown", handleBeatDragKeyDown, true);
  window.removeEventListener("blur", cancelBeatDrag);
  try {
    if (actor.scroll.hasPointerCapture?.(actor.pointerId)) {
      actor.scroll.releasePointerCapture(actor.pointerId);
    }
  } catch {
    // Window listeners retain terminal ownership when pointer capture is unavailable.
  }
  usePlayerStore.getState().setBeatDragging(false);
}

/** Claiming clears the shared actor before cleanup, so later terminal events are no-ops. */
function claimBeatDrag(pointerId?: number): BeatDragActor | null {
  const actor = beatDragActor;
  if (!actor || (pointerId !== undefined && actor.pointerId !== pointerId)) return null;
  publishBeatDrag(null);
  releaseBeatDragResources(actor);
  return actor;
}

function cancelBeatDrag(): void {
  claimBeatDrag();
}

function beatDragTime(actor: BeatDragActor): number {
  return Math.max(0, actor.originalTime + actor.dx / actor.pixelsPerSecond);
}

function updateBeatDrag(clientX: number, clientY: number): BeatDragActor | null {
  const actor = beatDragActor;
  if (!actor) return null;
  const pointerDx = clientX - actor.startX;
  const next = {
    ...actor,
    clientX,
    clientY,
    dx: pointerDx + actor.scroll.scrollLeft - actor.startScrollLeft,
    started: actor.started || Math.abs(pointerDx) > 2,
  };
  publishBeatDrag(next);
  usePlayerStore.getState().requestSeek(beatDragTime(next));
  return next;
}

function stepBeatDragAutoScroll(): void {
  beatDragRaf = 0;
  const actor = beatDragActor;
  if (!actor?.started) return;
  if (!applyTimelineAutoScrollStep(actor.scroll, actor.clientX, actor.clientY)) return;
  updateBeatDrag(actor.clientX, actor.clientY);
  beatDragRaf = requestAnimationFrame(stepBeatDragAutoScroll);
}

function syncBeatDragAutoScroll(actor: BeatDragActor): void {
  const action = resolveTimelineAutoScrollLoopAction(
    actor.scroll,
    actor.clientX,
    actor.clientY,
    beatDragRaf !== 0,
  );
  if (action === "start" && actor.started) {
    beatDragRaf = requestAnimationFrame(stepBeatDragAutoScroll);
  } else if (action === "stop" && beatDragRaf !== 0) {
    cancelAnimationFrame(beatDragRaf);
    beatDragRaf = 0;
  }
}

function handleBeatDragPointerMove(event: PointerEvent): void {
  if (event.pointerId !== beatDragActor?.pointerId) return;
  event.preventDefault();
  const actor = updateBeatDrag(event.clientX, event.clientY);
  if (actor) syncBeatDragAutoScroll(actor);
}

function handleBeatDragPointerUp(event: PointerEvent): void {
  if (event.pointerId !== beatDragActor?.pointerId) return;
  const latest = updateBeatDrag(event.clientX, event.clientY);
  const actor = claimBeatDrag(event.pointerId);
  if (!actor || !latest?.started) return;
  const store = usePlayerStore.getState();
  if (
    store.timelineSessionEpoch !== actor.sessionEpoch ||
    store.timelineProjectId !== actor.projectId
  ) {
    return;
  }
  const newTime = beatDragTime(latest);
  moveBeatCompositionTime(actor.originalTime, newTime);
  store.requestSeek(newTime);
}

function handleBeatDragPointerCancel(event: PointerEvent): void {
  claimBeatDrag(event.pointerId);
}

function handleBeatDragKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !beatDragActor) return;
  event.preventDefault();
  event.stopPropagation();
  cancelBeatDrag();
}

function beginBeatDrag(
  event: React.PointerEvent<HTMLDivElement>,
  index: number,
  originalTime: number,
  pixelsPerSecond: number,
): void {
  if (event.button !== 0 || !(pixelsPerSecond > 0)) return;
  const scroll = event.currentTarget.closest<HTMLElement>("[data-timeline-scroll-viewport]");
  if (!scroll) return;
  cancelBeatDrag();
  const store = usePlayerStore.getState();
  const musicElement = getTimelineElementIndexes(store.elements).musicElement;
  if (!musicElement?.src) return;
  const actor: BeatDragActor = {
    pointerId: event.pointerId,
    index,
    startX: event.clientX,
    clientX: event.clientX,
    clientY: event.clientY,
    originalTime,
    pixelsPerSecond,
    startScrollLeft: scroll.scrollLeft,
    dx: 0,
    started: false,
    sessionEpoch: store.timelineSessionEpoch,
    projectId: store.timelineProjectId,
    musicElement,
    musicKey: musicElement.key ?? musicElement.id,
    musicSrc: musicElement.src,
    scroll,
  };
  publishBeatDrag(actor);
  window.addEventListener("pointermove", handleBeatDragPointerMove);
  window.addEventListener("pointerup", handleBeatDragPointerUp);
  window.addEventListener("pointercancel", handleBeatDragPointerCancel);
  window.addEventListener("lostpointercapture", handleBeatDragPointerCancel);
  window.addEventListener("keydown", handleBeatDragKeyDown, true);
  window.addEventListener("blur", cancelBeatDrag);
  unsubscribeBeatDragSession = usePlayerStore.subscribe((state) => {
    const currentMusic = getTimelineElementIndexes(state.elements).musicElement;
    if (
      state.timelineSessionEpoch !== actor.sessionEpoch ||
      state.timelineProjectId !== actor.projectId ||
      currentMusic !== actor.musicElement ||
      (currentMusic.key ?? currentMusic.id) !== actor.musicKey ||
      currentMusic.src !== actor.musicSrc
    ) {
      cancelBeatDrag();
    }
  });
  try {
    scroll.setPointerCapture?.(event.pointerId);
  } catch {
    // Window listeners retain terminal ownership when pointer capture is unavailable.
  }
  store.setBeatDragging(true);
  store.requestSeek(Math.max(0, originalTime));
}

/** Hide both layers when beats are packed tighter than this (px) — too dense to read. */
function beatsTooDense(beatTimes: number[], pps: number): boolean {
  if (beatTimes.length < 2) return true;
  const avgInterval = (beatTimes[beatTimes.length - 1]! - beatTimes[0]!) / (beatTimes.length - 1);
  return avgInterval * pps < 5;
}

/**
 * Faint full-height beat lines painted into a track lane's background. Rendered
 * behind the clips so they only show through the empty track area (the dots in
 * BeatStrip mark beats on the clips themselves). Brightness scales with beat
 * loudness. Drawn on every track lane for a global beat grid.
 */
export const BeatBackgroundLines = memo(function BeatBackgroundLines({
  beatTimes,
  beatStrengths,
  pps,
  highlightTime,
  renderTimeRange,
}: {
  beatTimes: number[] | undefined;
  beatStrengths: number[] | undefined;
  pps: number;
  /** Snap guide time — drawn as a bright line even when it is not a beat. */
  highlightTime?: number | null;
  renderTimeRange?: TimelineTimeRange;
}) {
  const visibleBeatTimes = beatTimes && !beatsTooDense(beatTimes, pps) ? beatTimes : null;
  const highlightIsBeat =
    highlightTime != null &&
    visibleBeatTimes?.some((t) => Math.abs(t - highlightTime) < 1e-3) === true;
  if (!visibleBeatTimes && highlightTime == null) return null;
  const beatEntries = getTimelineBeatEntries(
    visibleBeatTimes ?? undefined,
    beatStrengths,
    renderTimeRange,
  );
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
      {beatEntries.map(({ time: t, index: i, strength: beatStrength }) => {
        const isHighlight = highlightTime != null && Math.abs(t - highlightTime) < 1e-3;
        const strength = Math.pow(Math.min(1, beatStrength ?? 0.5), 2.2);
        const opacity = isHighlight ? 1 : 0.06 + strength * 0.16;
        return (
          <div
            key={`${t}-${i}`}
            className="absolute top-0 bottom-0"
            style={{
              left: t * pps,
              width: isHighlight ? 2 : 1,
              background: `rgba(34,197,94,${opacity.toFixed(3)})`,
              boxShadow: isHighlight ? "0 0 6px rgba(34,197,94,0.9)" : undefined,
              zIndex: isHighlight ? 1 : undefined,
            }}
          />
        );
      })}
      {highlightTime != null && !highlightIsBeat && (
        <div
          className="absolute top-0 bottom-0"
          style={{
            left: highlightTime * pps,
            width: 2,
            background: "rgba(34,197,94,1)",
            boxShadow: "0 0 6px rgba(34,197,94,0.9)",
            zIndex: 1,
          }}
        />
      )}
    </div>
  );
});

/**
 * Green beat dots on the music track's row. Drag a dot to move its beat,
 * double-click to delete; both scrub the audio. Dot size/brightness scale with
 * beat loudness (gamma-curved for contrast).
 */
export const BeatStrip = memo(function BeatStrip({
  beatTimes,
  beatStrengths,
  pps,
  renderTimeRange,
}: {
  beatTimes: number[] | undefined;
  beatStrengths: number[] | undefined;
  pps: number;
  renderTimeRange?: TimelineTimeRange;
}) {
  const activeActor = useSyncExternalStore(
    subscribeBeatDrag,
    getBeatDragSnapshot,
    getBeatDragSnapshot,
  );
  const sessionEpoch = usePlayerStore((state) => state.timelineSessionEpoch);
  const projectId = usePlayerStore((state) => state.timelineProjectId);

  if (!beatTimes || beatsTooDense(beatTimes, pps)) return null;
  const drag =
    activeActor &&
    activeActor.sessionEpoch === sessionEpoch &&
    activeActor.projectId === projectId &&
    Math.abs((beatTimes[activeActor.index] ?? Number.NaN) - activeActor.originalTime) < 1e-3
      ? activeActor
      : null;
  const cy = BEAT_BAND_H / 2;
  const beatEntries = getTimelineBeatEntries(
    beatTimes,
    beatStrengths,
    renderTimeRange,
    drag ? new Set([drag.index]) : undefined,
  );

  return (
    <div
      className="absolute left-0 right-0 pointer-events-none"
      style={{ top: CLIP_Y, height: BEAT_BAND_H, background: "rgba(0,0,0,0.28)", zIndex: 11 }}
    >
      {beatEntries.map(({ time: t, index: i, strength: beatStrength }) => {
        // Louder beats → larger, brighter dot. Gamma curve widens the contrast.
        const strength = Math.pow(Math.min(1, beatStrength ?? 0.5), 2.2);
        const r = 1.5 + strength * 2.5;
        const opacity = 0.25 + strength * 0.75;
        const dxPx = drag?.index === i ? drag.dx : 0;
        const x = t * pps + dxPx;
        return (
          <div
            key={`${t}-${i}`}
            className="absolute select-none"
            title="Drag to move · double-click to delete"
            draggable={false}
            style={{
              left: x - BEAT_HIT_W / 2,
              top: 0,
              width: BEAT_HIT_W,
              height: BEAT_BAND_H,
              cursor: "ew-resize",
              pointerEvents: "auto",
              touchAction: "none",
            }}
            onPointerDown={(e) => {
              // preventDefault stops the browser starting a native text/drag
              // selection (which otherwise "selects" the whole panel mid-drag).
              e.preventDefault();
              e.stopPropagation();
              beginBeatDrag(e, i, t, pps);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              deleteBeatAtCompositionTime(t);
              usePlayerStore.getState().requestSeek(Math.max(0, t)); // park scrubber at deleted beat
            }}
          >
            <div
              className="absolute"
              style={{
                left: BEAT_HIT_W / 2 - r,
                top: cy - r,
                width: r * 2,
                height: r * 2,
                borderRadius: "50%",
                background: `rgba(34,197,94,${opacity.toFixed(3)})`,
                pointerEvents: "none",
              }}
            />
          </div>
        );
      })}
    </div>
  );
});
