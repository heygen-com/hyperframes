/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { probeAndCacheElementVolume } from "./mediaVolumeEnvelope";

describe("probeAndCacheElementVolume", () => {
  it("restores the timeline playhead after sampling volume automation", () => {
    const audio = document.createElement("audio");
    audio.dataset.volume = "1";
    document.body.append(audio);

    let playhead = 0.75;
    const timeline = {
      totalTime(next?: number) {
        if (next !== undefined) {
          playhead = next;
          audio.volume = next >= 1 ? 0 : 1;
        }
        return playhead;
      },
    };
    const cache = new WeakMap<HTMLMediaElement, { time: number; volume: number }[]>();

    probeAndCacheElementVolume(audio, timeline, 1, cache);

    expect(playhead).toBe(0.75);
    expect(audio.volume).toBe(1);
    expect(cache.get(audio)).toEqual(
      expect.arrayContaining([expect.objectContaining({ volume: 0 })]),
    );
  });
});
