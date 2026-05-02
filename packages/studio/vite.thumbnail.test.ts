import { describe, expect, it, vi } from "vitest";
import { seekThumbnailPreview } from "./vite.thumbnail";

describe("seekThumbnailPreview", () => {
  it("prefers the HyperFrames player seek path over raw timelines", async () => {
    const evaluate = vi.fn(async (fn: (time: number) => string, time: number) => {
      const playerSeek = vi.fn();
      const timelinePause = vi.fn();
      const previousWindow = globalThis.window;
      vi.stubGlobal("window", {
        __player: { seek: playerSeek },
        __timelines: {
          main: { pause: timelinePause },
          nested: { pause: timelinePause },
        },
      });
      try {
        const result = fn(time);
        expect(playerSeek).toHaveBeenCalledWith(10);
        expect(timelinePause).not.toHaveBeenCalled();
        return result;
      } finally {
        vi.stubGlobal("window", previousWindow);
      }
    });

    await expect(seekThumbnailPreview({ evaluate }, 10)).resolves.toBe("player");
  });

  it("falls back to all registered timelines for standalone composition pages", async () => {
    const evaluate = vi.fn(async (fn: (time: number) => string, time: number) => {
      const firstPause = vi.fn();
      const secondPause = vi.fn();
      const tickerTick = vi.fn();
      const previousWindow = globalThis.window;
      vi.stubGlobal("window", {
        __timelines: {
          first: { pause: firstPause },
          second: { pause: secondPause },
        },
        gsap: { ticker: { tick: tickerTick } },
      });
      try {
        const result = fn(time);
        expect(firstPause).toHaveBeenCalledWith(2.5);
        expect(secondPause).toHaveBeenCalledWith(2.5);
        expect(tickerTick).toHaveBeenCalled();
        return result;
      } finally {
        vi.stubGlobal("window", previousWindow);
      }
    });

    await expect(seekThumbnailPreview({ evaluate }, 2.5)).resolves.toBe("timelines");
  });
});
