import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CANVAS_NUDGE_COMMIT_DEBOUNCE_MS } from "../../../src/components/editor/domEditNudge";
import { pressNudges, saveFault, shownAfterKeys, timedWrite } from "./case.mjs";
import { slowest } from "./sequences.mjs";
import { score, UNDO_WRITE_MAX_MS } from "./report.mjs";

const measured = (undoTimeout, ms = 80) => ({
  tracking: { max: 0.1 },
  pressJump: 0,
  teleport: null,
  drop: 0,
  reload: 0,
  render: 0,
  undo: { bytes: true, redoBytes: true, box: 0, redoBox: 0, ms, redoMs: 80 },
  undoTimeout,
  smooth: { intervals: [16], work: [2], control: { intervals: [16], work: [2] } },
  unsettled: [],
});

describe("undo and redo saves", () => {
  it("names the first lost write, or none", () => {
    const ok = { reached: true, ms: 80 };
    expect(
      saveFault([
        ["undo", ok],
        ["redo", ok],
      ]),
    ).toBe(null);
    expect(
      saveFault([
        ["undo", ok],
        ["redo", { reached: false }],
      ]),
    ).toBe("redo lost");
  });

  it("fails undo on a late or lost save even when the bytes come back right", () => {
    expect(score({}, measured(null)).checks.undo).toBe(true);
    expect(score({}, measured(null, UNDO_WRITE_MAX_MS + 1)).checks.undo).toBe(false);
    expect(score({}, measured("redo lost")).checks.undo).toBe(false);
  });

  it("times a write from its key, and fails undo past the limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "edit-bench-save-"));
    writeFileSync(join(dir, "index.html"), "after");
    const ctx = { dir, files: ["index.html"] };
    const from = { "index.html": "before" };
    const undoIn = async (ago) => {
      const w = await timedWrite(ctx, from, Date.now() - ago);
      return score({}, measured(null, w.ms)).checks.undo;
    };
    expect(await undoIn(UNDO_WRITE_MAX_MS - 1000)).toBe(true);
    expect(await undoIn(UNDO_WRITE_MAX_MS + 1000)).toBe(false);
  });

  it("judges a sequence's undo walk by its slowest write", () => {
    const walk = [{ ms: 60 }, { ms: UNDO_WRITE_MAX_MS + 500 }, { ms: 70 }];
    expect(slowest(walk)).toBe(UNDO_WRITE_MAX_MS + 500);
    expect(slowest([])).toBe(null);
    expect(score({}, measured(null, slowest(walk))).checks.undo).toBe(false);
    expect(score({}, measured(null, slowest(walk.slice(0, 1)))).checks.undo).toBe(true);
  });
});

describe("a nudge burst", () => {
  it("presses every key inside Studio's burst window, however slow a frame is", async () => {
    vi.useFakeTimers();
    try {
      const pressedAt = [];
      const page = {
        keyboard: { press: async () => void pressedAt.push(Date.now()) },
        // A frame longer than the burst window, as the GPU stall after a rotate gave on CI.
        evaluate: () => new Promise((r) => setTimeout(r, CANVAS_NUDGE_COMMIT_DEBOUNCE_MS + 50)),
      };
      const pressed = pressNudges(page, 3);
      await vi.runAllTimersAsync();
      await pressed;
      expect(pressedAt).toHaveLength(3);
      expect(pressedAt.at(-1) - pressedAt[0]).toBeLessThan(CANVAS_NUDGE_COMMIT_DEBOUNCE_MS);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the box after a nudge burst", () => {
  const at = (x) => ({
    visible: [
      [x, 0],
      [x + 10, 0],
      [x + 10, 10],
      [x, 10],
    ],
  });
  // A sealed preview draws a burst a frame round trip after its keys; until then it shows the box where it was.
  const preview = (shown) => {
    let frames = 0;
    return {
      read: async () => at(shown(frames)),
      frame: async () => void ((frames += 1), vi.advanceTimersByTime(16)),
    };
  };

  it("is the drawn box, not the one shown before the preview drew the keys", async () => {
    vi.useFakeTimers();
    try {
      const { read, frame } = preview((frames) => (frames < 3 ? 0 : 3));
      expect((await shownAfterKeys(read, at(0).visible, frame)).visible).toEqual(at(3).visible);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up at its deadline with the undrawn box when the keys never draw, so the step still fails", async () => {
    vi.useFakeTimers();
    try {
      const { read, frame } = preview(() => 0);
      const start = Date.now();
      expect((await shownAfterKeys(read, at(0).visible, frame)).visible).toEqual(at(0).visible);
      expect(Date.now() - start).toBeGreaterThanOrEqual(2000);
      expect(Date.now() - start).toBeLessThan(2100);
    } finally {
      vi.useRealTimers();
    }
  });
});
