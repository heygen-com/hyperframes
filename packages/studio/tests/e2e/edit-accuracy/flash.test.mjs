import { describe, expect, it } from "vitest";
import { classify, unwrap } from "./flash.mjs";

const TOL = 10;
// One row per painted frame: its marker counter and [vsBefore, vsAfter] differing pixels per pane.
const before = (counter) => ({ counter, diffs: { preview: [0, 50] } });
const after = (counter) => ({ counter, diffs: { preview: [50, 0] } });
const neither = (counter) => ({ counter, diffs: { preview: [50, 50] } });
const times = Array.from({ length: 20 }, (_, n) => n * 16);
const win = (inputN) => ({
  from: 1,
  to: 8,
  times,
  inputs: [{ type: "pointerup", n: inputN, t: 40 }],
});

describe("classify", () => {
  it("passes an input whose next frame already shows the after-state", () => {
    const w = classify(
      [before(1), before(2), after(3), after(4), after(5), after(6), after(7), after(8)],
      win(2),
      TOL,
    );
    expect(w.paint).toEqual({ frames: 1, ms: 8 });
    expect(w.bad).toEqual([]);
    expect(w.coverage).toBe(1);
  });

  it("counts frames that hold the old state after the input", () => {
    const rows = [
      before(1),
      before(2),
      before(3),
      before(4),
      after(5),
      after(6),
      after(7),
      after(8),
    ];
    expect(classify(rows, win(2), TOL).paint).toEqual({ frames: 3, ms: 40 });
  });

  it("flags a frame that is neither state as a flash and as late paint", () => {
    const w = classify(
      [before(1), before(2), after(3), neither(4), after(5), after(6), after(7), after(8)],
      win(2),
      TOL,
    );
    expect(w.bad.map((b) => b.counter)).toEqual([4]);
    expect(w.longest).toBe(1);
    expect(w.paint.frames).toBe(3);
  });

  it("counts a frame the screencast delivered twice once", () => {
    const rows = [
      before(1),
      before(2),
      neither(3),
      neither(3),
      after(4),
      after(5),
      after(6),
      after(7),
      after(8),
    ];
    const w = classify(rows, win(2), TOL);
    expect(w.bad.map((b) => b.frame)).toEqual([2]);
    expect(w.frames).toBe(8);
  });

  it("reports missing counters and never guesses paint without a logged input", () => {
    const w = classify([before(1), after(4), after(8)], { from: 1, to: 8, times, inputs: [] }, TOL);
    expect(w.coverage).toBe(3 / 8);
    expect(w.missing).toEqual([
      [1, 2],
      [4, 6],
    ]);
    expect(w.paint).toBeNull();
  });
});

describe("unwrap", () => {
  it("restores counters past the marker's 1024 states, including a frame from just before the window", () => {
    const codes = [1028 % 1024, 1022, 1030 % 1024, 1034 % 1024, 1100 % 1024].map((counter) => ({
      counter,
    }));
    expect(unwrap(codes, 1030).map((r) => r.counter)).toEqual([1028, 1022, 1030, 1034, 1100]);
  });
});
