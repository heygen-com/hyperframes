import { describe, expect, it, vi } from "vitest";
import { buildAnimeDirectTimelineAdapter, isAnimeRegistryLike } from "./timeline-adapters.js";

describe("anime direct timeline adapters", () => {
  it("adapts hyperframesAnime entries with seconds-to-milliseconds seeking", () => {
    const seek = vi.fn();
    const play = vi.fn();
    const pause = vi.fn();
    const registry = {
      entries: () => [
        {
          id: "main",
          instance: {
            seek,
            play,
            pause,
            totalDuration: () => 2500,
            duration: 1000,
          },
          labels: {},
        },
      ],
    };

    expect(isAnimeRegistryLike(registry)).toBe(true);
    const adapter = buildAnimeDirectTimelineAdapter(registry, "main");
    if (!adapter) throw new Error("expected anime adapter");

    expect(adapter.duration()).toBe(2.5);
    expect(adapter.time()).toBe(0);

    adapter.seek(1.25, false);
    adapter.play();
    adapter.pause();

    expect(seek).toHaveBeenCalledWith(1250);
    expect(adapter.time()).toBe(1.25);
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("selects the root id from __hfAnime and falls back to the last registration", () => {
    const introSeek = vi.fn();
    const outroSeek = vi.fn();
    const registry = {
      intro: { seek: introSeek, duration: 1000 },
      outro: { id: "outro", instance: { seek: outroSeek, duration: 3000 }, labels: {} },
    };

    const rootAdapter = buildAnimeDirectTimelineAdapter(registry, "intro");
    if (!rootAdapter) throw new Error("expected root anime adapter");
    rootAdapter.seek(0.5);

    const fallbackAdapter = buildAnimeDirectTimelineAdapter(registry, "missing");
    if (!fallbackAdapter) throw new Error("expected fallback anime adapter");
    fallbackAdapter.seek(2);

    expect(introSeek).toHaveBeenCalledWith(500);
    expect(outroSeek).toHaveBeenCalledWith(2000);
    expect(rootAdapter.duration()).toBe(1);
    expect(fallbackAdapter.duration()).toBe(3);
  });
});
