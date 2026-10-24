// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { toAuthoredStart } from "../store/timelineElement";
import type { ClipManifestClip } from "../lib/playbackTypes";
import { createTimelineElementFromManifestClip } from "../lib/timelineDOM";
import { normalizeToZones } from "./timelineZones";
import { commitDraggedClipMove, type TimelineMoveEdit } from "./timelineClipDragCommit";
import type { DraggedClipState } from "./useTimelineClipDrag";
import { applyTimelineMoveAttributes, buildPatchTarget } from "../../hooks/timelineEditingHelpers";
import { planDropTrackInsert } from "../../utils/timelineDropTrackInsert";

/**
 * Pipeline test across the REAL manifest→element boundary: no hand-injected
 * `authoredTrack` / `stackingContextId`. A runtime-manifest-shaped payload with
 * SPARSE authored tracks flows through createTimelineElementFromManifestClip →
 * (normalizeToZones | buildChildElements) → commitDraggedClipMove, and the
 * persisted data-track-index must be the AUTHORED target, never the display lane.
 */

const manifestClip = (over: Partial<ClipManifestClip>): ClipManifestClip => ({
  id: "x",
  label: "x",
  start: 0,
  duration: 2,
  track: 0,
  stackingContextId: "root",
  kind: "element",
  tagName: "div",
  compositionId: null,
  parentCompositionId: null,
  compositionSrc: null,
  assetUrl: null,
  ...over,
});

function fromManifest(clips: ClipManifestClip[]): TimelineElement[] {
  return clips.map((clip, index) =>
    createTimelineElementFromManifestClip({ clip, fallbackIndex: index }),
  );
}

function drag(
  element: TimelineElement,
  opts: { previewStart: number; previewTrack: number; insertRow?: number },
): DraggedClipState {
  return {
    element,
    originClientX: 0,
    originClientY: 0,
    originScrollLeft: 0,
    originScrollTop: 0,
    pointerClientX: 0,
    pointerClientY: 0,
    pointerOffsetX: 0,
    pointerOffsetY: 0,
    previewStart: opts.previewStart,
    previewTrack: opts.previewTrack,
    desiredTrack: opts.previewTrack,
    insertRow: opts.insertRow ?? null,
    snapTime: null,
    snapType: null,
    started: true,
  };
}

/** Commit a lane-change drag and return the single persisted edit batch. */
function commitLaneChange(
  element: TimelineElement,
  previewTrack: number,
  elements: TimelineElement[],
  trackOrder: number[],
): TimelineMoveEdit[] {
  const onMoveElements = vi.fn();
  commitDraggedClipMove(drag(element, { previewStart: element.start, previewTrack }), {
    elements,
    trackOrder,
    updateElement: vi.fn(),
    onMoveElements,
  });
  expect(onMoveElements).toHaveBeenCalledTimes(1);
  return onMoveElements.mock.calls[0][0] as TimelineMoveEdit[];
}

describe("track persist pipeline (manifest → factory → lanes → drag commit)", () => {
  // Sparse authored tracks 3 and 7 (mixed kinds), plus audio on 5, exactly as a
  // runtime manifest would ship them (clip.track is the verbatim data-track-index).
  const sparseManifest = [
    manifestClip({ id: "v", kind: "video", tagName: "video", track: 3, start: 0 }),
    manifestClip({ id: "g", kind: "element", tagName: "div", track: 7, start: 10 }),
    manifestClip({ id: "m", kind: "audio", tagName: "audio", track: 5, start: 0 }),
  ];

  it("factory records the authored track and stacking context from the manifest clip", () => {
    const [v, g, m] = fromManifest(sparseManifest);
    expect([v.authoredTrack, g.authoredTrack, m.authoredTrack]).toEqual([3, 7, 5]);
    expect(v.stackingContextId).toBe("root");
  });

  it("a lane change on a sparse file persists the AUTHORED target track, not the display lane", () => {
    // normalizeToZones packs visual tracks {3, 7} onto display lanes {0, 1} and
    // the audio track 5 onto lane 2, preserving the factory-set authoredTrack.
    const elements = normalizeToZones(fromManifest(sparseManifest));
    const byId = new Map(elements.map((e) => [e.id, e]));
    expect(byId.get("v")).toMatchObject({ track: 0, authoredTrack: 3 });
    expect(byId.get("g")).toMatchObject({ track: 1, authoredTrack: 7 });
    expect(byId.get("m")).toMatchObject({ track: 2, authoredTrack: 5 });

    // Drag the video (lane 0) onto the div's lane (display 1, authored 7).
    const down = commitLaneChange(byId.get("v")!, 1, elements, [0, 1, 2]);
    expect(down).toHaveLength(1);
    expect(down[0].updates.track).toBe(7); // authored, NOT display lane 1
    expect(down[0].updates.track).not.toBe(1);

    // And the reverse: the div (lane 1) onto the video's lane (display 0, authored 3).
    const up = commitLaneChange(byId.get("g")!, 0, elements, [0, 1, 2]);
    expect(up[0].updates.track).toBe(3); // authored, NOT display lane 0
  });
});

describe("track insert next to runtime-stamped wrapper rows", () => {
  // Untimed id'd wrappers around timed videos: inside Studio the runtime stamps each wrapper
  // (core runtime/init.ts), so it becomes a row whose timing is not in the file.
  const SOURCE = `<div id="root" data-composition-id="main" data-start="0" data-duration="6">
  <div id="w1"><video class="clip" src="a.mp4" data-start="0" data-duration="2" data-track-index="0" muted></video></div>
  <div id="w2"><video class="clip" src="a.mp4" data-start="2" data-duration="2" data-track-index="0" muted></video></div>
  <div id="w3"><video class="clip" src="a.mp4" data-start="4" data-duration="2" data-track-index="0" muted></video></div>
</div>`;

  function stampedPreview(): TimelineElement[] {
    const doc = new DOMParser().parseFromString(SOURCE, "text/html");
    const clips: TimelineElement[] = [];
    // Manifest order is DOM order; an untracked row falls back to its node index as its track.
    ["w1", "w2", "w3"].forEach((id, i) => {
      const wrapper = doc.getElementById(id)!;
      wrapper.setAttribute("data-start", "0");
      wrapper.setAttribute("data-duration", "6");
      wrapper.setAttribute("data-hf-autostamped", "1");
      const video = wrapper.querySelector("video")!;
      const wrapperClip = manifestClip({ id, label: id, duration: 6, track: 2 * i + 1 });
      const videoClip = manifestClip({
        id: null,
        label: `video ${i}`,
        kind: "video",
        tagName: "video",
        start: 2 * i,
        track: 0,
      });
      clips.push(
        createTimelineElementFromManifestClip({
          clip: wrapperClip,
          fallbackIndex: 2 * i,
          doc,
          hostEl: wrapper,
        }),
        createTimelineElementFromManifestClip({
          clip: videoClip,
          fallbackIndex: 2 * i + 1,
          doc,
          hostEl: video,
        }),
      );
    });
    return normalizeToZones(clips);
  }

  /** Drag the first video onto a new bottom track with `selected` (plus it) moving along;
   *  returns the source as useTimelineGroupEditing saves it. */
  function insertTrackAndSave(selectedDomIds: string[]): Document {
    const elements = stampedPreview();
    const videos = elements.filter((e) => !e.domId);
    const selected = [...videos, ...elements.filter((e) => selectedDomIds.includes(e.domId!))];
    const trackOrder = [...new Set(elements.map((e) => e.track))].sort((a, b) => a - b);
    const onMoveElements = vi.fn();
    const row = trackOrder.length;
    commitDraggedClipMove(drag(videos[0], { previewStart: 0, previewTrack: row, insertRow: row }), {
      elements,
      trackOrder,
      updateElement: vi.fn(),
      onMoveElements,
      selectedKeys: new Set(selected.map((e) => e.key ?? e.id)),
    });
    expect(onMoveElements).toHaveBeenCalledTimes(1);
    const saved = (onMoveElements.mock.calls[0][0] as TimelineMoveEdit[]).reduce(
      (html, edit) =>
        applyTimelineMoveAttributes(
          html,
          buildPatchTarget(edit.element)!,
          toAuthoredStart(edit.element, edit.updates.start),
          edit.element.duration,
          edit.updates.track,
        ),
      SOURCE,
    );
    return new DOMParser().parseFromString(saved, "text/html");
  }

  it("moving the selected videos onto a new track writes no timing onto the wrappers", () => {
    const doc = insertTrackAndSave([]);
    for (const id of ["w1", "w2", "w3"]) {
      const wrapper = doc.getElementById(id)!;
      expect(wrapper.hasAttribute("data-start"), id).toBe(false);
      expect(wrapper.hasAttribute("data-track-index"), id).toBe(false);
    }
    expect(doc.querySelector("#w1 video")?.getAttribute("data-track-index")).not.toBe("0");
  });

  it("a wrapper the user selected is renumbered with the tracks it moves among", () => {
    const doc = insertTrackAndSave(["w2"]);
    expect(doc.getElementById("w2")?.getAttribute("data-track-index")).toBe("1");
    expect(doc.getElementById("w1")?.hasAttribute("data-track-index")).toBe(false);
  });

  it("a dropped asset opening a new track renumbers no wrapper", () => {
    const elements = stampedPreview();
    const trackOrder = [...new Set(elements.map((e) => e.track))].sort((a, b) => a - b);
    const plan = planDropTrackInsert({
      elements,
      trackOrder,
      insertRow: 0,
      dropped: { id: "new", tag: "img", start: 0, duration: 1 },
    });
    // The three videos shift down; only the wrappers carry an id.
    expect(plan?.renumbers).toHaveLength(3);
    expect(plan?.renumbers.filter((r) => r.element.domId)).toEqual([]);
  });
});
