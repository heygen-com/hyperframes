import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  clampClipFades,
  fadeSampler,
  fadeWedgePath,
  MIN_FADE_SECONDS,
  type ClipFades,
  type FadeSampler,
} from "./clipFades";
import { bendFromPointer, bendHandlePosition } from "./clipFadeBendDrag";
import { FADE_CURVE_LIMIT } from "@hyperframes/core/clip-fade";

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
  /** How far the fade is bent; 0 is a straight ramp. */
  curve: number;
  /** How the level rises across the fade, read back from where it is kept. */
  sample: FadeSampler;
  /**
   * The clip's accent. The same colour, weight and opacity the automation lane
   * strokes an envelope with — a fade IS an envelope, and drawing the two alike
   * is what makes the wedge on the clip and the curve in the expanded lane read
   * as one line rather than two unrelated marks.
   */
  accent: string;
  /** Grips are hidden until the clip is worth aiming at. */
  showGrips: boolean;
  /** True when this is not the selected clip, which is what makes it editable. */
  readOnly: boolean;
  /** Dragging the fade line bends it. Live while dragging, once on release. */
  onBend(curve: number, persist: boolean): void;
  /** Live during the drag: preview only, never persisted. */
  onPreview(next: ClipFades): void;
  /** Once, on release. */
  onCommit(next: ClipFades): void;
}

/** Side of the grip square, in px. Matches the trim handle's visual weight. */
const GRIP = 9;

/** Diameter of the bend handle. Smaller than a grip: it is a finer adjustment,
 *  and it sits on the line rather than on a corner you throw the pointer at. */
const BEND = 7;

/** What the bend reads as, for a title and for a screen reader. */
function bendLabel(curve: number): string {
  if (Math.abs(curve) < 0.02) return "Straight";
  return curve < 0 ? "Starts slow, finishes fast" : "Starts fast, finishes slow";
}

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
  sample,
  accent,
  showGrips,
  readOnly,
  onPreview,
  onCommit,
  onBend,
}: TimelineClipFadesProps) {
  // While dragging, the drawn fades come from here: the committed value only
  // catches up once the write lands, and the wedge has to track the pointer.
  const [draft, setDraft] = useState<ClipFades | null>(null);
  const [bendDraft, setBendDraft] = useState<number | null>(null);
  const dragRef = useRef<{ edge: "in" | "out"; originX: number; from: ClipFades } | null>(null);
  const bendRef = useRef<{ top: number; height: number } | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const shown = draft ?? fades;
  // The bend is previewed the same way the lengths are: the committed value
  // only catches up once the write lands, and the line has to stay under the
  // pointer until then.
  const shownCurve = bendDraft ?? curve;
  const shownSample = bendDraft === null ? sample : fadeSampler(bendDraft);

  const onGripDown = useCallback(
    (edge: "in" | "out", event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      // The grip sits on top of the trim handle and inside the clip body; both
      // would otherwise start their own gesture from this same press.
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
      // A press that moved nothing must not write the same fade back to the
      // file: a mis-aimed click is not an edit.
      if (next && from && (next.fadeIn !== from.fadeIn || next.fadeOut !== from.fadeOut)) {
        onCommit(next);
      }
    },
    [onCommit, resolveDrag],
  );

  /**
   * The bend drag. It measures the clip's own pixel box on the way down rather
   * than taking a height prop, because a clip row is sometimes sized by
   * `bottom` and so has no number to pass down.
   */
  const onBendDown = useCallback((event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const host = hostRef.current;
    if (!host) return;
    const box = host.getBoundingClientRect();
    if (!(box.height > 0)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    bendRef.current = { top: box.top, height: box.height };
  }, []);

  const resolveBend = useCallback((clientY: number): number | null => {
    const drag = bendRef.current;
    return drag ? bendFromPointer(clientY - drag.top, drag.height) : null;
  }, []);

  const onBendMove = useCallback(
    (event: ReactPointerEvent) => {
      const next = resolveBend(event.clientY);
      if (next === null) return;
      setBendDraft(next);
      onBend(next, false);
    },
    [onBend, resolveBend],
  );

  const onBendUp = useCallback(
    (event: ReactPointerEvent) => {
      const next = resolveBend(event.clientY);
      bendRef.current = null;
      setBendDraft(null);
      if (next !== null && next !== curve) onBend(next, true);
    },
    [curve, onBend, resolveBend],
  );

  /**
   * The handle that bends a fade, sitting on the curve's own midpoint so it
   * stays under the pointer as the shape changes. Only present once there is a
   * fade to bend: with none there is no line to pull, and the corner grips are
   * what start one.
   */
  const bendFor = (edge: "in" | "out") => {
    const seconds = edge === "in" ? shown.fadeIn : shown.fadeOut;
    if (seconds < MIN_FADE_SECONDS) return null;
    const at = bendHandlePosition({
      edge,
      seconds,
      pixelsPerSecond,
      width,
      height: hostRef.current?.getBoundingClientRect().height ?? 0,
      level: shownSample(0.5),
    });
    if (!at) return null;
    const label = bendLabel(shownCurve);
    return (
      <div
        key={`bend-${edge}`}
        role="slider"
        tabIndex={-1}
        aria-label={edge === "in" ? "Fade in curve" : "Fade out curve"}
        aria-valuemin={-FADE_CURVE_LIMIT}
        aria-valuemax={FADE_CURVE_LIMIT}
        aria-valuenow={shownCurve}
        aria-valuetext={label}
        data-clip-fade-bend={edge}
        onPointerDown={onBendDown}
        onPointerMove={onBendMove}
        onPointerUp={onBendUp}
        onPointerCancel={onBendUp}
        title={`Drag up or down to bend this fade. ${label}`}
        style={{
          position: "absolute",
          left: at.x - BEND / 2,
          top: at.y - BEND / 2,
          width: BEND,
          height: BEND,
          borderRadius: "50%",
          background: accent,
          boxShadow: "0 0 0 1.5px rgba(0,0,0,0.55)",
          cursor: "ns-resize",
          pointerEvents: "auto",
          zIndex: 6,
        }}
      />
    );
  };

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
        title={`Fade ${edge}: drag to set its length. Drag the dot on the line to bend it.`}
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
          pointerEvents: "auto",
          zIndex: 6,
        }}
      />
    );
  };

  return (
    // One positioned box owns the overlay so the bend handle has a parent whose
    // height it can measure, and so both handles share the clip's coordinates.
    <div ref={hostRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
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
          const { line, fill } = fadeWedgePath({
            edge,
            seconds,
            sample: shownSample,
            pixelsPerSecond,
            width,
            height: VIEW_HEIGHT,
          });
          // Two paths, not one: stroking the closed wedge would outline the
          // fill's straight top and side as well, which reads as a rectangle
          // butted onto the curve instead of one continuous level line.
          return (
            <g key={edge}>
              <path d={fill} fill="rgba(0,0,0,0.45)" stroke="none" />
              <path
                d={line}
                fill="none"
                stroke={accent}
                strokeWidth={1.5}
                strokeOpacity={0.95}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
      </svg>
      {showGrips && !readOnly && (["in", "out"] as const).map(gripFor)}
      {showGrips && !readOnly && (["in", "out"] as const).map(bendFor)}
    </div>
  );
}
