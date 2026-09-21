import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../player";
import {
  applyTrackRenumbers,
  planDropTrackInsert,
  resolveDropTrack,
} from "./timelineDropTrackInsert";

function clip(id: string, track: number, start: number): TimelineElement {
  return {
    id,
    key: id,
    tag: "div",
    start,
    duration: 2,
    track,
    authoredTrack: track,
    hfId: `hf-${id}`,
    domId: id,
    // Main-document elements carry no sourceFile, as in production.
  };
}

const trackOrder = [0, 1, 2];
const dropped = { id: "new", tag: "img", start: 5, duration: 3 };
const elements = [clip("a", 0, 0), clip("b", 1, 0), clip("c", 2, 0)];
const source = elements
  .map(
    (e) =>
      `<div data-hf-id="${e.hfId}" id="${e.id}" data-start="0" data-track-index="${e.track}"></div>`,
  )
  .join("\n");

describe("planDropTrackInsert", () => {
  it("opens a lane between two rows and pushes the lanes below down", () => {
    const plan = planDropTrackInsert({ elements, trackOrder, insertRow: 1, dropped });
    expect(plan?.track).toBe(1);
    expect(plan?.renumbers.map((r) => [r.element.id, r.track])).toEqual([
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("opens a lane above the first row", () => {
    const plan = planDropTrackInsert({ elements, trackOrder, insertRow: 0, dropped });
    expect(plan?.track).toBe(0);
    expect(plan?.renumbers.map((r) => [r.element.id, r.track])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("still renumbers when the peers' own sourceFile is a real path, not undefined", () => {
    const subComp = elements.map((e) => ({ ...e, sourceFile: "sub.html" }));
    const plan = planDropTrackInsert({ elements: subComp, trackOrder, insertRow: 1, dropped });
    expect(plan?.track).toBe(1);
    expect(plan?.renumbers.map((r) => [r.element.id, r.track])).toEqual([
      ["b", 2],
      ["c", 3],
    ]);
  });
});

describe("planDropTrackInsert against the display row order", () => {
  it("counts an audio-group anchor row the way a clip drag does", () => {
    // Rows shown: group anchor (-0.5), track 0, track 1. Row boundary 2 is between 0 and 1.
    const grouped = elements.slice(0, 2).map((e) => (e.id === "a" ? { ...e, audioGroup: "g" } : e));
    const plan = planDropTrackInsert({
      elements: grouped,
      trackOrder: [-0.5, 0, 1],
      insertRow: 2,
      dropped,
    });
    expect(plan?.track).toBe(1);
    expect(plan?.renumbers.map((r) => [r.element.id, r.track])).toEqual([["b", 2]]);
  });
});

describe("applyTrackRenumbers", () => {
  it("rewrites only the renumbered clips' data-track-index", () => {
    const plan = planDropTrackInsert({ elements, trackOrder, insertRow: 1, dropped });
    const out = applyTrackRenumbers(source, plan!);
    const tracks = [...out.matchAll(/id="(\w)"[^>]*data-track-index="(\d+)"/g)].map((m) => [
      m[1],
      +m[2],
    ]);
    expect(tracks).toEqual([
      ["a", 0],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("throws when a clip's opening tag is missing", () => {
    const plan = planDropTrackInsert({ elements, trackOrder, insertRow: 1, dropped });
    expect(() => applyTrackRenumbers("<div></div>", plan!)).toThrow(/Cannot renumber/);
  });
});

describe("resolveDropTrack", () => {
  it("keeps the aimed lane and the source when no insert is asked for", () => {
    const out = resolveDropTrack({
      source,
      elements,
      placement: { track: 2 },
      dropped,
    });
    expect(out).toEqual({ source, track: 2 });
  });

  it("returns the new lane and the source with the lanes below pushed down", () => {
    const out = resolveDropTrack({
      source,
      elements,
      placement: { track: 1, insertRow: 1, trackOrder },
      dropped,
    });
    expect(out.track).toBe(1);
    expect(out.source).toContain('id="b" data-start="0" data-track-index="2"');
  });

  it("refuses to insert when a locked clip would have to move", () => {
    const locked = elements.map((e) => (e.id === "b" ? { ...e, timelineLocked: true } : e));
    expect(() =>
      resolveDropTrack({
        source,
        elements: locked,
        placement: { track: 1, insertRow: 1, trackOrder },
        dropped,
      }),
    ).toThrow(/locked/);
  });
});
