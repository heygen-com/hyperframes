import { describe, expect, it } from "vitest";
import { authoredTrackForLane, laneForAuthoredTrack } from "./timelineAuthoredTrack";
import type { TimelineElement } from "../store/playerStore";

/**
 * A clip on a display lane, with the authored track it came from.
 *
 * The two differ on purpose in most of these: a composition whose authored
 * tracks are 0, 4 and 9 packs onto lanes 0, 1 and 2, and that gap is the whole
 * reason this translation exists.
 */
function clip(
  id: string,
  lane: number,
  authoredTrack: number,
  sourceFile = "index.html",
): TimelineElement {
  return {
    id,
    tag: "div",
    start: 0,
    duration: 1,
    track: lane,
    authoredTrack,
    sourceFile,
  } as TimelineElement;
}

/** Authored 0, 4, 9 packed onto lanes 0, 1, 2. */
const SPARSE = [clip("a", 0, 0), clip("b", 1, 4), clip("c", 2, 9)];

describe("laneForAuthoredTrack", () => {
  it("puts a declared track on the lane its own clips occupy", () => {
    expect(laneForAuthoredTrack(4, SPARSE, "index.html")).toEqual({ kind: "lane", lane: 1 });
    expect(laneForAuthoredTrack(9, SPARSE, "index.html")).toEqual({ kind: "lane", lane: 2 });
  });

  // The number the agent writes is not the row the user sees.
  it("does not mistake the authored number for the lane number", () => {
    expect(laneForAuthoredTrack(9, SPARSE, "index.html")).not.toEqual({ kind: "lane", lane: 9 });
  });

  it("gives two declarations on one track the same lane", () => {
    expect(laneForAuthoredTrack(4, SPARSE, "index.html")).toEqual(
      laneForAuthoredTrack(4, SPARSE, "index.html"),
    );
  });

  // A whole new track is the most interesting thing an agent can declare.
  it("reports a track with no clips anywhere as provisional", () => {
    expect(laneForAuthoredTrack(12, SPARSE, "index.html")).toEqual({ kind: "provisional" });
  });

  it("reports every track as provisional on an empty timeline", () => {
    expect(laneForAuthoredTrack(0, [], "index.html")).toEqual({ kind: "provisional" });
    expect(laneForAuthoredTrack(7, [], "index.html")).toEqual({ kind: "provisional" });
  });

  // An expanded sub-composition's rows carry authored numbers from their own
  // file; matching one would draw on a row belonging to another composition.
  it("ignores a clip that only matches in a different source file", () => {
    const elsewhere = [clip("x", 0, 0, "index.html"), clip("y", 1, 4, "scenes/intro.html")];
    expect(laneForAuthoredTrack(4, elsewhere, "index.html")).toEqual({ kind: "provisional" });
    expect(laneForAuthoredTrack(4, elsewhere, "scenes/intro.html")).toEqual({
      kind: "lane",
      lane: 1,
    });
  });

  it("treats a declaration with no file as being about the unnamed file", () => {
    const unnamed = [{ ...clip("a", 0, 3), sourceFile: undefined } as TimelineElement];
    expect(laneForAuthoredTrack(3, unnamed, null)).toEqual({ kind: "lane", lane: 0 });
    expect(laneForAuthoredTrack(3, unnamed, "index.html")).toEqual({ kind: "provisional" });
  });

  // Lane 0 is a real answer and must not read as "nowhere".
  it("distinguishes lane zero from having no lane", () => {
    expect(laneForAuthoredTrack(0, SPARSE, "index.html")).toEqual({ kind: "lane", lane: 0 });
  });
});

describe("laneForAuthoredTrack and authoredTrackForLane", () => {
  // The two directions have to agree, or a skeleton lands somewhere a clip
  // dragged to the same row would not persist to.
  it("round-trips every authored track in a sparse file", () => {
    for (const element of SPARSE) {
      const authored = element.authoredTrack!;
      const lane = laneForAuthoredTrack(authored, SPARSE, "index.html");
      expect(lane).toEqual({ kind: "lane", lane: element.track });

      const dragged = { ...element, id: "dragged", key: "dragged" } as TimelineElement;
      expect(authoredTrackForLane(element.track, SPARSE, dragged)).toBe(authored);
    }
  });
});
