import { describe, expect, it } from "vitest";
import {
  masterTimeline,
  resolveDuration,
  seekTimelines,
  type TimelineLike,
  type TimelineRegistry,
} from "./timelineSeek.js";

interface FakeTimeline extends TimelineLike {
  calls: string[];
}

function fakeTimeline(duration: number): FakeTimeline {
  const calls: string[] = [];
  return {
    calls,
    duration: () => duration,
    pause() {
      calls.push("pause");
    },
    seek(timeSeconds: number, suppressEvents?: boolean) {
      calls.push(`seek:${timeSeconds}:${suppressEvents}`);
    },
  };
}

describe("masterTimeline", () => {
  it("prefers the timeline registered under the composition id", () => {
    const main = fakeTimeline(5);
    const other = fakeTimeline(2);
    const registry: TimelineRegistry = { other, main };
    expect(masterTimeline(registry, "main")).toBe(main);
  });

  it("falls back to the first registered timeline", () => {
    const first = fakeTimeline(3);
    expect(masterTimeline({ first }, "missing")).toBe(first);
    expect(masterTimeline({}, null)).toBeNull();
  });
});

describe("resolveDuration", () => {
  it("uses a valid override before the timeline", () => {
    expect(resolveDuration({ main: fakeTimeline(5) }, "main", 2)).toBe(2);
  });

  it("reads the master timeline duration otherwise", () => {
    expect(resolveDuration({ main: fakeTimeline(5) }, "main")).toBe(5);
    expect(resolveDuration({ main: fakeTimeline(5) }, "main", -1)).toBe(5);
  });

  it("returns 0 when nothing usable exists", () => {
    expect(resolveDuration({}, null)).toBe(0);
    expect(resolveDuration({ main: fakeTimeline(0) }, "main")).toBe(0);
  });
});

describe("seekTimelines", () => {
  it("pauses then seeks every timeline at the quantized frame time", () => {
    const a = fakeTimeline(5);
    const b = fakeTimeline(5);
    const quantized = seekTimelines({ a, b }, 1.51, 30);
    expect(quantized).toBeCloseTo(1.5, 10);
    expect(a.calls).toEqual(["pause", `seek:${quantized}:true`]);
    expect(b.calls).toEqual(["pause", `seek:${quantized}:true`]);
  });
});
