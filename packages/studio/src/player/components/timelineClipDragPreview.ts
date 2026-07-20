import { resolveTimelineMove, resolveTimelineResize } from "./timelineEditing";
import type { TimelineElement } from "../store/playerStore";
import { TRACK_H, getTimelineRowFromY, INSERT_BOUNDARY_BAND } from "./timelineLayout";
import { isMusicTrack, isAudioTimelineElement } from "../../utils/timelineInspector";
import {
  TIMELINE_SNAP_PX,
  snapMoveToTargets,
  snapTimelineTime,
  type TimelineSnapTarget,
} from "./timelineSnapping";
import { resolveInsertRow, resolveZoneDropPlacement } from "./timelineCollision";
import {
  applyTimelineGroupResizePreview,
  type TimelineGroupResizeSession,
} from "./timelineGroupEditing";
import { clampGroupMoveDelta } from "./timelineMultiDragPreview";
import type { DraggedClipState, ResizingClipState } from "./timelineClipDragTypes";

/** Snap-target builder closure supplied by the hook (closes over refs + store). */
type BuildSnapTargets = (
  excludeElementKey: string | null,
  includeBeats: boolean,
) => TimelineSnapTarget[];

export interface DragPreviewContext {
  scroll: HTMLDivElement | null;
  pps: number;
  duration: number;
  trackOrder: number[];
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
  const { scroll, trackOrder, elements } = ctx;
  // rowFloat = the pointer's position in track-heights from the top lane; a
  // near-boundary hover requests a deliberate new-track insert. Uses the
  // shared row→y inverse so the top breathing pad is subtracted consistently.
  const rowFloat = scroll
    ? getTimelineRowFromY(clientY - scroll.getBoundingClientRect().top + scroll.scrollTop)
    : 0;
  // Geometry-exact band (the clip inset) so an insert only arms in the visible
  // gutter BETWEEN clip bodies — dragging over a clip body is a lane move, never a
  // phantom insert (the plain-horizontal-drag misfire). See INSERT_BOUNDARY_BAND.
  const rawInsertRow = resolveInsertRow(rowFloat, trackOrder.length, INSERT_BOUNDARY_BAND);
  // Pointer sub-row half: when a drop must auto-create a track (aimed span
  // occupied, no free lane), open it on the side the pointer is nearer.
  const preferInsertAbove = rowFloat - Math.floor(rowFloat) < 0.5;
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
    dragKey: drag.element.key ?? drag.element.id,
    isAudio: isAudioTimelineElement(drag.element),
    preferInsertAbove,
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
  const nextMove = resolveTimelineMove(
    {
      start: drag.element.start,
      track: drag.element.track,
      duration: drag.element.duration,
      originClientX: drag.originClientX,
      originClientY: drag.originClientY,
      originScrollLeft: drag.originScrollLeft,
      originScrollTop: drag.originScrollTop,
      currentScrollLeft: scroll?.scrollLeft ?? drag.originScrollLeft,
      currentScrollTop: scroll?.scrollTop ?? drag.originScrollTop,
      pixelsPerSecond: pps,
      trackHeight: TRACK_H,
      maxStart: dragMaxStart,
      trackOrder,
    },
    clientX,
    clientY,
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
  return {
    ...drag,
    started: true,
    pointerClientX: clientX,
    pointerClientY: clientY,
    previewStart,
    previewTrack,
    // The lane the POINTER aims at (pre-collision): the commit reads it to tell a
    // deliberate vertical lane change from a horizontal drag merely bumped sideways.
    desiredTrack: nextMove.track,
    insertRow,
    snapTime: snap.snapTime,
    snapType: snap.snapType,
  };
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

  // Snap edge to unified targets (beats + clip edges + playhead) when available.
  // The snap must stay inside the same limits resolveTimelineResize enforces, or
  // it would push the edge past the available source media / composition end.
  // The music track defines the beats, so it must not snap to them — but it
  // still snaps to the playhead and other clip edges.
  const trimTargets = buildSnapTargets(
    resize.element.key ?? resize.element.id,
    !isMusicTrack(resize.element),
  );
  if (trimTargets.length > 0) {
    const snapSecs = TIMELINE_SNAP_PX / Math.max(pps, 1);
    if (resize.edge === "end") {
      const edgeTime = nextResize.start + nextResize.duration;
      const snapped = snapTimelineTime(edgeTime, trimTargets, snapSecs).time;
      // Stay within [start+minDuration, maxEnd] so the snap can't create a
      // degenerate clip or run past the source/composition limit.
      const snappedDuration = Math.round((snapped - nextResize.start) * 1000) / 1000;
      if (snapped !== edgeTime && snapped <= maxEnd + 1e-6 && snappedDuration >= 0.05) {
        nextResize = { ...nextResize, duration: snappedDuration };
      }
    } else {
      const snapped = snapTimelineTime(nextResize.start, trimTargets, snapSecs).time;
      const delta = nextResize.start - snapped; // >0 when snapping left
      // Leftward snap reveals more source; cap so playbackStart can't go < 0.
      const maxLeftDelta =
        nextResize.playbackStart != null
          ? nextResize.playbackStart / playbackRate
          : Number.POSITIVE_INFINITY;
      // Also require the resulting duration to stay >= minDuration so a rightward
      // snap (delta < 0) can't collapse the clip to zero/negative.
      const snappedDuration = Math.round((nextResize.duration + delta) * 1000) / 1000;
      if (
        snapped !== nextResize.start &&
        snapped >= 0 &&
        delta <= maxLeftDelta + 1e-6 &&
        snappedDuration >= 0.05
      ) {
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
    }
  }

  return {
    originScrollLeft,
    previewStart: nextResize.start,
    previewDuration: nextResize.duration,
    previewPlaybackStart: nextResize.playbackStart,
  };
}

/**
 * Apply a rigid group-resize preview: fold the grabbed clip's raw delta into the
 * session, preview every non-grabbed member through the store (`updateElement`),
 * and set the grabbed clip's preview state (it renders from resizingClip state, so
 * its store value stays pristine until commit — like the single-clip path).
 */
export function previewGroupResize(
  session: TimelineGroupResizeSession,
  next: ResizePreviewResult,
  grabbedKey: string,
  updateElement: (
    key: string,
    patch: { start: number; duration: number; playbackStart?: number },
  ) => void,
  setResizeState: (v: ResizePreviewResult) => void,
): void {
  const grabbedChange = applyTimelineGroupResizePreview(session, next);
  for (const c of session.changes) {
    if (c.key === grabbedKey) continue;
    updateElement(c.key, { start: c.start, duration: c.duration, playbackStart: c.playbackStart });
  }
  setResizeState({
    originScrollLeft: next.originScrollLeft,
    previewStart: grabbedChange?.start ?? next.previewStart,
    previewDuration: grabbedChange?.duration ?? next.previewDuration,
    previewPlaybackStart: grabbedChange?.playbackStart ?? next.previewPlaybackStart,
  });
}
