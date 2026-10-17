import { afterEach, describe, expect, it, vi } from "vitest";
import { initRuntimeAnalytics } from "./analytics";
import { initSandboxRuntimeModular } from "./init";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

const FRAME_MS = 100;

function mountPlayer(rateAttr: string) {
  resetRuntimeFixtureDom();
  let now = 0;
  let id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callbacks.set(++id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((key) => {
    callbacks.delete(key);
  });
  const step = (frames = 1) => {
    for (let i = 0; i < frames; i++) {
      now += FRAME_MS;
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(now);
    }
  };
  document.body.innerHTML = `<div data-composition-id="main" data-root="true" data-duration="10"><video data-start="0" data-duration="10" ${rateAttr} src="/movie.mp4"></video></div>`;
  const video = document.querySelector("video")!;
  // A decoder in step with the mocked clock: its position advances at its rate while unpaused.
  let position = 0;
  let anchor = 0;
  let paused = true;
  let rate = 1;
  const read = () => (paused ? position : position + ((now - anchor) / 1000) * rate);
  const reanchor = () => {
    position = read();
    anchor = now;
  };
  Object.defineProperties(video, {
    currentTime: {
      get: read,
      set: (t: number) => {
        position = t;
        anchor = now;
      },
      configurable: true,
    },
    paused: { get: () => paused, configurable: true },
    playbackRate: {
      get: () => rate,
      set: (r: number) => {
        reanchor();
        rate = r;
      },
      configurable: true,
    },
    duration: { value: 20, configurable: true },
    readyState: { value: 4, configurable: true },
  });
  video.play = vi.fn(() => {
    reanchor();
    paused = false;
    return Promise.resolve();
  });
  video.pause = vi.fn(() => {
    reanchor();
    paused = true;
  });
  video.load = vi.fn();
  window.__timelines = { main: createMockTimeline(10) };
  initSandboxRuntimeModular();
  const resyncs: unknown[] = [];
  initRuntimeAnalytics((msg) => {
    if ((msg as { event?: string }).event === "media_resynced") resyncs.push(msg);
  });
  /** The decoder falls `seconds` behind on its own, as a stalled fetch would. */
  const stall = (seconds: number) => {
    anchor += (seconds * 1000) / rate;
  };
  return { player: window.__player!, video, step, stall, resyncs };
}

afterEach(() => {
  window.__hfRuntimeTeardown?.();
  vi.restoreAllMocks();
  resetRuntimeFixtureDom();
});

describe.each([
  ["a clip at its own rate", ""],
  ["a clip at 2x", 'data-playback-rate="2"'],
])("media_resynced through the player, %s", (_name, rateAttr) => {
  it("is reported when the playing video falls behind on its own", () => {
    const { player, step, stall, resyncs } = mountPlayer(rateAttr);
    player.play();
    step(10);
    expect(resyncs).toEqual([]);
    stall(1);
    step();
    expect(resyncs).toHaveLength(1);
  });

  it("is not reported for a user's seek while playing", () => {
    const { player, video, step, resyncs } = mountPlayer(rateAttr);
    const rate = rateAttr ? 2 : 1;
    player.play();
    step(10);
    player.seek(6);
    player.play();
    step(10);
    expect(player.isPlaying()).toBe(true);
    expect(video.currentTime).toBeCloseTo(7 * rate, 1);
    expect(resyncs).toEqual([]);
  });

  it("is not reported for a seek that keeps playing", () => {
    const { player, video, step, resyncs } = mountPlayer(rateAttr);
    const rate = rateAttr ? 2 : 1;
    player.play();
    step(10);
    player.seek(6, { keepPlaying: true });
    step(10);
    expect(player.isPlaying()).toBe(true);
    expect(video.currentTime).toBeCloseTo(7 * rate, 1);
    expect(resyncs).toEqual([]);
  });

  it("is not reported when playback loops back to the start", () => {
    const { player, video, step, resyncs } = mountPlayer(rateAttr);
    const rate = rateAttr ? 2 : 1;
    player.play();
    step(105);
    expect(player.isPlaying()).toBe(false);
    // The host loops by seeking to the start and playing again.
    player.seek(0, { keepPlaying: true });
    player.play();
    step(10);
    expect(player.isPlaying()).toBe(true);
    expect(video.currentTime).toBeCloseTo(1 * rate, 1);
    expect(resyncs).toEqual([]);
  });
});
