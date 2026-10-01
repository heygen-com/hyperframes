import {
  createContext,
  useEffect,
  useLayoutEffect,
  useMemo,
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
  type AudioFades,
} from "@hyperframes/core/audio-fade";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { Tooltip } from "../../components/ui";
import { useTimelineEditContextOptional } from "../../contexts/TimelineEditContext";
import { releasedOutsideWindow } from "./timelinePointerRelease";
import {
  collectTimelineSnapTargets,
  snapTimelineTime,
  TIMELINE_SNAP_PX,
  type TimelineSnapTarget,
  type TimelineSnapType,
} from "./timelineSnapping";

type FadeEdge = "in" | "out";
type FadeDraft = { edge: FadeEdge; seconds: number } | null;

const TAB_WIDTH = 4;
const TAB_HEIGHT = 15;
const HANDLE_HIT = 24;
/** The tab never sits closer than this to a clip end, so it stays on the clip's top edge. */
const TAB_INSET = 7;
/** Where the tab's centre sits inside its hit box; most of the box hangs into the clip. */
const TAB_CENTER_IN_HIT = 8;
const HANDLE_Z_ABOVE_CLIP_CONTENT = 30;
const SUPPRESS_CLIP_NATIVE_TITLE = "";
/** Pixels of pointer travel before a press on the handle counts as a drag. */
const DRAG_THRESHOLD_PX = 2;
/** Double-click on a handle with no fade, or Enter, adds this much. */
const DEFAULT_FADE_SECONDS = 0.5;
const SNAP_LABEL: Record<TimelineSnapType, string> = {
  playhead: "playhead",
  "clip-edge": "clip edge",
  beat: "beat",
};

/** The fades a clip's content draws with, live during a drag; null outside a fade-capable clip. */
export type ClipFadeShape = AudioFades & { duration: number };
export const ClipFadesContext = createContext<ClipFadeShape | null>(null);

// Owned by TimelineClip so the handles and the waveform share the value under the pointer;
// the draft also bridges release until the store re-reads the file.
export function useClipFadeDraft(el: TimelineElement) {
  const [draft, setDraft] = useState<FadeDraft>(null);
  const authoredIn = el.fadeIn ?? 0;
  const authoredOut = el.fadeOut ?? 0;
  useEffect(() => setDraft(null), [authoredIn, authoredOut]);
  const { fadeIn, fadeOut } = clampFadesToDuration(
    {
      fadeIn: draft?.edge === "in" ? draft.seconds : authoredIn,
      fadeOut: draft?.edge === "out" ? draft.seconds : authoredOut,
    },
    el.duration,
  );
  const shape = useMemo(
    () => ({ fadeIn, fadeOut, duration: el.duration }),
    [fadeIn, fadeOut, el.duration],
  );
  return { draft, setDraft, shape };
}

interface TimelineClipFadesProps {
  el: TimelineElement;
  pps: number;
  widthPx: number;
  /** Handles show on hover/selection; the ramps show whenever a fade is set. */
  showHandles: boolean;
  /** The selected clip's handles join the tab order. */
  focusable?: boolean;
  /** Audio clips draw the fade in their waveform; others get the shaded wedge. */
  hasWaveform?: boolean;
  fade: ReturnType<typeof useClipFadeDraft>;
}

/** Pill-aware y of the clip's top edge at x, so the tab rides the rounded ends. */
function topEdgeY(x: number, widthPx: number, heightPx: number, radiusPx: number): number {
  const r = Math.min(radiusPx, widthPx / 2, heightPx / 2);
  const d = x < r ? r - x : x > widthPx - r ? x - (widthPx - r) : 0;
  return d > 0 ? r - Math.sqrt(Math.max(0, r * r - d * d)) : 0;
}

/** Slim tabs at each fade's end that drag `data-fade-in` / `data-fade-out`. */
// fallow-ignore-next-line complexity
export function TimelineClipFades({
  el,
  pps,
  widthPx,
  showHandles,
  focusable = false,
  hasWaveform = false,
  fade,
}: TimelineClipFadesProps) {
  const { onSetElementAttributeLive, onSetElementAttributeQuiet, onRevertElementAttributeLive } =
    useTimelineEditContextOptional();
  const canEdit = Boolean(onSetElementAttributeLive && onSetElementAttributeQuiet);
  const { setDraft } = fade;
  const fades = fade.shape;
  const [dragging, setDragging] = useState<FadeEdge | null>(null);
  const [focused, setFocused] = useState<FadeEdge | null>(null);
  const [snapType, setSnapType] = useState<TimelineSnapType | null>(null);
  const authoredIn = el.fadeIn ?? 0;
  const authoredOut = el.fadeOut ?? 0;
  const inPx = Math.min(widthPx, fades.fadeIn * pps);
  const outPx = Math.min(widthPx, fades.fadeOut * pps);

  const visible =
    fades.fadeIn > 0 || fades.fadeOut > 0 || showHandles || dragging !== null || focused !== null;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [clipBox, setClipBox] = useState({ height: 0, radius: 0 });
  useLayoutEffect(() => {
    const clip = rootRef.current?.parentElement;
    if (!clip) return;
    const radius = parseFloat(getComputedStyle(clip).borderTopLeftRadius) || 0;
    const height = clip.clientHeight;
    setClipBox((box) =>
      box.height === height && box.radius === radius ? box : { height, radius },
    );
  }, [widthPx, visible]);

  const gesture = useRef<{
    edge: FadeEdge;
    pointerId: number;
    originClientX: number;
    originSeconds: number;
    otherSeconds: number;
    moved: boolean;
    last: number;
    snapTargets: TimelineSnapTarget[];
  } | null>(null);

  const attrFor = (edge: FadeEdge) =>
    edge === "in" ? HF_AUDIO_FADE_IN_ATTR : HF_AUDIO_FADE_OUT_ATTR;
  const attrText = (seconds: number) => (seconds > 0 ? formatFadeSeconds(seconds) : null);
  const labelFor = (edge: FadeEdge) => (edge === "in" ? "Fade in" : "Fade out");
  const limitFor = (edge: FadeEdge) =>
    Math.max(0, el.duration - (edge === "in" ? authoredOut : authoredIn));

  /** Moves the fade's end onto a playhead or clip edge within the timeline's snap radius. */
  const snapSeconds = (g: NonNullable<typeof gesture.current>, seconds: number) => {
    const knee = g.edge === "in" ? el.start + seconds : el.start + el.duration - seconds;
    const snapped = snapTimelineTime(knee, g.snapTargets, TIMELINE_SNAP_PX / Math.max(pps, 1e-6));
    if (!snapped.target) return { seconds, type: null };
    const next = g.edge === "in" ? snapped.time - el.start : el.start + el.duration - snapped.time;
    const limit = Math.max(0, el.duration - g.otherSeconds);
    return next >= 0 && next <= limit
      ? { seconds: next, type: snapped.target.type }
      : { seconds, type: null };
  };

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
    const store = usePlayerStore.getState();
    gesture.current = {
      edge,
      pointerId: e.pointerId,
      originClientX: e.clientX,
      originSeconds: edge === "in" ? authoredIn : authoredOut,
      otherSeconds: edge === "in" ? authoredOut : authoredIn,
      moved: false,
      last: edge === "in" ? authoredIn : authoredOut,
      snapTargets: store.timelineSnapEnabled
        ? collectTimelineSnapTargets({
            elements: store.elements,
            playheadTime: store.currentTime,
            beatTimes: [],
            excludeElementKey: el.key ?? el.id,
          })
        : [],
    };
    setDragging(edge);
  };

  const onHandlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (!g.moved && Math.abs(e.clientX - g.originClientX) < DRAG_THRESHOLD_PX) return;
    g.moved = true;
    const { seconds: raw, type } = snapSeconds(g, secondsAt(e.clientX));
    const seconds = Math.round(raw * 100) / 100;
    setSnapType(type);
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
    setSnapType(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    return g;
  };

  /** Puts the live document back where the file has it and drops the draft. */
  const revertGesture = (g: Gesture) => {
    if (g.moved) {
      onSetElementAttributeLive?.(el, attrFor(g.edge), attrText(g.originSeconds));
      onRevertElementAttributeLive?.(el, attrFor(g.edge));
    }
    setDraft(null);
  };

  /** One saved write, one undo step. */
  const commit = (edge: FadeEdge, seconds: number) => {
    setDraft({ edge, seconds });
    void onSetElementAttributeQuiet?.(el, attrFor(edge), attrText(seconds), labelFor(edge));
  };

  const finish = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = endGesture(e);
    if (!g) return;
    if (cancelled || !g.moved || releasedOutsideWindow(e)) return revertGesture(g);
    commit(g.edge, g.last);
  };

  const onHandleDoubleClick = (edge: FadeEdge) => {
    const current = edge === "in" ? authoredIn : authoredOut;
    commit(edge, current > 0 ? 0 : Math.min(DEFAULT_FADE_SECONDS, limitFor(edge)));
  };

  const onHandleKeyDown = (edge: FadeEdge) => (e: KeyboardEvent<HTMLDivElement>) => {
    const current = edge === "in" ? fades.fadeIn : fades.fadeOut;
    const step = e.shiftKey ? 1 : 0.1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? current + step
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? current - step
          : e.key === "Home" || e.key === "Delete" || e.key === "Backspace"
            ? 0
            : e.key === "End"
              ? limitFor(edge)
              : e.key === "Enter" && current === 0
                ? DEFAULT_FADE_SECONDS
                : null;
    if (next === null || !canEdit) return;
    // The timeline also listens for arrows; a handled key is the handle's alone.
    e.preventDefault();
    e.stopPropagation();
    commit(edge, Math.round(Math.min(limitFor(edge), Math.max(0, next)) * 100) / 100);
  };

  useEffect(() => {
    if (dragging === null) return;
    const cancelOnWindowEscape = (e: globalThis.KeyboardEvent) => {
      const g = gesture.current;
      if (e.key !== "Escape" || !g) return;
      e.preventDefault();
      e.stopPropagation();
      gesture.current = null;
      setDragging(null);
      setSnapType(null);
      revertGesture(g);
    };
    window.addEventListener("keydown", cancelOnWindowEscape, { capture: true });
    return () => window.removeEventListener("keydown", cancelOnWindowEscape, { capture: true });
  });

  const showIn = fades.fadeIn > 0;
  const showOut = fades.fadeOut > 0;
  const handlesVisible = showHandles || dragging !== null || focused !== null;
  if (!visible) return null;

  const hitWidth = Math.min(HANDLE_HIT, widthPx / 2);
  const tabX = (edge: FadeEdge) => {
    const knee = edge === "in" ? inPx : widthPx - outPx;
    const inset = Math.min(TAB_INSET, widthPx / 2);
    return Math.min(widthPx - inset, Math.max(inset, knee));
  };
  const handleGeometry = (edge: FadeEdge) => {
    const x = tabX(edge);
    // Each hit box keeps to its own half, so on a narrow clip the two never overlap.
    const left =
      edge === "in"
        ? Math.min(widthPx / 2 - hitWidth, Math.max(0, x - hitWidth / 2))
        : Math.min(widthPx - hitWidth, Math.max(widthPx / 2, x - hitWidth / 2));
    const edgeY = topEdgeY(x, widthPx, clipBox.height, clipBox.radius);
    return { left, tabLeft: x - left, top: edgeY + 1 - TAB_CENTER_IN_HIT };
  };
  const handleStyle = (geometry: { left: number; top: number }): CSSProperties => ({
    position: "absolute",
    top: geometry.top,
    left: geometry.left,
    width: hitWidth,
    height: HANDLE_HIT,
    cursor: "ew-resize",
    opacity: handlesVisible ? 1 : 0,
    pointerEvents: handlesVisible && canEdit ? "auto" : "none",
    touchAction: "none",
    outline: "none",
  });

  return (
    <div
      ref={rootRef}
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: "inherit",
        pointerEvents: "none",
        zIndex: HANDLE_Z_ABOVE_CLIP_CONTENT,
      }}
    >
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
            overflow: "hidden",
            borderRadius: "inherit",
          }}
          viewBox={`0 0 ${Math.max(widthPx, 1)} 100`}
          preserveAspectRatio="none"
        >
          {showIn && (
            <FadeRamp
              testId="clip-fade-in"
              wedge={hasWaveform ? null : `0,0 ${inPx},0 0,100`}
              line={[0, 100, inPx, 0]}
            />
          )}
          {showOut && (
            <FadeRamp
              testId="clip-fade-out"
              wedge={hasWaveform ? null : `${widthPx - outPx},0 ${widthPx},0 ${widthPx},100`}
              line={[widthPx - outPx, 0, widthPx, 100]}
            />
          )}
        </svg>
      )}
      {canEdit &&
        (["in", "out"] as const).map((edge) => {
          const geometry = handleGeometry(edge);
          return (
            <FadeHandle
              key={edge}
              direction={edge}
              value={edge === "in" ? fades.fadeIn : fades.fadeOut}
              max={Math.max(0, el.duration - (edge === "in" ? fades.fadeOut : fades.fadeIn))}
              snapLabel={dragging === edge && snapType ? SNAP_LABEL[snapType] : null}
              style={handleStyle(geometry)}
              tabLeft={geometry.tabLeft}
              tabTop={TAB_CENTER_IN_HIT - TAB_HEIGHT / 2}
              focusable={focusable}
              dragging={dragging === edge}
              onPointerDown={onHandlePointerDown(edge)}
              onPointerMove={onHandlePointerMove}
              onPointerUp={(e) => finish(e, false)}
              onPointerCancel={(e) => finish(e, true)}
              onDoubleClick={() => onHandleDoubleClick(edge)}
              onKeyDown={onHandleKeyDown(edge)}
              onFocusChange={(on) => setFocused(on ? edge : null)}
            />
          );
        })}
    </div>
  );
}

/** A 1 px dashed gain line; clips without a waveform also shade the gain they lose. */
function FadeRamp({
  testId,
  wedge,
  line,
}: {
  testId: string;
  wedge: string | null;
  line: [number, number, number, number];
}) {
  const [x1, y1, x2, y2] = line;
  return (
    <>
      {wedge && (
        <polygon
          data-testid={testId}
          points={wedge}
          fill="var(--timeline-fade-shade)"
          fillOpacity={0.35}
        />
      )}
      <line
        data-testid={wedge ? undefined : testId}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="var(--clip-handle)"
        strokeOpacity={0.55}
        strokeWidth={1}
        strokeDasharray="2 3"
        vectorEffect="non-scaling-stroke"
      />
    </>
  );
}

function FadeHandle({
  direction,
  value,
  max,
  snapLabel,
  style,
  tabLeft,
  tabTop,
  focusable,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onDoubleClick,
  onKeyDown,
  onFocusChange,
}: {
  direction: "in" | "out";
  value: number;
  max: number;
  snapLabel: string | null;
  style: CSSProperties;
  tabLeft: number;
  tabTop: number;
  focusable: boolean;
  dragging: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onFocusChange: (focused: boolean) => void;
}) {
  const label = direction === "in" ? "Fade in" : "Fade out";
  const text = `${label} ${formatFadeSeconds(value)} s`;
  return (
    <Tooltip label={snapLabel ? `${text}, snapped to ${snapLabel}` : text}>
      <div
        role="slider"
        tabIndex={focusable ? 0 : -1}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${formatFadeSeconds(value)}s`}
        data-testid={`clip-fade-handle-${direction}`}
        data-dragging={dragging ? "" : undefined}
        className="timeline-fade-handle"
        title={SUPPRESS_CLIP_NATIVE_TITLE}
        style={style}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDoubleClick();
        }}
        onKeyDown={onKeyDown}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
      >
        <span
          aria-hidden="true"
          className="timeline-fade-tab"
          style={{
            left: tabLeft - TAB_WIDTH / 2,
            top: tabTop,
            width: TAB_WIDTH,
            height: TAB_HEIGHT,
            pointerEvents: "none",
          }}
        />
      </div>
    </Tooltip>
  );
}
