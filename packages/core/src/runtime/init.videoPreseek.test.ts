import { afterEach, expect, it, vi } from "vitest";
import { mediaElementTime } from "./mediaClock";
import { initSandboxRuntimeModular } from "./init";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

it.each(["video", "audio"])(
  "prepares an upcoming %s when playback enters its lookahead, after metadata arrives",
  (tag) => {
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
    const step = () => {
      now += 100;
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(now);
    };
    document.body.innerHTML = `<div data-composition-id="main" data-root="true" data-duration="6"><${tag} id="incoming" data-start="4" data-duration="2" data-media-start="8" src="/movie.mp4"></${tag}></div>`;
    const video = document.querySelector<HTMLMediaElement>(tag)!;
    Object.defineProperty(video, "duration", { value: 20, configurable: true });
    Object.defineProperty(video, "readyState", { value: 0, configurable: true });
    Object.defineProperty(video, "paused", { value: true, writable: true, configurable: true });
    const play = vi.fn(() => {
      Object.assign(video, { paused: false });
      return Promise.resolve();
    });
    video.play = play;
    video.pause = vi.fn(() => {
      Object.assign(video, { paused: true });
    });
    video.load = vi.fn();
    const seek = vi.spyOn(video, "currentTime", "set");
    window.__timelines = { main: createMockTimeline(6) };
    initSandboxRuntimeModular();
    window.__player!.play();
    for (let i = 0; i < 28; i++) step();
    expect(seek).not.toHaveBeenCalled();
    Object.defineProperty(video, "readyState", { value: 4, configurable: true });
    step();
    if (tag === "video") expect(video.style.visibility).toBe("hidden");
    expect(video.currentTime).toBe(mediaElementTime(8));
    expect(play).not.toHaveBeenCalled();
    for (let i = 0; i < 11; i++) step();
    if (tag === "video") expect(video.style.visibility).toBe("visible");
    expect(seek).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
  },
);

afterEach(() => {
  window.__hfRuntimeTeardown?.();
  vi.restoreAllMocks();
  resetRuntimeFixtureDom();
});
