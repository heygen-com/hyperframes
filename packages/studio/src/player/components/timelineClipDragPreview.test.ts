import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import {
  computeDragPreview,
  computeResizePreview,
  type DragPreviewContext,
} from "./timelineClipDragPreview";
import type { DraggedClipState } from "./timelineClipDragTypes";
import { RULER_H, TRACKS_TOP_PAD, TRACK_H } from "./timelineLayout";

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

function ctx(): DragPreviewContext {
  return {
    scroll: fakeScroll(),
    pps: PPS,
    duration: 44.5,
    trackOrder: [0, 1, 2],
    elements: fixtureElements,
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
