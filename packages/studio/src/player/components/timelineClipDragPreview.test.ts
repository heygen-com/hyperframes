import { describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import {
  computeDragPreview,
  computeResizePreview,
  getTimelineDragOverlayPosition,
  type DragPreviewContext,
} from "./timelineClipDragPreview";
import type { DraggedClipState } from "./timelineClipDragTypes";
import { commitDraggedClipMove } from "./timelineClipDragCommit";
import { LANE_H, RULER_H, TRACKS_TOP_PAD, TRACK_H } from "./timelineLayout";

// ─────────────────────────────────────────────────────────────────────────────
// Regression bed for the live-reproduced BUG 1: a PLAIN HORIZONTAL drag of a clip
// on its own top lane armed a phantom new-track insert (the old 0.32 insert band
// reached deep into the clip body). That insert flipped the commit into the
// lane-change branch, which nudged the clip's z-index and re-sorted it off its
// lane. The invariant: a horizontal drag over a clip BODY → insertRow === null,
// previewTrack unchanged (a pure time move — zero topology change, zero z sync).
//
// Elements mirror the user's index.html shapes: a high-z "v-moodboard" alone on
// the top display lane, over several lower-lane video clips it overlaps in time,
// plus a caption. Tracks here are already the normalized DISPLAY lanes (the store
// runs normalizeToZones on discovery), matching what the drag hook passes in.
// ─────────────────────────────────────────────────────────────────────────────

const PPS = 40;

function clip(
  id: string,
  track: number,
  start: number,
  duration: number,
  zIndex: number,
  tag = "video",
): TimelineElement {
  return { id, key: id, tag, start, duration, track, zIndex, domId: id };
}

// v-moodboard: own top lane (0). Lower lane (1) carries overlapping video clips;
// captions sit on lane 2. trackOrder = [0, 1, 2].
const moodboard = clip("v-moodboard", 0, 19, 5.5, 37);
const fixtureElements: TimelineElement[] = [
  moodboard,
  clip("v-dashboard", 1, 19, 4, 16),
  clip("v-globe", 1, 23, 1.5, 17),
  clip("cap", 2, 20.82, 1.78, 0, "text"),
];

// A scroll container whose content-space y equals clientY (rect top 0, no scroll).
function fakeScroll(): HTMLDivElement {
  return {
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    scrollLeft: 0,
    scrollTop: 0,
    scrollWidth: 100000,
  } as unknown as HTMLDivElement;
}

function ctx(
  rowHeights?: readonly number[],
  elements: TimelineElement[] = fixtureElements,
): DragPreviewContext {
  return {
    scroll: fakeScroll(),
    pps: PPS,
    duration: 44.5,
    trackOrder: [0, 1, 2],
    elements,
    rowHeights,
    selectedKeys: new Set<string>(),
    buildSnapTargets: () => [],
    audioTracks: new Set<number>(),
  };
}

// content-space y for a fractional row index (inverse of getTimelineRowFromY).
const yForRow = (rowFloat: number) => RULER_H + TRACKS_TOP_PAD + rowFloat * TRACK_H;

// A drag grabbing `element` at vertical position `grabRowFloat` within its lane.
function horizontalDrag(
  element: TimelineElement,
  grabRowFloat: number,
  deltaSeconds: number,
): { drag: DraggedClipState; clientX: number; clientY: number } {
  const originClientX = 800;
  const originClientY = yForRow(grabRowFloat);
  const drag: DraggedClipState = {
    pointerId: 0,
    element,
    originClientX,
    originClientY,
    originScrollLeft: 0,
    originScrollTop: 0,
    pointerClientX: originClientX,
    pointerClientY: originClientY,
    pointerOffsetX: 0,
    pointerOffsetY: 0,
    previewStart: element.start,
    previewTrack: element.track,
    insertRow: null,
    snapTime: null,
    snapType: null,
    started: true,
  };
  // Horizontal: clientY stays at the grab point; only x advances by the delta.
  return { drag, clientX: originClientX + deltaSeconds * PPS, clientY: originClientY };
}

describe("computeDragPreview — plain horizontal drag never arms a phantom insert (BUG 1)", () => {
  it("dragging v-moodboard +2s while grabbing its clip body keeps it a pure time move", () => {
    const { drag, clientX, clientY } = horizontalDrag(moodboard, 0.5, 2);
    const next = computeDragPreview(drag, clientX, clientY, ctx());
    expect(next.insertRow).toBeNull(); // no phantom new-track insert
    expect(next.previewTrack).toBe(0); // stays on its own lane
    expect(next.desiredTrack).toBe(0); // pointer never left lane 0 → not a vertical aim
    expect(next.previewStart).toBeCloseTo(21, 5); // +2s moved
  });

  it("grabbing ANYWHERE across the clip body (not just dead-center) stays a pure time move", () => {
    // Sweep the whole clip body of lane 0; a horizontal drag must never insert.
    for (let grab = 0.1; grab <= 0.9 + 1e-9; grab += 0.1) {
      const { drag, clientX, clientY } = horizontalDrag(moodboard, grab, 2);
      const next = computeDragPreview(drag, clientX, clientY, ctx());
      expect(next.insertRow).toBeNull();
      expect(next.previewTrack).toBe(0);
    }
  });

  it("aiming the gutter ABOVE the top lane arms a top insert (UX rule 2)", () => {
    // Drag v-moodboard up into the top breathing pad → insert a new top track.
    const originClientX = 800;
    const originClientY = yForRow(0.5);
    const drag: DraggedClipState = {
      pointerId: 0,
      element: moodboard,
      originClientX,
      originClientY,
      originScrollLeft: 0,
      originScrollTop: 0,
      pointerClientX: originClientX,
      pointerClientY: originClientY,
      pointerOffsetX: 0,
      pointerOffsetY: 0,
      previewStart: moodboard.start,
      previewTrack: moodboard.track,
      insertRow: null,
      snapTime: null,
      snapType: null,
      started: true,
    };
    // Pointer well above the first lane (into the top pad → rowFloat < 0).
    const next = computeDragPreview(drag, originClientX, yForRow(-0.6), ctx());
    expect(next.insertRow).toBe(0); // a new TOP track will be created on drop
  });

  it("keeps a horizontal drag in the body of an expanded row out of insert mode", () => {
    const rowHeights = [TRACK_H + 2 * LANE_H, TRACK_H, TRACK_H];
    const clientY = RULER_H + TRACKS_TOP_PAD + rowHeights[0] - 8;
    const { drag, clientX } = horizontalDrag(moodboard, 0.5, 2);
    const next = computeDragPreview(
      { ...drag, originClientY: clientY, pointerClientY: clientY },
      clientX,
      clientY,
      ctx(rowHeights),
    );
    expect(next.insertRow).toBeNull();
    expect(next.previewTrack).toBe(0);
  });

  it("uses the expanded row midpoint when choosing the side for a group drag's automatic insert", () => {
    const rowHeights = [TRACK_H + 2 * LANE_H, TRACK_H];
    const dragged = clip("dragged", 0, 0, 1, 3);
    const occupied = [dragged, clip("block-0", 0, 0, 1, 2), clip("block-1", 1, 0, 1, 1)];
    const clientY = RULER_H + TRACKS_TOP_PAD + 30;
    const drag: DraggedClipState = {
      pointerId: 0,
      element: dragged,
      originClientX: 0,
      originClientY: clientY,
      originScrollLeft: 0,
      originScrollTop: 0,
      pointerClientX: 0,
      pointerClientY: clientY,
      pointerOffsetX: 0,
      pointerOffsetY: 0,
      previewStart: 0,
      previewTrack: 0,
      insertRow: null,
      snapTime: null,
      snapType: null,
      started: true,
    };
    const next = computeDragPreview(drag, 0, clientY, {
      ...ctx(rowHeights, occupied),
      trackOrder: [0, 1],
      selectedKeys: new Set(["dragged", "block-1"]),
    });
    expect(next.insertRow).toBe(0);
    // A single clip dropped on the same occupied lanes stays put and overwrites instead.
    const single = computeDragPreview(drag, 0, clientY, {
      ...ctx(rowHeights, occupied),
      trackOrder: [0, 1],
    });
    expect(single.insertRow).toBeNull();
    expect(single.previewTrack).toBe(0);
  });
});

describe("computeDragPreview — magnetic first clip on an empty main track", () => {
  // v-lower sits alone on lane 1; lane 0 (the main track) is empty.
  const vLower = clip("v-lower", 1, 10, 4, 5);

  // Grab v-lower mid-body on lane 1, aim at `targetRowFloat` (same x — no
  // horizontal move), against the given sibling elements and selection.
  function dragUpToMainTrack(
    elements: TimelineElement[],
    targetRowFloat = 0.5,
    selectedKeys: ReadonlySet<string> = new Set(),
  ) {
    const originClientY = yForRow(1.5);
    const drag: DraggedClipState = {
      pointerId: 0,
      element: vLower,
      originClientX: 800,
      originClientY,
      originScrollLeft: 0,
      originScrollTop: 0,
      pointerClientX: 800,
      pointerClientY: originClientY,
      pointerOffsetX: 0,
      pointerOffsetY: 0,
      previewStart: vLower.start,
      previewTrack: vLower.track,
      insertRow: null,
      snapTime: null,
      snapType: null,
      started: true,
    };
    return computeDragPreview(drag, 800, yForRow(targetRowFloat), {
      ...ctx(undefined, elements),
      trackOrder: [0, 1],
      selectedKeys,
    });
  }

  it("dragging straight up onto the empty main track snaps the preview start to 0", () => {
    const next = dragUpToMainTrack([vLower]);
    expect(next.previewTrack).toBe(0);
    expect(next.insertRow).toBeNull();
    expect(next.previewStart).toBe(0);
  });

  it("does not touch the start once the main track already holds a clip", () => {
    const vMain = clip("v-main", 0, 0, 3, 5);
    const next = dragUpToMainTrack([vLower, vMain]);
    expect(next.previewStart).toBe(10); // unchanged — main track wasn't empty
  });

  it("aiming the top gutter over an empty main track snaps the ghost: the insert renumbers onto track 0", () => {
    const next = dragUpToMainTrack([vLower], -0.6);
    expect(next.insertRow).toBe(0);
    expect(next.previewStart).toBe(0);
  });

  it("does not retime the rest of a multi-selection when the grabbed clip lands on the empty main track", () => {
    const vOther = clip("v-other", 1, 15, 3, 5);
    const next = dragUpToMainTrack([vLower, vOther], 0.5, new Set(["v-lower", "v-other"]));
    expect(next.previewTrack).toBe(0);
    // The grabbed clip's OWN vertical-only move must not force a horizontal
    // shift that resolveMultiSelection would then apply to v-other.
    expect(next.previewStart).toBe(10);
  });
});

describe("computeResizePreview — composition source continuity", () => {
  it("seeds a legacy composition offset and advances it at playback rate", () => {
    const element = {
      ...clip("comp", 0, 2, 4, 0, "div"),
      kind: "composition" as const,
      playbackRate: 2,
    };
    const result = computeResizePreview(
      {
        element,
        edge: "start",
        originClientX: 0,
        previewStart: 2,
        previewDuration: 4,
        started: true,
      },
      100,
      { scroll: fakeScroll(), pps: 100, buildSnapTargets: () => [] },
    );

    expect(result).toMatchObject({
      previewStart: 3,
      previewDuration: 3,
      previewPlaybackStart: 2,
    });
  });
});

describe("getTimelineDragOverlayPosition", () => {
  it("keeps the gesture actor under the pointer across two-axis autoscroll", () => {
    const { drag } = horizontalDrag(moodboard, 0.5, 2);
    const scroll = {
      scrollLeft: 500,
      scrollTop: 300,
      getBoundingClientRect: () => ({ left: 20, top: 40 }),
    } as Pick<HTMLDivElement, "scrollLeft" | "scrollTop" | "getBoundingClientRect">;
    expect(
      getTimelineDragOverlayPosition(
        {
          ...drag,
          pointerClientX: 900,
          pointerClientY: 700,
          pointerOffsetX: 25,
          pointerOffsetY: 10,
        },
        scroll,
      ),
    ).toEqual({ left: 1_355, top: 950 });
  });

  it("does not mount an actor before threshold or without the stable viewport", () => {
    const { drag } = horizontalDrag(moodboard, 0.5, 2);
    expect(getTimelineDragOverlayPosition({ ...drag, started: false }, fakeScroll())).toBeNull();
    expect(getTimelineDragOverlayPosition(drag, null)).toBeNull();
  });
});

describe("computeDragPreview — the ghost start is the committed start", () => {
  function preview(
    element: TimelineElement,
    elements: TimelineElement[],
    originRow: number,
    targetRowFloat: number,
    selectedKeys: ReadonlySet<string> = new Set(),
  ): DraggedClipState {
    const originClientY = yForRow(originRow + 0.5);
    const drag: DraggedClipState = {
      pointerId: 0,
      element,
      originClientX: 800,
      originClientY,
      originScrollLeft: 0,
      originScrollTop: 0,
      pointerClientX: 800,
      pointerClientY: originClientY,
      pointerOffsetX: 0,
      pointerOffsetY: 0,
      previewStart: element.start,
      previewTrack: element.track,
      insertRow: null,
      snapTime: null,
      snapType: null,
      started: true,
    };
    return computeDragPreview(drag, 800, yForRow(targetRowFloat), {
      ...ctx(undefined, elements),
      trackOrder: [0, 1, 2],
      selectedKeys,
    });
  }

  function committedStart(
    ghost: DraggedClipState,
    committed: TimelineElement,
    elements: TimelineElement[],
    selectedKeys: ReadonlySet<string> = new Set(),
  ): number | undefined {
    const onMoveElement = vi.fn();
    const onMoveElements = vi.fn();
    commitDraggedClipMove(ghost, {
      elements,
      trackOrder: [0, 1, 2],
      updateElement: vi.fn(),
      onMoveElement,
      onMoveElements,
      selectedKeys,
    });
    const edits = onMoveElements.mock.calls[0]?.[0] as
      | Array<{ element: TimelineElement; updates: { start: number } }>
      | undefined;
    const single = onMoveElement.mock.calls[0];
    if (single) return single[1].start;
    return edits?.find((e) => e.element.id === committed.id)?.updates.start;
  }

  const lower = clip("lower", 1, 10, 4, 5);

  it("plain move onto the empty main track", () => {
    const ghost = preview(lower, [lower], 1, 0.5);
    expect(ghost.previewStart).toBe(0);
    expect(committedStart(ghost, lower, [lower])).toBe(ghost.previewStart);
  });

  it("top-gutter insert that pushes the old track-0 clip down lands on track 0 at 0", () => {
    const oldMain = clip("old-main", 0, 0, 3, 5);
    const elements = [oldMain, lower];
    const ghost = preview(lower, elements, 1, -0.6);
    expect(ghost.insertRow).toBe(0);
    expect(ghost.previewStart).toBe(0);
    expect(committedStart(ghost, lower, elements)).toBe(0);
  });

  it("top-gutter insert with a clip staying on track 0 keeps the pointer start", () => {
    const stays = clip("stays", 0, 0, 3, 5);
    const elements = [stays, lower];
    // Insert between lane 0 and 1: the resident track-0 clip does not move.
    const ghost = preview(lower, elements, 1, 1.0);
    expect(ghost.previewStart).toBe(10);
    expect(committedStart(ghost, lower, elements)).toBe(10);
  });

  it("expanded child dragged with its host: the host commits at 0 and the ghost matches", () => {
    for (const [hostStart, childStart] of [
      [30, 32],
      [20, 22],
    ]) {
      const host = clip("host", 1, hostStart, 10, 5);
      const child: TimelineElement = {
        ...clip("child", 2, childStart, 4, 5),
        expandedHostKey: "host",
        expandedParentStart: hostStart,
      };
      const elements = [host, child];
      const keys = new Set(["host", "child"]);
      const ghost = preview(child, elements, 2, 0.5, keys);
      expect(ghost.previewTrack).toBe(0);
      expect(ghost.previewStart).toBe(childStart - hostStart);
      expect(committedStart(ghost, host, elements, keys)).toBe(0);
    }
  });
});
