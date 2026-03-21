import { describe, it, expect, vi } from "vitest";
import { createGSAPFrameAdapter } from "./gsap.js";
import type { FrameAdapter, FrameAdapterContext } from "./types.js";

function makeMockTimeline(duration = 10, totalDuration?: number) {
  return {
    duration: vi.fn().mockReturnValue(duration),
    totalDuration: totalDuration !== undefined ? vi.fn().mockReturnValue(totalDuration) : undefined,
    seek: vi.fn(),
    pause: vi.fn(),
  };
}

describe("createGSAPFrameAdapter", () => {
  it("returns a FrameAdapter with required properties", () => {
    const timeline = makeMockTimeline(10);
    const adapter = createGSAPFrameAdapter({ fps: 30, timeline });

    expect(adapter.id).toBe("gsap");
    expect(typeof adapter.init).toBe("function");
    expect(typeof adapter.getDurationFrames).toBe("function");
    expect(typeof adapter.seekFrame).toBe("function");
  });

  it("uses custom id when provided", () => {
    const timeline = makeMockTimeline(10);
    const adapter = createGSAPFrameAdapter({ id: "custom-gsap", fps: 30, timeline });

    expect(adapter.id).toBe("custom-gsap");
  });

  it("getDurationFrames returns correct frame count", () => {
    const timeline = makeMockTimeline(10); // 10 seconds
    const adapter = createGSAPFrameAdapter({ fps: 30, timeline });

    // 10 seconds * 30 fps = 300 frames
    expect(adapter.getDurationFrames()).toBe(300);
  });

  it("getDurationFrames uses totalDuration when available", () => {
    const timeline = makeMockTimeline(5, 15); // duration=5, totalDuration=15
    const adapter = createGSAPFrameAdapter({ fps: 30, timeline });

    // Should use totalDuration (15) not duration (5)
    // 15 seconds * 30 fps = 450 frames
    expect(adapter.getDurationFrames()).toBe(450);
  });

  it("getDurationFrames returns 0 for zero-duration timeline", () => {
    const timeline = makeMockTimeline(0);
    const adapter = createGSAPFrameAdapter({ fps: 30, timeline });

    expect(adapter.getDurationFrames()).toBe(0);
  });

  it("init pauses the timeline", () => {
    const timeline = makeMockTimeline(10);
    const adapter = createGSAPFrameAdapter({ fps: 30, timeline });

    adapter.init!({} as FrameAdapterContext);

    expect(timeline.pause).toHaveBeenCalled();
  });

  it("seekFrame seeks to the correct time in seconds", () => {
    const timeline = makeMockTimeline(10);
    const adapter = createGSAPFrameAdapter({ fps: 30, timeline });

    adapter.seekFrame(90); // Frame 90 at 30fps = 3 seconds

    expect(timeline.seek).toHaveBeenCalledWith(3, false);
    expect(timeline.pause).toHaveBeenCalled();
  });

  it("seekFrame clamps negative frames to 0", () => {
    const timeline = makeMockTimeline(10);
    const adapter = createGSAPFrameAdapter({ fps: 30, timeline });

    adapter.seekFrame(-5);

    expect(timeline.seek).toHaveBeenCalledWith(0, false);
  });

  it("seekFrame handles non-finite frame numbers", () => {
    const timeline = makeMockTimeline(10);
    const adapter = createGSAPFrameAdapter({ fps: 30, timeline });

    adapter.seekFrame(NaN);

    expect(timeline.seek).toHaveBeenCalledWith(0, false);
  });

  it("seekFrame handles Infinity", () => {
    const timeline = makeMockTimeline(10);
    const adapter = createGSAPFrameAdapter({ fps: 30, timeline });

    adapter.seekFrame(Infinity);

    // Infinity is not finite, so it gets clamped to 0
    expect(timeline.seek).toHaveBeenCalledWith(0, false);
  });

  it("works without pause method on timeline", () => {
    const timeline = {
      duration: vi.fn().mockReturnValue(5),
      seek: vi.fn(),
      // No pause method
    };

    const adapter = createGSAPFrameAdapter({ fps: 30, timeline });

    // Should not throw
    adapter.init!({} as FrameAdapterContext);
    adapter.seekFrame(0);

    expect(timeline.seek).toHaveBeenCalled();
  });

  it("getDurationFrames ceiling the frame count", () => {
    const timeline = makeMockTimeline(1.05); // 1.05 seconds * 30 fps = 31.5 -> ceil = 32
    const adapter = createGSAPFrameAdapter({ fps: 30, timeline });

    expect(adapter.getDurationFrames()).toBe(32);
  });
});

describe("FrameAdapter type", () => {
  it("adapter conforms to FrameAdapter interface", () => {
    const timeline = makeMockTimeline(10);
    const adapter: FrameAdapter = createGSAPFrameAdapter({ fps: 30, timeline });

    expect(adapter.id).toBeDefined();
    expect(adapter.getDurationFrames).toBeDefined();
    expect(adapter.seekFrame).toBeDefined();
  });
});
