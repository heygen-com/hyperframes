import { afterEach, expect, it, vi } from "vitest";
import { type FrameSource, registerFrameSource } from "./frameSources";
import { initSandboxRuntimeModular } from "./init";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

const disposers: Array<() => void> = [];

/** A ten-second film whose video #cam, timed by `videoAttrs`, has a frame source, played on a hand-driven clock. */
function playWithFrameSource(
  videoAttrs = 'data-start="0" data-duration="4"',
  source: Partial<FrameSource> = {},
) {
  resetRuntimeFixtureDom();
  document.body.innerHTML =
    '<div data-composition-id="main" data-root="true" data-duration="10">' +
    `<video id="cam" data-track-index="0" ${videoAttrs}></video>` +
    "</div>";
  const cam = document.getElementById("cam") as HTMLVideoElement;
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const asked: number[] = [];
  disposers.push(
    registerFrameSource({
      element: cam,
      render: (sourceTime) => void asked.push(sourceTime),
      ...source,
    }),
  );
  window.__timelines = { main: createMockTimeline(10) };

  let now = 0;
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  window.requestAnimationFrame = (cb) => (frames.set(++nextFrame, cb), nextFrame);
  window.cancelAnimationFrame = (id) => void frames.delete(id);
  const states: Array<{ isPlaying: boolean; buffering: boolean }> = [];
  vi.spyOn(window.parent, "postMessage").mockImplementation((message: unknown) => {
    const m = message as { type?: string; isPlaying: boolean; buffering: boolean };
    if (m?.type === "state") states.push({ isPlaying: m.isPlaying, buffering: m.buffering });
  });

  initSandboxRuntimeModular();
  const playFor = (seconds: number) => {
    for (let ms = 0; ms < seconds * 1000; ms += 1000 / 60) {
      now += 1000 / 60;
      const due = [...frames.values()];
      frames.clear();
      for (const cb of due) cb(now);
    }
  };
  return { cam, asked, states, playFor };
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  window.__hfRuntimeTeardown?.();
  vi.restoreAllMocks();
  resetRuntimeFixtureDom();
});

it("the runtime never loads, seeks or plays a video its frame source supplies, even one with a src", () => {
  const { cam, playFor } = playWithFrameSource('data-start="0" data-duration="4" src="/cam.mp4"');
  const load = vi.spyOn(cam, "load").mockImplementation(() => {});
  const play = vi.spyOn(cam, "play").mockImplementation(() => Promise.resolve());
  const seek = vi.fn();
  Object.defineProperty(cam, "currentTime", { get: () => 0, set: seek, configurable: true });

  window.__player!.play();
  playFor(1);
  window.__player!.seek(2);
  window.__player!.pause();
  window.__player!.play();
  playFor(1);

  expect(load).not.toHaveBeenCalled();
  expect(play).not.toHaveBeenCalled();
  expect(seek).not.toHaveBeenCalled();
});
