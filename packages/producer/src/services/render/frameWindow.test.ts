import { describe, expect, it } from "vitest";
import { assertRangeSupported, resolveFrameWindow } from "./frameWindow.js";

const fps30 = { num: 30, den: 1 };
const ntsc = { num: 30000, den: 1001 };

describe("resolveFrameWindow", () => {
  it("covers the frames from the start to the end second", () => {
    expect(resolveFrameWindow({ startSeconds: 2.5, endSeconds: 4 }, fps30, 300)).toEqual({
      startFrame: 75,
      endFrame: 120,
    });
  });

  it("runs to the film's end without an end, and stops there when the end is past it", () => {
    expect(resolveFrameWindow({ startSeconds: 9 }, fps30, 300)).toEqual({
      startFrame: 270,
      endFrame: 300,
    });
    expect(resolveFrameWindow({ startSeconds: 9, endSeconds: 60 }, fps30, 300)).toEqual({
      startFrame: 270,
      endFrame: 300,
    });
  });

  it("lands on exact frames at a rational frame rate", () => {
    // 1001 s at 30000/1001 fps is exactly 30000 frames; a float fps of 29.97 would give 30000.03.
    expect(resolveFrameWindow({ startSeconds: 1001, endSeconds: 2002 }, ntsc, 90_000)).toEqual({
      startFrame: 30_000,
      endFrame: 60_000,
    });
    expect(resolveFrameWindow({ startSeconds: 1.001 }, ntsc, 300)).toEqual({
      startFrame: 30,
      endFrame: 300,
    });
  });

  it("refuses a range that holds no frame", () => {
    expect(() => resolveFrameWindow({ startSeconds: 10 }, fps30, 300)).toThrow(/holds no frame/);
    expect(() => resolveFrameWindow({ startSeconds: 2, endSeconds: 2.01 }, fps30, 300)).toThrow(
      /holds no frame/,
    );
  });
});

describe("assertRangeSupported", () => {
  const window = { startFrame: 75, endFrame: 120 };

  it("lets the disk and layered routes capture a window", () => {
    expect(() => assertRangeSupported(window, "sdr_disk")).not.toThrow();
    expect(() => assertRangeSupported(window, "hdr_layered")).not.toThrow();
  });

  it("refuses a window on the streaming routes, which render whole films", () => {
    expect(() => assertRangeSupported(window, "sdr_streaming")).toThrow(
      /renders the whole film only/,
    );
    expect(() => assertRangeSupported(window, "sdr_segmented")).toThrow(
      /renders the whole film only/,
    );
  });
});
