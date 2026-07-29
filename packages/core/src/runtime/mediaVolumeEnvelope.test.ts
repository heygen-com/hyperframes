/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { probeAndCacheElementVolume, probeElementVolumeKeyframes } from "./mediaVolumeEnvelope";

describe("probeElementVolumeKeyframes", () => {
  it("retains the last plateau sample before a short volume change", () => {
    const audio = document.createElement("audio");
    audio.dataset.start = "0";
    audio.dataset.duration = "2";
    audio.dataset.volume = "0.8";

    const keyframes = probeElementVolumeKeyframes(
      audio,
      (time) => {
        audio.volume = time < 1.05 ? 0.8 : 0.2;
      },
      2,
      10,
    );

    expect(keyframes).toContainEqual({ time: 1, volume: 0.8 });
    expect(keyframes).toContainEqual({ time: 1.1, volume: 0.2 });
  });

  it("samples a short transition at a clip end between frame intervals", () => {
    const audio = document.createElement("audio");
    audio.dataset.start = "0";
    audio.dataset.duration = "1.05";
    audio.dataset.volume = "0.7";

    const keyframes = probeElementVolumeKeyframes(
      audio,
      (time) => {
        audio.volume = time < 1.02 ? 0.7 : 0.1;
      },
      1.05,
      10,
    );

    expect(keyframes).toEqual([
      { time: 0, volume: 0.7 },
      { time: 1, volume: 0.7 },
      { time: 1.05, volume: 0.1 },
    ]);
  });

  it("preserves every sampled point of a continuous ramp", () => {
    const audio = document.createElement("audio");
    audio.dataset.start = "0";
    audio.dataset.duration = "0.5";
    audio.dataset.volume = "0";

    const keyframes = probeElementVolumeKeyframes(
      audio,
      (time) => {
        audio.volume = time * 2;
      },
      0.5,
      10,
    );

    expect(keyframes).toEqual([
      { time: 0, volume: 0 },
      { time: 0.1, volume: 0.2 },
      { time: 0.2, volume: 0.4 },
      { time: 0.3, volume: 0.6 },
      { time: 0.4, volume: 0.8 },
      { time: 0.5, volume: 1 },
    ]);
  });

  it("prefers data-duration when a stale data-end is also present", () => {
    const video = document.createElement("video");
    video.dataset.start = "0";
    video.dataset.end = "0.25";
    video.dataset.duration = "1";
    video.dataset.volume = "0";

    const sampledTimes: number[] = [];
    probeElementVolumeKeyframes(
      video,
      (time) => {
        sampledTimes.push(time);
        video.volume = time;
      },
      1,
      10,
    );

    expect(sampledTimes.at(-1)).toBe(1);
  });
});

describe("probeAndCacheElementVolume", () => {
  it("does not seek or cache when live timeline probing is disabled", () => {
    const audio = document.createElement("audio");
    audio.dataset.volume = "1";
    document.body.append(audio);

    let seekCount = 0;
    const timeline = {
      totalTime(next?: number) {
        if (next !== undefined) {
          seekCount += 1;
          audio.volume = next >= 1 ? 0 : 1;
        }
        return 0.75;
      },
    };
    const cache = new WeakMap<HTMLMediaElement, { time: number; volume: number }[]>();

    probeAndCacheElementVolume(audio, timeline, 1, cache, {
      allowLiveTimelineSeek: false,
    });

    expect(seekCount).toBe(0);
    expect(audio.volume).toBe(1);
    expect(cache.has(audio)).toBe(false);
  });

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
