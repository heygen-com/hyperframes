import { resolveTimelineMove, resolveTimelineResize } from "./timelineEditing";
import type { TimelineElement } from "../store/playerStore";
import {
  getTimelineInsertBoundaryBand,
  getTimelineRowFromY,
  getTimelineRowHeight,
  getTimelineRowPositionFromY,
} from "./timelineLayout";
import { isMusicTrack, isAudioTimelineElement } from "../../utils/timelineInspector";
import {
  TIMELINE_SNAP_PX,
  snapMoveToTargets,
  snapTimelineTime,
  type TimelineSnapTarget,
  type TimelineSnapType,
} from "./timelineSnapping";
import { resolveInsertRow, resolveZoneDropPlacement } from "./timelineCollision";
import {
  applyTimelineGroupResizePreview,
  type TimelineGroupResizeSession,
} from "./timelineGroupEditing";
import { clampGroupMoveDelta } from "./timelineMultiDragPreview";
import type { DraggedClipState, ResizingClipState } from "./timelineClipDragTypes";
import { resolveDragLandingStart } from "./timelineDragLanding";
import { STUDIO_PREVIEW_FPS } from "../lib/time";

/** Snap-target builder closure supplied by the hook (closes over refs + store). */
type BuildSnapTargets = (
  excludeElementKey: string | null,
  includeBeats: boolean,
  includePlayhead?: boolean,
) => TimelineSnapTarget[];

export interface DragPreviewContext {
  scroll: HTMLDivElement | null;
  pps: number;
  duration: number;
  trackOrder: number[];
  rowHeights?: readonly number[];
  elements: TimelineElement[];
  selectedKeys: ReadonlySet<string>;
  buildSnapTargets: BuildSnapTargets;
  /**
   * The set of tracks that hold audio clips (drives zone-aware drop placement).
   * Frozen for the whole gesture, so the hook builds it ONCE at drag start and
   * passes it in — see useTimelineClipDrag. Absent (e.g. in unit tests) ⇒ built
   * on demand from `elements`, so the result is identical either way.
   */
  audioTracks?: ReadonlySet<number>;
}

/** Content-space position for the stable viewport drag actor. */
export function getTimelineDragOverlayPosition(
  drag: DraggedClipState,
  scroll: Pick<HTMLDivElement, "scrollLeft" | "scrollTop" | "getBoundingClientRect"> | null,
): { left: number; top: number } | null {
  if (!drag.started || !scroll) return null;
  const rect = scroll.getBoundingClientRect();
  return {
    left: drag.pointerClientX - rect.left + scroll.scrollLeft - drag.pointerOffsetX,
    top: drag.pointerClientY - rect.top + scroll.scrollTop - drag.pointerOffsetY,
  };
}

/**
 * Max start a drag may reach. Allow dragging past the current content into the
 * rendered timeline extent (the viewport-fill keeps that ≥ the viewport width).
 * The composition grows to fit on commit (content-driven duration), so don't
 * cap at content length.
 */
function resolveDragMaxStart(scroll: HTMLDivElement | null, pps: number, duration: number): number {
  return Math.max(duration, scroll && pps > 0 ? scroll.scrollWidth / pps : duration);
}

/**
 * Rigid group move: when the grabbed clip is part of a multi-selection, the
 * WHOLE formation shifts by its delta on commit (see timelineClipDragCommit).
 * Clamp that delta here — against every selected member's start — so the
 * grabbed clip can't out-run the group: it STOPS the instant any member would
 * cross 0, exactly as it lands on commit. Lane changes still apply to the
 * grabbed clip only, so only the start (x) is constrained.
 */
function resolveGroupClampedStart(
  snapStart: number,
  element: TimelineElement,
  dragKey: string,
  elements: TimelineElement[],
  selectedKeys: ReadonlySet<string>,
): number {
  if (selectedKeys.size <= 1 || !selectedKeys.has(dragKey)) return snapStart;
  const memberStarts = elements.filter((e) => selectedKeys.has(e.key ?? e.id)).map((e) => e.start);
  const clampedDelta = clampGroupMoveDelta(snapStart - element.start, memberStarts);
  return element.start + clampedDelta;
}

/**
 * The whole drop decision (no same-track overlap, zone-respecting, relocate or
 * create) — one tested pure function, so what runs here is what's verified.
 */
function resolveDropPlacement(
  drag: DraggedClipState,
  clientY: number,
  previewStart: number,
  desiredTrack: number,
  ctx: DragPreviewContext,
): { track: number; insertRow: number | null } {
  const { scroll, trackOrder, rowHeights, elements, selectedKeys } = ctx;
  const dragKey = drag.element.key ?? drag.element.id;
  const isGroupDrag = selectedKeys.size > 1 && selectedKeys.has(dragKey);
  // rowFloat = the pointer's position in track-heights from the top lane; a
  // near-boundary hover requests a deliberate new-track insert. Uses the
  // shared row→y inverse so the top breathing pad is subtracted consistently.
  const rowPosition = scroll
    ? getTimelineRowPositionFromY(
        clientY - scroll.getBoundingClientRect().top + scroll.scrollTop,
        rowHeights,
      )
    : { rowFloat: 0, row: 0, fraction: 0, rowHeight: getTimelineRowHeight(0, rowHeights) };
  // Geometry-exact band (the clip inset divided by this row's actual height) so
  // an insert only arms in the visible gutter between clip bodies.
  const rawInsertRow = resolveInsertRow(
    rowPosition.rowFloat,
    trackOrder.length,
    getTimelineInsertBoundaryBand(rowPosition.rowHeight),
  );
  // Pointer sub-row half: when a drop must auto-create a track (aimed span
  // occupied, no free lane), open it on the side the pointer is nearer.
  const preferInsertAbove = rowPosition.fraction < 0.5;
  const audioTracks =
    ctx.audioTracks ?? new Set(elements.filter(isAudioTimelineElement).map((e) => e.track));
  return resolveZoneDropPlacement({
    order: trackOrder,
    audioTracks,
    elements,
    desiredTrack,
    deliberateInsertRow: rawInsertRow,
    start: previewStart,
    duration: drag.element.duration,
    dragKey,
    isAudio: isAudioTimelineElement(drag.element),
    preferInsertAbove,
    relocateOnOverlap: isGroupDrag,
  });
}

/** Recompute the dragged-clip preview (move + snap + group clamp + drop placement). */
export function computeDragPreview(
  drag: DraggedClipState,
  clientX: number,
  clientY: number,
  ctx: DragPreviewContext,
): DraggedClipState {
  const { scroll, pps, duration, trackOrder, elements, selectedKeys, buildSnapTargets } = ctx;
  const dragMaxStart = resolveDragMaxStart(scroll, pps, duration);
  const scrollTop = scroll?.scrollTop ?? drag.originScrollTop;
  const scrollRectTop = scroll?.getBoundingClientRect().top ?? 0;
  const originRow = getTimelineRowFromY(
    drag.originClientY - scrollRectTop + drag.originScrollTop,
    ctx.rowHeights,
  );
  const currentRow = getTimelineRowFromY(clientY - scrollRectTop + scrollTop, ctx.rowHeights);
  // resolveTimelineMove's vertical axis is row indices, which is why the pointer
  // and scroll pixels are folded into originRow/currentRow above.
  const nextMove = resolveTimelineMove(
    {
      start: drag.element.start,
      track: drag.element.track,
      duration: drag.element.duration,
      originClientX: drag.originClientX,
      originRow,
      originScrollLeft: drag.originScrollLeft,
      currentScrollLeft: scroll?.scrollLeft ?? drag.originScrollLeft,
      pixelsPerSecond: pps,
      maxStart: dragMaxStart,
      trackOrder,
    },
    clientX,
    currentRow,
  );
  // The music track defines the beats, so it must not snap to them —
  // but it still snaps to the playhead and other clip edges.
  const targets = buildSnapTargets(
    drag.element.key ?? drag.element.id,
    !isMusicTrack(drag.element),
  );
  const snap = snapMoveToTargets(
    nextMove.start,
    drag.element.duration,
    targets,
    pps,
    // Relaxed clamp: allow the snapped start past the content, up to the
    // rendered extent (see dragMaxStart) — the composition grows on commit.
    dragMaxStart + drag.element.duration,
  );
  const dragKey = drag.element.key ?? drag.element.id;
  const previewStart = resolveGroupClampedStart(
    snap.start,
    drag.element,
    dragKey,
    elements,
    selectedKeys,
  );
  const { track: previewTrack, insertRow } = resolveDropPlacement(
    drag,
    clientY,
    previewStart,
    nextMove.track,
    ctx,
  );
  const placed = { ...drag, previewStart, previewTrack, insertRow };
  const snappedStart = resolveDragLandingStart(placed, {
    elements,
    trackOrder,
    selectedKeys,
  });
  return {
    ...drag,
    started: true,
    pointerClientX: clientX,
    pointerClientY: clientY,
    previewStart: snappedStart,
    previewTrack,
    // The lane the POINTER aims at (pre-collision): the commit reads it to tell a
    // deliberate vertical lane change from a horizontal drag merely bumped sideways.
    desiredTrack: nextMove.track,
    insertRow,
    snapTime: snap.snapTime,
    snapType: snap.snapType,
  };
}

/** One frame: the last visible frame of a clip sits just before its end time. */
const TRIM_END_FRAME_LEAD_S = 1 / STUDIO_PREVIEW_FPS;

/** The composition time whose frame a trim shows: the edge being dragged. */
export function trimPreviewTime(edge: "start" | "end", start: number, duration: number): number {
  return edge === "start" ? start : Math.max(start, start + duration - TRIM_END_FRAME_LEAD_S);
}

export interface ResizePreviewContext {
  scroll: HTMLDivElement | null;
  pps: number;
  buildSnapTargets: BuildSnapTargets;
}

export interface ResizePreviewResult {
  originScrollLeft: number;
  previewStart: number;
  previewDuration: number;
  previewPlaybackStart?: number;
  /** The target the trimmed edge snapped to; null when the edge is free. */
  snapTime: number | null;
  snapType: TimelineSnapType | null;
}

/** Compute the trim preview for a pointer x (pure — the hook applies the state). */
// fallow-ignore-next-line complexity
export function computeResizePreview(
  resize: ResizingClipState,
  clientX: number,
  ctx: ResizePreviewContext,
): ResizePreviewResult {
  const { scroll, pps, buildSnapTargets } = ctx;
  // Scroll compensation: auto-scroll moves the content while the pointer stays
  // put, so fold the scroll delta into the pointer x (mirrors
  // resolveTimelineMove's originScrollLeft handling).
  const originScrollLeft = resize.originScrollLeft ?? scroll?.scrollLeft ?? 0;
  const effectiveClientX = clientX + ((scroll?.scrollLeft ?? originScrollLeft) - originScrollLeft);

  const sourceRemaining =
    resize.element.sourceDuration != null
      ? Math.max(
          0,
          (resize.element.sourceDuration - (resize.element.playbackStart ?? 0)) /
            Math.max(resize.element.playbackRate ?? 1, 0.1),
        )
      : Number.POSITIVE_INFINITY;
  const normalizedTag = resize.element.tag.toLowerCase();
  const canSeedPlaybackStart =
    resize.element.kind === "composition" || normalizedTag === "audio" || normalizedTag === "video";
  const playbackRate = Math.max(resize.element.playbackRate ?? 1, 0.1);
  // Trim limit = available source media only — NOT the composition length.
  // Duration is content-driven (the comp grows/shrinks to fit on commit), so
  // capping a trim at the current comp end both blocked extending the last clip
  // rightward and, after a far move, collapsed a clip to the sliver between its
  // start and the comp end (the 8s→0.95s audio incident). Images/text/shapes
  // have no source, so they extend freely.
  const maxEnd = resize.element.start + sourceRemaining;
  let nextResize = resolveTimelineResize(
    {
      start: resize.element.start,
      duration: resize.element.duration,
      originClientX: resize.originClientX,
      pixelsPerSecond: pps,
      minStart: 0,
      maxEnd,
      playbackStart:
        resize.edge === "start" && canSeedPlaybackStart
          ? (resize.element.playbackStart ?? 0)
          : resize.element.playbackStart,
      playbackRate: resize.element.playbackRate,
    },
    resize.edge,
    effectiveClientX,
  );

  // Snap to beats and clip edges, never the playhead (the dragged edge drives
  // its own preview seek, so that would be circular). Stay inside the same
  // limits resolveTimelineResize enforces. The music track defines the
  // beats, so it must not snap to them, but still snaps to clip edges.
  const trimTargets = buildSnapTargets(
    resize.element.key ?? resize.element.id,
    !isMusicTrack(resize.element),
    false,
  );
  let snap: TimelineSnapTarget | null = null;
  if (trimTargets.length > 0) {
    const snapSecs = TIMELINE_SNAP_PX / Math.max(pps, 1);
    if (resize.edge === "end") {
      const edgeTime = nextResize.start + nextResize.duration;
      const { time: snapped, target } = snapTimelineTime(edgeTime, trimTargets, snapSecs);
      // Stay within [start+minDuration, maxEnd] so the snap can't create a
      // degenerate clip or run past the source/composition limit.
      const snappedDuration = Math.round((snapped - nextResize.start) * 1000) / 1000;
      if (target && snapped <= maxEnd + 1e-6 && snappedDuration >= 0.05) {
        // An edge already on the target still owns the guide; only move it when off.
        if (snapped !== edgeTime) nextResize = { ...nextResize, duration: snappedDuration };
        snap = target;
      }
    } else {
      const { time: snapped, target } = snapTimelineTime(nextResize.start, trimTargets, snapSecs);
      const delta = nextResize.start - snapped; // >0 when snapping left
      // Leftward snap reveals more source; cap so playbackStart can't go < 0.
      const maxLeftDelta =
        nextResize.playbackStart != null
          ? nextResize.playbackStart / playbackRate
          : Number.POSITIVE_INFINITY;
      // Also require the resulting duration to stay >= minDuration so a rightward
      // snap (delta < 0) can't collapse the clip to zero/negative.
      const snappedDuration = Math.round((nextResize.duration + delta) * 1000) / 1000;
      if (target && snapped >= 0 && delta <= maxLeftDelta + 1e-6 && snappedDuration >= 0.05) {
        if (snapped !== nextResize.start) {
          nextResize = {
            ...nextResize,
            start: snapped,
            duration: snappedDuration,
            playbackStart:
              nextResize.playbackStart != null
                ? Math.round(Math.max(0, nextResize.playbackStart - delta * playbackRate) * 1000) /
                  1000
                : undefined,
          };
        }
        snap = target;
      }
    }
  }

  return {
    originScrollLeft,
    previewStart: nextResize.start,
    previewDuration: nextResize.duration,
    previewPlaybackStart: nextResize.playbackStart,
    snapTime: snap?.time ?? null,
    snapType: snap?.type ?? null,
  };
}

/**
 * Apply a rigid group-resize preview: fold the grabbed clip's raw delta into the
 * session and publish a coordinator-owned projection. Canonical elements stay
 * pristine until the exactly-once commit.
 */
export function previewGroupResize(
  session: TimelineGroupResizeSession,
  next: ResizePreviewResult,
  setResizeState: (
    v: ResizePreviewResult & { groupPreview: TimelineGroupResizeSession["changes"] },
  ) => void,
): void {
  const grabbedChange = applyTimelineGroupResizePreview(session, next);
  const previewStart = grabbedChange?.start ?? next.previewStart;
  const previewDuration = grabbedChange?.duration ?? next.previewDuration;
  // A member clamp can pull the grabbed edge off the raw snap target; then no guide.
  const edgeTime = session.edge === "end" ? previewStart + previewDuration : previewStart;
  const stillSnapped = next.snapTime != null && Math.abs(edgeTime - next.snapTime) < 1e-3;
  setResizeState({
    originScrollLeft: next.originScrollLeft,
    previewStart,
    previewDuration,
    previewPlaybackStart: grabbedChange?.playbackStart ?? next.previewPlaybackStart,
    snapTime: stillSnapped ? next.snapTime : null,
    snapType: stillSnapped ? next.snapType : null,
    groupPreview: session.changes,
  });
}
