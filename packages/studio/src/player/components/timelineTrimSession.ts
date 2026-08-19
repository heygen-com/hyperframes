import type { TimelineElement } from "../store/playerStore";
import { getTimelineEditCapabilities } from "./timelineEditCapabilities";
import { laneGapFloor } from "./timelineGaps";
import {
  resolveTimelineMinDuration,
  type TimelineGroupResizeChange,
  type TimelineGroupResizeMember,
  type TimelineGroupResizeSession,
} from "./timelineGroupEditing";
import {
  collectTimelineSnapTargets,
  snapTimelineTime,
  TIMELINE_SNAP_PX,
  type TimelineSnapTarget,
} from "./timelineSnapping";
import { isMusicTrack } from "../../utils/timelineInspector";
import { frameToSeconds } from "../lib/time";
import type { TimelineTrimPreview } from "../store/trimPreviewSlice";
import {
  applyTrimDelta,
  clampTrimDelta,
  resolveTrimPlan,
  trimPlanKeys,
  trimPreviewFrames,
  trimSnapAnchor,
  type TimelineTrimEdge,
  type TimelineTrimMode,
  type TrimClip,
  type TrimPlan,
} from "./timelineTrimOps";

/**
 * Gesture layer for the four trim tools: turns store elements into the pure
 * plan {@link timelineTrimOps} works on, and a pointer x into per-clip changes.
 *
 * A trim session IS a {@link TimelineGroupResizeSession} — it carries the same
 * members / changes / hasChanged triple — so the whole downstream pipeline
 * (projection rendering, escape-cancel, atomic commit through
 * `commitTimelineGroupResize`) is reused verbatim. Only the preview math
 * differs, and that is what the extra `trim` field selects.
 */

export interface TimelineTrimSession extends TimelineGroupResizeSession {
  trim: {
    mode: TimelineTrimMode;
    plan: TrimPlan;
    laneFloor: number;
    /**
     * Snap targets frozen at gesture start, with every clip the plan may rewrite
     * removed: those clips ride the trim, so snapping the moving edge onto one of
     * them would be snapping to itself.
     */
    snapTargets: TimelineSnapTarget[];
  };
}

function isTimelineTrimSession(
  session: TimelineGroupResizeSession | null,
): session is TimelineTrimSession {
  return session != null && "trim" in session;
}

const keyOf = (element: TimelineElement): string => element.key ?? element.id;

/**
 * Whether the clip samples a re-pointable source. The store reports
 * `playbackStart: 0` for every element (the runtime manifest defaults it), so
 * an in point cannot be inferred from its presence — this is the one place that
 * decides it, from the element's kind and its media metadata.
 */
function hasSourceWindow(element: TimelineElement): boolean {
  if (element.kind === "composition" || element.compositionSrc) return true;
  if (element.playbackStartAttr != null) return true;
  if (element.sourceDuration != null && Number.isFinite(element.sourceDuration)) return true;
  return ["video", "audio"].includes(element.tag.toLowerCase());
}

const toTrimClip = (element: TimelineElement): TrimClip => ({
  key: keyOf(element),
  start: element.start,
  duration: element.duration,
  playbackStart: element.playbackStart,
  playbackRate: element.playbackRate,
  sourceDuration: element.sourceDuration,
  sourceWindow: hasSourceWindow(element),
});

/** What a plan asks of each clip it touches: a pure move, or a retime of an edge. */
type TrimRequirement = "move" | "trim-start" | "trim-end" | "trim-both";

function trimRequirements(plan: TrimPlan): Map<string, TrimRequirement> {
  const required = new Map<string, TrimRequirement>();
  switch (plan.mode) {
    case "ripple":
      required.set(plan.grabbed.key, plan.edge === "start" ? "trim-start" : "trim-end");
      for (const follower of plan.followers) required.set(follower.key, "move");
      break;
    case "roll":
      required.set(plan.left.key, "trim-end");
      required.set(plan.right.key, "trim-start");
      break;
    case "slip":
      // The in AND out points both move, even though neither lane edge does.
      required.set(plan.grabbed.key, "trim-both");
      break;
    case "slide":
      required.set(plan.grabbed.key, "move");
      if (plan.prev) required.set(plan.prev.key, "trim-end");
      if (plan.next) required.set(plan.next.key, "trim-start");
      break;
  }
  return required;
}

function satisfiesRequirement(element: TimelineElement, requirement: TrimRequirement): boolean {
  const caps = getTimelineEditCapabilities(element);
  switch (requirement) {
    case "move":
      return caps.canMove;
    case "trim-start":
      return caps.canTrimStart;
    case "trim-end":
      return caps.canTrimEnd;
    case "trim-both":
      return caps.canTrimStart && caps.canTrimEnd;
  }
}

interface TrimSessionShape {
  plan: TrimPlan;
  members: TimelineGroupResizeMember[];
  laneFloor: number;
}

/**
 * The clips a trim gesture would rewrite, or null when it cannot run: the
 * operation has no valid shape on this lane (see `resolveTrimPlan`), or one of
 * the clips it would rewrite is locked / implicitly timed. Refusal is
 * all-or-nothing — a trim never half-applies and leaves the lane inconsistent.
 */
function resolveTrimSessionShape(
  grabbed: TimelineElement,
  mode: TimelineTrimMode,
  edge: TimelineTrimEdge,
  elements: readonly TimelineElement[],
): TrimSessionShape | null {
  const laneElements = elements.filter((element) => element.track === grabbed.track);
  const plan = resolveTrimPlan(laneElements.map(toTrimClip), keyOf(grabbed), mode, edge);
  if (!plan) return null;

  const required = trimRequirements(plan);
  const members: TimelineGroupResizeMember[] = [];
  for (const element of laneElements) {
    const requirement = required.get(keyOf(element));
    if (!requirement) continue;
    if (!satisfiesRequirement(element, requirement)) return null;
    members.push({
      element,
      key: keyOf(element),
      start: element.start,
      duration: element.duration,
      playbackStart: element.playbackStart,
      playbackRate: element.playbackRate,
    });
  }
  return { plan, members, laneFloor: laneGapFloor(laneElements) };
}

/**
 * Whether the tool can act on this clip at all — read at pointerdown so a
 * refused gesture (a roll with nothing across the cut, a slip on generated
 * pixels) never starts and reports itself instead of silently doing nothing.
 */
export function canStartTimelineTrim(
  grabbed: TimelineElement,
  mode: TimelineTrimMode,
  edge: TimelineTrimEdge,
  elements: readonly TimelineElement[],
): boolean {
  return resolveTrimSessionShape(grabbed, mode, edge, elements) != null;
}

export interface TrimSessionContext {
  elements: readonly TimelineElement[];
  playheadTime: number | null;
  beatTimes: readonly number[];
  snapEnabled: boolean;
}

/**
 * Reuse the in-flight session when it still describes this gesture, otherwise
 * open a fresh one. Sessions are opened lazily on the first pointer movement,
 * so the identity check is what keeps a second gesture from inheriting the
 * first one's frozen plan and snap grid.
 */
export function reuseOrOpenTrimSession(
  current: TimelineGroupResizeSession | null,
  grabbed: TimelineElement,
  mode: TimelineTrimMode,
  edge: TimelineTrimEdge,
  ctx: TrimSessionContext,
): TimelineTrimSession | null {
  const describesThisGesture =
    isTimelineTrimSession(current) &&
    current.grabbedKey === keyOf(grabbed) &&
    current.edge === edge &&
    current.trim.mode === mode;
  return describesThisGesture
    ? (current as TimelineTrimSession)
    : buildTimelineTrimSession(grabbed, mode, edge, ctx);
}

/** Open a trim session, freezing its snap grid for the whole gesture. */
export function buildTimelineTrimSession(
  grabbed: TimelineElement,
  mode: TimelineTrimMode,
  edge: TimelineTrimEdge,
  ctx: TrimSessionContext,
): TimelineTrimSession | null {
  const shape = resolveTrimSessionShape(grabbed, mode, edge, ctx.elements);
  if (!shape) return null;

  const planKeys = trimPlanKeys(shape.plan);
  return {
    grabbedKey: keyOf(grabbed),
    edge,
    members: shape.members,
    changes: [],
    hasChanged: false,
    trim: {
      mode,
      plan: shape.plan,
      laneFloor: shape.laneFloor,
      snapTargets: ctx.snapEnabled
        ? collectTimelineSnapTargets({
            elements: ctx.elements.filter((element) => !planKeys.has(keyOf(element))),
            playheadTime: ctx.playheadTime,
            // The music track defines the beats, so it must not snap to them.
            beatTimes: isMusicTrack(grabbed) ? [] : ctx.beatTimes,
          })
        : [],
    },
  };
}

/**
 * Snap the gesture's moving edge to the frozen target grid and report the delta
 * that lands it there. Slip has no lane edge to snap (see `trimSnapAnchor`), so
 * its delta passes through untouched.
 */
function snapTrimDelta(session: TimelineTrimSession, rawDelta: number, pps: number): number {
  const anchor = trimSnapAnchor(session.trim.plan);
  const { snapTargets } = session.trim;
  if (!anchor || snapTargets.length === 0) return rawDelta;
  const snapped = snapTimelineTime(
    anchor.time + anchor.sign * rawDelta,
    snapTargets,
    TIMELINE_SNAP_PX / Math.max(pps, 1),
  );
  return snapped.target ? anchor.sign * (snapped.time - anchor.time) : rawDelta;
}

/**
 * Fold a pointer delta (in seconds) into the session and return the grabbed
 * clip's own change, so the caller can render it from the resize state exactly
 * as the group-resize path does. Mutates `changes` / `hasChanged` in place.
 */
export function applyTimelineTrimPreview(
  session: TimelineTrimSession,
  rawDeltaSeconds: number,
  pps: number,
  publishPreview?: (preview: TimelineTrimPreview) => void,
): TimelineGroupResizeChange | undefined {
  const { plan, laneFloor } = session.trim;
  const delta = clampTrimDelta(
    plan,
    snapTrimDelta(session, rawDeltaSeconds, pps),
    resolveTimelineMinDuration(),
    laneFloor,
  );
  publishPreview?.({
    mode: session.trim.mode,
    delta,
    ...trimPreviewFrames(plan, delta, frameToSeconds(1)),
  });
  const byKey = new Map(session.members.map((member) => [member.key, member]));
  session.changes = applyTrimDelta(plan, delta).flatMap((change) => {
    const member = byKey.get(change.key);
    // A plan only ever names clips the builder snapshotted; the guard keeps a
    // future plan shape from persisting a change with no element behind it.
    return member ? [{ ...change, element: member.element }] : [];
  });
  session.hasChanged = session.changes.some((change) => {
    const member = byKey.get(change.key)!;
    // An absent playbackStart means "unchanged" (see TrimChange), so it is
    // compared only when the change actually carries one.
    return (
      change.start !== member.start ||
      change.duration !== member.duration ||
      (change.playbackStart != null && change.playbackStart !== member.playbackStart)
    );
  });
  return session.changes.find((change) => change.key === session.grabbedKey);
}
