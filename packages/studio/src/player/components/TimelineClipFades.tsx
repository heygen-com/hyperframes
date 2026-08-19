import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  clampClipFades,
  fadeWedgePath,
  MIN_FADE_SECONDS,
  type ClipFades,
  type FadeCurve,
} from "./clipFades";

/**
 * The fade grips on a clip's top corners, and the wedges they draw.
 *
 * The gesture is deliberately local rather than folded into the timeline's drag
 * coordinator: a fade has no lane to change, nothing to snap to and nothing to
 * collide with, so all the machinery that gesture owns would sit unused. What
 * it does need — a live preview on every move and one persisted write on
 * release — the automation binding already provides.
 */

export interface TimelineClipFadesProps {
  /** Committed fades, as read back out of the clip's own envelope. */
  fades: ClipFades;
  /** Clip length in seconds; the fades share it and cannot outrun it. */
  duration: number;
  pixelsPerSecond: number;
  width: number;
  curve: FadeCurve;
  /** Grips are hidden until the clip is worth aiming at. */
  showGrips: boolean;
  /** True when this is not the selected clip, which is what makes it editable. */
  readOnly: boolean;
  /** Double-clicking a grip steps the fade through its curve shapes. */
  onCycleCurve(): void;
  /** Live during the drag: preview only, never persisted. */
  onPreview(next: ClipFades): void;
  /** Once, on release. */
  onCommit(next: ClipFades): void;
}

/** Side of the grip square, in px. Matches the trim handle's visual weight. */
const GRIP = 9;

/**
 * Vertical units the wedge is drawn in. A clip's height is set by the row, and
 * sometimes by `bottom` rather than a number, so the overlay draws in its own
 * space and lets the SVG stretch it — the horizontal axis stays in real pixels,
 * which is the axis a fade's length is read off.
 */
const VIEW_HEIGHT = 100;

export function TimelineClipFades({
  fades,
  duration,
  pixelsPerSecond,
  width,
  curve,
  showGrips,
  readOnly,
  onPreview,
  onCommit,
  onCycleCurve,
}: TimelineClipFadesProps) {
  // While dragging, the drawn fades come from here: the committed value only
  // catches up once the write lands, and the wedge has to track the pointer.
  const [draft, setDraft] = useState<ClipFades | null>(null);
  const dragRef = useRef<{ edge: "in" | "out"; originX: number; from: ClipFades } | null>(null);
  const shown = draft ?? fades;

  const onGripDown = useCallback(
    (edge: "in" | "out", event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      // The grip sits on top of the trim handle and inside the clip body; both
      // would otherwise start their own gesture from this same press. NOT
      // preventDefault: that suppresses the compatibility click events, and the
      // double-click that cycles the curve is one of them.
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { edge, originX: event.clientX, from: fades };
    },
    [fades],
  );

  const resolveDrag = useCallback(
    (clientX: number): ClipFades | null => {
      const drag = dragRef.current;
      if (!drag || pixelsPerSecond <= 0) return null;
      // Both grips are dragged INTO the clip, so the out grip reads the
      // opposite sign — its fade grows as the pointer travels left.
      const travel = (clientX - drag.originX) / pixelsPerSecond;
      const delta = drag.edge === "in" ? travel : -travel;
      const next =
        drag.edge === "in"
          ? { ...drag.from, fadeIn: Math.max(0, drag.from.fadeIn + delta) }
          : { ...drag.from, fadeOut: Math.max(0, drag.from.fadeOut + delta) };
      return clampClipFades(next, duration);
    },
    [duration, pixelsPerSecond],
  );

  const onGripMove = useCallback(
    (event: ReactPointerEvent) => {
      const next = resolveDrag(event.clientX);
      if (!next) return;
      setDraft(next);
      onPreview(next);
    },
    [onPreview, resolveDrag],
  );

  const onGripUp = useCallback(
    (event: ReactPointerEvent) => {
      const next = resolveDrag(event.clientX);
      const from = dragRef.current?.from;
      dragRef.current = null;
      setDraft(null);
      // A press that moved nothing — the first half of a double-click, or a
      // mis-aimed click — must not write the same fade back to the file.
      if (next && from && (next.fadeIn !== from.fadeIn || next.fadeOut !== from.fadeOut)) {
        onCommit(next);
      }
    },
    [onCommit, resolveDrag],
  );

  const gripFor = (edge: "in" | "out") => {
    const seconds = edge === "in" ? shown.fadeIn : shown.fadeOut;
    const span = Math.min(seconds * pixelsPerSecond, width);
    // Parked on the corner when there is no fade, which is where you grab to
    // start one; otherwise it rides the top of the wedge it drew.
    const x = edge === "in" ? span : width - span;
    return (
      <div
        key={edge}
        role="slider"
        tabIndex={-1}
        aria-label={edge === "in" ? "Fade in" : "Fade out"}
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={seconds}
        aria-valuetext={seconds >= MIN_FADE_SECONDS ? `${seconds.toFixed(2)} seconds` : "No fade"}
        data-clip-fade-grip={edge}
        onPointerDown={(event) => onGripDown(edge, event)}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={onGripUp}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (seconds > 0) onCycleCurve();
        }}
        title={`Fade ${edge}: drag to set its length, double-click to change its ${curve} curve`}
        style={{
          position: "absolute",
          left: x - GRIP / 2,
          top: 1,
          width: GRIP,
          height: GRIP,
          borderRadius: 2,
          background: "rgba(255,255,255,0.9)",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
          cursor: "ew-resize",
          zIndex: 6,
        }}
      />
    );
  };

  return (
    <>
      <svg
        aria-hidden="true"
        width="100%"
        height="100%"
        viewBox={`0 0 ${Math.max(width, 1)} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3 }}
      >
        {(["in", "out"] as const).map((edge) => {
          const seconds = edge === "in" ? shown.fadeIn : shown.fadeOut;
          if (seconds <= 0) return null;
          return (
            <path
              key={edge}
              d={fadeWedgePath({
                edge,
                seconds,
                curve,
                pixelsPerSecond,
                width,
                height: VIEW_HEIGHT,
              })}
              fill="rgba(0,0,0,0.45)"
              stroke="rgba(255,255,255,0.75)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      {showGrips && !readOnly && (["in", "out"] as const).map(gripFor)}
    </>
  );
}
