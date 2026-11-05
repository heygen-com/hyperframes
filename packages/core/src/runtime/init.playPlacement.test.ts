import { afterEach, describe, expect, it, vi } from "vitest";
import { mediaElementTime } from "./mediaClock";
import { initSandboxRuntimeModular } from "./init";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

function mountPlayer(videoAttrs: string, sourceDuration: number) {
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
  const step = (frames: number) => {
    for (let i = 0; i < frames; i++) {
      now += 100;
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(now);
    }
  };
  document.body.innerHTML = `<div data-composition-id="main" data-root="true" data-duration="10"><video data-start="0" data-duration="10" ${videoAttrs} src="/movie.mp4"></video></div>`;
  const video = document.querySelector("video")!;
  // A decoder in step with the mocked clock: its position advances at its rate while unpaused.
  const seeks: number[] = [];
  const rates: number[] = [];
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
        seeks.push(t);
        position = t;
        anchor = now;
      },
      configurable: true,
    },
    paused: { get: () => paused, configurable: true },
    playbackRate: {
      get: () => rate,
      set: (r: number) => {
        rates.push(r);
        reanchor();
        rate = r;
      },
      configurable: true,
    },
    duration: { value: sourceDuration, configurable: true },
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
  return { player: window.__player!, video, step, seeks, rates };
}

afterEach(() => {
  window.__hfRuntimeTeardown?.();
  vi.restoreAllMocks();
  resetRuntimeFixtureDom();
});

describe.each([
  // name, attributes, source seconds, source time at t=5, at t=5.5, rate
  ["a clip at its own rate", "", 20, 5, 5.5, 1],
  ["a clip at 2x", 'data-playback-rate="2"', 20, 10, 11, 2],
  ["a looping clip", "loop", 4, 1, 1.5, 1],
])("%s", (_name, attrs, sourceDuration, atFive, atFiveAndAHalf, rate) => {
  it("lands at its source time in one seek when play is pressed", () => {
    const { player, video, step, seeks } = mountPlayer(attrs, sourceDuration);
    player.seek(5);
    video.currentTime = 0;
    seeks.length = 0;
    player.play();
    step(3);
    expect(seeks).toEqual([mediaElementTime(atFive)]);
    expect(video.currentTime).toBeCloseTo(mediaElementTime(atFive + 0.3 * rate), 5);
  });

  it("lands at its source time in one seek when seeked while playing", () => {
    const { player, video, step, seeks } = mountPlayer(attrs, sourceDuration);
    player.play();
    step(10);
    seeks.length = 0;
    player.seek(5.5, { keepPlaying: true });
    step(3);
    expect(player.isPlaying()).toBe(true);
    expect(seeks).toEqual([mediaElementTime(atFiveAndAHalf)]);
    expect(video.currentTime).toBeCloseTo(mediaElementTime(atFiveAndAHalf + 0.3 * rate), 5);
  });
});

it("does not seek a paused video already at its source time when play is pressed", () => {
  const { player, video, step, seeks } = mountPlayer("", 20);
  player.seek(5);
  seeks.length = 0;
  player.play();
  step(3);
  expect(seeks).toEqual([]);
  expect(video.currentTime).toBeCloseTo(mediaElementTime(5.3), 5);
});

it("keeps a clip's own rate when the transport rate is set while playing", () => {
  const { player, video, step, rates } = mountPlayer('data-playback-rate="1.15"', 20);
  player.play();
  step(3);
  rates.length = 0;
  // Studio sends the transport rate on every Play.
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      data: { source: "hf-parent", type: "control", action: "set-playback-rate", playbackRate: 1 },
    }),
  );
  step(3);
  expect(rates.filter((rate) => Math.abs(rate - 1.15) > 1e-9)).toEqual([]);
  expect(video.playbackRate).toBeCloseTo(1.15, 9);
});

describe("pause placement", () => {
  it("leaves a video leased while paused where its owner put it", () => {
    const { player, video, step, seeks } = mountPlayer("", 20);
    player.play();
    step(3);
    window.__hf!.leasePausedMedia!(video);
    video.currentTime = 1;
    seeks.length = 0;
    player.pause();
    step(3);
    expect(seeks).toEqual([]);
  });

  it("still places an unleased video at the playhead", () => {
    const { player, video, step, seeks } = mountPlayer("", 20);
    player.play();
    step(3);
    video.currentTime = 1;
    seeks.length = 0;
    player.pause();
    step(3);
    expect(seeks).toEqual([mediaElementTime(0.3)]);
  });
});

it("does not move media on play while native media sync is disabled", () => {
  const { player, video, step, seeks } = mountPlayer("", 20);
  // What the slideshow player sends: its presenter drives the slide media itself.
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      data: {
        source: "hf-parent",
        type: "control",
        action: "set-native-media-sync-disabled",
        disabled: true,
      },
    }),
  );
  player.seek(5);
  seeks.length = 0;
  player.play();
  step(3);
  expect(seeks).toEqual([]);
  expect(video.currentTime).toBe(0);
});
