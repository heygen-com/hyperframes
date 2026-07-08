import { describe, expect, it, vi } from "vitest";
import { loadHyperframeRuntimeSource } from "@hyperframes/core";
import { loadRuntimeSource } from "./runtimeSource.js";
import { isThumbnailTimelineReady, seekThumbnailPage } from "./thumbnailTimeline.js";

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

describe("loadRuntimeSource", () => {
  it("loads runtime source from the published core entrypoint", async () => {
    await expect(loadRuntimeSource()).resolves.toBe(loadHyperframeRuntimeSource());
  });
});

describe("thumbnail timeline helpers", () => {
  it("treats hyperframesAnime registrations as thumbnail-ready", () => {
    withWindowValue(
      {
        hyperframesAnime: {
          entries: () => [{ id: "main", instance: { seek: vi.fn(), duration: 1000 }, labels: {} }],
        },
      },
      () => {
        expect(isThumbnailTimelineReady()).toBe(true);
      },
    );
  });

  it("seeks anime registrations in milliseconds when no GSAP timelines exist", () => {
    const seek = vi.fn();
    withWindowValue(
      {
        hyperframesAnime: {
          entries: () => [{ id: "main", instance: { seek, duration: 1000 }, labels: {} }],
        },
      },
      () => {
        seekThumbnailPage(1.25);
      },
    );

    expect(seek).toHaveBeenCalledWith(1250);
  });

  it("preserves the GSAP fallback path when GSAP timelines are present", () => {
    const pause = vi.fn();
    const tick = vi.fn();
    const animeSeek = vi.fn();
    withWindowValue(
      {
        __timelines: { main: { pause } },
        gsap: { ticker: { tick } },
        hyperframesAnime: {
          entries: () => [{ id: "main", instance: { seek: animeSeek }, labels: {} }],
        },
      },
      () => {
        seekThumbnailPage(2);
      },
    );

    expect(pause).toHaveBeenCalledWith(2);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(animeSeek).not.toHaveBeenCalled();
  });
});
