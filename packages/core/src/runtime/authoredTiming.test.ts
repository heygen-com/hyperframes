import { describe, expect, it } from "vitest";

const timingModule = await import("./authoredTiming.js").catch(() => null);

describe("resolveAuthoredTimingWindow", () => {
  const resolve = (values: {
    start?: string | null;
    duration?: string | null;
    authoredDuration?: string | null;
    end?: string | null;
    authoredEnd?: string | null;
  }) => {
    expect(timingModule, "canonical authored timing helper must exist").not.toBeNull();
    return timingModule?.resolveAuthoredTimingWindow(values) ?? null;
  };

  it("uses public timing before preserved timing and duration before end", () => {
    expect(
      resolve({
        start: "2",
        duration: "3",
        authoredDuration: "4",
        end: "20",
        authoredEnd: "30",
      }),
    ).toEqual({ start: 2, duration: 3, end: 5 });
  });

  it("falls back through preserved duration, public end, and preserved end", () => {
    expect(resolve({ start: "1", duration: "", authoredDuration: "2.5" })).toEqual({
      start: 1,
      duration: 2.5,
      end: 3.5,
    });
    expect(resolve({ start: "1", duration: "0", end: "4", authoredEnd: "8" })).toEqual({
      start: 1,
      duration: 3,
      end: 4,
    });
    expect(resolve({ start: "1", duration: "-1", end: "NaN", authoredEnd: "6" })).toEqual({
      start: 1,
      duration: 5,
      end: 6,
    });
  });

  it("rejects unusable values and preserves a usable start-only window", () => {
    expect(resolve({ start: null, duration: "2" })).toBeNull();
    expect(resolve({ start: "Infinity", duration: "2" })).toBeNull();
    expect(resolve({ start: "1.25", duration: "NaN", end: "1.25" })).toEqual({
      start: 1.25,
      duration: null,
      end: null,
    });
  });

  it.each([
    ["blank public duration", { start: "0", duration: " ", authoredDuration: "2" }, 2],
    ["invalid public duration", { start: "0", duration: "NaN", authoredDuration: "2" }, 2],
    ["infinite public duration", { start: "0", duration: "Infinity", authoredDuration: "2" }, 2],
    ["zero public duration", { start: "0", duration: "0", authoredDuration: "2" }, 2],
    ["negative public duration", { start: "0", duration: "-2", authoredDuration: "2" }, 2],
  ])("uses a usable preserved duration after %s", (_label, values, expectedEnd) => {
    expect(resolve(values)).toEqual({ start: 0, duration: 2, end: expectedEnd });
  });

  it("uses preserved end when public end does not create a positive window", () => {
    expect(resolve({ start: "4", end: "3", authoredEnd: "5.5" })).toEqual({
      start: 4,
      duration: 1.5,
      end: 5.5,
    });
  });

  it("clamps a finite negative absolute start before deriving the window", () => {
    expect(resolve({ start: "-1", duration: "3" })).toEqual({
      start: 0,
      duration: 3,
      end: 3,
    });
  });
});
