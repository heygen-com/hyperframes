import { expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { timelineRows } from "./timelineRowKeys";

const el = (id: string, track: number, authoredTrack?: number, tag = "div"): TimelineElement => ({
  id,
  tag,
  start: 0,
  duration: 1,
  track,
  ...(authoredTrack === undefined ? {} : { authoredTrack }),
});

it("keys rows by zone and authored track, numbering repeats and empty lanes apart, and finds each row's clips", () => {
  const rows = timelineRows([
    [0, [el("a", 0, 3)]],
    [1, [el("b", 1, 3)]],
    [2, [el("c", 2, 3, "audio")]],
    [3, []],
  ]);
  expect([0, 1, 2, 3, 9].map(rows.reactKey)).toEqual([
    "visual:3",
    "visual:3#1",
    "audio:3",
    "lane:3",
    "lane:9",
  ]);
});
