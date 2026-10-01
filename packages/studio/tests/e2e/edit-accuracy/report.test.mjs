import { describe, expect, it } from "vitest";
import { score, UNDO_WRITE_MAX_MS } from "./report.mjs";

const frames = { intervals: [16, 17, 16], work: [2, 3, 2] };
const result = (undo) => ({
  tracking: { max: 0 },
  pressJump: 0,
  drop: 0,
  reload: 0,
  render: 0,
  undo: { bytes: true, redoBytes: true, box: 0, redoBox: 0, ...undo },
  smooth: { ...frames, control: frames },
  unsettled: [],
});
const undoCheck = (undo) => score({ id: "case" }, result(undo)).checks.undo;

describe("the undo check", () => {
  it("passes an undo and redo whose writes land within the limit of their keys", () => {
    expect(undoCheck({ ms: UNDO_WRITE_MAX_MS, redoMs: 80 })).toBe(true);
  });

  it("fails an undo or a redo whose write lands later than the limit", () => {
    expect(undoCheck({ ms: UNDO_WRITE_MAX_MS + 1, redoMs: 80 })).toBe(false);
    expect(undoCheck({ ms: 80, redoMs: UNDO_WRITE_MAX_MS + 1 })).toBe(false);
  });
});
