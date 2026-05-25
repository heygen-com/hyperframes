import { describe, expect, it, vi } from "vitest";
import { wrapTimeline } from "./playbackAdapter";
import type { TimelineLike } from "./playbackTypes";

describe("wrapTimeline seek keepPlaying option (#834)", () => {
  function mockTimeline(): TimelineLike & {
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    seek: ReturnType<typeof vi.fn>;
  } {
    return {
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn(),
      time: () => 0,
      duration: () => 10,
      isActive: () => false,
    };
  }

  it("default seek pauses the GSAP timeline before and after seeking", () => {
    const tl = mockTimeline();
    const adapter = wrapTimeline(tl);

    adapter.seek(5);

    expect(tl.pause).toHaveBeenCalledTimes(2);
    expect(tl.seek).toHaveBeenCalledWith(5);
  });

  it("seek with { keepPlaying: true } skips the implicit pause", () => {
    const tl = mockTimeline();
    const adapter = wrapTimeline(tl);

    adapter.seek(5, { keepPlaying: true });

    expect(tl.pause).not.toHaveBeenCalled();
    expect(tl.seek).toHaveBeenCalledWith(5);
  });

  it("seek with { keepPlaying: false } still pauses (explicit default)", () => {
    const tl = mockTimeline();
    const adapter = wrapTimeline(tl);

    adapter.seek(5, { keepPlaying: false });

    expect(tl.pause).toHaveBeenCalledTimes(2);
    expect(tl.seek).toHaveBeenCalledWith(5);
  });
});
