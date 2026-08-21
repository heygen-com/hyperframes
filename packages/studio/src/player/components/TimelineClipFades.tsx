import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  clampClipFades,
  envelopeFadeSampler,
  fadeWedgePath,
  MIN_FADE_SECONDS,
  type ClipFadeCurves,
  type ClipFades,
} from "./clipFades";
import {
  bendFromPointer,
  fadeHandlePosition,
  lengthFromPointer,
  resolveDragAxis,
  type FadeDragAxis,
} from "./clipFadeBendDrag";
import { FadeDiamond } from "./FadeDiamond";
import { CLIP_HANDLE_W } from "./timelineLayout";

/**
 * The fade handles on a clip's top corners, and the wedges they draw.
 *
 * The gesture is deliberately local rather than folded into the timeline's drag
 * coordinator: a fade has no lane to change, nothing to snap to and nothing to
 * collide with, so all the machinery that gesture owns would sit unused. What
 * it does need, a live preview on every move and one persisted write on
 * release, the automation binding already provides.
 */

export interface TimelineClipFadesProps {
  /** Committed fades, as read back out of the clip's own envelope. */
  fades: ClipFades;
  /** Clip length in seconds; the fades share it and cannot outrun it. */
  duration: number;
  pixelsPerSecond: number;
  width: number;
  /** How far each ramp is bent; 0 is a straight one. */
  curves: ClipFadeCurves;
  /** The curve an in-progress fade gesture will draw. */
  curvesFor(next: ClipFades): ClipFadeCurves;
  /**
   * The clip's accent. The same colour, weight and opacity the automation lane
   * strokes an envelope with: a fade IS an envelope, and drawing the two alike
   * is what makes the wedge on the clip and the curve in the expanded lane read
   * as one line rather than two unrelated marks.
   */
  accent: string;
  /** Handles are hidden until the clip is worth aiming at. */
  showGrips: boolean;
  /** True when this is not the selected clip, which is what makes it editable. */
  readOnly: boolean;
  /** Dragging a handle up or down bends that fade. Live, then once on release. */
  onBend(edge: "in" | "out", curve: number, persist: boolean): void;
  /** Live during the drag: preview only, never persisted. */
  onPreview(next: ClipFades): void;
  /** Once, on release. */
  onCommit(next: ClipFades): void;
}

/**
 * One handle per fade, not two.
 *
 * A fade has two properties and they used to have a control each, which put
 * four handles on a clip that is often eighty pixels wide, sitting on top of
 * the thumbnails and the label and the trim handles. The diamond collapses each
 * pair: it lives on the curve's midpoint, so sideways is the length and up and
 * down is the bend, and both stay under the pointer because the midpoint is
 * exactly the point those two gestures move. What you gain over two controls is
 * not just space, it is that the handle draws the fade's own curve inside
 * itself, so it says what shape it is rather than only where it is.
 */
const DIAMOND = 13;

/**
 * How far a handle is held off the clip's edge.
 *
 * The clip is `overflow: hidden` with a rounded corner, so a handle centred on
 * the corner loses its outer half to the clip and another bite to the radius.
 * Parking it fully inside is the difference between a handle and a smear.
 */
const HANDLE_INSET = 2;

/** Keep a handle's box inside the clip it belongs to. */
function insetWithin(position: number, size: number, extent: number): number {
  const limit = Math.max(HANDLE_INSET, extent - size - HANDLE_INSET);
  return Math.max(HANDLE_INSET, Math.min(position, limit));
}

/**
 * Where a handle's centre parks when the clip has no fade yet.
 *
 * Not the very corner: the trim handle already owns that strip, and two
 * controls sharing ten pixels means every grab is a coin toss over which one
 * you got. Just inboard of it reads as the same corner without being the same
 * pixels.
 *
 * It is also the spot that makes the first drag continuous. The handle is a
 * midpoint, so parking its centre here is the same as claiming a fade twice
 * this wide, and the moment the pointer moves the maths already agrees with
 * where your finger is. Park it anywhere else and the fade jumps on contact.
 */
function parkedCentre(edge: "in" | "out", width: number): number {
  const inboard = CLIP_HANDLE_W / 2;
  return edge === "in" ? inboard : width - inboard;
}

/** What the bend reads as, for a title and for a screen reader. */
function bendLabel(curve: number): string {
  if (Math.abs(curve) < 0.02) return "Straight";
  return curve < 0 ? "Starts slow, finishes fast" : "Starts fast, finishes slow";
}

/** What the handle says it is, to a pointer and to a screen reader. */
function handleWording(edge: "in" | "out", seconds: number, drawn: boolean, shape: string) {
  if (!drawn) {
    return {
      label: edge === "in" ? "Fade in" : "Fade out",
      valueText: "No fade",
      title: `Drag in to fade ${edge}.`,
    };
  }
  const length = seconds.toFixed(2);
  return {
    label: edge === "in" ? "Fade in" : "Fade out",
    valueText: `${length} seconds, ${shape.toLowerCase()}`,
    title: `Fade ${edge}, ${length}s. Drag sideways for length, up or down to bend. ${shape}.`,
  };
}

/**
 * Vertical units the wedge is drawn in. A clip's height is set by the row, and
 * sometimes by `bottom` rather than a number, so the overlay draws in its own
 * space and lets the SVG stretch it. The horizontal axis stays in real pixels,
 * which is the axis a fade's length is read off.
 */
const VIEW_HEIGHT = 100;

/** What a drag needs to know about the clip it started on. */
interface FadeDrag {
  edge: "in" | "out";
  originX: number;
  originY: number;
  /** The clip's own box, measured once on the way down. */
  left: number;
  top: number;
  height: number;
  /** Forced when there is no fade yet: nothing to bend until one exists. */
  axis: FadeDragAxis | null;
  from: ClipFades;
}

export function TimelineClipFades({
  fades,
  duration,
  pixelsPerSecond,
  width,
  curves,
  curvesFor,
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
  // Keyed by edge, because only the ramp being dragged is in draft: the other
  // one has to keep drawing its own committed shape underneath.
  const [bendDraft, setBendDraft] = useState<{ edge: "in" | "out"; curve: number } | null>(null);
  const dragRef = useRef<FadeDrag | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const shown = draft ?? fades;
  const shownCurves = curvesFor(shown);
  // The bend is previewed the same way the lengths are: the committed value
  // only catches up once the write lands, and the line has to stay under the
  // pointer until then.
  const shownCurve = (edge: "in" | "out") =>
    bendDraft?.edge === edge ? bendDraft.curve : edge === "in" ? shownCurves.in : shownCurves.out;
  const shownSample = (edge: "in" | "out") => envelopeFadeSampler(shownCurve(edge));

  const onHandleDown = useCallback(
    (edge: "in" | "out", event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      // The handle sits on top of the trim handle and inside the clip body;
      // both would otherwise start their own gesture from this same press.
      event.stopPropagation();
      const box = hostRef.current?.getBoundingClientRect();
      if (!box || !(box.height > 0)) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const seconds = edge === "in" ? fades.fadeIn : fades.fadeOut;
      dragRef.current = {
        edge,
        originX: event.clientX,
        originY: event.clientY,
        left: box.left,
        top: box.top,
        height: box.height,
        // A clip with no fade has no curve to pull on, so every direction draws
        // one instead of half of them doing nothing.
        axis: seconds >= MIN_FADE_SECONDS ? null : "length",
        from: fades,
      };
    },
    [fades],
  );

  /**
   * What the pointer is currently asking for, on whichever axis this drag
   * locked to. Returns null until it has moved far enough to have one, which is
   * what keeps a mis-aimed click from editing anything.
   */
  const resolve = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const drag = dragRef.current;
      if (!drag) return null;
      drag.axis ??= resolveDragAxis(event.clientX - drag.originX, event.clientY - drag.originY);
      if (!drag.axis) return null;
      if (drag.axis === "bend") {
        return {
          axis: "bend" as const,
          edge: drag.edge,
          curve: bendFromPointer(event.clientY - drag.top, drag.height),
        };
      }
      const seconds = lengthFromPointer({
        edge: drag.edge,
        offsetX: event.clientX - drag.left,
        pixelsPerSecond,
        width,
      });
      const next =
        drag.edge === "in" ? { ...drag.from, fadeIn: seconds } : { ...drag.from, fadeOut: seconds };
      return { axis: "length" as const, fades: clampClipFades(next, duration) };
    },
    [duration, pixelsPerSecond, width],
  );

  const onHandleMove = useCallback(
    (event: ReactPointerEvent) => {
      const next = resolve(event);
      if (!next) return;
      if (next.axis === "bend") {
        setBendDraft({ edge: next.edge, curve: next.curve });
        onBend(next.edge, next.curve, false);
        return;
      }
      setDraft(next.fades);
      onPreview(next.fades);
    },
    [onBend, onPreview, resolve],
  );

  const onHandleUp = useCallback(
    (event: ReactPointerEvent) => {
      const next = resolve(event);
      const drag = dragRef.current;
      dragRef.current = null;
      setDraft(null);
      setBendDraft(null);
      if (!next || !drag) return;
      // A press that changed nothing must not write the same value back to the
      // file: a mis-aimed click is not an edit.
      if (next.axis === "bend") {
        const was = next.edge === "in" ? curves.in : curves.out;
        if (next.curve !== was) onBend(next.edge, next.curve, true);
        return;
      }
      const changed =
        next.fades.fadeIn !== drag.from.fadeIn || next.fades.fadeOut !== drag.from.fadeOut;
      if (changed) onCommit(next.fades);
    },
    [curves, onBend, onCommit, resolve],
  );

  const handleFor = (edge: "in" | "out") => {
    const seconds = edge === "in" ? shown.fadeIn : shown.fadeOut;
    const drawn = seconds >= MIN_FADE_SECONDS;
    const sampler = shownSample(edge);
    const height = hostRef.current?.getBoundingClientRect().height ?? 0;
    const at = fadeHandlePosition({
      edge,
      seconds,
      pixelsPerSecond,
      width,
      height,
      level: sampler(0.5),
    });
    // With no fade the handle waits on the corner, held fully inside the clip:
    // there is no curve under it yet to ride.
    const centreX = at?.x ?? parkedCentre(edge, width);
    const centreY = at?.y ?? HANDLE_INSET + DIAMOND / 2;
    const curve = shownCurve(edge);
    const wording = handleWording(edge, seconds, drawn, bendLabel(curve));
    return (
      <div
        key={edge}
        role="slider"
        tabIndex={-1}
        aria-label={wording.label}
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={seconds}
        aria-valuetext={wording.valueText}
        // Kept as two hooks on one element: the handle does both jobs now, and
        // anything that reached for either of them still finds it.
        data-clip-fade-grip={edge}
        data-clip-fade-bend={edge}
        data-clip-fade-curve={curve}
        onPointerDown={(event) => onHandleDown(edge, event)}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
        title={wording.title}
        // Quiet until you go for it: parked in the corner it shares space with
        // the clip's own label, and a solid mark there reads as damage rather
        // than as a handle.
        className={`${drawn ? "opacity-90" : "opacity-60"} hover:opacity-100 transition-opacity`}
        style={{
          position: "absolute",
          left: insetWithin(centreX - DIAMOND / 2, DIAMOND, width),
          // Clamped across, free up and down. A clip row is 42px and a bend at
          // the limit puts the curve within 3px of the edge, so a handle held
          // inside could not ride the curve past about half the bend range. The
          // clip does crop it at the extremes; drifting out from under the
          // pointer would be the worse of the two, because the whole gesture is
          // that the curve goes where you put it.
          top: centreY - DIAMOND / 2,
          width: DIAMOND,
          height: DIAMOND,
          // Both axes do something, so neither arrow tells the truth on its own.
          cursor: "move",
          pointerEvents: "auto",
          filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.55))",
          zIndex: 6,
        }}
      >
        <FadeDiamond size={DIAMOND} sample={sampler} edge={edge} accent={accent} active={drawn} />
      </div>
    );
  };

  return (
    // One positioned box owns the overlay so the handles have a parent whose
    // box they can measure, and so they share the clip's coordinates.
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
            sample: shownSample(edge),
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
      {showGrips && !readOnly && (["in", "out"] as const).map(handleFor)}
    </div>
  );
}
