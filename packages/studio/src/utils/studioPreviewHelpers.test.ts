import { describe, expect, it, vi } from "vitest";
import { coversComposition, pauseStudioPreviewPlayback } from "./studioPreviewHelpers";

describe("coversComposition (full-bleed canvas-pick exclusion)", () => {
  const viewport = { width: 1920, height: 1080 };

  it("treats a full-bleed scene wrapper as covering the composition", () => {
    expect(coversComposition({ width: 1920, height: 1080 }, viewport)).toBe(true);
    expect(coversComposition({ width: 1900, height: 1040 }, viewport)).toBe(true); // ~99%/96%
  });

  it("does NOT exclude inner content (a stat card, a heading)", () => {
    expect(coversComposition({ width: 320, height: 180 }, viewport)).toBe(false);
    expect(coversComposition({ width: 1900, height: 200 }, viewport)).toBe(false); // wide but short
    expect(coversComposition({ width: 200, height: 1040 }, viewport)).toBe(false); // tall but narrow
  });

  it("needs BOTH axes near full-bleed (>=95%)", () => {
    expect(coversComposition({ width: 1800, height: 1080 }, viewport)).toBe(false); // 93.75% wide
    expect(coversComposition({ width: 1920, height: 1000 }, viewport)).toBe(false); // 92.6% tall
  });

  it("guards against a degenerate viewport", () => {
    expect(coversComposition({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(false);
    expect(coversComposition({ width: 100, height: 100 }, { width: 1, height: 1 })).toBe(false);
  });
});

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
