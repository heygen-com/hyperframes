import { describe, it, expect, vi } from "vitest";
import { createGsapAdapter } from "./gsap";
import type { RuntimeTimelineLike } from "../types";

function createMockTimeline(): RuntimeTimelineLike {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    totalTime: vi.fn(),
    time: vi.fn(() => 0),
    duration: vi.fn(() => 10),
    add: vi.fn(),
    paused: vi.fn(),
    set: vi.fn(),
  };
}

describe("gsap adapter", () => {
  it("has correct name", () => {
    const adapter = createGsapAdapter({ getTimeline: () => null });
    expect(adapter.name).toBe("gsap");
  });

  it("seek uses totalTime when available", () => {
    const timeline = createMockTimeline();
    const adapter = createGsapAdapter({ getTimeline: () => timeline });
    adapter.seek({ time: 5 });
    expect(timeline.pause).toHaveBeenCalled();
    expect(timeline.totalTime).toHaveBeenCalledWith(5, false);
    expect(timeline.seek).not.toHaveBeenCalled();
  });

  it("seek falls back to .seek() when totalTime is missing", () => {
    const timeline = createMockTimeline();
    (timeline as Record<string, unknown>).totalTime = undefined;
    const adapter = createGsapAdapter({ getTimeline: () => timeline });
    adapter.seek({ time: 3 });
    expect(timeline.pause).toHaveBeenCalled();
    expect(timeline.seek).toHaveBeenCalledWith(3, false);
  });

  it("seek clamps negative time to 0", () => {
    const timeline = createMockTimeline();
    const adapter = createGsapAdapter({ getTimeline: () => timeline });
    adapter.seek({ time: -5 });
    expect(timeline.totalTime).toHaveBeenCalledWith(0, false);
  });

  it("seek handles NaN time", () => {
    const timeline = createMockTimeline();
    const adapter = createGsapAdapter({ getTimeline: () => timeline });
    adapter.seek({ time: NaN });
    expect(timeline.totalTime).toHaveBeenCalledWith(0, false);
  });

  it("seek does nothing without timeline", () => {
    const adapter = createGsapAdapter({ getTimeline: () => null });
    expect(() => adapter.seek({ time: 5 })).not.toThrow();
  });

  it("pause pauses the timeline", () => {
    const timeline = createMockTimeline();
    const adapter = createGsapAdapter({ getTimeline: () => timeline });
    adapter.pause();
    expect(timeline.pause).toHaveBeenCalled();
  });

  it("pause does nothing without timeline", () => {
    const adapter = createGsapAdapter({ getTimeline: () => null });
    expect(() => adapter.pause()).not.toThrow();
  });

  it("discover is a no-op", () => {
    const adapter = createGsapAdapter({ getTimeline: () => null });
    expect(() => adapter.discover()).not.toThrow();
  });
});
