import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  computeSnapshotTimes,
  parseZoomScale,
  requireSnapshotFfmpeg,
  resolveSnapshotVideoFrameTime,
  tailFrameTime,
} from "./snapshot.js";

// --zoom's crop-region math (selector bbox + padding + clamp, exact region
// form, no-match error) is owned by and tested in
// ../capture/captureCompositionFrame.test.ts alongside its implementation.

describe("tailFrameTime", () => {
  it("backs off ~3% of duration so the final frame isn't the blank exact-end", () => {
    // Verified on the V4 3D artifact: t=8.0 of an 8s clip rendered blank white,
    // t=7.76 rendered the final hero. 8 - 8*0.03 = 7.76.
    expect(tailFrameTime(8)).toBeCloseTo(7.76, 5);
  });

  it("uses a 50ms floor for short clips", () => {
    expect(tailFrameTime(1)).toBeCloseTo(0.95, 5); // 1 - 0.05 (floor beats 3%)
  });

  it("never goes negative", () => {
    expect(tailFrameTime(0)).toBe(0);
  });
});

describe("transparent snapshot capture", () => {
  it("asks Chrome to retain the alpha channel in review PNGs", () => {
    const source = readFileSync(new URL("./snapshot.ts", import.meta.url), "utf8");
    expect(source).toContain(
      'page.screenshot({ path: framePath, type: "png", omitBackground: true })',
    );
  });
});

describe("resolveSnapshotVideoFrameTime", () => {
  it("keeps media active at the inclusive clip end and samples its last decodable frame", () => {
    expect(
      resolveSnapshotVideoFrameTime({
        globalTime: 15,
        clipStart: 0,
        clipDuration: 15,
        relativeTime: 15,
        sourceDuration: 15,
      }),
    ).toBeCloseTo(15 - 1 / 30, 6);
  });

  it("keeps ordinary in-window media timestamps unchanged", () => {
    expect(
      resolveSnapshotVideoFrameTime({
        globalTime: 7.5,
        clipStart: 0,
        clipDuration: 15,
        relativeTime: 7.5,
        sourceDuration: 15,
      }),
    ).toBe(7.5);
  });

  it("does not activate media after the clip end", () => {
    expect(
      resolveSnapshotVideoFrameTime({
        globalTime: 15.001,
        clipStart: 0,
        clipDuration: 15,
        relativeTime: 15.001,
        sourceDuration: 15,
      }),
    ).toBeNull();
  });

  it.each([
    {
      name: "before clip start",
      input: {
        globalTime: 4.9,
        clipStart: 5,
        clipDuration: 10,
        relativeTime: 0,
        sourceDuration: 10,
      },
      expected: null,
    },
    {
      name: "negative relative time",
      input: {
        globalTime: 5,
        clipStart: 5,
        clipDuration: 10,
        relativeTime: -0.1,
        sourceDuration: 10,
      },
      expected: null,
    },
    {
      name: "unknown source duration",
      input: {
        globalTime: 15,
        clipStart: 5,
        clipDuration: 10,
        relativeTime: 10,
        sourceDuration: 0,
      },
      expected: 10 - 1 / 30,
    },
    {
      name: "offset clip inclusive end",
      input: {
        globalTime: 15,
        clipStart: 5,
        clipDuration: 10,
        relativeTime: 10,
        sourceDuration: 10,
      },
      expected: 10 - 1 / 30,
    },
    {
      name: "clip end within floating-point tolerance",
      input: {
        globalTime: 15 + 5e-10,
        clipStart: 5,
        clipDuration: 10,
        relativeTime: 10,
        sourceDuration: 10,
      },
      expected: 10 - 1 / 30,
    },
  ])("handles $name", ({ input, expected }) => {
    const result = resolveSnapshotVideoFrameTime(input);
    if (expected === null) expect(result).toBeNull();
    else expect(result).toBeCloseTo(expected, 6);
  });
});

describe("computeSnapshotTimes (FINDING [7]: tail is always captured)", () => {
  it("default frames: last point is the readable tail, never exact duration", () => {
    const { times, appendedTail } = computeSnapshotTimes(8, { frames: 5 });
    expect(times).toHaveLength(5);
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBeCloseTo(7.76, 5);
    expect(times[times.length - 1]).toBeLessThan(8); // not the blank exact-end
    expect(appendedTail).toBe(false);
  });

  it("single frame samples the midpoint", () => {
    expect(computeSnapshotTimes(8, { frames: 1 }).times).toEqual([4]);
  });

  it("explicit --at: keeps the user's times AND appends an end-of-timeline frame", () => {
    const { times, appendedTail } = computeSnapshotTimes(8, { frames: 5, at: [1, 2, 3] });
    expect(times.slice(0, 3)).toEqual([1, 2, 3]);
    expect(times[times.length - 1]).toBeCloseTo(7.76, 5);
    expect(appendedTail).toBe(true);
  });

  it("explicit --at: does not double-add when the user already sampled the tail", () => {
    const { times, appendedTail } = computeSnapshotTimes(8, { frames: 5, at: [1, 7.76] });
    expect(times).toEqual([1, 7.76]);
    expect(appendedTail).toBe(false);
  });

  it("explicit --at: a sample at exact duration counts as the tail (no append)", () => {
    const { appendedTail } = computeSnapshotTimes(8, { frames: 5, at: [1, 8] });
    expect(appendedTail).toBe(false);
  });

  it("respects includeEnd:false opt-out for --at", () => {
    const { times, appendedTail } = computeSnapshotTimes(8, {
      frames: 5,
      at: [1, 2],
      includeEnd: false,
    });
    expect(times).toEqual([1, 2]);
    expect(appendedTail).toBe(false);
  });

  it("preserves exact explicit transition timestamps", () => {
    const exactTransition = 3.3666666666666667;
    const { times } = computeSnapshotTimes(8, {
      frames: 5,
      at: [exactTransition],
      includeEnd: false,
    });
    expect(times).toEqual([exactTransition]);
  });
});

describe("parseZoomScale (--zoom-scale)", () => {
  it("defaults to 3 when unset", () => {
    expect(parseZoomScale(undefined)).toBe(3);
  });

  it("honors an explicit scale", () => {
    expect(parseZoomScale("2")).toBe(2);
  });

  it("falls back to the default for invalid or non-positive input", () => {
    expect(parseZoomScale("abc")).toBe(3);
    expect(parseZoomScale("0")).toBe(3);
    expect(parseZoomScale("-1")).toBe(3);
  });
});

describe("requireSnapshotFfmpeg", () => {
  it("rejects video snapshot extraction when FFmpeg is unavailable", () => {
    expect(() => requireSnapshotFfmpeg(undefined)).toThrow(
      /FFmpeg is required to extract video frames for snapshots/,
    );
  });

  it("preserves the resolved FFmpeg executable", () => {
    expect(requireSnapshotFfmpeg("C:\\tools\\ffmpeg.exe")).toBe("C:\\tools\\ffmpeg.exe");
  });
});
