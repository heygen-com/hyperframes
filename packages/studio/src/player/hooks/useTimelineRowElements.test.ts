import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { selectTimelineRowElements } from "./useTimelineRowElements";

const el = (id: string, domId?: string): TimelineElement => ({
  id,
  domId,
  start: 0,
  duration: 1,
  track: 0,
  tag: "div",
});

describe("selectTimelineRowElements", () => {
  it("drops an element the shared definition does not call top-level", () => {
    const rows = selectTimelineRowElements([el("a", "a"), el("b", "b")], new Set(["a"]));
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("keeps everything until the document has been read", () => {
    const all = [el("a", "a"), el("b", "b")];
    expect(selectTimelineRowElements(all, null)).toBe(all);
  });

  it("keeps an element with no DOM id", () => {
    expect(selectTimelineRowElements([el("k")], new Set())).toHaveLength(1);
  });
});
