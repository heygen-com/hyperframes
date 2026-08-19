/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  interpolateVolumeGain,
  probeAndCacheElementVolume,
  probeElementVolumeKeyframes,
} from "./mediaVolumeEnvelope";

describe("probeElementVolumeKeyframes", () => {
  it("treats trailing-garbage duration as unknown instead of truncating preview sampling", () => {
    const audio = document.createElement("audio");
    audio.dataset.start = "0";
    audio.dataset.duration = "5s";
    audio.dataset.volume = "0";

    const keyframes = probeElementVolumeKeyframes(
      audio,
      (time) => {
        audio.volume = time < 7 ? 0 : 1;
      },
      10,
      1,
    );

    expect(keyframes).toContainEqual({ time: 7, volume: 1 });
  });

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

  it("caches a track-relative envelope for a clip that starts after t=0", () => {
    // The probe stamps timeline seek times. A clip starting at 2s therefore
    // yields keyframes at 2.0+, and reading them with track-relative time landed
    // before the first keyframe and clamped to its volume — 0 for a fade-in, so
    // the preview stayed silent for the whole clip while the render was correct.
    const audio = document.createElement("audio");
    audio.dataset.start = "2";
    audio.dataset.duration = "1";
    audio.dataset.volume = "1";
    document.body.append(audio);

    const timeline = {
      totalTime(next?: number) {
        if (next !== undefined) {
          // 0.05s linear fade-in at the clip's start (timeline t=2).
          audio.volume = Math.max(0, Math.min(1, (next - 2) / 0.05));
        }
        return 0;
      },
    };
    const cache = new WeakMap<HTMLMediaElement, { time: number; volume: number }[]>();

    probeAndCacheElementVolume(audio, timeline, 3, cache);

    const envelope = cache.get(audio);
    if (!envelope) throw new Error("Expected a cached envelope");
    expect(envelope[0]).toEqual({ time: 0, volume: 0 });
    expect(envelope.at(-1)?.time).toBeCloseTo(1, 5);

    // Silent at the clip's start, full once the fade is done, and it stays there.
    expect(interpolateVolumeGain(envelope, 0)).toBeCloseTo(0, 5);
    expect(interpolateVolumeGain(envelope, 0.05)).toBeCloseTo(1, 5);
    expect(interpolateVolumeGain(envelope, 0.5)).toBeCloseTo(1, 5);
    expect(interpolateVolumeGain(envelope, 1)).toBeCloseTo(1, 5);
  });
  it("keeps a fade that starts from an above-unity authored gain", () => {
    const audio = document.createElement("audio");
    audio.dataset.start = "0";
    audio.dataset.duration = "2";
    audio.dataset.volume = "1.949845"; // +5.8 dB

    // A GSAP tween reads the seeded value as its FROM. Through the spec's
    // [0,1] clamp on `HTMLMediaElement.volume` that read back as 1, so the
    // whole authored boost was thrown away by the mere presence of a fade.
    const keyframes = probeElementVolumeKeyframes(
      audio,
      (time) => {
        audio.volume = 1.949845 * Math.max(0, 1 - time / 2);
      },
      2,
      10,
    );

    expect(keyframes?.[0]?.volume).toBeCloseTo(1.949845, 5);
    expect(audio.volume).toBeLessThanOrEqual(1);
  });

  it("carries an above-unity tween target through to the envelope", () => {
    const audio = document.createElement("audio");
    audio.dataset.start = "0";
    audio.dataset.duration = "1";
    audio.dataset.volume = "1";

    const keyframes = probeElementVolumeKeyframes(
      audio,
      (time) => {
        audio.volume = 1 + time;
      },
      1,
      10,
    );

    expect(keyframes?.at(-1)?.volume).toBeCloseTo(2, 5);
  });

  it("restores the native accessor once the probe is done", () => {
    const audio = document.createElement("audio");
    audio.dataset.start = "0";
    audio.dataset.duration = "1";
    audio.dataset.volume = "2";

    probeElementVolumeKeyframes(audio, () => {}, 1, 10);

    // The own accessor is gone and the spec setter is back in charge: it
    // rejects an out-of-range volume rather than silently taking it.
    expect(Object.getOwnPropertyDescriptor(audio, "volume")).toBeUndefined();
    expect(audio.volume).toBe(1);
    expect(() => {
      audio.volume = 5;
    }).toThrow();
  });
});
