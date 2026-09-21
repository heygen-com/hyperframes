import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  HF_AUDIO_FADE_IN_ATTR,
  HF_AUDIO_FADE_OUT_ATTR,
  clampFadesToDuration,
  formatFadeSeconds,
} from "@hyperframes/core/audio-fade";
import type { TimelineElement } from "../store/playerStore";
import { useTimelineEditContextOptional } from "../../contexts/TimelineEditContext";

type FadeEdge = "in" | "out";

const HANDLE_SIZE = 10;
const HANDLE_HIT = 16;
/** Pixels of pointer travel before a press on the handle counts as a drag. */
const DRAG_THRESHOLD_PX = 2;

interface TimelineClipFadesProps {
  el: TimelineElement;
  pps: number;
  widthPx: number;
  /** Handles show on hover/selection; the shaded ramps show whenever a fade is set. */
  showHandles: boolean;
}

/** Corner dots that drag `data-fade-in` / `data-fade-out`; the wedge is the faded region. */
export function TimelineClipFades({ el, pps, widthPx, showHandles }: TimelineClipFadesProps) {
  const { onSetElementAttributeLive, onSetElementAttributeQuiet } =
    useTimelineEditContextOptional();
  const canEdit = Boolean(onSetElementAttributeLive && onSetElementAttributeQuiet);

  // Draft holds the value under the pointer during a drag; it also bridges
  // the gap between release and the store re-reading the file, so the ramp
  // does not snap back for a frame.
  const [draft, setDraft] = useState<{ edge: FadeEdge; seconds: number } | null>(null);
  const [dragging, setDragging] = useState<FadeEdge | null>(null);
  const authoredIn = el.fadeIn ?? 0;
  const authoredOut = el.fadeOut ?? 0;
  useEffect(() => setDraft(null), [authoredIn, authoredOut]);

  const fades = clampFadesToDuration(
    {
      fadeIn: draft?.edge === "in" ? draft.seconds : authoredIn,
      fadeOut: draft?.edge === "out" ? draft.seconds : authoredOut,
    },
    el.duration,
  );
  const inPx = Math.min(widthPx, fades.fadeIn * pps);
  const outPx = Math.min(widthPx, fades.fadeOut * pps);

  const gesture = useRef<{
    edge: FadeEdge;
    pointerId: number;
    originClientX: number;
    originSeconds: number;
    otherSeconds: number;
    moved: boolean;
    last: number;
  } | null>(null);

  const attrFor = (edge: FadeEdge) =>
    edge === "in" ? HF_AUDIO_FADE_IN_ATTR : HF_AUDIO_FADE_OUT_ATTR;
  const attrText = (seconds: number) => (seconds > 0 ? formatFadeSeconds(seconds) : null);

  const secondsAt = (clientX: number): number => {
    const g = gesture.current;
    if (!g) return 0;
    const deltaSeconds = (clientX - g.originClientX) / Math.max(pps, 1e-6);
    // Fade-in grows to the right, fade-out grows to the left.
    const raw = g.edge === "in" ? g.originSeconds + deltaSeconds : g.originSeconds - deltaSeconds;
    const limit = Math.max(0, el.duration - g.otherSeconds);
    const clamped = Math.min(limit, Math.max(0, raw));
    return Math.round(clamped * 100) / 100;
  };

  const onHandlePointerDown = (edge: FadeEdge) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !canEdit) return;
    // Ours, not the clip's: a press here must not start a move or trim.
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      edge,
      pointerId: e.pointerId,
      originClientX: e.clientX,
      originSeconds: edge === "in" ? authoredIn : authoredOut,
      otherSeconds: edge === "in" ? authoredOut : authoredIn,
      moved: false,
      last: edge === "in" ? authoredIn : authoredOut,
    };
    setDragging(edge);
  };

  const onHandlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (!g.moved && Math.abs(e.clientX - g.originClientX) < DRAG_THRESHOLD_PX) return;
    g.moved = true;
    const seconds = secondsAt(e.clientX);
    if (seconds === g.last) return;
    g.last = seconds;
    setDraft({ edge: g.edge, seconds });
    onSetElementAttributeLive?.(el, attrFor(g.edge), attrText(seconds));
  };

  type Gesture = NonNullable<typeof gesture.current>;

  /** Ends the pointer gesture and returns it, or null when the event is not ours. */
  const endGesture = (e: PointerEvent<HTMLDivElement>): Gesture | null => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return null;
    gesture.current = null;
    setDragging(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    return g;
  };

  /** Puts the live document back where the file has it and drops the draft. */
  const revertGesture = (g: Gesture) => {
    if (g.moved) onSetElementAttributeLive?.(el, attrFor(g.edge), attrText(g.originSeconds));
    setDraft(null);
  };

  const finish = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = endGesture(e);
    if (!g) return;
    if (cancelled || !g.moved) return revertGesture(g);
    setDraft({ edge: g.edge, seconds: g.last });
    void onSetElementAttributeQuiet?.(
      el,
      attrFor(g.edge),
      attrText(g.last),
      g.edge === "in" ? "Fade in" : "Fade out",
    );
  };

  const onHandleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (e.key !== "Escape" || !g) return;
    e.preventDefault();
    gesture.current = null;
    setDragging(null);
    revertGesture(g);
  };

  const showIn = fades.fadeIn > 0;
  const showOut = fades.fadeOut > 0;
  const handlesVisible = showHandles || dragging !== null;
  if (!showIn && !showOut && !handlesVisible) return null;

  const handleStyle = (leftPx: number): CSSProperties => ({
    position: "absolute",
    top: -(HANDLE_HIT - HANDLE_SIZE) / 2 + 1,
    left: leftPx - HANDLE_HIT / 2,
    width: HANDLE_HIT,
    height: HANDLE_HIT,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "ew-resize",
    zIndex: 6,
    opacity: handlesVisible ? 1 : 0,
    pointerEvents: handlesVisible && canEdit ? "auto" : "none",
    touchAction: "none",
    outline: "none",
  });

  return (
    <>
      {(showIn || showOut) && (
        <svg
          aria-hidden="true"
          data-testid="clip-fade-ramps"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex: 5,
            overflow: "visible",
          }}
          viewBox={`0 0 ${Math.max(widthPx, 1)} 100`}
          preserveAspectRatio="none"
        >
          {/* The shaded wedge is the gain that is NOT there: above the ramp. */}
          {showIn && (
            <>
              <polygon
                data-testid="clip-fade-in"
                points={`0,0 ${inPx},0 0,100`}
                fill="var(--timeline-fade-shade)"
              />
              <line
                x1={0}
                y1={100}
                x2={inPx}
                y2={0}
                stroke="var(--clip-handle)"
                strokeOpacity={0.9}
                strokeWidth={1.25}
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
          {showOut && (
            <>
              <polygon
                data-testid="clip-fade-out"
                points={`${widthPx - outPx},0 ${widthPx},0 ${widthPx},100`}
                fill="var(--timeline-fade-shade)"
              />
              <line
                x1={widthPx - outPx}
                y1={0}
                x2={widthPx}
                y2={100}
                stroke="var(--clip-handle)"
                strokeOpacity={0.9}
                strokeWidth={1.25}
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>
      )}
      {canEdit && (
        <>
          <div
            role="slider"
            tabIndex={-1}
            aria-label="Fade in"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, el.duration - fades.fadeOut)}
            aria-valuenow={fades.fadeIn}
            aria-valuetext={`${formatFadeSeconds(fades.fadeIn)}s`}
            data-testid="clip-fade-handle-in"
            title={`Fade in: ${formatFadeSeconds(fades.fadeIn)}s — drag to change`}
            style={handleStyle(inPx)}
            onPointerDown={onHandlePointerDown("in")}
            onPointerMove={onHandlePointerMove}
            onPointerUp={(e) => finish(e, false)}
            onPointerCancel={(e) => finish(e, true)}
            onKeyDown={onHandleKeyDown}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <FadeDot active={dragging === "in"} />
          </div>
          <div
            role="slider"
            tabIndex={-1}
            aria-label="Fade out"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, el.duration - fades.fadeIn)}
            aria-valuenow={fades.fadeOut}
            aria-valuetext={`${formatFadeSeconds(fades.fadeOut)}s`}
            data-testid="clip-fade-handle-out"
            title={`Fade out: ${formatFadeSeconds(fades.fadeOut)}s — drag to change`}
            style={handleStyle(widthPx - outPx)}
            onPointerDown={onHandlePointerDown("out")}
            onPointerMove={onHandlePointerMove}
            onPointerUp={(e) => finish(e, false)}
            onPointerCancel={(e) => finish(e, true)}
            onKeyDown={onHandleKeyDown}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <FadeDot active={dragging === "out"} />
          </div>
        </>
      )}
    </>
  );
}

function FadeDot({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
        borderRadius: "50%",
        background: active ? "var(--timeline-fade-dot-active)" : "var(--clip-handle)",
        boxShadow: "0 0 0 1.5px var(--timeline-fade-dot-ring)",
        transform: active ? "scale(1.15)" : undefined,
        transition: "transform 80ms ease-out",
      }}
    />
  );
}
