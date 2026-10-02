import { describe, expect, it } from "vitest";
import { smoothness } from "./case.mjs";

const thread = { pid: 1, tid: 2 };
const mark = { name: "edit-bench-end", cat: "blink.user_timing", ts: 1_000_000, ...thread };
const task = (ts, dur, tdur) => ({ name: "RunTask", ph: "X", ts, dur, tdur, ...thread });
// Frame stamps 50, 66 and 82 ms before a mark at 100 ms: trace time 950, 966 and 982 ms.
const rec = (tasks) => ({ frames: [50, 66, 82], mark: 100, long: [], trace: [mark, ...tasks] });

describe("smoothness work per frame", () => {
  it("measures the frames when only a task before them lacks thread time", () => {
    const s = smoothness(rec([task(900_000, 10_000), task(960_000, 4_000, 4_000)]));
    expect(s.work).toEqual([4, 0]);
    expect(s.untimedOutside).toBe(1);
  });

  it("leaves the work unknown when a task inside the frames lacks thread time", () => {
    const s = smoothness(rec([task(960_000, 4_000)]));
    expect(s.work).toBeNull();
  });
});
