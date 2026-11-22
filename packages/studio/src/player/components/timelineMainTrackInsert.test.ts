import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { resolveMainTrackInsert } from "./timelineMainTrackInsert";

function el(id: string, start: number, duration: number, track = 0): TimelineElement {
  return { id, tag: "video", start, duration, track, domId: id };
}

const starts = (moves: ReturnType<typeof resolveMainTrackInsert>) =>
  Object.fromEntries((moves ?? []).map((m) => [m.element.id, m.start]));

describe("resolveMainTrackInsert", () => {
  const a = el("a", 0, 2);
  const b = el("b", 2, 2);
  const c = el("c", 4, 2);

  it("puts a clip dropped onto the first clip's spot first and moves the others right", () => {
    expect(starts(resolveMainTrackInsert([a, b, c], c, 0.05, true))).toEqual({ c: 0, a: 2, b: 4 });
  });

  it("puts a clip dropped onto a later clip's spot before it and closes the gap it left", () => {
    expect(starts(resolveMainTrackInsert([a, b, c], a, 4, true))).toEqual({ b: 0, a: 2 });
  });

  it("moves a linked partner with its clip", () => {
    const cLinked = { ...c, link: "l1" };
    const cAudio = { ...el("c-audio", 4, 2, 1), tag: "audio", link: "l1" };
    const moves = resolveMainTrackInsert([a, b, cLinked, cAudio], cLinked, 0, true);
    expect(starts(moves)).toEqual({ c: 0, a: 2, b: 4, "c-audio": 0 });
  });

  it("is null when the drop overlaps no clip, and empty when the order stays the same", () => {
    expect(resolveMainTrackInsert([a, el("far", 8, 2)], a, 4, true)).toBeNull();
    expect(resolveMainTrackInsert([a, b, c], b, 2.5, true)).toEqual([]);
  });

  it("is null when a linked partner would land on a clip that stays in its lane", () => {
    const cLinked = { ...c, link: "l1" };
    const cAudio = { ...el("c-audio", 4, 2, 1), tag: "audio", link: "l1" };
    const music = { ...el("music", 0, 2, 1), tag: "audio" };
    expect(resolveMainTrackInsert([a, b, cLinked, cAudio, music], cLinked, 0, true)).toBeNull();
  });

  // fails without the fix: each partner was checked only against clips that stay put.
  it("is null when two moving linked partners would overlap each other in one lane", () => {
    const aLinked = { ...a, link: "la" };
    const aAudio = { ...el("a-audio", 0, 2, 1), tag: "audio", link: "la" };
    const cLinked = { ...c, link: "lc" };
    const cAudio = { ...el("c-audio", 4.5, 2, 1), tag: "audio", link: "lc" };
    const all = [aLinked, b, cLinked, aAudio, cAudio];
    expect(resolveMainTrackInsert(all, cLinked, 0, true)).toBeNull();
  });

  // fails without the fix: a partner's new start was never checked against 0.
  it("is null when a linked partner would start before 0", () => {
    const cLinked = { ...c, link: "l1" };
    const cAudio = { ...el("c-audio", 3, 2, 1), tag: "audio", link: "l1" };
    expect(resolveMainTrackInsert([a, b, cLinked, cAudio], cLinked, 0, true)).toBeNull();
  });

  it("is null when a clip that would move is locked", () => {
    const lockedA = { ...a, timelineLocked: true };
    expect(resolveMainTrackInsert([lockedA, b, c], c, 0, true)).toBeNull();
  });
});
