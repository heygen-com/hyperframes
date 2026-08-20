import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import {
  applyTimelineTrimPreview,
  buildTimelineTrimSession,
  canStartTimelineTrim,
} from "./timelineTrimSession";

function el(id: string, over: Partial<TimelineElement> = {}): TimelineElement {
  return { id, key: id, tag: "video", start: 0, duration: 2, track: 0, domId: id, ...over };
}

/** a(0-2) and b(2-3) butted on track 0; c(0-4) sits alone on track 1. */
const A = el("a", { start: 0, duration: 2 });
const B = el("b", { start: 2, duration: 3, playbackStart: 1, sourceDuration: 20 });
const C = el("c", { start: 0, duration: 4, track: 1 });
const ELEMENTS = [A, B, C];

const NO_SNAP = { playheadTime: null, beatTimes: [], snapEnabled: false };

describe("canStartTimelineTrim", () => {
  it("accepts a ripple on any editable clip", () => {
    expect(canStartTimelineTrim(A, "ripple", "end", ELEMENTS)).toBe(true);
  });

  it("refuses a roll into a lane that has no clip across the cut", () => {
    expect(canStartTimelineTrim(A, "roll", "end", ELEMENTS)).toBe(true);
    expect(canStartTimelineTrim(B, "roll", "end", ELEMENTS)).toBe(false);
    // c is alone on its own lane — no edit point on either side.
    expect(canStartTimelineTrim(C, "roll", "start", ELEMENTS)).toBe(false);
  });

  it("refuses a slip on generated pixels, which have no source to re-point", () => {
    // The store reports playbackStart: 0 for a div too, so the refusal has to
    // come from the element's kind — not from the number being absent.
    const div = el("text", { tag: "div", start: 0, duration: 4, playbackStart: 0, track: 2 });
    expect(div.playbackStart).toBe(0);
    expect(canStartTimelineTrim(div, "slip", "end", [div])).toBe(false);
    expect(canStartTimelineTrim(B, "slip", "end", ELEMENTS)).toBe(true);
  });

  it("refuses when a clip the operation would rewrite is locked", () => {
    const locked = [A, { ...B, timelineLocked: true }];
    // The ripple would have to shift b, and b cannot be moved.
    expect(canStartTimelineTrim(A, "ripple", "end", locked)).toBe(false);
    // Trimming b's own edge is likewise refused.
    expect(canStartTimelineTrim(A, "roll", "end", locked)).toBe(false);
  });

  it("only considers clips on the grabbed clip's own lane", () => {
    // c is at 0-4 on lane 1 and overlaps both lane-0 clips in time; it must not
    // become a ripple follower or a roll partner.
    const session = buildTimelineTrimSession(A, "ripple", "end", {
      elements: ELEMENTS,
      ...NO_SNAP,
    });
    expect(session?.members.map((m) => m.key)).toEqual(["a", "b"]);
  });
});

describe("applyTimelineTrimPreview", () => {
  const session = () =>
    buildTimelineTrimSession(A, "ripple", "end", { elements: ELEMENTS, ...NO_SNAP })!;

  it("projects the grabbed change and every follower", () => {
    const s = session();
    const grabbed = applyTimelineTrimPreview(s, 0.5, 100);
    expect(grabbed).toMatchObject({ key: "a", duration: 2.5 });
    expect(s.changes.map((c) => [c.key, c.start])).toEqual([
      ["a", 0],
      ["b", 2.5],
    ]);
    expect(s.hasChanged).toBe(true);
  });

  it("reports no change for a delta that moves nothing", () => {
    const s = session();
    expect(applyTimelineTrimPreview(s, 0, 100)).toBeUndefined();
    expect(s.hasChanged).toBe(false);
  });

  it("carries the live element on every change so the commit can persist it", () => {
    const s = session();
    applyTimelineTrimPreview(s, 0.5, 100);
    expect(s.changes.map((c) => c.element.id)).toEqual(["a", "b"]);
  });

  it("leaves the in point off a clip that only moves, exactly as a drag would", () => {
    const s = session();
    applyTimelineTrimPreview(s, 0.5, 100);
    // b only travels: writing an in point here would stamp an attribute that a
    // plain drag of the same clip never writes.
    expect(s.changes.find((c) => c.key === "b")?.playbackStart).toBeUndefined();
    // a is trimmed at its out point — its in point is untouched too.
    expect(s.changes.find((c) => c.key === "a")?.playbackStart).toBeUndefined();
  });

  it("snaps the moving edge to the playhead, ignoring the clips that ride along", () => {
    // Playhead at 2.6s; a's out point starts at 2 and the drag asks for +0.4.
    const s = buildTimelineTrimSession(A, "ripple", "end", {
      elements: ELEMENTS,
      playheadTime: 2.6,
      beatTimes: [],
      snapEnabled: true,
    })!;
    // b's own edges (2 and 5) are excluded — they move with the trim.
    expect(s.trim.snapTargets.map((t) => t.time)).toEqual([0, 2.6, 4]);
    const grabbed = applyTimelineTrimPreview(s, 0.55, 100);
    expect(grabbed?.duration).toBe(2.6);
  });
});
