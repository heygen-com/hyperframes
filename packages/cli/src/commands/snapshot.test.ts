import { describe, expect, it, vi } from "vitest";
import { computeSnapshotTimes, seekSnapshotPage, tailFrameTime } from "./snapshot.js";

// fallow-ignore-next-line code-duplication
function withWindowValue(value: unknown, run: () => void): void {
  const hadWindow = Reflect.has(globalThis, "window");
  const previousWindow = Reflect.get(globalThis, "window");
  Reflect.set(globalThis, "window", value);
  try {
    run();
  } finally {
    if (hadWindow) {
      Reflect.set(globalThis, "window", previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
}

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
});

describe("seekSnapshotPage", () => {
  it("flushes GSAP ticker after seeking when GSAP is present", () => {
    const renderSeek = vi.fn();
    const tick = vi.fn();
    const animeUpdate = vi.fn();
    withWindowValue(
      {
        __player: { renderSeek },
        gsap: { ticker: { tick } },
        anime: { engine: { update: animeUpdate } },
      },
      () => {
        seekSnapshotPage(1.5);
      },
    );

    expect(renderSeek).toHaveBeenCalledWith(1.5);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(animeUpdate).not.toHaveBeenCalled();
  });

  it("flushes anime engine when GSAP ticker is unavailable", () => {
    const seek = vi.fn();
    const update = vi.fn();
    withWindowValue(
      {
        __player: { seek },
        anime: { engine: { update } },
      },
      () => {
        seekSnapshotPage(2);
      },
    );

    expect(seek).toHaveBeenCalledWith(2);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
