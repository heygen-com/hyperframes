import { describe, expect, it, vi } from "vitest";
import { pauseStudioPreviewPlayback } from "./studioPreviewHelpers";

describe("pauseStudioPreviewPlayback", () => {
  it("pauses through __player without pausing sibling timelines directly", () => {
    const playerPause = vi.fn();
    const timelinePause = vi.fn();
    const siblingPause = vi.fn();

    const iframe = {
      contentWindow: {
        __player: {
          getTime: () => 4.25,
          pause: playerPause,
        },
        __timeline: {
          time: () => 4.25,
          pause: timelinePause,
        },
        __timelines: {
          root: {
            pause: siblingPause,
          },
        },
      },
    } as unknown as HTMLIFrameElement;

    expect(pauseStudioPreviewPlayback(iframe)).toBe(4.25);
    expect(playerPause).toHaveBeenCalledTimes(1);
    expect(timelinePause).not.toHaveBeenCalled();
    expect(siblingPause).not.toHaveBeenCalled();
  });

  it("falls back to pausing timelines directly when __player is unavailable", () => {
    const timelinePause = vi.fn();
    const siblingPause = vi.fn();

    const iframe = {
      contentWindow: {
        __timeline: {
          time: () => 2.5,
          pause: timelinePause,
        },
        __timelines: {
          root: {
            pause: siblingPause,
          },
        },
      },
    } as unknown as HTMLIFrameElement;

    expect(pauseStudioPreviewPlayback(iframe)).toBe(2.5);
    expect(timelinePause).toHaveBeenCalledTimes(1);
    expect(siblingPause).toHaveBeenCalledTimes(1);
  });
});
